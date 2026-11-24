import { Router } from 'express';
import { z } from 'zod';
import {
  adminBadgeCreateSchema,
  adminCategoryPatchSchema,
  adminCertificationSchema,
  adminDocumentPatchSchema,
  adminVendorStatusPatchSchema,
  alertDispatchSchema,
  blacklistSchema,
  commercialRestrictionsSchema,
  commissionConfigSchema,
  deliveryZonesSchema,
  disputePatchSchema,
  editorialSchema,
  legalTextsSchema,
  maintenanceSchema,
  orderStatusOverrideSchema,
  passcodeChangeSchema,
  registrationRulesSchema,
} from '../../src/shared/schemas';
import type { OrderStatus, ProductItem, VendorAccountStatus } from '../../src/shared/types';
import { db } from '../db';
import { generateTrackingToken, hashPassword, requireAuth, verifyPassword, type AuthenticatedRequest } from '../auth';
import { paymentProvider } from '../djomy';
import {
  commissionByVendor,
  commissionSummary,
  getCommissionConfig,
  monthlyReport,
  queryCommissionLedger,
  setCommissionConfig,
} from '../commissions';
import {
  buyerDossier,
  categoryStats,
  conversionFunnel,
  dashboardStats,
  deliveryStats,
  operatorStats,
  planStats,
  periodBounds,
  queryBuyers,
  quotesPipeline,
  reviewsStats,
  salesSeries,
  searchStats,
  seasonalityStats,
  systemHealth,
  topProducts,
} from '../stats';
import {
  getAllBadges,
  getAllCategories,
  getVendorCompliance,
  getRule,
  setRule,
  getDeliveryZones,
  getCommercialRestrictions,
  hydrateProducts,
} from '../queries';
import { sendMail } from '../mailer';
import { markPaymentFailed, markPaymentRefunded, settlePaymentRow } from './payments';
import {
  HttpError,
  applyOrderRefund,
  dispatchPushNotification,
  genId,
  getAdminAuthRule,
  getMaintenance,
  getOrderById,
  getVapidKeys,
  now,
  parseBody,
  sendCsv,
  setAdminAuthRule,
  setMaintenance,
} from './_helpers';

export const adminRouter = Router();

/* Every /api/admin route requires an admin session (cookie or Bearer). */
const requireAdmin = requireAuth(['admin']);

/* ─────────────────────────────────────────────────────────────────────────
 * Audit trail helper — every admin mutation lands in audit_logs
 * ──────────────────────────────────────────────────────────────────────── */

const ADMIN_NAME = 'Direction EMROD';

