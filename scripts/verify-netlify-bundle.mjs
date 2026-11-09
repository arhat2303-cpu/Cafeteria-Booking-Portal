#!/usr/bin/env node
/**
 * Local Netlify platform simulator + verification harness.
 *
 * Loads the EXACT production artifact that Netlify deploys (`dist/functions/api.cjs`),
 * invokes it with Lambda-shaped events (the same shape Netlify Functions receive),
 * and translates the returned Lambda response back into real HTTP responses.
 *
 * Crucially, this harness blocks `require('node:sqlite')` with
 * ERR_UNKNOWN_BUILTIN_MODULE, reproducing the AWS Lambda runtime that produced the
 * production "Request failed with status 502" sign-in failure.
 *
 * Usage:
 *   node scripts/verify-netlify-bundle.mjs          # self-test, exits non-zero on failure
 *   node scripts/verify-netlify-bundle.mjs --serve  # keep serving on PORT for manual browsing
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import crypto from 'node:crypto';

const root = process.cwd();
const bundlePath = path.join(root, 'dist', 'functions', 'api.cjs');
const clientDir = path.join(root, 'dist', 'client');
const port = Number(process.env.PORT || 3100);
const serveMode = process.argv.includes('--serve');

if (!fs.existsSync(bundlePath)) {
  console.error('Missing dist/functions/api.cjs — run `npm run build` first.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Simulate AWS Lambda (nodejs20.x): no experimental `node:sqlite` builtin.
// ---------------------------------------------------------------------------
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (String(request).includes('sqlite')) {
    const err = new Error(`No such built-in module: ${request}`);
    err.code = 'ERR_UNKNOWN_BUILTIN_MODULE';
    throw err;
  }
  return originalLoad.apply(this, arguments);
};

// Netlify Functions environment flags (serverless behaviour, /tmp writable storage)
process.env.NETLIFY = 'true';
process.env.BRS_ALLOW_EPHEMERAL_TEST_DB = '1';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'api';
process.env.DATABASE_PATH = `${process.env.TMPDIR || '/tmp'}/netlify-sim-${process.pid}.sqlite`;
process.env.PUBLIC_APP_URL = `http://localhost:${port}`;

const { handler } = await originalLoad(bundlePath, null, false) ?? {};
const fn = handler || (await import(bundlePath)).handler;

// ---------------------------------------------------------------------------
// 2. netlify.toml redirects (parsed so the simulator stays honest to config)
// ---------------------------------------------------------------------------
const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
const redirects = [...toml.matchAll(/\[\[redirects\]\]([\s\S]*?)(?=\n\[\[|\n*$)/g)].map((m) => {
  const block = m[1];
  const from = block.match(/from\s*=\s*"([^"]+)"/)?.[1];
  const to = block.match(/to\s*=\s*"([^"]+)"/)?.[1];
  const status = Number(block.match(/status\s*=\s*(\d+)/)?.[1] || 200);
  const force = /force\s*=\s*true/.test(block);
  return { from, to, status, force };
});

function matchRedirect(pathname) {
  for (const rule of redirects) {
    if (!rule.from) continue;
    const splatIdx = rule.from.indexOf('*');
    if (splatIdx === -1) {
      if (rule.from === pathname) return { target: rule.to, splat: '' };
      continue;
    }
    const prefix = rule.from.slice(0, splatIdx);
    if (pathname.startsWith(prefix)) {
      return { target: rule.to, splat: pathname.slice(prefix.length) };
    }
  }
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(pathname, res) {
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(clientDir, safePath);
  if (!filePath.startsWith(clientDir)) filePath = path.join(clientDir, 'index.html');
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(clientDir, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'public, max-age=60',
  });
  fs.createReadStream(filePath).pipe(res);
}

// ---------------------------------------------------------------------------
// 3. HTTP <-> Lambda event bridge
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks);
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const redirect = matchRedirect(parsed.pathname);

    if (!redirect) {
      serveStatic(parsed.pathname, res);
      return;
    }

    const functionPath = redirect.target.replace(':splat', redirect.splat);

    // Rewrites targeting static assets are served by Netlify's CDN, not by the function.
    if (!functionPath.startsWith('/.netlify/functions/')) {
      serveStatic(functionPath === '/index.html' ? '/index.html' : functionPath, res);
      return;
    }
    const contentType = String(req.headers['content-type'] || '');
    const isTextBody =
      !rawBody.length ||
      /^(text\/|application\/json|application\/x-www-form-urlencoded)/i.test(contentType);

    // Netlify gives the function the *rewritten* internal path but keeps the original in rawUrl.
    const event = {
      httpMethod: req.method,
      path: functionPath,
      rawUrl: `http://${req.headers.host || 'localhost'}${parsed.pathname}${parsed.search}`,
      rawQuery: parsed.search.replace(/^\?/, ''),
      queryStringParameters: Object.fromEntries(parsed.searchParams.entries()),
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)])
      ),
      body: rawBody.length
        ? isTextBody
          ? rawBody.toString('utf8')
          : rawBody.toString('base64')
        : null,
      isBase64Encoded: Boolean(rawBody.length) && !isTextBody,
    };

    try {
      const out = await fn(event, { awsRequestId: crypto.randomUUID() });
      const headers = { ...(out.headers || {}) };
      const multi = out.multiValueHeaders || {};
      for (const [k, v] of Object.entries(multi)) {
        headers[k] = Array.isArray(v) ? v : [v];
      }
      res.writeHead(out.statusCode || 200, headers);
      res.end(
        out.isBase64Encoded && out.body
          ? Buffer.from(out.body, 'base64')
          : out.body ?? ''
      );
    } catch (err) {
      console.error('[sim] function threw:', err);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Function invocation crashed' }));
    }
  });
});

await new Promise((resolve) => server.listen(port, '0.0.0.0', resolve));
const baseUrl = `http://127.0.0.1:${port}`;

if (serveMode) {
  console.log(`[sim] Netlify bundle preview: ${baseUrl}`);
  console.log('[sim] Serving the exact dist/functions/api.cjs artifact with node:sqlite blocked.');
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
} else {
  // -------------------------------------------------------------------------
  // 4. Self-test: the production sign-in path, end to end, over real HTTP
  // -------------------------------------------------------------------------
  let failures = 0;
  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failures++;
      console.log(`  ✗ ${name}\n      ${err.message}`);
    }
  };
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  const ADMIN_ONE = requireAdminPassword('BRS_ADMIN_ONE_PASSWORD', 'permanent Admin 1 sign-in');
  const ADMIN_TWO = requireAdminPassword('BRS_ADMIN_TWO_PASSWORD', 'permanent Admin 2 sign-in');


// The permanent Admin credentials are NEVER hardcoded in this repository (Git history included).
// Supply them at run time, e.g.
//   BRS_ADMIN_ONE_PASSWORD=... BRS_ADMIN_TWO_PASSWORD=... npm run verify
function requireAdminPassword(envVar, label) {
  const value = (process.env[envVar] || '').trim();
  if (!value) {
    console.log(`  - SKIPPED ${label}: set ${envVar} to run this live-credential check.`);
    return null;
  }
  return value;
}

  console.log('\n=== Netlify serverless artifact verification (node:sqlite BLOCKED) ===\n');

  await check('GET /api/health returns 200 JSON through the /api/* rewrite', async () => {
    const r = await fetch(`${baseUrl}/api/health`);
    assert(r.status === 200, `status ${r.status}`);
    const j = await r.json();
    assert(j.status === 'ok', 'health payload missing status ok');
  });

  await check('GET /api/auth/public-config returns 200', async () => {
    const r = await fetch(`${baseUrl}/api/auth/public-config`);
    assert(r.status === 200, `status ${r.status}`);
  });

  let sessionCookie = '';
  if (ADMIN_ONE) await check('POST /api/auth/login (permanent Admin 1) returns 200 + HttpOnly session cookie', async () => {
    const r = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ARHATSHAH8149', password: ADMIN_ONE, expectedRole: 'admin' }),
    });
    const text = await r.text();
    assert(r.status === 200, `status ${r.status} body=${text.slice(0, 300)}`);
    const j = JSON.parse(text);
    assert(j.user?.role === 'admin', 'wrong user returned');
    assert(j.user?.role === 'admin', 'wrong role returned');
    const setCookie = r.headers.getSetCookie?.() || [];
    assert(setCookie.length > 0, 'no Set-Cookie header');
    assert(/HttpOnly/i.test(setCookie[0]), 'session cookie not HttpOnly');
    sessionCookie = setCookie[0].split(';')[0];
  });

  if (sessionCookie) await check('GET /api/auth/me with the cookie keeps the session (no 502)', async () => {
    const r = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: sessionCookie } });
    const text = await r.text();
    assert(r.status === 200, `status ${r.status} body=${text.slice(0, 300)}`);
    assert(JSON.parse(text).user.role === 'admin', 'session not restored');
  });

  if (sessionCookie) await check('GET /api/menu with session returns all 28 official SEHHI items', async () => {
    const r = await fetch(`${baseUrl}/api/menu`, { headers: { cookie: sessionCookie } });
    const text = await r.text();
    assert(r.status === 200, `status ${r.status} body=${text.slice(0, 300)}`);
    const j = JSON.parse(text);
    assert(j.items.length === 28, `expected 28 menu items, received ${j.items.length}`);
  });

  if (ADMIN_TWO) await check('POST /api/auth/login (permanent Admin 2) authenticates', async () => {
    const r = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ruthvikabrs123', password: ADMIN_TWO }),
    });
    const text = await r.text();
    assert(r.status === 200, `status ${r.status} body=${text.slice(0, 300)}`);
    assert(JSON.parse(text).user.role === 'admin', 'second admin failed to sign in');
  });

  await check('Wrong password returns a clean 401 JSON error (not 502)', async () => {
    const r = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'not-a-real-user', password: 'wrong-password' }),
    });
    const text = await r.text();
    assert(r.status === 401, `status ${r.status}`);
    assert(JSON.parse(text).error, 'missing error message');
  });

  await check('Unknown API route returns JSON 404 instead of a gateway error', async () => {
    const r = await fetch(`${baseUrl}/api/does-not-exist`);
    assert(r.status === 404, `status ${r.status}`);
    assert((await r.text()).includes('error'), 'missing JSON error body');
  });

  await check('SPA shell and static assets are still served from the CDN publish dir', async () => {
    const r = await fetch(`${baseUrl}/`);
    assert(r.status === 200, `status ${r.status}`);
    const html = await r.text();
    assert(html.includes('<div id="root"'), 'SPA shell not served');
    const logo = await fetch(`${baseUrl}/brs-logo.png`);
    assert(logo.status === 200, `logo status ${logo.status}`);
  });

  server.close();
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const p = `${process.env.DATABASE_PATH}${suffix}`;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch {
    /* ignore */
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} serverless check(s) failed.\n`);
    process.exit(1);
  }
  console.log('\n✓ All Netlify serverless production-path checks passed with node:sqlite unavailable.\n');
  process.exit(0);
}
