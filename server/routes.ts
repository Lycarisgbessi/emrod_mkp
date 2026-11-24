import { Router } from 'express';
import { db } from './db';
import { registerTokenHooks } from './auth';
import { publicRouter } from './routes/public';
import { ordersRouter } from './routes/orders';
import { quotesRouter } from './routes/quotes';
import { paymentsRouter } from './routes/payments';
import { authRouter } from './routes/auth';
import { vendorRouter } from './routes/vendor';
import { adminRouter } from './routes/admin';

/**
 * Persists issued session tokens (jti) so the admin Security tab can list
 * and revoke active sessions; revocation checks read token_revocations.
 */
registerTokenHooks(
  (info) => {
    // Fire-and-forget: le registre n'interrompt jamais une connexion
    void db
      .prepare(
        `INSERT INTO issued_tokens (jti, sub, role, email, exp, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (jti) DO NOTHING`
      )
      .run(
        info.jti,
        info.sub,
        info.role,
        info.email,
        new Date(info.exp * 1000).toISOString(),
        new Date().toISOString()
      )
      .catch(() => {});
  },
  async (jti) => {
    try {
      const row = await db.prepare(`SELECT 1 FROM token_revocations WHERE jti = ?`).get(jti);
      return Boolean(row);
    } catch {
      return false;
    }
  }
);

export function createApiRouter(): Router {
  const api = Router();

  api.use(publicRouter);
  api.use(authRouter);
  api.use(ordersRouter);
  api.use(quotesRouter);
  api.use(paymentsRouter);
  api.use(vendorRouter);
  api.use(adminRouter);

  return api;
}
