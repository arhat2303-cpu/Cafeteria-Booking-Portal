import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getDb } from './db/connection.js';
import { createApiApp } from './app.js';

async function startServer() {
  // Ensure database & schema are initialized
  getDb();

  const app = createApiApp();
  const distClientDir = path.resolve(process.cwd(), 'dist/client');
  const isProd = config.nodeEnv === 'production' && fs.existsSync(path.join(distClientDir, 'index.html'));

  if (isProd) {
    app.use(express.static(distClientDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distClientDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(config.port, config.host, () => {
    console.log(
      `[Bright Riders SmartCanteen] Server listening on http://${config.host}:${config.port} (${config.nodeEnv})`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start Bright Riders SmartCanteen server:', err);
  process.exit(1);
});
