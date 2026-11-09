import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { authenticate } from './middleware/auth.js';
import { ensureSqlEngine, getDb } from './db/connection.js';
import { eventHub } from './services/events.js';
import { authRouter } from './routes/auth.js';
import { menuRouter } from './routes/menu.js';
import { cartRouter } from './routes/cart.js';
import { ordersRouter } from './routes/orders.js';
import { paymentsRouter } from './routes/payments.js';
import { chefRouter } from './routes/chef.js';
import { adminRouter } from './routes/admin.js';
import { config } from './config.js';

export function createApiApp() {
  const app = express();

  // Trust reverse proxy headers (e.g., E2B / cloud load balancers)
  app.set('trust proxy', 1);

  // Safe security headers (intentionally permitting iframe embedding for Live Preview)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(cookieParser());

  // Ensure WebAssembly SQLite engine is initialized before any route runs
  app.use((_req, res, next) => {
    ensureSqlEngine()
      .then(() => next())
      .catch((err) => {
        res.status(500).json({ error: err?.message || 'Database initialization failed.' });
      });
  });

  // Serverless-safe JSON body parser: prevents `express.json()` stream hangs on AWS Lambda / Netlify Functions
  // when `event.body` has already been buffered into `req.rawBody` or `req.body`.
  app.use((req, res, next) => {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (!ct.includes('application/json')) {
      next();
      return;
    }

    const rawBuf: Buffer | null = Buffer.isBuffer((req as any).rawBody)
      ? (req as any).rawBody
      : Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === 'string'
      ? Buffer.from(req.body, 'utf8')
      : null;

    if (rawBuf !== null) {
      const txt = rawBuf.toString('utf8').trim();
      if (!txt) {
        req.body = {};
        next();
        return;
      }
      try {
        req.body = JSON.parse(txt);
        next();
      } catch {
        res.status(400).json({ error: 'Invalid JSON request payload.' });
      }
      return;
    }

    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      next();
      return;
    }

    express.json({ limit: '2mb' })(req, res, next);
  });

  // Serve uploaded food photos from SQLite first (persists on Netlify Serverless), with disk fallback
  app.get('/uploads/menu/:filename', (req, res, next) => {
    const filename = path.basename(req.params.filename || '');
    if (!filename) {
      res.status(404).end();
      return;
    }
    try {
      const db = getDb();
      const row = db.get<{ mime_type: string; data: Uint8Array }>(
        'SELECT mime_type, data FROM uploaded_files WHERE filename = ?',
        filename
      );
      if (row && row.data) {
        res.setHeader('Content-Type', row.mime_type);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(Buffer.from(row.data));
        return;
      }
    } catch {
      // Fall through to static file middleware
    }
    next();
  });

  app.use(
    '/uploads',
    express.static(path.resolve(process.cwd(), 'server/uploads'), {
      maxAge: '1h',
      fallthrough: false,
    })
  );

  // Serve generated exhibition Demo_Video folder with HTTP Range support
  app.use(
    '/Demo_Video',
    express.static(path.resolve(process.cwd(), 'Demo_Video'), {
      maxAge: '1h',
      fallthrough: false,
    })
  );

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'Bright Riders School – Digital Canteen Solution',
      paymentMode: config.isStripeConfigured ? 'stripe' : 'brs_sandbox_aed',
      timestamp: new Date().toISOString(),
    });
  });

  // Real-time Server-Sent Events (SSE) Stream (auto-switches to serverless polling hint on Netlify Functions)
  app.get('/api/events/stream', authenticate, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');

    if (config.isServerless) {
      res.write(
        `event: serverless_mode\ndata: ${JSON.stringify({
          pollingIntervalMs: 12000,
          timestamp: new Date().toISOString(),
        })}\n\n`
      );
      res.end();
      return;
    }

    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const clientId = crypto.randomBytes(12).toString('hex');
    eventHub.addClient({
      id: clientId,
      userId: req.user!.id,
      role: req.user!.role,
      res,
    });

    res.write(
      `event: connected\ndata: ${JSON.stringify({
        clientId,
        role: req.user!.role,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
        eventHub.removeClient(clientId);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      eventHub.removeClient(clientId);
    });
  });

  // Mount Domain Routers
  app.use('/api/auth', authRouter);
  app.use('/api/menu', menuRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/chef', chefRouter);
  app.use('/api/admin', adminRouter);

  // Unknown API 404 handler
  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  return app;
}
