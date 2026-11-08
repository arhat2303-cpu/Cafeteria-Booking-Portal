import fs from 'node:fs';
import path from 'node:path';
import serverless from 'serverless-http';
import { connectLambda, getStore, type Store } from '@netlify/blobs';
import { createApiApp } from '../../server/app.js';
import { config } from '../../server/config.js';
import { closeSingletonDb, getDb } from '../../server/db/connection.js';

const BLOB_STORE_NAME = 'bright-riders-smartcanteen';
const BLOB_DB_KEY = 'canteen.sqlite';

let lastSyncedEtag: string | null = null;

function resolveBlobStore(event: any): Store | null {
  try {
    if (event && typeof event.blobs === 'string' && event.blobs.length > 0) {
      connectLambda(event);
    }
    return getStore({
      name: BLOB_STORE_NAME,
      consistency: 'strong',
    });
  } catch {
    // Running locally without Netlify Blobs credentials — fall back to local /tmp SQLite file
    return null;
  }
}

async function hydrateSqliteFromNetlifyBlobs(store: Store | null): Promise<boolean> {
  const dbPath = config.databasePath;
  if (!store || dbPath === ':memory:') {
    getDb();
    return false;
  }

  try {
    const meta = await store.getMetadata(BLOB_DB_KEY, { consistency: 'strong' });

    if (!meta) {
      // Brand-new Netlify deployment: initialize schema + 28 official Bright Riders items + accounts, then persist
      const db = getDb();
      db.checkpointWal();
      if (fs.existsSync(dbPath)) {
        const bytes = fs.readFileSync(dbPath);
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const wr = await store.set(BLOB_DB_KEY, ab as ArrayBuffer);
        lastSyncedEtag = wr.etag || null;
      }
      return true;
    }

    if (meta.etag && meta.etag === lastSyncedEtag && fs.existsSync(dbPath)) {
      getDb();
      return false;
    }

    const snapshot = await store.getWithMetadata(BLOB_DB_KEY, {
      type: 'arrayBuffer',
      consistency: 'strong',
    });

    if (snapshot?.data) {
      closeSingletonDb();
      fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
      for (const suffix of ['-wal', '-shm']) {
        const walFile = `${dbPath}${suffix}`;
        if (fs.existsSync(walFile)) {
          fs.unlinkSync(walFile);
        }
      }
      fs.writeFileSync(dbPath, Buffer.from(snapshot.data));
      lastSyncedEtag = snapshot.etag || meta.etag || null;
    }

    getDb();
    return false;
  } catch {
    // Graceful fallback so API never fails if Blobs metadata lookup experiences transient issues
    getDb();
    return false;
  }
}

async function persistSqliteToNetlifyBlobs(store: Store | null): Promise<void> {
  const dbPath = config.databasePath;
  if (!store || dbPath === ':memory:') return;

  try {
    const db = getDb();
    db.checkpointWal();
    if (!fs.existsSync(dbPath)) return;
    const bytes = fs.readFileSync(dbPath);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const wr = await store.set(BLOB_DB_KEY, ab as ArrayBuffer);
    if (wr?.etag) {
      lastSyncedEtag = wr.etag;
    }
  } catch {
    // Non-fatal fallback
  }
}

function normalizeEventPath(event: any): void {
  if (!event || typeof event.path !== 'string') return;
  const fnPrefix = '/.netlify/functions/api';
  if (event.path.startsWith(fnPrefix)) {
    const remainder = event.path.slice(fnPrefix.length) || '/';
    if (remainder.startsWith('/api/') || remainder === '/api' || remainder.startsWith('/uploads/')) {
      event.path = remainder;
    } else {
      event.path = `/api${remainder.startsWith('/') ? remainder : `/${remainder}`}`;
    }
  }
}

const expressApp = createApiApp();

const serverlessHandler = serverless(expressApp, {
  binary: ['image/*', 'application/octet-stream'],
  request: (req: any, event: any) => {
    if (event?.body) {
      req.rawBody = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : Buffer.from(event.body, 'utf8');
    }
  },
});

export const handler = async (event: any, context: any) => {
  normalizeEventPath(event);

  const store = resolveBlobStore(event);
  await hydrateSqliteFromNetlifyBlobs(store);

  const response = (await serverlessHandler(event, context)) as any;

  const method = String(event?.httpMethod || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    await persistSqliteToNetlifyBlobs(store);
  }

  return response;
};
