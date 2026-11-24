import { Router } from 'express';
import { z } from 'zod';
import { messageSubmitSchema, pushSubscriptionSchema, analyticsTrackSchema } from '../../src/shared/schemas';
import { detectExternalContactAttempt } from '../../src/shared/domain';
import type { CategoryItem, ProductItem, VendorPublicSummary } from '../../src/shared/types';
import { db } from '../db';
import {
  getAllBadges,
  getAllCategories,
  getCommercialRestrictions,
  getDeliveryZones,
  getRule,
  getVendorPublicSummaries,
  getVendorPublicSummary,
  hydrateProducts,
  queryPublicProducts,
  queryPublicVendors,
} from '../queries';
import { sendMail } from '../mailer';
import { getVapidKeys, HttpError, logAnalyticsEvent, logSearchQuery, now, genId, parseBody, wrap } from './_helpers';

export const publicRouter = Router();

/* ─────────────────────────────────────────────────────────────────────────
 * GET /api/homepage — storefront payload (editorial + featured + vendors)
 * ──────────────────────────────────────────────────────────────────────── */

const DEFAULT_EDITORIAL: Record<string, string> = {
  announcementText: 'Livraison et montage assurés à Conakry · Paiement sécurisé Djomy',
  heroTitle: 'Des meubles uniques, sur mesure, créés par des femmes pour votre intérieur.',
  heroSubtitle:
    'Bois nobles de Guinée, cuirs pleine fleur et métaux texturés façonnés à la main dans notre atelier de Sonfonia et chez nos artisans certifiés.',
  heroCtaLabel: 'Explorer la collection',
  featuredTitle: 'Pièces signatures & éditions d’atelier',
  featuredSubtitle:
    'Chaque création allie justesse architecturale, durabilité absolue et finitions appliquées à la main.',
};