function audit(action: string, targetType: string, targetId: string, before: unknown, after: unknown): void {
  void db
    .prepare(
      `INSERT INTO audit_logs (id, actor_id, actor_role, actor_name, action, target_type, target_id, before_json, after_json, created_at)
       VALUES (?, 'admin', 'admin', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(genId('aud'), ADMIN_NAME, action, targetType, targetId, JSON.stringify(before ?? {}), JSON.stringify(after ?? {}), now())
    .catch(() => {});
}

async function refundOrderFully(orderId: string, comment: string): Promise<void> {
  const payments = await db
    .prepare(`SELECT id, djomy_reference, amount_gnf, method FROM payments WHERE order_id = ? AND status = 'succeeded'`)
    .all(orderId) as Array<{ id: string; djomy_reference: string; amount_gnf: number; method: string }>;
  for (const payment of payments) {
    if (payment.method && !['bank_transfer', 'virement'].includes(payment.method)) {
      // Provider-side refund is best-effort: the ledger stays coherent even offline
      try {
        void paymentProvider.refundPayment(payment.djomy_reference, Number(payment.amount_gnf), comment);
      } catch {
        // sandbox/live errors must not block the internal refund pipeline
      }
    }
    await applyOrderRefund({
      orderId,
      paymentId: payment.id,
      refundAmountGnf: Number(payment.amount_gnf),
      actorRole: 'admin',
      actorName: ADMIN_NAME,
      comment,
    });
  }
  if (payments.length === 0) {
    // No succeeded payment: still flip the status so both sides agree
    await db.prepare(`UPDATE orders SET status = 'Remboursée', balance_due_gnf = 0, updated_at = ? WHERE id = ?`).run(now(), orderId);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * GET /api/admin/overview — the single payload behind all 8 v1 tabs
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.get(
  '/admin/overview',
  requireAdmin,
  wrapOverview
);

type AsyncHandler = (req: AuthenticatedRequest, res: import('express').Response) => Promise<void>;
const wrapAdmin = (fn: AsyncHandler) =>
  (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void => {
    void fn(req as AuthenticatedRequest, res).catch(next);
  };

function wrapOverview(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void {
  void (async (): Promise<void> => {
    const today = now().slice(0, 10);
    const month = now().slice(0, 7);

    const salesToday = await db
      .prepare(`SELECT COALESCE(SUM(amount_gnf), 0) AS total FROM payments WHERE status = 'succeeded' AND order_id IS NOT NULL AND substr(created_at, 1, 10) = ?`)
      .get(today) as { total: number | bigint };
    const salesMonth = await db
      .prepare(`SELECT COALESCE(SUM(amount_gnf), 0) AS total FROM payments WHERE status = 'succeeded' AND order_id IS NOT NULL AND substr(created_at, 1, 7) = ?`)
      .get(month) as { total: number | bigint };
    const ordersCount = await db.prepare(`SELECT COUNT(*) AS cnt FROM orders`).get() as { cnt: number };
    const ordersByStatusRows = await db.prepare(`SELECT status, COUNT(*) AS cnt FROM orders GROUP BY status`).all() as Array<{ status: string; cnt: number }>;
    const vendorsPending = await db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'vendor' AND status IN ('pending', 'in_review')`).get() as { cnt: number };
    const vendorsValidated = await db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'vendor' AND status = 'validated'`).get() as { cnt: number };
    const productsPublished = await db.prepare(`SELECT COUNT(*) AS cnt FROM products WHERE status = 'published'`).get() as { cnt: number };
    const openDisputes = await db.prepare(`SELECT COUNT(*) AS cnt FROM disputes WHERE status = 'open'`).get() as { cnt: number };
    const flaggedMessagesCount = await db.prepare(`SELECT COUNT(*) AS cnt FROM messages WHERE is_flagged = 1`).get() as { cnt: number };
    const subscribersCount = await db.prepare(`SELECT COUNT(*) AS cnt FROM push_subscriptions`).get() as { cnt: number };

    const vendorRows = await db
      .prepare(
        `SELECT u.id, u.email, u.phone, u.status, u.status_reason, u.entity_type, u.created_at,
                vp.shop_name, vp.slug, vp.location, vp.is_emrod_official
         FROM users u JOIN vendor_profiles vp ON vp.user_id = u.id
         WHERE u.role = 'vendor' ORDER BY u.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const vendors = await Promise.all(
      vendorRows.map(async (v) => {
      const documents = await db
        .prepare(
          `SELECT id, doc_type, doc_label, file_name, status, rejection_reason
           FROM kyc_documents WHERE vendor_id = ? ORDER BY created_at DESC`
        )
        .all(String(v.id)) as Array<Record<string, unknown>>;
      const compliance = await getVendorCompliance(String(v.id));
      return {
        id: String(v.id),
        email: String(v.email),
        phone: String(v.phone),
        status: String(v.status) as VendorAccountStatus,
        status_reason: String(v.status_reason || ''),
        entity_type: String(v.entity_type || 'individual'),
        shop_name: String(v.shop_name),
        slug: String(v.slug),
        location: String(v.location),
        is_emrod_official: Number(v.is_emrod_official || 0),
        documents: documents.map((d) => ({
          id: String(d.id),
          doc_type: String(d.doc_type),
          doc_label: String(d.doc_label),
          file_name: String(d.file_name),
          status: String(d.status),
          rejection_reason: String(d.rejection_reason || ''),
        })),
        compliance: {
          isValidated: compliance?.isValidated ?? false,
          isCertified: compliance?.isCertified ?? false,
          earnedBadgeIds: compliance?.earnedBadgeIds ?? [],
          missingItems: (compliance?.missingItems ?? []).map((m) => ({ label: m.label, detail: m.detail })),
        },
      };
      })
    );

    const orders = await db
      .prepare(`SELECT id, order_number, buyer_name, total_gnf, status, created_at FROM orders ORDER BY created_at DESC LIMIT 60`)
      .all() as Array<Record<string, unknown>>;

    const productRows = await db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug
         FROM products p JOIN categories c ON c.id = p.category_id
         ORDER BY p.updated_at DESC LIMIT 120`
      )
      .all() as Array<Record<string, unknown>>;
    const products: ProductItem[] = await hydrateProducts(productRows);

    const reviews = await db
      .prepare(
        `SELECT r.id, p.name AS product_name, r.buyer_name, r.rating, r.comment, r.status, r.created_at
         FROM reviews r LEFT JOIN products p ON p.id = r.product_id
         ORDER BY r.created_at DESC LIMIT 50`
      )
      .all() as Array<Record<string, unknown>>;

    const flaggedMessages = await db
      .prepare(
        `SELECT id, sender_name, content, flag_reason, status, created_at FROM messages
         WHERE is_flagged = 1 ORDER BY created_at DESC LIMIT 50`
      )
      .all() as Array<Record<string, unknown>>;

    const disputes = await db
      .prepare(
        `SELECT d.id, o.order_number, o.buyer_name, d.reason, d.status, d.created_at
         FROM disputes d JOIN orders o ON o.id = d.order_id
         ORDER BY d.created_at DESC LIMIT 40`
      )
      .all() as Array<Record<string, unknown>>;

    const payments = await db
      .prepare(
        `SELECT id, djomy_reference, provider_reference, operator, amount_gnf, status, created_at
         FROM payments ORDER BY created_at DESC LIMIT 60`
      )
      .all() as Array<Record<string, unknown>>;

    const payouts = await db
      .prepare(
        `SELECT po.id, po.reference, po.amount_gnf, po.commission_gnf, po.net_amount_gnf, po.status, po.created_at,
                o.order_number, vp.shop_name
         FROM payouts po
         LEFT JOIN orders o ON o.id = po.order_id
         LEFT JOIN vendor_profiles vp ON vp.user_id = po.vendor_id
         ORDER BY po.created_at DESC LIMIT 60`
      )
      .all() as Array<Record<string, unknown>>;

    const notifications = await db
      .prepare(`SELECT id, title, body, created_at, sent_count, delivered_count, opened_count FROM notifications ORDER BY created_at DESC LIMIT 20`)
      .all() as Array<Record<string, unknown>>;

    const auditLogs = await db
      .prepare(`SELECT id, created_at, actor_name, action, target_type, target_id FROM audit_logs ORDER BY created_at DESC LIMIT 60`)
      .all() as Array<Record<string, unknown>>;

    const privacyRequests = await db
      .prepare(`SELECT id, email, phone, request_type, status, created_at FROM data_privacy_requests ORDER BY created_at DESC LIMIT 40`)
      .all() as Array<Record<string, unknown>>;

    res.json({
      kpis: {
        salesTodayGnf: Number(salesToday.total || 0),
        salesMonthGnf: Number(salesMonth.total || 0),
        ordersCount: Number(ordersCount.cnt || 0),
        ordersByStatus: Object.fromEntries(ordersByStatusRows.map((r) => [r.status, Number(r.cnt)])),
        vendorsPending: Number(vendorsPending.cnt || 0),
        vendorsValidated: Number(vendorsValidated.cnt || 0),
        productsPublished: Number(productsPublished.cnt || 0),
        openDisputes: Number(openDisputes.cnt || 0),
        flaggedMessagesCount: Number(flaggedMessagesCount.cnt || 0),
        subscribersCount: Number(subscribersCount.cnt || 0),
      },
      vendors,
      orders: orders.map((o) => ({
        id: String(o.id),
        order_number: String(o.order_number),
        buyer_name: String(o.buyer_name),
        total_gnf: Number(o.total_gnf),
        status: String(o.status),
        created_at: String(o.created_at),
      })),
      products,
      reviews: reviews.map((r) => ({
        id: String(r.id),
        product_name: String(r.product_name || ''),
        buyer_name: String(r.buyer_name),
        rating: Number(r.rating),
        comment: String(r.comment),
        status: String(r.status),
        created_at: String(r.created_at),
      })),
      flaggedMessages: flaggedMessages.map((m) => ({
        id: String(m.id),
        sender_name: String(m.sender_name),
        content: String(m.content),
        flag_reason: String(m.flag_reason || ''),
        status: String(m.status),
        created_at: String(m.created_at),
      })),
      disputes: disputes.map((d) => ({
        id: String(d.id),
        order_number: String(d.order_number),
        buyer_name: String(d.buyer_name),
        reason: String(d.reason),
        status: String(d.status),
        created_at: String(d.created_at),
      })),
      payments: payments.map((p) => ({
        id: String(p.id),
        djomy_reference: String(p.djomy_reference),
        provider_reference: String(p.provider_reference || ''),
        operator: String(p.operator || ''),
        amount_gnf: Number(p.amount_gnf),
        status: String(p.status),
        created_at: String(p.created_at),
      })),
      payouts: payouts.map((p) => ({
        id: String(p.id),
        reference: String(p.reference),
        order_number: String(p.order_number || ''),
        shop_name: String(p.shop_name || ''),
        amount_gnf: Number(p.amount_gnf),
        commission_gnf: Number(p.commission_gnf || 0),
        net_amount_gnf: Number(p.net_amount_gnf ?? p.amount_gnf),
        status: String(p.status),
        created_at: String(p.created_at),
      })),
      notifications: notifications.map((n) => ({
        id: String(n.id),
        title: String(n.title),
        body: String(n.body),
        created_at: String(n.created_at),
        sent_count: Number(n.sent_count || 0),
        delivered_count: Number(n.delivered_count || 0),
        opened_count: Number(n.opened_count || 0),
      })),
      auditLogs: auditLogs.map((a) => ({
        id: String(a.id),
        created_at: String(a.created_at),
        actor_name: String(a.actor_name),
        action: String(a.action),
        target_type: String(a.target_type),
        target_id: String(a.target_id),
      })),
      privacyRequests: privacyRequests.map((pr) => ({
        id: String(pr.id),
        email: String(pr.email),
        phone: String(pr.phone),
        request_type: String(pr.request_type),
        status: String(pr.status),
        created_at: String(pr.created_at),
      })),
      badges: await getAllBadges(),
      categories: await getAllCategories(),
      zones: await getDeliveryZones(),
      registrationRequirements: await getRule('registration_requirements', { fields: [], documents: [] }),
      restrictions: await getCommercialRestrictions(),
      editorial: await getRule('editorial', {}),
      legal: await getRule('legal', {}),
    });
  })().catch(next);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Vendors: status, certifications (v1) — F-ADM-02 / F-CER
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.patch(
  '/admin/vendors/:id/status',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(adminVendorStatusPatchSchema, req);
    const vendor = await db
      .prepare(`SELECT u.id, u.status, u.email, vp.shop_name FROM users u JOIN vendor_profiles vp ON vp.user_id = u.id WHERE u.id = ? AND u.role = 'vendor'`)
      .get(String(req.params.id)) as { id: string; status: string; email: string; shop_name: string } | undefined;
    if (!vendor) throw new HttpError(404, 'Vendeur introuvable.');

    const before = { status: vendor.status };
    await db.prepare(`UPDATE users SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?`).run(
      body.status,
      body.reason || '',
      now(),
      vendor.id
    );
    audit('vendor_status_changed', 'vendor', vendor.id, before, { status: body.status, reason: body.reason || '' });

    if (['validated', 'rejected', 'suspended'].includes(body.status)) {
      const labels: Record<string, string> = {
        validated: 'Votre atelier est validé — vos fiches sont désormais publiables.',
        rejected: `Votre dossier a été refusé. Motif : ${body.reason || 'non communiqué'}.`,
        suspended: `Votre atelier est suspendu. Motif : ${body.reason || 'non communiqué'}.`,
      };
      sendMail({
        to: vendor.email,
        subject: `EMROD — Statut de votre atelier : ${body.status}`,
        text: `Bonjour ${vendor.shop_name},\n\n${labels[body.status]}\n\nEMROD SARL`,
        html: `<p>Bonjour ${vendor.shop_name},</p><p>${labels[body.status]}</p><p>EMROD SARL</p>`,
      });
    }

    res.json({ ok: true, status: body.status });
  })
);

adminRouter.post(
  '/admin/vendors/:id/certifications',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(adminCertificationSchema, req);
    const vendor = await db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'vendor'`).get(String(req.params.id)) as { id: string } | undefined;
    if (!vendor) throw new HttpError(404, 'Vendeur introuvable.');
    const badge = await db.prepare(`SELECT id, name FROM badge_definitions WHERE id = ?`).get(body.badgeId) as { id: string; name: string } | undefined;
    if (!badge) throw new HttpError(404, 'Badge introuvable.');

    if (body.action === 'grant') {
      const existing = await db
        .prepare(`SELECT id FROM certifications WHERE vendor_id = ? AND badge_id = ? AND status = 'active'`)
        .get(vendor.id, badge.id);
      if (!existing) {
        await db.prepare(
          `INSERT INTO certifications (id, vendor_id, badge_id, granted_by, status, revoke_reason, expires_at, created_at, revoked_at)
           VALUES (?, ?, ?, 'admin', 'active', '', NULL, ?, NULL)`
        ).run(genId('cert'), vendor.id, badge.id, now());
      }
    } else {
      await db.prepare(
        `UPDATE certifications SET status = 'revoked', revoke_reason = ?, revoked_at = ?
         WHERE vendor_id = ? AND badge_id = ? AND status = 'active'`
      ).run(body.reason || 'Révocation manuelle', now(), vendor.id, badge.id);
    }
    audit(`certification_${body.action}d`, 'vendor', vendor.id, { badgeId: badge.id }, { badge: badge.name, reason: body.reason || '' });
    res.json({ ok: true, action: body.action, badgeId: badge.id });
  })
);

