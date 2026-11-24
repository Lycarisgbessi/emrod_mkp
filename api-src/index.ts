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
  if (!readyPromise) readyPromise = createApp();
  const app = await readyPromise;
  // Une app Express est un RequestHandler Node standard : (req, res).
  app(req, res);
}
