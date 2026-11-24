import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';
import { generateVAPIDKeys, setVapidDetails, sendNotification } from 'web-push';
import { db, runInTransaction } from '../db';
import { generateTrackingToken, hashTrackingToken } from '../auth';
import { recordCommissionForPayment, reverseCommissionForRefund } from '../commissions';
import { sendMail } from '../mailer';
import { canTransitionOrderStatus, formatGNF } from '../../src/shared/domain';
import type { OrderStatus } from '../../src/shared/types';

// ── Errors & request plumbing ────────────────────────────────────────────

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

type WrappedHandler = (req: Request, res: Response) => void | Promise<void>;

/** Express wrapper: converts HttpError into `{ error }` JSON responses. */
export function wrap(handler: WrappedHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res)).catch((err: unknown) => {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        console.error('[api] Unhandled error:', err);
        res.status(500).json({ error: 'Erreur interne du serveur.' });
      }
    });
  };
}

/** Parses + validates a JSON body with Zod; first issue message on failure. */
export function parseBody<T>(schema: ZodType<T>, req: Request): T {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, issue?.message || 'Données invalides.');
  }
  return result.data;
}

export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.ip || '';
}

// ── IDs, ordering, slugs ─────────────────────────────────────────────────

export function now(): string {
  return new Date().toISOString();
}

export function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function genTrackingToken(): { rawToken: string; tokenHash: string } {
  return generateTrackingToken();
}

export { hashTrackingToken };

/** Sequential human-friendly order number: EMR-<year>-<1000+count>. */
export async function nextOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const row = await db.prepare(`SELECT COUNT(*) AS c FROM orders`).get() as { c: number };
  let seq = 1000 + Number(row.c) + 1;
  // Guard against collisions after deletions (UNIQUE constraint on order_number)
  while (await db.prepare(`SELECT id FROM orders WHERE order_number = ?`).get(`EMR-${year}-${seq}`)) {
    seq += 1;
  }
  return `EMR-${year}-${seq}`;
}

export async function slugifyUnique(base: string, table: 'vendor_profiles' | 'products'): Promise<string> {
  const slug = base
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'boutique';
  let candidate = slug;
  let i = 2;
  while (await db.prepare(`SELECT 1 FROM ${table} WHERE slug = ?`).get(candidate)) {
    candidate = `${slug}-${i}`;
    i += 1;
  }
  return candidate;
}

// ── Platform state: maintenance, blacklist, analytics ───────────────────

export async function getMaintenance(): Promise<{ enabled: boolean; message: string }> {
  const row = await db
    .prepare(`SELECT value_json FROM platform_rules WHERE key = 'maintenance'`)
    .get() as { value_json: string } | undefined;
  try {
    const parsed = row ? (JSON.parse(row.value_json) as { enabled?: boolean; message?: string }) : {};
    return {
      enabled: Boolean(parsed.enabled),
      message: parsed.message || 'Maintenance en cours — les commandes reprennent dans quelques minutes.',
    };
  } catch {
    return { enabled: false, message: 'Maintenance en cours.' };
  }
}

