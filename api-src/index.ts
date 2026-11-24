/**
 * Point d'entrée serverless Vercel (@vercel/node).
 *
 * Le runtime Vercel appelle ce handler pour chaque requête routée ici via
 * vercel.json (rewrites /api/* et /sitemap.xml). L'application Express est
 * construite UNE fois par instance froide puis réutilisée pour toutes les
 * invocations chaudes du même lambda (cache module-level).
 */
import type { Express, Request, Response } from 'express';
import { createApp } from '../server';

let readyPromise: Promise<Express> | null = null;

export default async function handler(req: Request, res: Response): Promise<void> {
  try {
    if (!readyPromise) readyPromise = createApp();
    const app = await readyPromise;
    // Une app Express est un RequestHandler Node standard : (req, res).
    app(req, res);
  } catch (err) {
    // Sans ce catch, une erreur d'init (ex. DB injoignable) produirait un
    // FUNCTION_INVOCATION_FAILED opaque côté Vercel — on expose le diagnostic.
    console.error("[api] Erreur d'initialisation:", err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Initialisation API échouée',
      detail: (err as Error)?.message ?? String(err),
    }));
  }
}
