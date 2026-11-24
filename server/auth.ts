import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const RUNTIME_JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    // An ephemeral secret would silently invalidate every session (and tracking-token
    // signature) on each restart: refuse to boot in production without an explicit secret.
    throw new Error(
      'JWT_SECRET manquant. Définissez-le dans l’environnement (ex. `openssl rand -hex 32`). ' +
        'Le serveur refuse de démarrer en production avec un secret éphémère.'
    );
  }
  console.warn(
    '[auth] JWT_SECRET absent : secret éphémère généré pour le développement — ' +
      'toutes les sessions et signatures de jetons seront perdues au redémarrage.'
  );
  return crypto.randomBytes(32).toString('hex');
})();

export const AUTH_COOKIE_NAME = 'emrod_session';

export interface SessionPayload {
  sub: string;
  role: 'admin' | 'vendor';
  email: string;
  jti?: string;
  exp: number;
}

// ── Token registry hooks (wired in routes.ts to avoid a db↔auth import cycle) ──
type TokenIssuer = (info: { jti: string; sub: string; role: string; email: string; exp: number }) => void;
type RevocationChecker = (jti: string) => boolean | Promise<boolean>;
let tokenIssuer: TokenIssuer | null = null;
let revocationChecker: RevocationChecker | null = null;

export function registerTokenHooks(issuer: TokenIssuer, checker: RevocationChecker): void {
  tokenIssuer = issuer;
  revocationChecker = checker;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(keyHex, 'hex');
    if (derived.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}

function base64UrlEncode(data: string | Buffer): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function signSessionToken(payload: Omit<SessionPayload, 'exp'>, ttlSeconds = 60 * 60 * 12): string {
  const jti = payload.jti || crypto.randomUUID();
  const fullPayload: SessionPayload = {
    ...payload,
    jti,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  try {
    tokenIssuer?.({
      jti,
      sub: payload.sub,
      role: payload.role,
      email: payload.email,
      exp: fullPayload.exp,
    });
  } catch {
    // Registry write is best-effort — never block a login
  }
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const bodyB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = crypto
    .createHmac('sha256', RUNTIME_JWT_SECRET)
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${headerB64}.${bodyB64}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, bodyB64, sigB64] = parts;
    const expectedSig = crypto
      .createHmac('sha256', RUNTIME_JWT_SECRET)
      .update(`${headerB64}.${bodyB64}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const decoded = JSON.parse(base64UrlDecode(bodyB64)) as SessionPayload;
    if (!decoded || typeof decoded.exp !== 'number' || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (decoded.role !== 'admin' && decoded.role !== 'vendor') return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Full verification INCLUDING the server-side revocation list (async DB lookup).
 * Route guards use this one; the sync variant above covers signature/expiry only.
 */
export async function verifySessionTokenChecked(token: string): Promise<SessionPayload | null> {
  const decoded = verifySessionToken(token);
  if (!decoded) return null;
  // Revoked session (admin force-logout): reject even a still-valid signature
  if (decoded.jti) {
    try {
      const revoked = await revocationChecker?.(decoded.jti);
      if (revoked) return null;
    } catch {
      // Checker unavailable — fail-open on infra errors
    }
  }
  return decoded;
}

export function generateTrackingToken(): { rawToken: string; tokenHash: string } {
  const nonce = crypto.randomBytes(18).toString('hex');
  const sig = crypto
    .createHmac('sha256', RUNTIME_JWT_SECRET)
    .update(nonce)
    .digest('hex')
    .slice(0, 16);
  const rawToken = `emr_${nonce}_${sig}`;
  const tokenHash = hashTrackingToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashTrackingToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function setSessionCookie(res: Response, token: string): void {
  const isProd = process.env.NODE_ENV === 'production';
  // Emit HttpOnly cookie compatible with AI Studio iframe and local preview
  const attrs = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Max-Age=43200',
  ];
  if (isProd || process.env.APP_URL?.startsWith('https://')) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res: Response): void {
  const isProd = process.env.NODE_ENV === 'production';
  const attrs = [`${AUTH_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isProd || process.env.APP_URL?.startsWith('https://')) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim();
  }
  return null;
}

export interface AuthenticatedRequest extends Request {
  session?: SessionPayload;
}

export function verifySameOriginOnCookieMutation(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }
  // If using Bearer token directly or custom header X-Requested-With, allow
  if (req.headers.authorization?.startsWith('Bearer ') || req.headers['x-requested-with']) {
    next();
    return;
  }
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
  // Modern browsers always send Origin on cross-site (and same-site fetch/form) mutations.
  // The SPA only mutates through fetch calls carrying X-Requested-With / Bearer (handled above),
  // so a mutating request with neither Origin nor those markers is treated as untrusted.
  if (!origin || !host) {
    res.status(403).json({ error: 'Origine de la requête non autorisée.' });
    return;
  }
  try {
    const originHost = new URL(origin).host;
    if (originHost === host) {
      next();
      return;
    }
  } catch {
    res.status(403).json({ error: 'Origine invalide.' });
    return;
  }
  res.status(403).json({ error: 'Requête cross-origin refusée.' });
}

export function requireAuth(roles?: Array<'admin' | 'vendor'>) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const token = extractAuthToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentification requise.' });
      return;
    }
    const payload = await verifySessionTokenChecked(token);
    if (!payload) {
      res.status(401).json({ error: 'Session expirée ou invalide.' });
      return;
    }
    if (roles && !roles.includes(payload.role)) {
      res.status(403).json({ error: 'Accès non autorisé pour ce rôle.' });
      return;
    }
    req.session = payload;
    next();
  };
}
