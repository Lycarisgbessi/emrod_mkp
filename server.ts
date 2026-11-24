// Load .env / .env.local BEFORE any module reads process.env (JWT_SECRET, Djomy, VAPID…)
import 'dotenv/config';
import express, { type Express } from 'express';
import http from 'node:http';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import type { createServer as ViteDevServerFactory } from 'vite';
import { createApiRouter } from './server/routes';
import { db, initDatabase } from './server/db';

const PORT = Number(process.env.PORT || 3000);

/**
 * Construit l'application Express complète : init base (schéma/seed/fast-path),
 * API, sitemap, statiques. Partagée par le boot long-running (local, Docker,
 * Render) et le handler serverless Vercel (api/index.ts, sans listen).
 *
 * `httpServer` n'est requis que pour le middleware Vite en développement
 * (attache du WebSocket HMR).
 */
export async function createApp(httpServer?: http.Server): Promise<Express> {
  await initDatabase();

  const app = express();
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

  if (process.env.VERCEL === '1') {
    // Serverless : le statique (dist/) et le fallback SPA sont gérés par la
    // plateforme via vercel.json — rien à monter ici (fs read-only, pas de
    // middleware Vite).
  } else if (
    process.env.NODE_ENV === 'production' &&
    fs.existsSync(path.resolve(process.cwd(), 'dist'))
  ) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    if (!httpServer) {
      throw new Error(
        'Le middleware Vite (développement) exige un httpServer — le boot local le fournit.'
      );
    }
    const disableHmr = process.env.DISABLE_HMR === 'true';
    // Import dynamique : vite (et sa chaîne lightningcss/rolldown) ne doit
    // JAMAIS être chargé en production — il alourdirait le bundle serverless.
    const { createServer: createViteServer } = (await import('vite')) as {
      createServer: typeof ViteDevServerFactory;
    };
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

  return app;
}

// Boot long-running (local, Docker, Render). Sur Vercel (VERCEL=1), createApp
// est importé par api/index.ts et branché sur le runtime serverless — pas de
// listen, pas de port à ouvrir.
if (!process.env.VERCEL) {
  void (async () => {
    // L'app n'existe qu'après initDatabase : pendant la phase de démarrage,
    // les requêtes reçoivent un 503 explicite au lieu d'une connexion muette.
    let app: Express | null = null;
    const httpServer = http.createServer((req, res) => {
      if (!app) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Serveur en démarrage, réessayez.' }));
        return;
      }
      app(req, res);
    });
    try {
      app = await createApp(httpServer);
      httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`EMROD Marketplace running on http://0.0.0.0:${PORT}`);
      });
    } catch (err) {
      console.error('Failed to start EMROD server:', err);
      process.exit(1);
    }
  })();
}