/* PATCH /api/admin/documents/:id — KYC review */
adminRouter.patch(
  '/admin/documents/:id',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(adminDocumentPatchSchema, req);
    const doc = await db
      .prepare(`SELECT id, vendor_id, status, doc_label FROM kyc_documents WHERE id = ?`)
      .get(String(req.params.id)) as { id: string; vendor_id: string; status: string; doc_label: string } | undefined;
    if (!doc) throw new HttpError(404, 'Document introuvable.');

    await db.prepare(
      `UPDATE kyc_documents SET status = ?, reviewer_id = 'admin', rejection_reason = ?, updated_at = ? WHERE id = ?`
    ).run(body.status, body.status === 'rejected' ? body.reason || '' : '', now(), doc.id);

    // Validated as soon as every document of the dossier is approved
    if (body.status === 'approved') {
      const pending = await db
        .prepare(`SELECT COUNT(*) AS cnt FROM kyc_documents WHERE vendor_id = ? AND status != 'approved'`)
        .get(doc.vendor_id) as { cnt: number };
      const user = await db.prepare(`SELECT status FROM users WHERE id = ?`).get(doc.vendor_id) as { status: string } | undefined;
      if (Number(pending.cnt) === 0 && user && ['pending', 'in_review'].includes(user.status)) {
        await db.prepare(`UPDATE users SET status = 'validated', status_reason = '', updated_at = ? WHERE id = ?`).run(now(), doc.vendor_id);
        audit('vendor_auto_validated', 'vendor', doc.vendor_id, { status: user.status }, { status: 'validated' });
      }
    }
    audit(`kyc_${body.status}`, 'kyc_document', doc.id, { status: doc.status }, { status: body.status, reason: body.reason || '' });

    res.json({ ok: true, status: body.status });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * Rules, badges, categories, zones, editorial, legal (v1)
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.put(
  '/admin/rules/restrictions',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(commercialRestrictionsSchema, req);
    const before = await getCommercialRestrictions();
    await setRule('commercial_restrictions', body);
    audit('restrictions_updated', 'platform_rules', 'commercial_restrictions', before, body);
    res.json({ ok: true, restrictions: body });
  })
);

adminRouter.put(
  '/admin/rules/registration',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(registrationRulesSchema, req);
    const before = await getRule('registration_requirements', {});
    await setRule('registration_requirements', body);
    audit('registration_rules_updated', 'platform_rules', 'registration_requirements', before, body);
    res.json({ ok: true, registrationRequirements: body });
  })
);

