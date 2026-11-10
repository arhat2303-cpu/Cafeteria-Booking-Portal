#!/usr/bin/env node
/**
 * Verifies the Netlify Blobs persistence path of the deployed function artifact.
 *
 * Runs the deployed artifact in separate cold-start processes against a mock Blobs service.
 * Exercises both environment-based API access and Lambda event-based edge access,
 * including a separate uncached endpoint required for strong consistency.
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

let rejectWrites = false;
let rejectReads = false;
const lambdaEventMode = process.argv.includes('--lambda-event');
let strongReadCount = 0;
const blobs = new Map(); // key -> { data: Buffer, metadata?: string }
const etagOf = () => `"${crypto.randomUUID()}"`;

const handleMock = (req, res) => {
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

    // Lambda compatibility mode uses the edge protocol directly. Reads must use
    // the uncached port; the cached port intentionally refuses GETs.
    if (url.pathname.startsWith('/site-brightriders-test/')) {
      if (req.headers.authorization !== 'Bearer test-blobs-token') { res.writeHead(401).end(); return; }
      const key = decodeURIComponent(url.pathname.split('/').slice(3).join('/'));
      const prior = blobs.get(key);
      if (method === 'GET') {
        if (req.socket.localPort !== uncachedMock.address().port) { res.writeHead(418).end(); return; }
        strongReadCount++;
        if (rejectReads) { res.writeHead(503).end(); return; }
        if (!prior) { res.writeHead(404).end(); return; }
        res.writeHead(200, { etag: prior.etag, 'content-type': 'application/octet-stream' });
        res.end(prior.data);
        return;
      }
      if (method === 'PUT') {
        if (rejectWrites || (req.headers['if-match'] && req.headers['if-match'] !== prior?.etag) ||
            (req.headers['if-none-match'] === '*' && prior)) { res.writeHead(412).end(); return; }
        const etag = etagOf();
        blobs.set(key, { data: body, etag });
        res.writeHead(200, { etag }).end();
        return;
      }
      res.writeHead(405).end();
      return;
    }

    // Signed-URL data plane
    if (url.pathname.startsWith('/signed/')) {
      const key = decodeURIComponent(url.pathname.slice('/signed/'.length));
      if (method === 'PUT') {
        if (rejectWrites) { res.writeHead(412).end(); return; }
        const prior = blobs.get(key);
        if ((req.headers['if-match'] && req.headers['if-match'] !== prior?.etag) ||
            (req.headers['if-none-match'] === '*' && prior)) {
          res.writeHead(412).end();
          return;
        }
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

    if (method === 'GET' && rejectReads) { send(503, { error: 'storage down' }); return; }
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
};
const mock = http.createServer(handleMock);
const uncachedMock = http.createServer(handleMock);

await new Promise((r) => mock.listen(0, '127.0.0.1', r));
await new Promise((r) => uncachedMock.listen(0, '127.0.0.1', r));
const blobsApiUrl = `http://127.0.0.1:${mock.address().port}`;

const lambdaBlobs = Buffer.from(JSON.stringify({
  url: blobsApiUrl,
  url_uncached: `http://127.0.0.1:${uncachedMock.address().port}`,
  primary_region: 'dev',
  token: 'test-blobs-token',
})).toString('base64');

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
        headers: { 'content-type': 'application/json', ...(process.env.EVENT_BLOBS ? { 'X-Nf-Site-Id': 'site-brightriders-test', 'x-nf-deploy-id': 'deploy-test' } : {}), ...headers },
        ...(process.env.EVENT_BLOBS ? { blobs: process.env.EVENT_BLOBS } : {}),
        body: body ? JSON.stringify(body) : null,
        isBase64Encoded: false,
      },
      {}
    );

  const PHASE = process.env.PHASE;
  const demo = PHASE === 'smoke' || PHASE === 'smoke-again';
  const login = await call('POST', '/api/auth/login', {
    username: demo ? '12345' : PHASE === 'verify' ? 'ruthvikabrs123' : 'ARHATSHAH8149',
    password: demo ? 'abcd' : PHASE === 'verify' ? process.env.ADMIN_TWO_PW : process.env.ADMIN_ONE_PW,
    expectedRole: demo ? 'student' : 'admin',
  });
  if (demo) {
    if (login.statusCode !== 200 || JSON.parse(login.body).user.role !== 'student') throw new Error('DEMO_LOGIN_FAILED ' + login.statusCode);
    const menu = await call('GET', '/api/menu', null, { authorization: 'Bearer ' + JSON.parse(login.body).sessionToken });
    if (menu.statusCode !== 200 || JSON.parse(menu.body).items.length !== 28) throw new Error('DEMO_MENU_FAILED ' + menu.statusCode);
    console.log(JSON.stringify({ status: login.statusCode }));
    return;
  }
  if (PHASE === 'conflict' || PHASE === 'outage' || PHASE === 'missing-uncached') {
    console.log(JSON.stringify({ status: login.statusCode }));
    return;
  }
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

  if (PHASE === 'verify') {
    const created = await call('POST', '/api/admin/users', {
      role: 'chef', fullName: 'Second Admin Probe', username: 'probe.second',
      password: 'Probe-Chef#2026!', staffCode: 'BRS-CHF-PROBE2',
    }, auth);
    if (created.statusCode !== 201) throw new Error('SECOND_CREATE_FAILED ' + created.body);
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
        NETLIFY_BLOBS_CONTEXT: lambdaEventMode ? '' : context,
        EVENT_BLOBS: lambdaEventMode ? (phase === 'missing-uncached'
          ? Buffer.from(JSON.stringify({ url: blobsApiUrl, token: 'test-blobs-token' })).toString('base64')
          : lambdaBlobs) : '',
        BRS_ALLOW_EPHEMERAL_TEST_DB: '',
        NODE_ENV: 'test',
        DATABASE_PATH: `/tmp/blobs-probe-${phase}.sqlite`,
        ADMIN_ONE_PW: (process.env.BRS_ADMIN_ONE_PASSWORD || '').trim(),
        ADMIN_TWO_PW: (process.env.BRS_ADMIN_TWO_PASSWORD || '').trim(),
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

console.log(`\n=== Netlify Blobs snapshot round-trip (${lambdaEventMode ? 'Lambda event' : 'environment context'}) ===\n`);
const smoke = await runPhase('smoke');
const smokeAgain = await runPhase('smoke-again');
check('Demo student signs in and sees the menu in two separate cold starts', () => {
  assert(smoke.status === 200 && smokeAgain.status === 200, 'demo sign-in failed');
  if (lambdaEventMode) assert(strongReadCount > 0, 'uncached endpoint was not used');
});

if (lambdaEventMode) {
  const missing = await runPhase('missing-uncached');
  check('Missing uncached endpoint fails closed instead of using stale or isolated data', () => {
    assert(missing.status === 503, `expected 503, got ${missing.status}`);
  });
}
const adminPw = (process.env.BRS_ADMIN_ONE_PASSWORD || '').trim();
if (!adminPw || !process.env.BRS_ADMIN_TWO_PASSWORD) {
  console.log('\n  - SKIPPED Netlify Blobs snapshot round-trip: set both admin password environment variables to run it.\n');
  mock.close();
  uncachedMock.close();
  process.exit(failures ? 1 : 0);
}

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

if (lambdaEventMode) check('Lambda event supplies a working uncached strong-read endpoint', () => {
  assert(strongReadCount > 0, 'no strong reads reached the uncached endpoint');
});

const cold2 = await runPhase('verify');
check('Ruthvika sees Arhat’s user and creates another in a second cold start', () => {
  assert(cold2.usernames.includes('probe.chef'), 'chef account did NOT survive the cold start');
  assert(cold2.usernames.includes('ARHATSHAH8149'), 'permanent admin missing');
  assert(cold2.usernames.includes('ruthvikabrs123'), 'second permanent admin missing');
  assert(cold2.menuCount === 28, `menu lost across cold start: ${cold2.menuCount}`);
});

const cold3 = await runPhase('verify-back');
check('Arhat sees Ruthvika’s user in a third cold start', () => {
  assert(cold3.usernames.includes('probe.chef'), 'first user missing');
  assert(cold3.usernames.includes('probe.second'), 'second admin’s user missing');
});

const original = [...blobs.values()][0].data;
rejectWrites = true;
const conflict = await runPhase('conflict');
rejectWrites = false;
check('Concurrent write conflict is reported without overwriting shared data', () => {
  assert(conflict.status === 409, `expected 409, got ${conflict.status}`);
  assert([...blobs.values()][0].data.equals(original), 'snapshot was overwritten');
});
rejectReads = true;
const outage = await runPhase('outage');
rejectReads = false;
check('Storage outage does not silently create isolated data', () => {
  assert(outage.status === 503, `expected 503, got ${outage.status}`);
  assert([...blobs.values()][0].data.equals(original), 'snapshot changed during outage');
});

mock.close();
uncachedMock.close();
if (failures > 0) {
  console.error(`\n✗ ${failures} Blobs persistence check(s) failed.\n`);
  process.exit(1);
}
console.log('\n✓ Netlify Blobs persistence verified across cold starts.\n');