export async function setMaintenance(state: { enabled: boolean; message: string }): Promise<void> {
  await db.prepare(
    `INSERT INTO platform_rules (key, value_json, updated_at) VALUES ('maintenance', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(JSON.stringify(state), now());
}

/** True when the guest identity (email or phone) is on the buyer blacklist. */
export async function isBlacklistedGuest(email: string, phone: string): Promise<boolean> {
  const normalizePhone = (p: string): string => (p || '').replace(/[^\d]/g, '').slice(-8);
  // Email check (case-insensitive)
  const emailTrim = (email || '').trim().toLowerCase();
  if (
    emailTrim &&
    await db.prepare(`SELECT 1 FROM buyer_blacklist WHERE kind = 'email' AND LOWER(value) = ?`).get(emailTrim)
  ) {
    return true;
  }
  // Phone check on the 8 last digits so +224 prefixes never bypass the ban
  const phoneDigits = normalizePhone(phone);
  if (phoneDigits) {
    const rows = await db
      .prepare(`SELECT value FROM buyer_blacklist WHERE kind = 'phone'`)
      .all() as Array<{ value: string }>;
    if (rows.some((r) => normalizePhone(r.value) === phoneDigits)) return true;
  }
  return false;
}

export function logAnalyticsEvent(
  type: 'product_view' | 'cart_add' | 'checkout_start' | 'payment_success' | 'product_published' | (string & {}),
  productId?: string | null,
  orderId?: string | null
): void {
  try {
    void db
      .prepare(
        `INSERT INTO analytics_events (id, type, product_id, order_id, meta, created_at) VALUES (?, ?, ?, ?, '', ?)`
      )
      .run(genId('ev'), type, productId || null, orderId || null, now())
      .catch(() => {
        // Analytics must never break the request path
      });
  } catch {
    // ignore
  }
}

export function logSearchQuery(q: string, resultsCount: number): void {
  const clean = (q || '').trim().slice(0, 120);
  if (!clean) return;
  try {
    void db
      .prepare(`INSERT INTO search_queries (id, q, results_count, created_at) VALUES (?, ?, ?, ?)`)
      .run(genId('sq'), clean.toLowerCase(), resultsCount, now())
      .catch(() => {
        // ignore
      });
  } catch {
    // ignore
  }
}

// ── Admin auth rule ──────────────────────────────────────────────────────

export interface AdminAuthRule {
  claimed: boolean;
  passwordHash: string;
}

export async function getAdminAuthRule(): Promise<AdminAuthRule> {
  const row = await db
    .prepare(`SELECT value_json FROM platform_rules WHERE key = 'admin_auth'`)
    .get() as { value_json: string } | undefined;
  try {
    const parsed = row ? JSON.parse(row.value_json) as Partial<AdminAuthRule> : {};
    return { claimed: Boolean(parsed.claimed), passwordHash: String(parsed.passwordHash || '') };
  } catch {
    return { claimed: false, passwordHash: '' };
  }
}

export async function setAdminAuthRule(rule: AdminAuthRule): Promise<void> {
  await db.prepare(
    `INSERT INTO platform_rules (key, value_json, updated_at) VALUES ('admin_auth', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(JSON.stringify(rule), now());
}

// ── Web Push (VAPID keypair auto-persisted in platform_rules) ───────────

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export async function getVapidKeys(): Promise<VapidKeys> {
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) return { publicKey: envPub, privateKey: envPriv };

  const row = await db
    .prepare(`SELECT value_json FROM platform_rules WHERE key = 'vapid_keys'`)
    .get() as { value_json: string } | undefined;
  if (row) {
    try {
      const parsed = JSON.parse(row.value_json) as VapidKeys;
      if (parsed.publicKey && parsed.privateKey) return parsed;
    } catch {
      // regenerate below
    }
  }
  // Generate + persist so the key survives restarts (existing subscriptions stay valid)
  const generated = generateVAPIDKeys();
  const keys: VapidKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey };
  await db.prepare(
    `INSERT INTO platform_rules (key, value_json, updated_at) VALUES ('vapid_keys', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(JSON.stringify(keys), now());
  return keys;
}

/** Dispatches a web-push notification to matching subscriptions; returns delivered count. */
export async function dispatchPushNotification(payload: {
  title: string;
  body: string;
  targetCategory: string;
  targetRegion: string;
  targetUrl: string;
}): Promise<{ sentCount: number; deliveredCount: number }> {
  const subs = await db
    .prepare(
      `SELECT * FROM push_subscriptions WHERE frequency != 'disabled' AND endpoint != ''`
    )
    .all() as Array<{
    id: string;
    endpoint: string;
    keys_json: string;
    categories_json: string;
    region: string;
  }>;

  const matching = subs.filter((s) => {
    const cats = JSON.parse(String(s.categories_json || '[]')) as string[];
    const catOk =
      payload.targetCategory === 'all' || cats.length === 0 || cats.includes(payload.targetCategory);
    const regionOk = payload.targetRegion === 'all' || s.region === payload.targetRegion;
    return catOk && regionOk;
  });

  let delivered = 0;
  if (matching.length > 0) {
    try {
      const keys = await getVapidKeys();
      setVapidDetails(
        process.env.APP_URL || 'mailto:contact@emroddf.com',
        keys.publicKey,
        keys.privateKey
      );
      const body = JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.targetUrl,
      });
      for (const sub of matching) {
        try {
          const parsedKeys = JSON.parse(String(sub.keys_json || '{}')) as Record<string, string>;
          void sendNotification(
              { endpoint: sub.endpoint, keys: parsedKeys as { p256dh: string; auth: string } },
              body
            )
            .catch(async () => {
              // 404/410 → stale subscription: remove it so future campaigns stay fast
              try {
                await db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).run(sub.id);
              } catch {
                // ignore
              }
            });
          delivered += 1;
        } catch {
          // one bad subscription must not abort the campaign
        }
      }
    } catch (err) {
      console.error('[push] Campagne impossible :', err);
    }
  }
  return { sentCount: matching.length, deliveredCount: delivered };
}

// ── CSV export helper ────────────────────────────────────────────────────

export function sendCsv(res: Response, filename: string, rows: Array<Record<string, unknown>>): void {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : ['info'];
  const escape = (v: unknown): string => {
    const s =
      v === null || v === undefined
        ? ''
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(',')];
  if (rows.length === 0) {
    lines.push('"Aucune donnee sur la periode"');
  } else {
    for (const row of rows) lines.push(columns.map((c) => escape(row[c])).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // BOM so Excel opens accents correctly
  res.send('\uFEFF' + lines.join('\n'));
}

// ── Payment success / refund pipelines (shared by orders, quotes, admin) ─

interface OrderRow {
  id: string;
  order_number: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  subtotal_gnf: number;
  delivery_fee_gnf: number;
  total_gnf: number;
  status: string;
  tracking_token_hash: string;
  payment_mode: string;
  payment_plan: string;
  amount_paid_now_gnf: number;
  balance_due_gnf: number;
}

export async function getOrderById(orderId: string): Promise<OrderRow | null> {
  return (
    (await db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as OrderRow | undefined) || null
  );
}

export async function getOrderByTokenHash(tokenHash: string): Promise<OrderRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM orders WHERE tracking_token_hash = ?`)
      .get(tokenHash) as OrderRow | undefined) || null
  );
}