adminRouter.post(
  '/admin/badges',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(adminBadgeCreateSchema, req);
    const id = genId('badge');
    await db.prepare(
      `INSERT INTO badge_definitions (id, name, icon, criteria_description, public_description, is_mandatory, auto_assign, effect_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      body.name,
      body.icon || 'award',
      body.criteriaDescription,
      body.publicDescription || body.criteriaDescription,
      body.isMandatory ? 1 : 0,
      body.autoAssign ? 1 : 0,
      JSON.stringify(body.effect || {}),
      now()
    );
    audit('badge_created', 'badge', id, {}, body);
    res.status(201).json({ ok: true, id, name: body.name });
  })
);

adminRouter.patch(
  '/admin/categories/:id',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(adminCategoryPatchSchema, req);
    const cat = await db.prepare(`SELECT id, is_restricted, required_badge_id FROM categories WHERE id = ?`).get(String(req.params.id)) as
      | { id: string; is_restricted: number; required_badge_id: string | null }
      | undefined;
    if (!cat) throw new HttpError(404, 'Catégorie introuvable.');
    await db.prepare(`UPDATE categories SET is_restricted = ?, required_badge_id = ? WHERE id = ?`).run(
      body.isRestricted ? 1 : 0,
      body.requiredBadgeId ?? null,
      cat.id
    );
    audit('category_restriction_updated', 'category', cat.id, cat, body);
    res.json({ ok: true });
  })
);

adminRouter.put(
  '/admin/zones',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(deliveryZonesSchema, req);
    const before = await getDeliveryZones();
    await setRule('delivery_zones', body.zones);
    audit('zones_updated', 'platform_rules', 'delivery_zones', before, body.zones);
    res.json({ ok: true, zones: body.zones });
  })
);

adminRouter.put(
  '/admin/editorial',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(editorialSchema, req);
    const before = await getRule('editorial', {});
    await setRule('editorial', body);
    audit('editorial_updated', 'platform_rules', 'editorial', {}, Object.keys(body));
    res.json({ ok: true, editorial: body });
  })
);

adminRouter.put(
  '/admin/legal',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(legalTextsSchema, req);
    await setRule('legal', body);
    audit('legal_updated', 'platform_rules', 'legal', {}, Object.keys(body));
    res.json({ ok: true, legal: body });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * Push notifications campaign (v1) — F-ADM-07
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.post(
  '/admin/notifications/send',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(alertDispatchSchema, req);
    const id = genId('ntf');
    await db.prepare(
      `INSERT INTO notifications (id, title, body, target_category, target_region, target_url, sent_count, delivered_count, opened_count, unsubscribed_count, scheduled_for, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, ?)`
    ).run(id, body.title, body.body, body.targetCategory, body.targetRegion, body.targetUrl, now());

    const result = await dispatchPushNotification({
      title: body.title,
      body: body.body,
      targetCategory: body.targetCategory,
      targetRegion: body.targetRegion,
      targetUrl: body.targetUrl,
    });
    await db.prepare(`UPDATE notifications SET sent_count = ?, delivered_count = ? WHERE id = ?`).run(
      result.sentCount,
      result.deliveredCount,
      id
    );
    audit('notification_sent', 'notification', id, {}, { title: body.title, sent: result.sentCount });

    res.json({ ok: true, id, sentCount: result.sentCount, deliveredCount: result.deliveredCount });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * Moderation: products, reviews, messages + disputes + privacy (v1)
 * ──────────────────────────────────────────────────────────────────────── */

const moderationProductSchema = z.object({
  status: z.enum(['published', 'removed', 'in_review', 'draft', 'archived']),
  reason: z.string().max(500).optional(),
});

adminRouter.patch(
  '/admin/moderation/product/:id',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(moderationProductSchema, req);
    const product = await db.prepare(`SELECT id, status, name FROM products WHERE id = ?`).get(String(req.params.id)) as
      | { id: string; status: string; name: string }
      | undefined;
    if (!product) throw new HttpError(404, 'Produit introuvable.');
    await db.prepare(`UPDATE products SET status = ?, removal_reason = ?, updated_at = ? WHERE id = ?`).run(
      body.status,
      body.status === 'removed' ? body.reason || 'Retiré par la modération EMROD' : '',
      now(),
      product.id
    );
    audit('product_moderated', 'product', product.id, { status: product.status }, { status: body.status, reason: body.reason || '' });
    res.json({ ok: true, status: body.status });
  })
);

const moderationReviewSchema = z.object({
  status: z.enum(['published', 'hidden']),
  reason: z.string().max(500).optional(),
});

adminRouter.patch(
  '/admin/moderation/review/:id',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(moderationReviewSchema, req);
    const review = await db.prepare(`SELECT id, status FROM reviews WHERE id = ?`).get(String(req.params.id)) as
      | { id: string; status: string }
      | undefined;
    if (!review) throw new HttpError(404, 'Avis introuvable.');
    await db.prepare(`UPDATE reviews SET status = ?, moderation_reason = ? WHERE id = ?`).run(
      body.status,
      body.status === 'hidden' ? body.reason || 'Masqué par la modération EMROD' : '',
      review.id
    );
    audit('review_moderated', 'review', review.id, { status: review.status }, { status: body.status });
    res.json({ ok: true, status: body.status });
  })
);

const moderationMessageSchema = z.object({ status: z.enum(['visible', 'hidden']) });

adminRouter.patch(
  '/admin/moderation/message/:id',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(moderationMessageSchema, req);
    const message = await db.prepare(`SELECT id, status FROM messages WHERE id = ?`).get(String(req.params.id)) as
      | { id: string; status: string }
      | undefined;
    if (!message) throw new HttpError(404, 'Message introuvable.');
    await db.prepare(`UPDATE messages SET status = ? WHERE id = ?`).run(body.status, message.id);
    audit('message_moderated', 'message', message.id, { status: message.status }, { status: body.status });
    res.json({ ok: true, status: body.status });
  })
);

adminRouter.patch(
  '/admin/disputes/:id',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(disputePatchSchema, req);
    const dispute = await db.prepare(`SELECT id, order_id, status FROM disputes WHERE id = ?`).get(String(req.params.id)) as
      | { id: string; order_id: string; status: string }
      | undefined;
    if (!dispute) throw new HttpError(404, 'Litige introuvable.');

    await db.prepare(`UPDATE disputes SET status = ?, resolution_notes = ?, updated_at = ? WHERE id = ?`).run(
      body.status,
      body.resolutionNotes || '',
      now(),
      dispute.id
    );

    if (body.status === 'resolved_refund') {
      await refundOrderFully(dispute.order_id, `Litige arbitré par EMROD : remboursement acheteur. ${body.resolutionNotes || ''}`);
    } else if (body.status === 'resolved_release') {
      await db.prepare(`UPDATE orders SET status = 'Livrée', updated_at = ? WHERE id = ? AND status NOT IN ('Livrée', 'Remboursée')`).run(now(), dispute.order_id);
    }
    audit('dispute_resolved', 'dispute', dispute.id, { status: dispute.status }, { status: body.status, notes: body.resolutionNotes || '' });

    res.json({ ok: true, status: body.status });
  })
);

/* PATCH /api/admin/privacy/:id — RGPD-style requests (processed/rejected).
 * `processed` on a deletion request anonymizes every buyer trace. */
adminRouter.patch(
  '/admin/privacy/:id',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const bodySchema = z.object({ status: z.enum(['processed', 'rejected']) });
    const body = parseBody(bodySchema, req);
    const request = await db
      .prepare(`SELECT id, email, phone, request_type, status FROM data_privacy_requests WHERE id = ?`)
      .get(String(req.params.id)) as
      | { id: string; email: string; phone: string; request_type: string; status: string }
      | undefined;
    if (!request) throw new HttpError(404, 'Demande introuvable.');

    if (body.status === 'processed' && request.request_type === 'deletion') {
      const anonEmail = `deleted+${request.id}@emrod.local`;
      await runAnonymization(request.email, request.phone, anonEmail);
    }
    await db.prepare(`UPDATE data_privacy_requests SET status = ? WHERE id = ?`).run(body.status, request.id);
    audit('privacy_request_' + body.status, 'privacy_request', request.id, { status: request.status }, { type: request.request_type });

    res.json({ ok: true, status: body.status });
  })
);

async function runAnonymization(email: string, phone: string, anonEmail: string): Promise<void> {
  // Capture the display names used across tables BEFORE overwriting them
  const nameRows = await db.prepare(`SELECT DISTINCT buyer_name FROM orders WHERE buyer_email = ?`).all(email) as Array<{ buyer_name: string }>;
  const names = nameRows.map((r) => r.buyer_name).filter(Boolean);
  for (const name of names) {
    await db.prepare(`UPDATE reviews SET buyer_name = 'Client supprimé' WHERE buyer_name = ?`).run(name);
    await db.prepare(`UPDATE messages SET sender_name = 'Client supprimé' WHERE sender_role = 'buyer' AND sender_name = ?`).run(name);
  }
  await db.prepare(`UPDATE orders SET buyer_name = 'Client supprimé', buyer_email = ?, buyer_phone = '', delivery_address = '[supprimé]', bank_transfer_reference = '', updated_at = ? WHERE buyer_email = ?`).run(anonEmail, now(), email);
  await db.prepare(`UPDATE quote_requests SET buyer_name = 'Client supprimé', buyer_email = ?, buyer_phone = '', updated_at = ? WHERE buyer_email = ?`).run(anonEmail, now(), email);
  await db.prepare(`UPDATE conversations SET buyer_name = 'Client supprimé', buyer_email = ? WHERE buyer_email = ?`).run(anonEmail, email);
  await db.prepare(`UPDATE push_subscriptions SET email_fallback = '' WHERE email_fallback = ?`).run(email);
  await db.prepare(`UPDATE users SET phone = CASE WHEN phone = ? THEN '' ELSE phone END WHERE email = ?`).run(phone, email);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Payments: reconcile, refund, diagnostics + payouts (v1)
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.post(
  '/admin/payments/:ref/reconcile',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const reference = String(req.params.ref);
    const payment = await db.prepare(`SELECT * FROM payments WHERE djomy_reference = ?`).get(reference) as
      | (Record<string, unknown> & { id: string; status: string; type: string; quote_id: string | null; order_id: string | null })
      | undefined;
    if (!payment) throw new HttpError(404, 'Paiement introuvable pour cette référence.');

    if (String(payment.status) === 'succeeded') {
      res.json({ status: 'succeeded', settled: false, message: 'Paiement déjà confirmé.' });
      return;
    }

    const isLink = String(payment.type) === 'payment_link';
    const raw = isLink
      ? await paymentProvider.getPaymentLinkStatus(reference)
      : await paymentProvider.getPaymentStatus(reference);
    const payload = raw as { status?: string; paid?: boolean; rawStatus?: string };
    const providerStatus = String(payload.status || payload.rawStatus || '').toUpperCase();
    const paid = providerStatus === 'PAID' || providerStatus === 'SUCCEEDED' || providerStatus === 'SUCCESS' || Boolean(payload.paid);
    const failed = ['FAILED', 'CANCELLED', 'EXPIRED', 'ERROR'].includes(providerStatus);

    if (paid) {
      await db.prepare(`UPDATE payments SET status = 'succeeded', updated_at = ? WHERE id = ?`).run(now(), payment.id);
      const settled = await settlePaymentRow({ id: String(payment.id) }, 'admin_reconcile');
      audit('payment_reconciled', 'payment', payment.id, { status: payment.status }, { status: 'succeeded', settled: Boolean(settled) });
      res.json({ status: 'succeeded', settled: true });
      return;
    }
    if (failed) {
      await markPaymentFailed(payment.id);
      audit('payment_reconciled_failed', 'payment', payment.id, { status: payment.status }, { providerStatus });
      res.json({ status: 'failed' });
      return;
    }
    res.json({ status: providerStatus.toLowerCase() || 'pending', settled: false });
  })
);

adminRouter.post(
  '/admin/payments/:ref/refund',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const bodySchema = z.object({ reason: z.string().min(3).max(500) });
    const body = parseBody(bodySchema, req);
    const reference = String(req.params.ref);
    const payment = await db.prepare(`SELECT * FROM payments WHERE djomy_reference = ?`).get(reference) as
      | (Record<string, unknown> & { id: string; status: string; order_id: string | null; quote_id: string | null; amount_gnf: number; method: string })
      | undefined;
    if (!payment) throw new HttpError(404, 'Paiement introuvable pour cette référence.');
    if (String(payment.status) !== 'succeeded') throw new HttpError(409, 'Seul un paiement réussi peut être remboursé.');

    if (payment.order_id) {
      await refundOrderFully(String(payment.order_id), body.reason);
    } else {
      // Quote-only payment (order not created yet)
      if (payment.method && !['bank_transfer', 'virement'].includes(payment.method)) {
        try {
          await paymentProvider.refundPayment(reference, Number(payment.amount_gnf), body.reason);
        } catch {
          // provider-side best effort
        }
      }
      await markPaymentRefunded(payment.id);
    }
    audit('payment_refunded', 'payment', payment.id, { status: 'succeeded' }, { reason: body.reason });
    res.json({ ok: true, status: 'refunded' });
  })
);

adminRouter.get(
  '/admin/payments/djomy-diagnostics',
  requireAdmin,
  wrapAdmin(async (_req, res) => {
    const diagnostics = paymentProvider.getDiagnostics();
    const recentWebhooks = await db
      .prepare(`SELECT event_id, event_type, djomy_reference, created_at FROM webhook_events ORDER BY created_at DESC LIMIT 20`)
      .all() as Array<Record<string, unknown>>;
    res.json({
      diagnostics,
      recentWebhooks: recentWebhooks.map((w) => ({
        event_id: String(w.event_id),
        event_type: String(w.event_type),
        djomy_reference: String(w.djomy_reference || ''),
        created_at: String(w.created_at),
      })),
    });
  })
);

adminRouter.patch(
  '/admin/payouts/:id/mark-paid',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const payout = await db.prepare(`SELECT id, status, reference FROM payouts WHERE id = ?`).get(String(req.params.id)) as
      | { id: string; status: string; reference: string }
      | undefined;
    if (!payout) throw new HttpError(404, 'Versement introuvable.');
    await db.prepare(`UPDATE payouts SET status = 'paid', updated_at = ? WHERE id = ?`).run(now(), payout.id);
    audit('payout_marked_paid', 'payout', payout.id, { status: payout.status }, { status: 'paid' });
    res.json({ ok: true, status: 'paid' });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * V2 — STATISTIQUES AVANCÉES (Finance/Stats tabs)
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.get(
  '/admin/stats',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const period = String(req.query.period || '30d');
    const bounds = periodBounds(period);
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    res.json({
      period: bounds,
      kpis: await dashboardStats(period),
      salesSeries: await salesSeries(days),
      funnel: await conversionFunnel(days),
      operators: await operatorStats(days),
      plans: await planStats(days),
      quotes: await quotesPipeline(),
      delivery: await deliveryStats(days),
      reviews: await reviewsStats(),
      searches: await searchStats(days),
      seasonality: await seasonalityStats(days),
      topProducts: {
        sales: await topProducts('sales', 10),
        views: await topProducts('views', 10),
        conversion: await topProducts('conversion', 10),
      },
      categories: await categoryStats(days),
      buyers: await queryBuyers({ limit: 20 }),
    });
  })
);

adminRouter.get(
  '/admin/reports/monthly',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const months: Array<Record<string, unknown>> = [];
    for (let m = 1; m <= 12; m += 1) {
      months.push({ month: `${year}-${String(m).padStart(2, '0')}`, ...(await monthlyReportRow(`${year}-${String(m).padStart(2, '0')}`)) });
    }
    res.json({ year, months });
  })
);

async function monthlyReportRow(yearMonth: string): Promise<Record<string, unknown>> {
  // Lazy import avoided — monthlyReport is a static ESM import from ../commissions
  return monthlyReport(yearMonth);
}

/* ─────────────────────────────────────────────────────────────────────────
 * V2 — MOTEUR DE COMMISSIONS (Finance tab)
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.get(
  '/admin/commissions',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const vendorId = req.query.vendorId ? String(req.query.vendorId) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 200));
    res.json({
      config: await getCommissionConfig(),
      summary: await commissionSummary(from, to),
      byVendor: await commissionByVendor(from, to),
      lines: await queryCommissionLedger({ from, to, vendorId, status, limit }),
    });
  })
);

adminRouter.get(
  '/admin/commissions/config',
  requireAdmin,
  wrapAdmin(async (_req, res) => {
    res.json({ config: await getCommissionConfig() });
  })
);

adminRouter.put(
  '/admin/commissions/config',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(commissionConfigSchema, req);
    await setCommissionConfig(body);
    audit('commission_config_updated', 'platform_rules', 'commission_config', await getCommissionConfig(), body);
    res.json({ ok: true, config: await getCommissionConfig() });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * V2 — COMMANDES (Orders tab): list, detail, override, rotate-token
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.get(
  '/admin/orders',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const where: string[] = [];
    const args: Array<string | number> = [];
    const status = req.query.status ? String(req.query.status) : '';
    const q = req.query.q ? String(req.query.q).trim() : '';
    const vendorId = req.query.vendorId ? String(req.query.vendorId) : '';
    const from = req.query.from ? String(req.query.from) : '';
    const to = req.query.to ? String(req.query.to) : '';
    if (status) {
      where.push('o.status = ?');
      args.push(status);
    }
    if (q) {
      where.push('(o.order_number ILIKE ? OR o.buyer_name ILIKE ? OR o.buyer_email ILIKE ?)');
      args.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (vendorId) {
      where.push('EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.vendor_id = ?)');
      args.push(vendorId);
    }
    if (from) {
      where.push('o.created_at >= ?');
      args.push(from);
    }
    if (to) {
      where.push('o.created_at <= ?');
      args.push(`${to}~`); // lexicographic upper bound for ISO dates
    }
    const limit = Math.min(300, Math.max(10, Number(req.query.limit) || 100));
    const sql = `SELECT o.* FROM orders o ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.created_at DESC LIMIT ${limit}`;
    const rows = await db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
    res.json({
      orders: rows.map((o) => ({
        id: String(o.id),
        order_number: String(o.order_number),
        buyer_name: String(o.buyer_name),
        buyer_email: String(o.buyer_email),
        buyer_phone: String(o.buyer_phone),
        total_gnf: Number(o.total_gnf),
        status: String(o.status),
        payment_plan: String(o.payment_plan || 'full'),
        created_at: String(o.created_at),
      })),
    });
  })
);

adminRouter.get(
  '/admin/orders/:id',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const order = await getOrderById(String(req.params.id));
    if (!order) throw new HttpError(404, 'Commande introuvable.');
    const row = order as unknown as Record<string, unknown>;
    const items = await db
      .prepare(
        `SELECT oi.*, vp.shop_name FROM order_items oi LEFT JOIN vendor_profiles vp ON vp.user_id = oi.vendor_id WHERE oi.order_id = ?`
      )
      .all(order.id) as Array<Record<string, unknown>>;
    const events = await db.prepare(`SELECT status, actor_role, actor_name, comment, created_at FROM order_events WHERE order_id = ? ORDER BY created_at ASC`).all(order.id) as Array<Record<string, unknown>>;
    const payments = await db.prepare(`SELECT id, djomy_reference, provider_reference, type, method, operator, amount_gnf, status, created_at FROM payments WHERE order_id = ? ORDER BY created_at ASC`).all(order.id) as Array<Record<string, unknown>>;
    const payouts = await db.prepare(`SELECT id, reference, amount_gnf, commission_gnf, net_amount_gnf, status, created_at FROM payouts WHERE order_id = ? ORDER BY created_at ASC`).all(order.id) as Array<Record<string, unknown>>;
    const disputes = await db.prepare(`SELECT id, reason, status, resolution_notes, created_at FROM disputes WHERE order_id = ? ORDER BY created_at DESC`).all(order.id) as Array<Record<string, unknown>>;
    const commissions = await db.prepare(`SELECT id, vendor_id, gross_gnf, rate_percent, commission_gnf, net_vendor_gnf, base, status, source, created_at FROM commissions WHERE order_id = ? ORDER BY created_at ASC`).all(order.id) as Array<Record<string, unknown>>;
    res.json({ order: row, items, events, payments, payouts, disputes, commissions });
  })
);

adminRouter.patch(
  '/admin/orders/:id/status',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(orderStatusOverrideSchema, req);
    const order = await getOrderById(String(req.params.id));
    if (!order) throw new HttpError(404, 'Commande introuvable.');
    const next = body.status as OrderStatus;
    const row = order as unknown as Record<string, unknown>;
    const before = String(row.status);

    if (next === 'Remboursée') {
      await refundOrderFully(order.id, `Statut forcé par la direction : ${body.reason}`);
    } else {
      if (next === 'Annulée') {
        const items = await db.prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`).all(order.id) as Array<{ product_id: string; quantity: number }>;
        for (const it of items) {
          await db.prepare(`UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?`).run(it.quantity, it.product_id);
        }
        await db.prepare(`DELETE FROM payouts WHERE order_id = ? AND status IN ('pending', 'scheduled')`).run(order.id);
      }
      await db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`).run(next, now(), order.id);
    }

    await db.prepare(
      `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at)
       VALUES (?, ?, ?, 'admin', ?, ?, ?)`
    ).run(genId('oe'), order.id, next, ADMIN_NAME, `Override direction : ${body.reason}`, now());
    audit('order_status_override', 'order', order.id, { status: before }, { status: next, reason: body.reason });

    res.json({ status: next });
  })
);

adminRouter.post(
  '/admin/orders/:id/rotate-token',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const order = await getOrderById(String(req.params.id));
    if (!order) throw new HttpError(404, 'Commande introuvable.');
    const rotated = generateTrackingToken();
    const expires = new Date(Date.now() + 12 * 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare(`UPDATE orders SET tracking_token_hash = ?, tracking_token_expires_at = ?, updated_at = ? WHERE id = ?`).run(
      rotated.tokenHash,
      expires,
      now(),
      order.id
    );
    audit('tracking_token_rotated', 'order', order.id, {}, { expiresAt: expires });
    res.json({ ok: true, trackingToken: rotated.rawToken, expiresAt: expires });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * V2 — PRODUITS (Products tab): full list + featured toggle
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.get(
  '/admin/products',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const where: string[] = [];
    const args: Array<string | number> = [];
    const q = req.query.q ? String(req.query.q).trim() : '';
    const status = req.query.status ? String(req.query.status) : '';
    const vendorId = req.query.vendorId ? String(req.query.vendorId) : '';
    if (q) {
      where.push('(p.name ILIKE ? OR p.slug ILIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    if (status) {
      where.push('p.status = ?');
      args.push(status);
    }
    if (vendorId) {
      where.push('p.vendor_id = ?');
      args.push(vendorId);
    }
    const limit = Math.min(300, Math.max(10, Number(req.query.limit) || 150));
    const rows = await db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p
         JOIN categories c ON c.id = p.category_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY p.updated_at DESC LIMIT ${limit}`
      )
      .all(...args) as Array<Record<string, unknown>>;
    res.json({ products: await hydrateProducts(rows) });
  })
);

