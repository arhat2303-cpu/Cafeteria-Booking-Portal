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

let lastKnownEtag: string | null = null;
let cacheWarm = false;

/**
 * Netlify injects `NETLIFY_BLOBS_CONTEXT` into deployed Functions, so `getStore()` works
 * without extra wiring. `consistency` is requested per-operation below so that we degrade
 * gracefully when the runtime does not expose an uncached edge URL.
 */
function resolveBlobStore(): Store | null {
  try {
    return getStore({ name: BLOB_STORE_NAME });
  } catch {
    return null;
  }
}

async function readSnapshot(
  store: Store
): Promise<{ bytes: Uint8Array | null; etag: string | null }> {
  let lastErr: unknown = null;
  for (const consistency of ['strong', 'eventual'] as const) {
    try {
      const snapshot = await store.getWithMetadata(BLOB_DB_KEY, {
        type: 'arrayBuffer',
        consistency,
      });
      if (!snapshot) return { bytes: null, etag: null };
      const data = snapshot.data as ArrayBuffer | null;
      return {
        bytes: data && data.byteLength > 0 ? new Uint8Array(data) : null,
        etag: snapshot.etag ?? null,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function hydrateDatabase(store: Store | null): Promise<void> {
  await ensureSqlEngine();

  if (!store) {
    getDb();
    return;
  }

  try {
    const { bytes, etag } = await readSnapshot(store);

    if (!bytes) {
      // First run on this store: bootstrap the schema, 2 permanent admins and the 28-item menu.
      const db = hydrateSingletonFromBytes(null);
      cacheWarm = true;
      lastKnownEtag = etag;
      await persistDatabase(store, db.exportBytes());
      return;
    }

    if (cacheWarm && etag && etag === lastKnownEtag) {
      // Warm container with unchanged remote state — keep the in-memory database.
      getDb();
      return;
    }

    hydrateSingletonFromBytes(bytes);
    cacheWarm = true;
    lastKnownEtag = etag;
  } catch {
    // Never let persistence availability break sign-in or the API surface.
    try {
      getDb();
    } catch {
      hydrateSingletonFromBytes(null);
      cacheWarm = true;
    }
  }
}

async function persistDatabase(store: Store | null, bytesOverride?: Uint8Array): Promise<void> {
  if (!store) return;
  try {
    const bytes = bytesOverride ?? getDb().exportBytes();
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    // Optimistic concurrency: only overwrite the snapshot we last observed.
    if (lastKnownEtag) {
      try {
        const result = await store.set(BLOB_DB_KEY, arrayBuffer, {
          onlyIfMatch: lastKnownEtag,
        });
        if (result?.etag) lastKnownEtag = result.etag;
        if (result?.modified) return;
      } catch {
        // fall through to an unconditional write
      }
    }

    const written = await store.set(BLOB_DB_KEY, arrayBuffer);
    if (written?.etag) lastKnownEtag = written.etag;
  } catch {
    // Non-fatal: the request still succeeds even if the snapshot write fails.
  }
}

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

export const handler = async (event: any, context: any) => {
  try {
    if (context && typeof context === 'object') {
      context.callbackWaitsForEmptyEventLoop = false;
    }

    normalizeEventPath(event);

    const store = resolveBlobStore();
    await hydrateDatabase(store);

    const response = (await serverlessHandler(event, context)) as any;

    const method = String(
      event?.httpMethod || event?.requestContext?.http?.method || 'GET'
    ).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      await persistDatabase(store);
    }

    return response;
  } catch (err: any) {
    // Always answer with structured JSON (never an unhandled crash → "Request failed with status 502").
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: err?.message || 'Internal server error in the Bright Riders Digital Canteen API.',
      }),
    };
  }
};