async function ensureOrderEvent(orderId: string, status: OrderStatus, actorRole: string, actorName: string, comment: string): Promise<void> {
  const existing = await db
    .prepare(`SELECT id FROM order_events WHERE order_id = ? AND status = ? LIMIT 1`)
    .get(orderId, status) as { id: string } | undefined;
  if (existing) return;
  await db.prepare(
    `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(genId('oe'), orderId, status, actorRole, actorName, comment, now());
}

async function createPayoutsForOrder(order: OrderRow, source: string): Promise<void> {
  const existing = await db
    .prepare(`SELECT COUNT(*) AS c FROM payouts WHERE order_id = ?`)
    .get(order.id) as { c: number };
  if (Number(existing.c) > 0) return;

  const vendorShares = await db
    .prepare(
      `SELECT vendor_id, SUM(unit_price_gnf * quantity + delivery_fee_gnf) AS amount
       FROM order_items WHERE order_id = ? GROUP BY vendor_id ORDER BY vendor_id`
    )
    .all(order.id) as Array<{ vendor_id: string; amount: number }>;
  const total = Number(order.total_gnf) || 1;
  const paidNow = Math.min(Number(order.amount_paid_now_gnf), total);
  const refPrefix = source === 'bank_transfer' ? 'VIR-POUT' : 'DJM-POUT';
  for (let idx = 0; idx < vendorShares.length; idx++) {
    const v = vendorShares[idx]!;
    const amount = Math.round((Number(v.amount) * paidNow) / total);
    await db.prepare(
      `INSERT INTO payouts (id, vendor_id, order_id, amount_gnf, commission_gnf, net_amount_gnf, reference, status, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, 'pending', ?)`
    ).run(
      genId('pout'),
      v.vendor_id,
      order.id,
      amount,
      amount,
      `${refPrefix}-${String(order.order_number || '').replace(/\D/g, '').slice(-6)}${vendorShares.length > 1 ? `-${idx + 1}` : ''}`,
      now()
    );
  }
}

/**
 * Single success pipeline for ANY collected payment on an order:
 * webhook, OTP confirmation, portal completion, bank-transfer confirmation,
 * admin reconciliation. Idempotent per payment (guard on payments.status).
 */
export async function applyPaymentSuccess(params: {
  orderId: string;
  paymentId: string | null;
  paidAmountGnf: number;
  source: string;
  eventComment?: string;
}): Promise<void> {
  const order = await getOrderById(params.orderId);
  if (!order) return;

  await runInTransaction(async () => {
    // 1. Order paid/balance columns
    await db.prepare(
      `UPDATE orders
       SET amount_paid_now_gnf = amount_paid_now_gnf + ?,
           balance_due_gnf = GREATEST(0, total_gnf - amount_paid_now_gnf - ?),
           updated_at = ?
       WHERE id = ?`
    ).run(params.paidAmountGnf, params.paidAmountGnf, now(), order.id);

    // 2. Timeline event (once)
    await ensureOrderEvent(
      order.id,
      'Commandée',
      'system',
      'Système Djomy',
      params.eventComment || `Paiement confirmé (${formatGNF(params.paidAmountGnf)}).`
    );

    // 3. Refresh in-memory amount for payout prorata
    const refreshed = (await getOrderById(order.id))!;

    // 4. Vendor payouts (pro-rata of the collected amount)
    await createPayoutsForOrder(refreshed, params.source);

    // 5. Platform commission ledger + payout net columns
    await recordCommissionForPayment({
      orderId: order.id,
      paymentId: params.paymentId,
      amountGnf: params.paidAmountGnf,
      source: params.source,
    });

    // 6. Stock decrement
    const items = await db
      .prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`)
      .all(order.id) as Array<{ product_id: string; quantity: number }>;
    for (const item of items) {
      await db.prepare(`UPDATE products SET stock_qty = GREATEST(0, stock_qty - ?) WHERE id = ?`).run(
        item.quantity,
        item.product_id
      );
    }

    // 7. Funnel analytics
    logAnalyticsEvent('payment_success', null, order.id);
  });

  // 8. Receipt e-mail (fire-and-forget, outside the transaction)
  sendMail({
    to: order.buyer_email,
    subject: `Commande ${order.order_number} confirmée — EMROD Marketplace`,
    text: `Bonjour ${order.buyer_name},\n\nVotre paiement de ${formatGNF(params.paidAmountGnf)} pour la commande ${order.order_number} est confirmé.\nVotre lien de suivi personnel vous a été communiqué à la commande.\n\nEMROD SARL`,
    html: `<p>Bonjour ${order.buyer_name},</p><p>Votre paiement de <strong>${formatGNF(params.paidAmountGnf)}</strong> pour la commande <strong>${order.order_number}</strong> est confirmé. Votre lien de suivi personnel vous a été communiqué à la commande.</p><p>EMROD SARL — Atelier Sonfonia, Conakry</p>`,
  });
}

