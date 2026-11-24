// Load .env / .env.local BEFORE any module reads process.env (JWT_SECRET, Djomy, VAPID…)
import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { createApiRouter } from './server/routes';
import { db, initDatabase } from './server/db';

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  // Schema + seed against PostgreSQL (Neon) BEFORE any route can query
  await initDatabase();

  const app = express();
  const httpServer = http.createServer(app);
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(
    express.json({
      limit: '4mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  // Mount REST API
  app.use('/api', createApiRouter());

  // Liveness/readiness probe for hosts (Render, Railway, Docker HEALTHCHECK)
  app.get('/api/health', async (_req, res) => {
    try {
      await db.prepare('SELECT 1').get();
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(503).json({ status: 'degraded', error: (err as Error).message });
    }
  });

  // Unknown API routes must answer 404 JSON — never fall through to the SPA index.html
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint API introuvable.' });
  });

  // Dynamic SEO Sitemap (F-SEO-03)
  app.get('/sitemap.xml', async (_req, res) => {
    const baseUrl = (process.env.APP_URL || 'https://emroddf.com').replace(/\/$/, '');
    const products = (await db
      .prepare(`SELECT slug, updated_at FROM products WHERE status = 'published'`)
      .all()) as Array<{ slug: string; updated_at: string }>;
    const vendors = (await db
      .prepare(
        `SELECT vp.slug FROM vendor_profiles vp JOIN users u ON u.id = vp.user_id WHERE u.status = 'validated'`
      )
      .all()) as Array<{ slug: string }>;

    const urls = [
      `${baseUrl}/`,
      `${baseUrl}/catalogue`,
      `${baseUrl}/devenir-vendeur`,
      `${baseUrl}/suivi`,
      `${baseUrl}/alertes`,
      ...products.map((p) => `${baseUrl}/produit/${p.slug}`),
      ...vendors.map((v) => `${baseUrl}/artisan/${v.slug}`),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  });

  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist'))) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
        hmr: disableHmr ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`EMROD Marketplace running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start EMROD server:', err);
  process.exit(1);
});
