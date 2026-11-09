import express from 'express';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'bondtrust' });
  });
  return app;
}