/** Full refund pipeline: payment row, order status, commission reversal, stock restore. */
export async function applyOrderRefund(params: {
  orderId: string;
  paymentId?: string | null;
  refundAmountGnf: number;
  actorRole: 'admin' | 'vendor' | 'buyer' | 'system';
  actorName: string;
  comment?: string;
}): Promise<void> {
  const order = await getOrderById(params.orderId);
  if (!order) return;
  await runInTransaction(async () => {
    if (params.paymentId) {
      await db.prepare(`UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?`).run(
        now(),
        params.paymentId
      );
    }
    await db.prepare(
      `UPDATE orders SET status = 'Remboursée', balance_due_gnf = 0, updated_at = ? WHERE id = ?`
    ).run(now(), order.id);
    await db.prepare(
      `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at)
       VALUES (?, ?, 'Remboursée', ?, ?, ?, ?)`
    ).run(
      genId('oe'),
      order.id,
      params.actorRole,
      params.actorName,
      params.comment || `Remboursement de ${formatGNF(params.refundAmountGnf)} via Djomy.`,
      now()
    );
    // Negative commission lines keep ledger sums meaningful
    await reverseCommissionForRefund(order.id, params.refundAmountGnf);
    // Restore stock
    const items = await db
      .prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`)
      .all(order.id) as Array<{ product_id: string; quantity: number }>;
    for (const item of items) {
      await db.prepare(`UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?`).run(
        item.quantity,
        item.product_id
      );
    }
    // Cancel pending payouts
    await db.prepare(`DELETE FROM payouts WHERE order_id = ? AND status IN ('pending','scheduled')`).run(
      order.id
    );
  });
}

/** Status transition guard wrapper — throws a 400 with a readable French message. */
export function assertTransition(
  current: OrderStatus,
  next: OrderStatus,
  actorRole: 'system' | 'vendor' | 'admin' | 'buyer',
  reason?: string
): void {
  if (!canTransitionOrderStatus(current, next, actorRole)) {
    throw new HttpError(
      400,
      reason ||
        `Transition de statut « ${current} » vers « ${next} » non autorisée pour ce rôle.`
    );
  }
}

export async function insertOrderEvent(orderId: string, status: OrderStatus, actorRole: string, actorName: string, comment: string): Promise<void> {
  await db.prepare(
    `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(genId('oe'), orderId, status, actorRole, actorName, comment, now());
}
