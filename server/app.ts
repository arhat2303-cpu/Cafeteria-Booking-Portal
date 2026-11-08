import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { authenticate } from './middleware/auth.js';
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
  app.use(express.json({ limit: '2mb' }));

  // Serve uploaded food photos safely
  app.use(
    '/uploads',
    express.static(path.resolve(process.cwd(), 'server/uploads'), {
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

  // Real-time Server-Sent Events (SSE) Stream
  app.get('/api/events/stream', authenticate, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
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
