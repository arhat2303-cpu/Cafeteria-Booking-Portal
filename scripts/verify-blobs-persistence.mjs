#!/usr/bin/env node
/**
 * Verifies the Netlify Blobs persistence path of the deployed function artifact.
 *
 * A mock Netlify Blobs API (the same protocol `@netlify/blobs` speaks in production:
 * `/api/v1/blobs/...` → signed URL → GET/PUT) is started locally, `NETLIFY_BLOBS_CONTEXT`
 * is injected exactly like the Netlify runtime does, and `dist/functions/api.cjs` is run in
 * TWO SEPARATE Node processes to reproduce a genuine cold start + warm rehydration cycle.
 *
 * Cold start #1 signs in as an Admin and creates a Chef account.
 * Cold start #2 must see that Chef account (proving the snapshot round-trips through Blobs)
 * and must sign in successfully — the exact failure the user reported as "502".
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const bundle = path.join(root, 'dist', 'functions', 'api.cjs');

const blobs = new Map(); // key -> { data: Buffer, metadata?: string }
const etagOf = () => `"${crypto.randomUUID()}"`;

const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    const method = req.method.toUpperCase();

    const send = (status, payload, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(payload === undefined ? '' : JSON.stringify(payload));
    };

    // Signed-URL data plane
    if (url.pathname.startsWith('/signed/')) {
      const key = decodeURIComponent(url.pathname.slice('/signed/'.length));
      if (method === 'PUT') {
        const etag = etagOf();
        blobs.set(key, { data: body, etag });
        res.writeHead(200, { etag });
        res.end();
        return;
      }
      const entry = blobs.get(key);
      if (!entry) {
        res.writeHead(404).end();
        return;
      }
      if (method === 'HEAD') {
        res.writeHead(200, { etag: entry.etag, 'content-length': entry.data.length }).end();
        return;
      }
      res.writeHead(200, {
        etag: entry.etag,
        'content-type': 'application/octet-stream',
        'content-length': entry.data.length,
      });
      res.end(entry.data);
      return;
    }

    if (!url.pathname.startsWith('/api/v1/blobs/')) {
      send(404, { error: 'not found' });
      return;
    }

    if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
      send(401, { error: 'unauthorized' });
      return;
    }

    // /api/v1/blobs/{siteID}/{storeName}/{...key}
    const parts = url.pathname.slice('/api/v1/blobs/'.length).split('/');
    const key = parts.slice(2).map(decodeURIComponent).join('/');

    if (method === 'HEAD') {
      const entry = blobs.get(key);
      if (!entry) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { etag: entry.etag, 'content-length': entry.data.length }).end();
      return;
    }

    if (method === 'DELETE') {
      blobs.delete(key);
      res.writeHead(204).end();
      return;
    }

    if (method === 'GET' || method === 'PUT') {
      if (method === 'GET' && !blobs.has(key)) {
        send(404, { error: 'blob not found' });
        return;
      }
      send(200, { url: `http://127.0.0.1:${mock.address().port}/signed/${encodeURIComponent(key)}` });
      return;
    }

    send(405, { error: 'method not allowed' });
  });
});

await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const blobsApiUrl = `http://127.0.0.1:${mock.address().port}`;

const context = Buffer.from(
  JSON.stringify({
    apiURL: blobsApiUrl,
    siteID: 'site-brightriders-test',
    token: 'test-blobs-token',
  })
).toString('base64');

const lambdaScript = `
(async () => {
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function (request) {
    if (String(request).includes('sqlite')) {
      const err = new Error('No such built-in module: ' + request);
      err.code = 'ERR_UNKNOWN_BUILTIN_MODULE';
      throw err;
    }
    return originalLoad.apply(this, arguments);
  };

  const { handler } = require(${JSON.stringify(bundle)});
  const call = (method, publicPath, body, headers = {}) =>
    handler(
      {
        httpMethod: method,
        path: '/.netlify/functions/api' + publicPath.replace(/^\\/api/, ''),
        rawUrl: 'https://brightriders.netlify.app' + publicPath,
        headers: { 'content-type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : null,
        isBase64Encoded: false,
      },
      {}
    );

  const PHASE = process.env.PHASE;
  const login = await call('POST', '/api/auth/login', {
    username: 'ARHATSHAH8149',
    password: process.env.ADMIN_ONE_PW,
    expectedRole: 'admin',
  });
  if (login.statusCode !== 200) {
    throw new Error('LOGIN_FAILED ' + login.statusCode + ' ' + String(login.body).slice(0, 300));
  }
  const token = JSON.parse(login.body).sessionToken;
  const auth = { authorization: 'Bearer ' + token };

  if (PHASE === 'seed') {
    const created = await call(
      'POST',
      '/api/admin/users',
      {
        role: 'chef',
        fullName: 'Chef Persistence Probe',
        username: 'probe.chef',
        password: 'Probe-Chef#2026!',
        staffCode: 'BRS-CHF-PROBE',
      },
      auth
    );
    if (created.statusCode !== 201) throw new Error('CREATE_CHEF_FAILED ' + created.body);
  }

  const users = await call('GET', '/api/admin/users', null, auth);
  if (users.statusCode !== 200) throw new Error('USERS_FAILED ' + users.statusCode + ' ' + users.body);
  const list = JSON.parse(users.body).users || [];
  const menu = await call('GET', '/api/menu', null, auth);
  if (menu.statusCode !== 200) throw new Error('MENU_FAILED ' + menu.statusCode);

  console.log(JSON.stringify({
    phase: PHASE,
    usernames: list.map((u) => u.username).sort(),
    menuCount: JSON.parse(menu.body).items.length,
  }));
})().catch((err) => {
  console.error('PHASE_FAILED ' + err.message);
  process.exit(1);
});
`;

const runPhase = (phase) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', lambdaScript], {
      cwd: '/tmp',
      env: {
        ...process.env,
        PHASE: phase,
        NETLIFY: 'true',
        NETLIFY_BLOBS_CONTEXT: context,
        DATABASE_PATH: `/tmp/blobs-probe-${phase}.sqlite`,
        ADMIN_ONE_PW: (process.env.BRS_ADMIN_ONE_PASSWORD || '').trim(),
        NODE_OPTIONS: '--no-warnings',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`phase ${phase} exited ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split('\n').pop()));
      } catch {
        reject(new Error(`phase ${phase} produced unparseable output: ${stdout.trim()}`));
      }
    });
  });

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${label}\n      ${err.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const adminPw = (process.env.BRS_ADMIN_ONE_PASSWORD || '').trim();
if (!adminPw) {
  console.log('\n  - SKIPPED Netlify Blobs snapshot round-trip: set BRS_ADMIN_ONE_PASSWORD to run it.\n');
  mock.close();
  process.exit(0);
}

console.log('\n=== Netlify Blobs snapshot round-trip (two cold starts) ===\n');

const cold1 = await runPhase('seed');
check('Cold start #1 signs in and creates a Chef account', () => {
  assert(cold1.usernames.includes('probe.chef'), 'chef account missing after creation');
  assert(cold1.menuCount === 28, `expected 28 menu items, saw ${cold1.menuCount}`);
});
check('Cold start #1 wrote the SQLite snapshot to Netlify Blobs', () => {
  assert(blobs.size > 0, 'no blob written');
  const snapshot = [...blobs.values()][0];
  assert(snapshot.data.byteLength > 4096, `snapshot too small: ${snapshot.data.byteLength} bytes`);
  assert(snapshot.data.subarray(0, 15).toString('utf8') === 'SQLite format 3', 'not a SQLite file');
});

const cold2 = await runPhase('verify');
check('Cold start #2 signs in again (the exact 502 symptom) and sees the same data', () => {
  assert(cold2.usernames.includes('probe.chef'), 'chef account did NOT survive the cold start');
  assert(cold2.usernames.includes('ARHATSHAH8149'), 'permanent admin missing');
  assert(cold2.usernames.includes('ruthvikabrs123'), 'second permanent admin missing');
  assert(cold2.menuCount === 28, `menu lost across cold start: ${cold2.menuCount}`);
});

mock.close();
if (failures > 0) {
  console.error(`\n✗ ${failures} Blobs persistence check(s) failed.\n`);
  process.exit(1);
}
console.log('\n✓ Netlify Blobs persistence verified across cold starts.\n');