const featuredPatchSchema = z.object({ featured: z.boolean() });

adminRouter.patch(
  '/admin/products/:id/featured',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(featuredPatchSchema, req);
    const product = await db.prepare(`SELECT id, featured FROM products WHERE id = ?`).get(String(req.params.id)) as
      | { id: string; featured: number }
      | undefined;
    if (!product) throw new HttpError(404, 'Produit introuvable.');
    await db.prepare(`UPDATE products SET featured = ?, updated_at = ? WHERE id = ?`).run(body.featured ? 1 : 0, now(), product.id);
    audit('product_featured_toggled', 'product', product.id, { featured: product.featured }, { featured: body.featured });
    res.json({ ok: true, featured: body.featured });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * V2 — ACHETEURS (Buyers tab)
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.get(
  '/admin/buyers',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const q = req.query.q ? String(req.query.q).trim() : '';
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 60));
    res.json({ buyers: await queryBuyers({ q: q || undefined, limit }) });
  })
);

adminRouter.get(
  '/admin/buyers/:email',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const dossier = await buyerDossier(decodeURIComponent(String(req.params.email)));
    if (!dossier) throw new HttpError(404, 'Acheteur introuvable.');
    res.json(dossier);
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * V2 — SÉCURITÉ (Security tab): sessions, révocation, mot de passe
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.get(
  '/admin/security',
  requireAdmin,
  wrapAdmin(async (_req, res) => {
    const ts = now();
    const failedAttempts = await db
      .prepare(`SELECT subject, ip, success, created_at FROM login_attempts WHERE success = 0 ORDER BY created_at DESC LIMIT 60`)
      .all() as Array<Record<string, unknown>>;
    const activeSessions = await db
      .prepare(`SELECT jti, sub, role, email, exp, created_at FROM issued_tokens WHERE exp > ? ORDER BY created_at DESC LIMIT 60`)
      .all(ts) as Array<Record<string, unknown>>;
    const revokedCount = await db.prepare(`SELECT COUNT(*) AS cnt FROM token_revocations`).get() as { cnt: number };
    const securityLogs = await db
      .prepare(
        `SELECT id, created_at, actor_name, action, target_type, target_id FROM audit_logs
         WHERE action LIKE '%login%' OR action LIKE '%claim%' OR action LIKE '%passcode%' OR action LIKE '%revoke%' OR action LIKE '%token%'
         ORDER BY created_at DESC LIMIT 60`
      )
      .all() as Array<Record<string, unknown>>;
    res.json({
      failedAttempts: failedAttempts.map((a) => ({
        subject: String(a.subject),
        ip: String(a.ip),
        created_at: String(a.created_at),
      })),
      activeSessions: activeSessions.map((s) => ({
        jti: String(s.jti),
        sub: String(s.sub),
        role: String(s.role),
        email: String(s.email),
        exp: String(s.exp),
        created_at: String(s.created_at),
      })),
      revokedCount: Number(revokedCount.cnt || 0),
      securityLogs: securityLogs.map((l) => ({
        id: String(l.id),
        created_at: String(l.created_at),
        actor_name: String(l.actor_name),
        action: String(l.action),
        target_type: String(l.target_type),
        target_id: String(l.target_id),
      })),
      passcodeConfigured: (await getAdminAuthRule()).claimed,
    });
  })
);

adminRouter.post(
  '/admin/security/revoke',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const bodySchema = z.object({ jti: z.string().min(6).max(200) });
    const body = parseBody(bodySchema, req);
    await db.prepare(`INSERT INTO token_revocations (jti, revoked_at) VALUES (?, ?) ON CONFLICT (jti) DO NOTHING`).run(body.jti, now());
    await db.prepare(`DELETE FROM issued_tokens WHERE jti = ?`).run(body.jti);
    audit('token_revoked', 'session', body.jti, {}, {});
    res.json({ ok: true });
  })
);

