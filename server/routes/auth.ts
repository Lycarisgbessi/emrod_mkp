import { Router } from 'express';
import { z } from 'zod';
import { vendorRegisterSchema } from '../../src/shared/schemas';
import { db } from '../db';
import { clearSessionCookie, extractAuthToken, hashPassword, setSessionCookie, signSessionToken, type AuthenticatedRequest, verifyPassword, verifySessionToken, verifySessionTokenChecked } from '../auth';
import { getCommercialRestrictions, getRule } from '../queries';
import { sendMail } from '../mailer';
import {
  HttpError,
  clientIp,
  genId,
  getAdminAuthRule,
  getMaintenance,
  now,
  parseBody,
  setAdminAuthRule,
  slugifyUnique,
  wrap,
} from './_helpers';

export const authRouter = Router();

/* ─────────────────────────────────────────────────────────────────────────
 * Brute-force guard — 8 failed attempts per subject OR per IP within 15 min
 * ──────────────────────────────────────────────────────────────────────── */

const MAX_FAILED_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MINUTES = 15;

async function failedAttemptsSince(subject: string, ip: string, sinceIso: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM login_attempts
       WHERE success = 0 AND created_at >= ? AND (subject = ? OR (ip != '' AND ip = ?))`
    )
    .get(sinceIso, subject, ip) as { cnt: number };
  return Number(row.cnt || 0);
}

async function assertNotRateLimited(subject: string, ip: string): Promise<void> {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60 * 1000).toISOString();
  if ((await failedAttemptsSince(subject, ip, since)) >= MAX_FAILED_ATTEMPTS) {
    throw new HttpError(
      429,
      `Trop de tentatives échouées. Réessayez dans ${ATTEMPT_WINDOW_MINUTES} minutes.`
    );
  }
}

async function recordLoginAttempt(subject: string, ip: string, success: boolean): Promise<void> {
  await db.prepare(
    `INSERT INTO login_attempts (id, subject, ip, success, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(genId('att'), subject, ip, success ? 1 : 0, now());
  // Opportunistic prune — the attempts ledger only needs ~30 days of history
  await db.prepare(`DELETE FROM login_attempts WHERE created_at < ?`).run(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  );
}

function logAudit(
  actorId: string,
  actorRole: string,
  actorName: string,
  action: string,
  targetType: string,
  targetId: string,
  after: Record<string, unknown> = {}
): void {
  void db
    .prepare(
      `INSERT INTO audit_logs (id, actor_id, actor_role, actor_name, action, target_type, target_id, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`
    )
    .run(genId('aud'), actorId, actorRole, actorName, action, targetType, targetId, JSON.stringify(after), now())
    .catch(() => {});
}

const passcodeSchema = z.object({
  passcode: z.string().trim().min(1, 'Mot de passe requis.').max(128),
});

/* ─────────────────────────────────────────────────────────────────────────
 * GET /api/auth/admin-status — first-run detection for the login gate
 * ──────────────────────────────────────────────────────────────────────── */

authRouter.get(
  '/auth/admin-status',
  wrap(async (_req, res) => {
    const rule = await getAdminAuthRule();
    res.json({
      configured: rule.claimed,
      mode: rule.claimed ? 'claimed' : 'unclaimed',
    });
  })
);

/* POST /api/auth/admin-claim — first-run master password initialization */
authRouter.post(
  '/auth/admin-claim',
  wrap(async (req, res) => {
    const rule = await getAdminAuthRule();
    if (rule.claimed) {
      throw new HttpError(409, 'L’accès administrateur est déjà configuré — connectez-vous.');
    }
    const body = parseBody(passcodeSchema, req);
    if (body.passcode.length < 8) {
      throw new HttpError(400, 'Le mot de passe administrateur doit contenir au moins 8 caractères.');
    }

    await setAdminAuthRule({ claimed: true, passwordHash: hashPassword(body.passcode) });

    const ts = now();
    await db.prepare(
      `INSERT INTO audit_logs (id, actor_id, actor_role, actor_name, action, target_type, target_id, before_json, after_json, created_at)
       VALUES (?, ?, 'admin', 'Direction EMROD', 'admin_claimed', 'admin_auth', 'admin_auth', '{}', ?, ?)`
    ).run(genId('aud'), 'admin', JSON.stringify({ ip: clientIp(req) }), ts);

    const token = signSessionToken({ sub: 'admin', role: 'admin', email: 'direction@emroddf.com' });
    setSessionCookie(res, token);
    res.json({ token, role: 'admin' });
  })
);

/* POST /api/auth/admin-login */
authRouter.post(
  '/auth/admin-login',
  wrap(async (req, res) => {
    const rule = await getAdminAuthRule();
    if (!rule.claimed) {
      throw new HttpError(400, 'Accès administrateur non encore initialisé (premier démarrage requis).');
    }

    const ip = clientIp(req);
    await assertNotRateLimited('admin', ip);

    const body = parseBody(passcodeSchema, req);
    const ok = verifyPassword(body.passcode, rule.passwordHash);
    await recordLoginAttempt('admin', ip, ok);

    if (!ok) {
      const remaining = Math.max(
        0,
        MAX_FAILED_ATTEMPTS - (await failedAttemptsSince('admin', ip, new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60 * 1000).toISOString()))
      );
      throw new HttpError(
        401,
        remaining > 0
          ? `Mot de passe administrateur incorrect (${remaining} tentative(s) avant blocage temporaire).`
          : `Mot de passe incorrect. Compte bloqué ${ATTEMPT_WINDOW_MINUTES} minutes.`
      );
    }

    await db.prepare(
      `INSERT INTO audit_logs (id, actor_id, actor_role, actor_name, action, target_type, target_id, before_json, after_json, created_at)
       VALUES (?, ?, 'admin', 'Direction EMROD', 'admin_login', 'admin_auth', 'admin_auth', '{}', ?, ?)`
    ).run(genId('aud'), 'admin', JSON.stringify({ ip }), now());

    const token = signSessionToken({ sub: 'admin', role: 'admin', email: 'direction@emroddf.com' });
    setSessionCookie(res, token);
    res.json({ token, role: 'admin' });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * POST /api/auth/vendor-register — open a workshop dossier (status: pending)
 * ──────────────────────────────────────────────────────────────────────── */

authRouter.post(
  '/auth/vendor-register',
  wrap(async (req, res) => {
    const restrictions = await getCommercialRestrictions();
    if (!restrictions.vendorRegistrationEnabled) {
      throw new HttpError(403, 'Les inscriptions vendeur sont temporairement fermées par EMROD.');
    }

    const body = parseBody(vendorRegisterSchema, req);
    const email = body.email.toLowerCase();

    const existing = await db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) {
      throw new HttpError(409, 'Un compte existe déjà avec ce courriel — connectez-vous.');
    }

    const userId = genId('usr');
    const ts = now();
    const slug = await slugifyUnique(body.shopName, 'vendor_profiles');

    await db.prepare(
      `INSERT INTO users (id, email, phone, password_hash, role, status, status_reason, email_verified, phone_verified, entity_type, created_at)
       VALUES (?, ?, ?, ?, 'vendor', 'pending', '', 0, 0, ?, ?)`
    ).run(userId, email, body.phone, hashPassword(body.password), body.entityType, ts);

    await db.prepare(
      `INSERT INTO vendor_profiles (user_id, slug, shop_name, description, story, location, logo_url, is_emrod_official, default_zones_json, response_time_label, custom_fields_json, bank_transfer_enabled, bank_name, bank_account_holder, bank_iban_rib, bank_swift_bic, bank_instructions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '', 0, '[]', 'Répond sous 2h', ?, 0, '', '', '', '', '', ?)`
    ).run(userId, slug, body.shopName, body.description, body.story || '', body.location, JSON.stringify(body.customFields || {}), ts);

    await db.prepare(
      `INSERT INTO audit_logs (id, actor_id, actor_role, actor_name, action, target_type, target_id, before_json, after_json, created_at)
       VALUES (?, ?, 'vendor', ?, 'vendor_registered', 'user', ?, '{}', ?, ?)`
    ).run(
      genId('aud'),
      userId,
      body.shopName,
      JSON.stringify({ email, entityType: body.entityType, ip: clientIp(req) }),
      ts
    );

    sendMail({
      to: email,
      subject: `Dossier atelier ouvert — ${body.shopName} · EMROD`,
      text: `Bonjour ${body.shopName},\n\nVotre dossier vendeur est ouvert sur EMROD. Il est en attente d'examen par la direction.\nProchaine étape : déposez vos pièces justificatives KYC depuis votre portail vendeur.\n\nEMROD SARL`,
      html: `<p>Bonjour <strong>${body.shopName}</strong>,</p><p>Votre dossier vendeur est ouvert sur EMROD (statut : <em>en attente d'examen</em>).</p><p>Prochaine étape : déposez vos pièces justificatives KYC depuis votre portail vendeur.</p><p>EMROD SARL</p>`,
    });

    const token = signSessionToken({ sub: userId, role: 'vendor', email });
    setSessionCookie(res, token);
    res.status(201).json({ token, role: 'vendor', shopName: body.shopName });
  })
);

/* POST /api/auth/vendor-login — vendor AND admin (double-hat) login gate */
authRouter.post(
  '/auth/vendor-login',
  wrap(async (req, res) => {
    const body = parseBody(
      z.object({
        email: z.string().trim().email('Courriel invalide.'),
        password: z.string().min(1, 'Mot de passe requis.'),
      }),
      req
    );
    const email = body.email.toLowerCase();
    const ip = clientIp(req);
    await assertNotRateLimited(email, ip);

    const user = await db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as
      | { id: string; email: string; password_hash: string; role: 'admin' | 'vendor'; status: string }
      | undefined;

    const ok = Boolean(user) && verifyPassword(body.password, String(user?.password_hash || ''));
    await recordLoginAttempt(email, ip, ok);
    if (!ok || !user) {
      throw new HttpError(401, 'Courriel ou mot de passe incorrect.');
    }

    if (user.role === 'vendor') {
      if (user.status === 'rejected') {
        throw new HttpError(403, 'Votre dossier a été refusé par EMROD. Contactez la direction pour en connaître les motifs.');
      }
      if (user.status === 'suspended') {
        throw new HttpError(403, 'Votre compte atelier est suspendu. Contactez la direction EMROD.');
      }
    }

    await recordLoginAttempt(email, ip, true);
    const token = signSessionToken({ sub: user.id, role: user.role, email: user.email });
    setSessionCookie(res, token);
    res.json({ token, role: user.role });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * POST /api/auth/logout — revokes the current jti (server-side kill switch)
 * ──────────────────────────────────────────────────────────────────────── */

authRouter.post(
  '/auth/logout',
  wrap(async (req, res) => {
    const token = extractAuthToken(req);
    if (token) {
      const payload = verifySessionToken(token);
      if (payload?.jti) {
        await db.prepare(
          `INSERT INTO token_revocations (jti, revoked_at) VALUES (?, ?) ON CONFLICT (jti) DO NOTHING`
        ).run(payload.jti, now());
      }
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  })
);

/* GET /api/auth/me — session introspection (never 401: null when anonymous) */
authRouter.get(
  '/auth/me',
  wrap(async (req: AuthenticatedRequest, res) => {
    const token = extractAuthToken(req);
    const payload = token ? await verifySessionTokenChecked(token) : null;
    res.json({
      session: payload ? { sub: payload.sub, role: payload.role, email: payload.email } : null,
    });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * GET /api/rules/public — storefront + vendor-portal public configuration
 * (never leaks commission rates or admin-only settings)
 * ──────────────────────────────────────────────────────────────────────── */

authRouter.get(
  '/rules/public',
  wrap(async (_req, res) => {
    const restrictions = await getCommercialRestrictions();
    const registrationRequirements = await getRule('registration_requirements', {
      fields: [],
      documents: [],
    });
    const maintenance = await getMaintenance();
    res.json({
      restrictions,
      registrationRequirements,
      maintenance: { enabled: maintenance.enabled, message: maintenance.message },
      legal: await getRule('legal', {}),
      editorial: await getRule('editorial', {}),
    });
  })
);
