import serverless from 'serverless-http';
import { getStore, type Store } from '@netlify/blobs';
import { createApiApp } from '../../server/app.js';
import {
  ensureSqlEngine,
  getDb,
  hydrateSingletonFromBytes,
} from '../../server/db/connection.js';

const BLOB_STORE_NAME = 'bright-riders-smartcanteen';
// Versioned key: the earlier deployment wrote a 5-role (pre-Student/Parent/Chef/Admin) snapshot.
const BLOB_DB_KEY = 'canteen-v2-4roles.sqlite';

// Every request reads the shared snapshot. Never silently fall back to isolated /tmp data.
function resolveBlobStore(): Store | null {
  try { return getStore({ name: BLOB_STORE_NAME }); } catch { return null; }
}

class SnapshotConflict extends Error {}

async function readSnapshot(store: Store): Promise<{ bytes: Uint8Array | null; etag: string | null }> {
  let snapshot;
  try {
    snapshot = await store.getWithMetadata(BLOB_DB_KEY, { type: 'arrayBuffer', consistency: 'strong' });
  } catch (err: any) {
    // The external Netlify API may return 404 while resolving a signed URL.
    if (err?.status === 404) return { bytes: null, etag: null };
    throw err;
  }
  if (!snapshot) return { bytes: null, etag: null };
  const data = snapshot.data as ArrayBuffer;
  if (!data?.byteLength || !snapshot.etag) throw new Error('Invalid database snapshot or missing ETag.');
  return { bytes: new Uint8Array(data), etag: snapshot.etag };
}

async function persistDatabase(store: Store, bytes: Uint8Array, etag: string | null): Promise<void> {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const result = await store.set(BLOB_DB_KEY, data, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
  if (!result.modified) throw new SnapshotConflict('The shared database changed; please retry the request.');
}

// Lambda invocations can overlap in one process and share the SQLite singleton.
let queue: Promise<void> = Promise.resolve();

/**
 * Netlify hands the function the rewritten internal path (/.netlify/functions/api/...)
 * while the browser asked for /api/.... Recover the public path so Express routing works
 * regardless of whether the `/:splat` placeholder is forwarded.
 */
function normalizeEventPath(event: any): void {
  if (!event) return;

  if (typeof event.rawUrl === 'string' && event.rawUrl.startsWith('http')) {
    try {
      const { pathname } = new URL(event.rawUrl);
      if (pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/uploads/')) {
        event.path = pathname;
        return;
      }
    } catch {
      // fall through to path normalization
    }
  }

  if (typeof event.path !== 'string') return;

  const fnPrefix = '/.netlify/functions/api';
  if (event.path.startsWith(fnPrefix)) {
    const remainder = event.path.slice(fnPrefix.length) || '/';
    if (remainder === '/api' || remainder.startsWith('/api/') || remainder.startsWith('/uploads/')) {
      event.path = remainder;
    } else {
      event.path = `/api${remainder.startsWith('/') ? remainder : `/${remainder}`}`;
    }
  }
}

const expressApp = createApiApp();

const serverlessHandler = serverless(expressApp, {
  binary: ['image/*', 'application/octet-stream'],
  // Pre-buffer the Lambda body so `express.json()` never waits on an already-consumed stream.
  // This was a second, independent cause of gateway timeouts on POST /api/auth/login.
  request: (req: any, event: any) => {
    const body = event?.body;
    if (body === undefined || body === null) return;
    if (Buffer.isBuffer(body)) {
      req.rawBody = body;
    } else if (typeof body === 'string') {
      req.rawBody = event.isBase64Encoded
        ? Buffer.from(body, 'base64')
        : Buffer.from(body, 'utf8');
    } else if (typeof body === 'object') {
      req.body = body;
    }
  },
});

async function handleRequest(event: any, context: any) {
  try {
    if (context && typeof context === 'object') context.callbackWaitsForEmptyEventLoop = false;
    normalizeEventPath(event);
    await ensureSqlEngine();
    const store = resolveBlobStore();
    // Explicit test-only opt-in for bundle harnesses with no Netlify Blobs service.
    if (!store && process.env.BRS_ALLOW_EPHEMERAL_TEST_DB !== '1') {
      throw new Error('Shared database storage is unavailable.');
    }
    let snapshot: { bytes: Uint8Array | null; etag: string | null } = { bytes: null, etag: null };
    if (store) {
      snapshot = await readSnapshot(store);
      const db = hydrateSingletonFromBytes(snapshot.bytes);
      const initialized = db.exportBytes();
      // Persist first-run / one-time migrations even for GET requests.
      if (!snapshot.bytes || !Buffer.from(snapshot.bytes).equals(Buffer.from(initialized))) {
        await persistDatabase(store, initialized, snapshot.etag);
        snapshot = await readSnapshot(store);
        if (!snapshot.bytes) throw new Error('Database initialization could not be verified.');
        hydrateSingletonFromBytes(snapshot.bytes);
      }
    } else {
      getDb();
    }
    const response = (await serverlessHandler(event, context)) as any;
    const method = String(event?.httpMethod || event?.requestContext?.http?.method || 'GET').toUpperCase();
    if (store && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      await persistDatabase(store, getDb().exportBytes(), snapshot.etag);
    }
    return response;
  } catch (err: any) {
    console.error('Shared database request failed:', err);
    return {
      statusCode: err instanceof SnapshotConflict ? 409 : 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: err instanceof SnapshotConflict
        ? 'The shared database changed while processing your request. Please retry.'
        : 'The shared canteen database is unavailable. Please contact the administrator.' }),
    };
  }
}

export const handler = (event: any, context: any) => {
  const result = queue.then(() => handleRequest(event, context));
  queue = result.then(() => undefined, () => undefined);
  return result;
};