adminRouter.post(
  '/admin/security/passcode',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(passcodeChangeSchema, req);
    const rule = await getAdminAuthRule();
    if (rule.claimed && !verifyPassword(body.current, rule.passwordHash)) {
      throw new HttpError(403, 'Mot de passe actuel incorrect.');
    }
    await setAdminAuthRule({ claimed: true, passwordHash: hashPassword(body.next) });
    // Invalidate every active session (forced re-login everywhere)
    const active = await db.prepare(`SELECT jti FROM issued_tokens WHERE exp > ?`).all(now()) as Array<{ jti: string }>;
    for (const token of active) {
      await db.prepare(`INSERT INTO token_revocations (jti, revoked_at) VALUES (?, ?) ON CONFLICT (jti) DO NOTHING`).run(token.jti, now());
    }
    await db.prepare(`DELETE FROM issued_tokens`).run();
    audit('passcode_changed', 'admin_auth', 'admin_auth', {}, { sessionsInvalidated: active.length });
    res.json({ ok: true, sessionsInvalidated: active.length });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * V2 — SYSTÈME (System tab): santé DB, webhooks, emails
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.get(
  '/admin/system',
  requireAdmin,
  wrapAdmin(async (_req, res) => {
    const health = await systemHealth();
    const counts: Record<string, number> = {};
    for (const table of [
      'users', 'vendor_profiles', 'products', 'product_media', 'orders', 'order_items',
      'order_events', 'payments', 'payouts', 'commissions', 'quotes', 'quote_requests',
      'reviews', 'disputes', 'conversations', 'messages', 'notifications',
      'push_subscriptions', 'kyc_documents', 'certifications', 'audit_logs',
      'webhook_events', 'email_log', 'analytics_events', 'search_queries',
      'login_attempts', 'data_privacy_requests', 'buyer_blacklist',
    ]) {
      try {
        const row = await db.prepare(`SELECT COUNT(*) AS cnt FROM ${table}`).get() as { cnt: number };
        counts[table] = Number(row.cnt || 0);
      } catch {
        counts[table] = -1;
      }
    }
    const recentWebhooks = await db
      .prepare(`SELECT event_id, event_type, djomy_reference, processed, created_at FROM webhook_events ORDER BY created_at DESC LIMIT 40`)
      .all() as Array<Record<string, unknown>>;
    const recentEmails = await db
      .prepare(`SELECT id, to_email, subject, status, error, created_at FROM email_log ORDER BY created_at DESC LIMIT 60`)
      .all() as Array<Record<string, unknown>>;
    const vapid = await getVapidKeys();
    res.json({
      health,
      counts,
      maintenance: await getMaintenance(),
      integration: {
        djomy: paymentProvider.getDiagnostics().mode,
        smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
        vapidConfigured: Boolean(vapid.publicKey),
        appUrl: process.env.APP_URL || '',
        nodeVersion: process.version,
      },
      webhooks: recentWebhooks.map((w) => ({
        event_id: String(w.event_id),
        event_type: String(w.event_type),
        djomy_reference: String(w.djomy_reference || ''),
        processed: Number(w.processed || 0),
        created_at: String(w.created_at),
      })),
      emails: recentEmails.map((e) => ({
        id: String(e.id),
        to_email: String(e.to_email),
        subject: String(e.subject),
        status: String(e.status),
        error: String(e.error || ''),
        created_at: String(e.created_at),
      })),
    });
  })
);

/* GET /api/admin/webhooks — full webhook journal */
adminRouter.get(
  '/admin/webhooks',
  requireAdmin,
  wrapAdmin(async (_req, res) => {
    const rows = await db
      .prepare(`SELECT event_id, event_type, djomy_reference, processed, created_at FROM webhook_events ORDER BY created_at DESC LIMIT 150`)
      .all() as Array<Record<string, unknown>>;
    res.json({
      webhooks: rows.map((w) => ({
        event_id: String(w.event_id),
        event_type: String(w.event_type),
        djomy_reference: String(w.djomy_reference || ''),
        processed: Number(w.processed || 0),
        created_at: String(w.created_at),
      })),
    });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * V2 — MAINTENANCE & BLACKLIST
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.post(
  '/admin/maintenance',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(maintenanceSchema, req);
    const before = await getMaintenance();
    await setMaintenance({ enabled: body.enabled, message: body.message || '' });
    audit('maintenance_toggled', 'platform_rules', 'maintenance', before, body);
    res.json({ ok: true, maintenance: await getMaintenance() });
  })
);

adminRouter.get(
  '/admin/blacklist',
  requireAdmin,
  wrapAdmin(async (_req, res) => {
    const rows = await db.prepare(`SELECT id, value, kind, reason, created_at FROM buyer_blacklist ORDER BY created_at DESC`).all() as Array<Record<string, unknown>>;
    res.json({
      entries: rows.map((r) => ({
        id: String(r.id),
        value: String(r.value),
        kind: String(r.kind),
        reason: String(r.reason || ''),
        created_at: String(r.created_at),
      })),
    });
  })
);

adminRouter.post(
  '/admin/blacklist',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const body = parseBody(blacklistSchema, req);
    const kind = body.value.includes('@') ? 'email' : 'phone';
    const id = genId('bl');
    const result = await db
      .prepare(`INSERT INTO buyer_blacklist (id, value, kind, reason, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (value) DO NOTHING`)
      .run(id, body.value, kind, body.reason || '', now());
    if (Number(result.changes) === 0) throw new HttpError(409, 'Cette valeur est déjà dans la liste noire.');
    audit('blacklist_added', 'buyer_blacklist', id, {}, body);
    res.status(201).json({ ok: true, id, kind });
  })
);