publicRouter.get(
  '/homepage',
  wrap(async (_req, res) => {
    const editorialStored = await getRule<Record<string, unknown>>('editorial', {});
    const editorial: Record<string, string> = { ...DEFAULT_EDITORIAL };
    for (const [k, v] of Object.entries(editorialStored)) {
      if (typeof v === 'string' && v.trim()) editorial[k] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') editorial[k] = String(v);
    }

    const categories = await getAllCategories();
    const featured = (await queryPublicProducts({ sort: 'featured' })).slice(0, 6);
    const vendors = (await queryPublicVendors({ sort: 'featured' })).slice(0, 9);
    const emrodVendor = vendors.find((v) => v.isEmrodOfficial) || null;

    res.json({ editorial, categories, featured, emrodVendor, vendors });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * GET /api/products — catalog search (filters, sort, pagination + metadata)
 * ──────────────────────────────────────────────────────────────────────── */

function numParam(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

publicRouter.get(
  '/products',
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const filters = {
      q: q || undefined,
      category: String(req.query.category || '') || undefined,
      material: String(req.query.material || '') || undefined,
      badge: String(req.query.badge || '') || undefined,
      zone: String(req.query.zone || '') || undefined,
      vendor: String(req.query.vendor || '') || undefined,
      mode: String(req.query.mode || '') || undefined,
      sort: String(req.query.sort || 'featured'),
      minPrice: numParam(req.query.minPrice),
      maxPrice: numParam(req.query.maxPrice),
      minQty: numParam(req.query.minQty),
      inStockOnly: req.query.inStockOnly === '1',
      minRating: numParam(req.query.minRating),
    };

    const all = await queryPublicProducts(filters);
    const total = all.length;
    const limit = Math.min(60, Math.max(1, numParam(req.query.limit) || 12));
    const items: ProductItem[] = all.slice(0, limit);

    if (q.length >= 3) logSearchQuery(q, total);

    res.json({
      items,
      total,
      categories: await getAllCategories(),
      badges: await getAllBadges(),
      zones: (await getDeliveryZones()).filter((zone) => zone.active),
      vendors: await queryPublicVendors({ sort: 'featured' }),
    });
  })
);

/* GET /api/products/:slugOrId — product detail (reviews + public Q&A) */
publicRouter.get(
  '/products/:slugOrId',
  wrap(async (req, res) => {
    const key = String(req.params.slugOrId || '').trim();
    if (!key) throw new HttpError(404, 'Création introuvable.');

    const row = await db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug
         FROM products p
         JOIN categories c ON c.id = p.category_id
         JOIN users u ON u.id = p.vendor_id
         WHERE (p.slug = ? OR p.id = ?) AND p.status = 'published' AND u.status = 'validated'
         LIMIT 1`
      )
      .get(key, key) as Record<string, unknown> | undefined;
    const products = row ? await hydrateProducts([row]) : [];
    const product = products[0];
    if (!product) throw new HttpError(404, 'Création introuvable.');

    const reviewRows = await db
      .prepare(
        `SELECT id, buyer_name, rating, comment, photos_json, vendor_reply, created_at
         FROM reviews WHERE product_id = ? AND status = 'published'
         ORDER BY created_at DESC LIMIT 30`
      )
      .all(product.id) as Array<Record<string, unknown>>;

    const conv = await db
      .prepare(`SELECT id FROM conversations WHERE type = 'product' AND product_id = ? LIMIT 1`)
      .get(product.id) as { id: string } | undefined;
    const questionRows = conv
      ? (await db
          .prepare(
            `SELECT id, sender_role, sender_name, content, created_at FROM messages
             WHERE conversation_id = ? AND is_public = 1 AND status = 'visible'
             ORDER BY created_at ASC LIMIT 60`
          )
          .all(conv.id) as Array<Record<string, unknown>>)
      : [];

    res.json({
      product,
      reviews: reviewRows.map((r) => ({
        id: String(r.id),
        buyerName: String(r.buyer_name),
        rating: Number(r.rating),
        comment: String(r.comment),
        photos: JSON.parse(String(r.photos_json || '[]')) as string[],
        vendorReply: String(r.vendor_reply || ''),
        createdAt: String(r.created_at),
      })),
      questions: questionRows.map((m) => ({
        id: String(m.id),
        senderRole: String(m.sender_role),
        senderName: String(m.sender_name),
        content: String(m.content),
        createdAt: String(m.created_at),
      })),
      zones: (await getDeliveryZones()).filter((zone) => zone.active),
      restrictions: await getCommercialRestrictions(),
    });
  })
);

/* POST /api/products/:id/questions — public Q&A (buyer message, moderated) */
publicRouter.post(
  '/products/:id/questions',
  wrap(async (req, res) => {
    const productId = String(req.params.id || '');
    const body = parseBody(
      messageSubmitSchema.extend({
        senderName: z.string().trim().min(1).max(120).optional(),
      }),
      req
    );

    const product = await db
      .prepare(
        `SELECT p.id, p.name, p.vendor_id FROM products p
         JOIN users u ON u.id = p.vendor_id
         WHERE p.id = ? AND p.status = 'published' AND u.status = 'validated'`
      )
      .get(productId) as { id: string; name: string; vendor_id: string } | undefined;
    if (!product) throw new HttpError(404, 'Création introuvable.');

    const restrictions = await getCommercialRestrictions();
    if (!restrictions.allowExternalContactsInMessages) {
      const check = detectExternalContactAttempt(body.content);
      if (check.blocked) throw new HttpError(400, check.reason || 'Message non conforme aux règles EMROD.');
    }

    let conv = await db
      .prepare(`SELECT id FROM conversations WHERE type = 'product' AND product_id = ? LIMIT 1`)
      .get(product.id) as { id: string } | undefined;
    if (!conv) {
      const convId = genId('conv');
      await db.prepare(
        `INSERT INTO conversations (id, type, product_id, vendor_id, buyer_name, buyer_email, created_at)
         VALUES (?, 'product', ?, ?, ?, '', ?)`
      ).run(convId, product.id, product.vendor_id, body.senderName || 'Visiteur', now());
      conv = { id: convId };
    }

    const senderName = (body.senderName || 'Visiteur').slice(0, 120);
    const msgId = genId('msg');
    const ts = now();
    await db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_role, sender_name, content, is_public, is_flagged, status, created_at)
       VALUES (?, ?, 'buyer', ?, ?, 1, 0, 'visible', ?)`
    ).run(msgId, conv.id, senderName, body.content, ts);

    const vendorUser = await db.prepare(`SELECT email FROM users WHERE id = ?`).get(product.vendor_id) as
      | { email: string }
      | undefined;
    if (vendorUser) {
      sendMail({
        to: vendorUser.email,
        subject: `Nouvelle question publique — ${product.name}`,
        text: `${senderName} a posé une question publique sur « ${product.name} » :\n${body.content}\nRépondez depuis votre portail vendeur (messagerie produit).`,
        html: `<p><strong>${senderName}</strong> a posé une question publique sur « <strong>${product.name}</strong> » :</p><p>${body.content}</p><p>Répondez depuis votre portail vendeur.</p>`,
      });
    }

    res.status(201).json({
      id: msgId,
      senderRole: 'buyer',
      senderName,
      content: body.content,
      createdAt: ts,
    });
  })
);

/* POST /api/messages/:msgId/flag — public report to moderation */
publicRouter.post(
  '/messages/:msgId/flag',
  wrap(async (req, res) => {
    const body = parseBody(z.object({ reason: z.string().trim().min(2).max(400) }), req);
    const msgId = String(req.params.msgId || '');
    const result = await db
      .prepare(`UPDATE messages SET is_flagged = 1, flag_reason = ? WHERE id = ?`)
      .run(body.reason.slice(0, 400), msgId);
    if (result.changes === 0) throw new HttpError(404, 'Message introuvable.');
    res.json({ ok: true });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * GET /api/vendors — vendor directory search (sales, badges, location…)
 * ──────────────────────────────────────────────────────────────────────── */

publicRouter.get(
  '/vendors',
  wrap(async (req, res) => {
    const vendors: VendorPublicSummary[] = await queryPublicVendors({
      q: String(req.query.q || '').trim() || undefined,
      minSales: numParam(req.query.minSales),
      badge: String(req.query.badge || '') || undefined,
      minRating: numParam(req.query.minRating),
      location: String(req.query.location || '') || undefined,
      bankTransferOnly: req.query.bankTransferOnly === '1',
      sort: String(req.query.sort || 'featured'),
    });

    const locations = [...new Set(vendors.map((v) => v.location))].sort((a, b) =>
      a.localeCompare(b, 'fr')
    );

    res.json({
      vendors,
      total: vendors.length,
      badges: await getAllBadges(),
      locations,
    });
  })
);

/* GET /api/vendors/:slugOrId — public storefront (vendor + products + reviews) */
publicRouter.get(
  '/vendors/:slugOrId',
  wrap(async (req, res) => {
    const key = String(req.params.slugOrId || '').trim();
    const vendor = await getVendorPublicSummary(key);
    if (!vendor) throw new HttpError(404, 'Atelier introuvable.');

    const products = await queryPublicProducts({ vendor: vendor.slug });
    const reviewRows = await db
      .prepare(
        `SELECT r.id, r.buyer_name, r.rating, r.comment, r.vendor_reply, r.created_at, p.name AS product_name
         FROM reviews r JOIN products p ON p.id = r.product_id
         WHERE r.vendor_id = ? AND r.status = 'published'
         ORDER BY r.created_at DESC LIMIT 30`
      )
      .all(vendor.userId) as Array<Record<string, unknown>>;

    res.json({
      vendor,
      products,
      reviews: reviewRows.map((r) => ({
        id: String(r.id),
        buyerName: String(r.buyer_name),
        rating: Number(r.rating),
        comment: String(r.comment),
        vendorReply: String(r.vendor_reply || ''),
        productName: String(r.product_name),
        createdAt: String(r.created_at),
      })),
    });
  })
);

/* GET /api/zones — active delivery zones (checkout + cart context) */
publicRouter.get(
  '/zones',
  wrap(async (_req, res) => {
    res.json({ zones: (await getDeliveryZones()).filter((zone) => zone.active) });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * Notifications feed + open tracking (PWA alerts)
 * ──────────────────────────────────────────────────────────────────────── */

publicRouter.get(
  '/notifications/feed',
  wrap(async (_req, res) => {
    const rows = await db
      .prepare(
        `SELECT id, title, body, target_category, target_region, target_url, created_at
         FROM notifications ORDER BY created_at DESC LIMIT 20`
      )
      .all() as Array<Record<string, unknown>>;
    res.json({
      notifications: rows.map((n) => ({
        id: String(n.id),
        title: String(n.title),
        body: String(n.body),
        target_category: String(n.target_category),
        target_region: String(n.target_region),
        target_url: String(n.target_url),
        created_at: String(n.created_at),
      })),
    });
  })
);

publicRouter.post(
  '/notifications/:id/open',
  wrap(async (req, res) => {
    await db.prepare(`UPDATE notifications SET opened_count = opened_count + 1 WHERE id = ?`).run(
      String(req.params.id || '')
    );
    res.json({ ok: true });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * Web Push — VAPID public key + subscription upsert
 * ──────────────────────────────────────────────────────────────────────── */

publicRouter.get(
  '/push/vapid-key',
  wrap(async (_req, res) => {
    res.json({ publicKey: (await getVapidKeys()).publicKey });
  })
);

publicRouter.post(
  '/push/subscribe',
  wrap(async (req, res) => {
    const body = parseBody(pushSubscriptionSchema, req);

    if (body.endpoint) {
      const keysJson = JSON.stringify(body.keys || {});
      const categoriesJson = JSON.stringify(body.categories || []);
      const region = body.region || 'Conakry';
      const frequency = body.frequency || 'instant';
      const emailFallback = body.emailFallback || '';
      await db.prepare(
        `INSERT INTO push_subscriptions (id, endpoint, keys_json, categories_json, region, frequency, email_fallback, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           keys_json = excluded.keys_json,
           categories_json = excluded.categories_json,
           region = excluded.region,
           frequency = excluded.frequency,
           email_fallback = excluded.email_fallback`
      ).run(genId('push'), body.endpoint, keysJson, categoriesJson, region, frequency, emailFallback, now());
    }
    // Email-only fallback (browser blocked push): acknowledged without a push row —
    // the address can still receive the weekly digest via future email campaigns.

    res.json({ ok: true, push: Boolean(body.endpoint) });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * Privacy requests (access / deletion) — US-T03
 * ──────────────────────────────────────────────────────────────────────── */

publicRouter.post(
  '/privacy/request',
  wrap(async (req, res) => {
    const body = parseBody(
      z.object({
        email: z.string().trim().email('Courriel invalide.'),
        phone: z.string().trim().min(6, 'Téléphone requis.').max(30),
        requestType: z.enum(['access', 'deletion']),
      }),
      req
    );
    const requestId = genId('dpr');
    await db.prepare(
      `INSERT INTO data_privacy_requests (id, email, phone, request_type, status, created_at)
       VALUES (?, ?, ?, ?, 'received', ?)`
    ).run(requestId, body.email.toLowerCase(), body.phone, body.requestType, now());

    sendMail({
      to: body.email,
      subject: 'Votre demande RGPD — EMROD SARL',
      text:
        body.requestType === 'access'
          ? 'Bonjour,\n\nVotre demande d’accès à vos données a été enregistrée. EMROD vous répondra sous 30 jours avec l’export de vos commandes invitées.\n\nEMROD SARL'
          : 'Bonjour,\n\nVotre demande d’effacement de données a été enregistrée. EMROD la traitera sous 30 jours (les factures légales sont conservées selon les obligations comptables guinéennes).\n\nEMROD SARL',
      html:
        body.requestType === 'access'
          ? '<p>Bonjour,</p><p>Votre demande d’accès à vos données a été enregistrée. EMROD vous répondra sous 30 jours avec l’export de vos commandes invitées.</p><p>EMROD SARL</p>'
          : '<p>Bonjour,</p><p>Votre demande d’effacement de données a été enregistrée. EMROD la traitera sous 30 jours (les factures légales sont conservées selon les obligations comptables guinéennes).</p><p>EMROD SARL</p>',
    });

    res.status(201).json({
      message:
        body.requestType === 'access'
          ? 'Votre demande d’accès est enregistrée — vous recevrez une copie de vos données sous 30 jours.'
          : 'Votre demande d’effacement est enregistrée — elle sera traitée sous 30 jours.',
    });
  })
);

/* POST /api/analytics/track — lightweight funnel events (cart_add, checkout_start) */
publicRouter.post(
  '/analytics/track',
  wrap(async (req, res) => {
    const body = parseBody(analyticsTrackSchema, req);
    logAnalyticsEvent(body.type, body.productId || undefined);
    res.json({ ok: true });
  })
);