adminRouter.delete(
  '/admin/blacklist/:id',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const entry = await db.prepare(`SELECT id, value FROM buyer_blacklist WHERE id = ?`).get(String(req.params.id)) as
      | { id: string; value: string }
      | undefined;
    if (!entry) throw new HttpError(404, 'Entrée introuvable.');
    await db.prepare(`DELETE FROM buyer_blacklist WHERE id = ?`).run(entry.id);
    audit('blacklist_removed', 'buyer_blacklist', entry.id, entry, {});
    res.json({ ok: true });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * V2 — EXPORTS ÉTENDUS (CSV, BOM UTF-8 pour Excel)
 * ──────────────────────────────────────────────────────────────────────── */

adminRouter.get(
  '/admin/export/:type',
  requireAdmin,
  wrapAdmin(async (req, res) => {
    const type = String(req.params.type);

    if (type === 'orders') {
      const rows = await db
        .prepare(
          `SELECT o.order_number, o.buyer_name, o.buyer_email, o.buyer_phone, o.status, o.payment_plan,
                  o.total_gnf, o.amount_paid_now_gnf, o.balance_due_gnf, o.created_at
           FROM orders o ORDER BY o.created_at DESC`
        )
        .all() as Array<Record<string, unknown>>;
      sendCsv(res, 'emrod-commandes.csv', rows as Array<Record<string, unknown>>);
      return;
    }

    if (type === 'vendors') {
      const rows = await db
        .prepare(
          `SELECT u.email, u.phone, u.status, u.entity_type, vp.shop_name, vp.slug, vp.location, vp.is_emrod_official, u.created_at
           FROM users u JOIN vendor_profiles vp ON vp.user_id = u.id ORDER BY u.created_at DESC`
        )
        .all() as Array<Record<string, unknown>>;
      sendCsv(res, 'emrod-ateliers.csv', rows as Array<Record<string, unknown>>);
      return;
    }

    if (type === 'products') {
      const rows = await db
        .prepare(
          `SELECT p.id, p.name, p.slug, p.status, p.price_gnf, p.mode, p.stock_qty, c.name AS category, vp.shop_name, p.views_count, p.created_at
           FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN vendor_profiles vp ON vp.user_id = p.vendor_id
           ORDER BY p.created_at DESC`
        )
        .all() as Array<Record<string, unknown>>;
      sendCsv(res, 'emrod-produits.csv', rows as Array<Record<string, unknown>>);
      return;
    }

    if (type === 'payments' || type === 'commissions' || type === 'payouts' || type === 'buyers' || type === 'quotes' || type === 'reviews' || type === 'audit') {
      await exportExtended(type, res);
      return;
    }

    throw new HttpError(404, `Type d'export inconnu : ${type}`);
  })
);

async function exportExtended(type: string, res: import('express').Response): Promise<void> {
  if (type === 'payments') {
    const rows = await db
      .prepare(
        `SELECT p.djomy_reference, p.type, p.method, p.operator, p.amount_gnf, p.status, p.quote_id, p.order_id, p.created_at
         FROM payments p ORDER BY p.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    sendCsv(res, 'emrod-paiements.csv', rows as Array<Record<string, unknown>>);
    return;
  }
  if (type === 'commissions') {
    const rows = await db
      .prepare(
        `SELECT c.created_at, c.order_id, c.vendor_id, vp.shop_name, c.gross_gnf, c.rate_percent, c.commission_gnf, c.net_vendor_gnf, c.base, c.status, c.source
         FROM commissions c LEFT JOIN vendor_profiles vp ON vp.user_id = c.vendor_id ORDER BY c.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    sendCsv(res, 'emrod-commissions.csv', rows as Array<Record<string, unknown>>);
    return;
  }
  if (type === 'payouts') {
    const rows = await db
      .prepare(
        `SELECT po.created_at, po.reference, vp.shop_name, o.order_number, po.amount_gnf, po.commission_gnf, po.net_amount_gnf, po.status
         FROM payouts po LEFT JOIN vendor_profiles vp ON vp.user_id = po.vendor_id LEFT JOIN orders o ON o.id = po.order_id
         ORDER BY po.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    sendCsv(res, 'emrod-versements.csv', rows as Array<Record<string, unknown>>);
    return;
  }
  if (type === 'buyers') {
    const rows = (await queryBuyers({ limit: 500 })) as Array<Record<string, unknown>>;
    sendCsv(res, 'emrod-acheteurs.csv', rows as Array<Record<string, unknown>>);
    return;
  }
  if (type === 'quotes') {
    const rows = await db
      .prepare(
        `SELECT q.created_at, p.name AS product, q.buyer_name, q.buyer_email, q.step_status, q.quoted_amount_gnf, q.djomy_reference
         FROM quote_requests q LEFT JOIN products p ON p.id = q.product_id ORDER BY q.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    sendCsv(res, 'emrod-devis.csv', rows as Array<Record<string, unknown>>);
    return;
  }
  if (type === 'reviews') {
    const rows = await db
      .prepare(
        `SELECT r.created_at, p.name AS product, r.buyer_name, r.rating, r.comment, r.status
         FROM reviews r LEFT JOIN products p ON p.id = r.product_id ORDER BY r.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    sendCsv(res, 'emrod-avis.csv', rows as Array<Record<string, unknown>>);
    return;
  }
  const rows = await db
    .prepare(`SELECT created_at, actor_name, action, target_type, target_id FROM audit_logs ORDER BY created_at DESC`)
    .all() as Array<Record<string, unknown>>;
  sendCsv(res, 'emrod-audit.csv', rows as Array<Record<string, unknown>>);
}
