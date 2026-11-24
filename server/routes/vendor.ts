import { Router } from 'express';
import {
  kycDocumentUploadSchema,
  keywordsExtractSchema,
  messageSubmitSchema,
  productUpsertSchema,
  quoteSendLinkSchema,
  quoteStepPatchSchema,
  reviewReplySchema,
  vendorOrderStatusPatchSchema,
  vendorProfileUpdateSchema,
} from '../../src/shared/schemas';
import {
  canVendorAdvanceOrder,
  detectExternalContactAttempt,
  extractKeywordsFromDescription,
  formatGNF,
  canTransitionOrderStatus,
} from '../../src/shared/domain';
import type { OrderStatus, ProductItem } from '../../src/shared/types';
import { db, runInTransaction } from '../db';
import { requireAuth, type AuthenticatedRequest } from '../auth';
import { paymentProvider } from '../djomy';
import {
  getAllBadges,
  getAllCategories,
  getCommercialRestrictions,
  getDeliveryZones,
  getRule,
  getVendorCompliance,
  hydrateProducts,
} from '../queries';
import { sendMail } from '../mailer';
import { settlePaymentRow } from './payments';
import {
  HttpError,
  assertTransition,
  genId,
  insertOrderEvent,
  logAnalyticsEvent,
  now,
  parseBody,
  slugifyUnique,
  wrap,
} from './_helpers';

export const vendorRouter = Router();

/* ─────────────────────────────────────────────────────────────────────────
 * Vendor context guard — every /api/vendor route requires a vendor profile
 * ──────────────────────────────────────────────────────────────────────── */

interface VendorContext {
  userId: string;
  email: string;
  user: Record<string, unknown> & { id: string; email: string; status: string; role: string };
  profile: Record<string, unknown> & { user_id: string; slug: string; shop_name: string };
}

async function loadVendorContext(req: AuthenticatedRequest): Promise<VendorContext> {
  const userId = req.session!.sub;
  const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as VendorContext['user'] | undefined;
  if (!user) throw new HttpError(401, 'Session expirée ou invalide.');
  const profile = await db.prepare(`SELECT * FROM vendor_profiles WHERE user_id = ?`).get(userId) as
    | VendorContext['profile']
    | undefined;
  if (!profile) throw new HttpError(403, 'Aucun atelier n’est rattaché à ce compte.');
  return { userId, email: user.email, user, profile };
}

async function vendorOwnsOrder(userId: string, orderId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM order_items WHERE order_id = ? AND vendor_id = ? LIMIT 1`)
    .get(orderId, userId);
  return Boolean(row);
}

/* ─────────────────────────────────────────────────────────────────────────
 * GET /api/vendor/dashboard — the single payload powering every vendor tab
 * ──────────────────────────────────────────────────────────────────────── */

vendorRouter.get(
  '/vendor/dashboard',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const { userId, profile, user } = ctx;

    const compliance = await getVendorCompliance(userId);
    const restrictions = await getCommercialRestrictions();

    const documents = await db
      .prepare(
        `SELECT id, doc_type, doc_label, file_name, status, rejection_reason, created_at
         FROM kyc_documents WHERE vendor_id = ? ORDER BY created_at DESC`
      )
      .all(userId) as Array<Record<string, unknown>>;

    const productRows = await db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug
         FROM products p JOIN categories c ON c.id = p.category_id
         WHERE p.vendor_id = ? AND p.status != 'removed'
         ORDER BY p.created_at DESC`
      )
      .all(userId) as Array<Record<string, unknown>>;
    const products: ProductItem[] = await hydrateProducts(productRows);

    const orderRows = await db
      .prepare(
        `SELECT DISTINCT o.* FROM orders o
         WHERE EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.vendor_id = ?)
         ORDER BY o.created_at DESC LIMIT 150`
      )
      .all(userId) as Array<Record<string, unknown>>;

    const orders = await Promise.all(
      orderRows.map(async (o) => {
      const items = await db
        .prepare(
          `SELECT id, product_name, quantity, unit_price_gnf FROM order_items
           WHERE order_id = ? AND vendor_id = ?`
        )
        .all(String(o.id), userId) as Array<{
        id: string;
        product_name: string;
        quantity: number;
        unit_price_gnf: number;
      }>;
      const vendorSubtotal = items.reduce((sum, it) => sum + Number(it.unit_price_gnf) * Number(it.quantity), 0);
      const paid = await db
        .prepare(`SELECT 1 FROM payments WHERE order_id = ? AND status = 'succeeded' LIMIT 1`)
        .get(String(o.id));
      return {
        id: String(o.id),
        order_number: String(o.order_number),
        buyer_name: String(o.buyer_name),
        buyer_phone: String(o.buyer_phone),
        delivery_zone_name: String(o.delivery_zone_name || ''),
        delivery_address: String(o.delivery_address || ''),
        total_gnf: Number(o.total_gnf),
        vendor_subtotal_gnf: vendorSubtotal,
        payment_plan: (o.payment_plan as string) || 'full',
        deposit_percent: Number(o.deposit_percent ?? 100),
        amount_paid_now_gnf: Number(o.amount_paid_now_gnf ?? 0),
        balance_due_gnf: Number(o.balance_due_gnf ?? 0),
        bank_transfer_reference: String(o.bank_transfer_reference || ''),
        bank_transfer_declared_at: (o.bank_transfer_declared_at as string | null) || null,
        payment_status: paid ? 'succeeded' : 'pending',
        status: String(o.status) as OrderStatus,
        created_at: String(o.created_at),
        items,
      };
      })
    );

    const quotes = await db
      .prepare(
        `SELECT q.id, p.name AS product_name, q.buyer_name, q.buyer_email, q.buyer_phone,
                q.preferred_material, q.dimensions_notes, q.project_notes, q.quantity,
                q.desired_zone_id, q.step_status, q.quoted_amount_gnf, q.payment_link_url,
                q.djomy_reference, q.created_at
         FROM quote_requests q LEFT JOIN products p ON p.id = q.product_id
         WHERE q.vendor_id = ? ORDER BY q.created_at DESC LIMIT 100`
      )
      .all(userId) as Array<Record<string, unknown>>;

    const reviews = await db
      .prepare(
        `SELECT r.id, p.name AS product_name, r.buyer_name, r.rating, r.comment, r.vendor_reply, r.created_at
         FROM reviews r JOIN products p ON p.id = r.product_id
         WHERE r.vendor_id = ? AND r.status = 'published'
         ORDER BY r.created_at DESC LIMIT 60`
      )
      .all(userId) as Array<Record<string, unknown>>;

    const convRows = await db
      .prepare(
        `SELECT id, type, buyer_name, buyer_email FROM conversations
         WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 60`
      )
      .all(userId) as Array<Record<string, unknown>>;
    const threads = await Promise.all(
      convRows.map(async (c) => {
      const messages = await db
        .prepare(
          `SELECT id, sender_role, sender_name, content, created_at FROM messages
           WHERE conversation_id = ? AND status = 'visible' ORDER BY created_at ASC, id ASC`
        )
        .all(String(c.id)) as Array<Record<string, unknown>>;
      return {
        id: String(c.id),
        type: String(c.type),
        buyer_name: String(c.buyer_name),
        buyer_email: String(c.buyer_email || ''),
        messages: messages.map((m) => ({
          id: String(m.id),
          sender_role: String(m.sender_role),
          sender_name: String(m.sender_name),
          content: String(m.content),
          created_at: String(m.created_at),
        })),
      };
      })
    );

    const payouts = await db
      .prepare(
        `SELECT id, order_id, amount_gnf, commission_gnf, net_amount_gnf, reference, status, created_at
         FROM payouts WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 100`
      )
      .all(userId) as Array<Record<string, unknown>>;

    const revenueEligible = orders.filter((o) => o.status !== 'Annulée' && o.status !== 'Remboursée');
    const stats = {
      totalRevenueGnf: revenueEligible.reduce((sum, o) => sum + o.vendor_subtotal_gnf, 0),
      ordersCount: revenueEligible.length,
      publishedProductsCount: products.filter((p) => p.status === 'published').length,
      pendingOrdersCount: orders.filter((o) =>
        ['Commandée', 'Confirmée', 'En préparation'].includes(o.status)
      ).length,
    };

    res.json({
      user: {
        id: String(user.id),
        email: String(user.email),
        phone: String(user.phone),
        role: String(user.role),
        status: String(user.status),
        status_reason: String(user.status_reason || ''),
        entity_type: (String(user.entity_type) === 'company' ? 'company' : 'individual'),
        created_at: String(user.created_at),
      },
      profile: {
        user_id: String(profile.user_id),
        slug: String(profile.slug),
        shop_name: String(profile.shop_name),
        description: String(profile.description),
        story: String(profile.story || ''),
        location: String(profile.location),
        response_time_label: String(profile.response_time_label || 'Répond sous 2h'),
        custom_fields_json: String(profile.custom_fields_json || '{}'),
        is_emrod_official: Number(profile.is_emrod_official || 0),
      },
      bankDetails: {
        bankTransferEnabled: Boolean(Number(profile.bank_transfer_enabled || 0) === 1),
        bankName: String(profile.bank_name || ''),
        bankAccountHolder: String(profile.bank_account_holder || ''),
        bankIbanRib: String(profile.bank_iban_rib || ''),
        bankSwiftBic: String(profile.bank_swift_bic || ''),
        bankInstructions: String(profile.bank_instructions || ''),
      },
      compliance: {
        isValidated: compliance?.isValidated ?? false,
        isCertified: compliance?.isCertified ?? false,
        earnedBadgeIds: compliance?.earnedBadgeIds ?? [],
        missingItems: compliance?.missingItems ?? [],
      },
      documents: documents.map((d) => ({
        id: String(d.id),
        doc_type: String(d.doc_type),
        doc_label: String(d.doc_label),
        file_name: String(d.file_name),
        status: String(d.status),
        rejection_reason: String(d.rejection_reason || ''),
        created_at: String(d.created_at),
      })),
      registrationRequirements: await getRule('registration_requirements', { fields: [], documents: [] }),
      restrictions,
      categories: await getAllCategories(),
      badges: await getAllBadges(),
      zones: (await getDeliveryZones()).filter((zone) => zone.active),
      products,
      orders,
      quotes: quotes.map((q) => ({
        id: String(q.id),
        product_name: String(q.product_name || 'Pièce sur mesure'),
        buyer_name: String(q.buyer_name),
        buyer_email: String(q.buyer_email),
        buyer_phone: String(q.buyer_phone),
        preferred_material: String(q.preferred_material),
        dimensions_notes: String(q.dimensions_notes),
        project_notes: String(q.project_notes),
        quantity: Number(q.quantity || 1),
        desired_zone_id: String(q.desired_zone_id || ''),
        step_status: String(q.step_status),
        quoted_amount_gnf: q.quoted_amount_gnf === null ? null : Number(q.quoted_amount_gnf),
        payment_link_url: (q.payment_link_url as string | null) || null,
        djomy_reference: (q.djomy_reference as string | null) || null,
        created_at: String(q.created_at),
      })),
      reviews: reviews.map((r) => ({
        id: String(r.id),
        product_name: String(r.product_name),
        buyer_name: String(r.buyer_name),
        rating: Number(r.rating),
        comment: String(r.comment),
        vendor_reply: String(r.vendor_reply || ''),
        created_at: String(r.created_at),
      })),
      threads,
      payouts: payouts.map((p) => ({
        id: String(p.id),
        order_id: String(p.order_id),
        amount_gnf: Number(p.amount_gnf),
        commission_gnf: Number(p.commission_gnf || 0),
        net_amount_gnf: Number(p.net_amount_gnf ?? p.amount_gnf),
        reference: String(p.reference),
        status: String(p.status),
        created_at: String(p.created_at),
      })),
      stats,
    });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * KYC documents
 * ──────────────────────────────────────────────────────────────────────── */

vendorRouter.post(
  '/vendor/documents',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const body = parseBody(kycDocumentUploadSchema, req);
    const ts = now();

    await db.prepare(
      `INSERT INTO kyc_documents (id, vendor_id, doc_type, doc_label, file_name, file_data_url, status, reviewer_id, rejection_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, '', ?, ?)`
    ).run(genId('kyc'), ctx.userId, body.docType, body.docLabel || body.docType, body.fileName, body.fileDataUrl, ts, ts);

    // First document moves a fresh dossier into the review queue
    if (ctx.user.status === 'pending') {
      await db.prepare(`UPDATE users SET status = 'in_review', updated_at = ? WHERE id = ?`).run(ts, ctx.userId);
    }

    await db.prepare(
      `INSERT INTO audit_logs (id, actor_id, actor_role, actor_name, action, target_type, target_id, before_json, after_json, created_at)
       VALUES (?, ?, 'vendor', ?, 'kyc_uploaded', 'kyc_document', ?, '{}', ?, ?)`
    ).run(
      genId('aud'),
      ctx.userId,
      ctx.profile.shop_name,
      genId('kyc'),
      JSON.stringify({ docType: body.docType, fileName: body.fileName }),
      ts
    );

    res.status(201).json({ ok: true });
  })
);

vendorRouter.get(
  '/vendor/documents/:id/file',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const doc = await db
      .prepare(`SELECT file_name, file_data_url FROM kyc_documents WHERE id = ? AND vendor_id = ?`)
      .get(String(req.params.id), ctx.userId) as { file_name: string; file_data_url: string } | undefined;
    if (!doc) throw new HttpError(404, 'Document introuvable.');
    res.json({ fileName: doc.file_name, fileDataUrl: doc.file_data_url });
  })
);

/* POST /api/vendor/keywords/extract — SEO keyword suggestions */
vendorRouter.post(
  '/vendor/keywords/extract',
  requireAuth(['vendor', 'admin']),
  wrap(async (req, res) => {
    const body = parseBody(keywordsExtractSchema, req);
    const keywords = extractKeywordsFromDescription(
      body.name || '',
      body.description || '',
      body.category || '',
      body.materials || ''
    ).slice(0, 12);
    res.json({ keywords });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * Products CRUD — with compliance gates (restricted categories, max
 * uncertified listings) and optional pre-moderation (in_review)
 * ──────────────────────────────────────────────────────────────────────── */

async function resolvePublicationStatus(
  requested: 'draft' | 'in_review' | 'published' | 'archived',
  ctx: VendorContext,
  categoryId: string
): Promise<'draft' | 'in_review' | 'published' | 'archived'> {
  if (requested !== 'published') return requested;

  const compliance = await getVendorCompliance(ctx.userId);
  const restrictions = await getCommercialRestrictions();
  const category = await db
    .prepare(`SELECT id, name, is_restricted, required_badge_id FROM categories WHERE id = ?`)
    .get(categoryId) as
    | { id: string; name: string; is_restricted: number; required_badge_id: string | null }
    | undefined;
  if (!category) throw new HttpError(400, 'Catégorie introuvable.');

  const gate = compliance?.canPublishInCategory({
    isRestricted: Boolean(Number(category.is_restricted || 0) === 1),
    requiredBadgeId: category.required_badge_id,
    name: category.name,
  });
  if (gate && !gate.allowed) throw new HttpError(403, gate.reason || 'Publication non autorisée dans cette catégorie.');

  const publishedCount = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM products WHERE vendor_id = ? AND status = 'published'`)
    .get(ctx.userId) as { cnt: number };
  const moreGate = compliance?.canAddMoreProducts(
    Number(publishedCount.cnt || 0),
    restrictions.maxProductsUncertified
  );
  if (moreGate && !moreGate.allowed) {
    throw new HttpError(
      403,
      `Limite de ${restrictions.maxProductsUncertified} article(s) publié(s) pour les ateliers non certifiés. Obtenez une certification EMROD ou archivez une fiche.`
    );
  }

  if (restrictions.preModerationEnabled) return 'in_review';
  return 'published';
}

async function insertProductMedia(productId: string, media: Array<{ type: 'image' | 'video'; url: string; posterUrl?: string | null; altText: string; sortOrder: number }>): Promise<void> {
  for (const m of media) {
    await db.prepare(
      `INSERT INTO product_media (id, product_id, type, url, poster_url, alt_text, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(genId('pm'), productId, m.type, m.url, m.posterUrl || null, m.altText, m.sortOrder);
  }
}

vendorRouter.post(
  '/vendor/products',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const body = parseBody(productUpsertSchema, req);
    const finalStatus = await resolvePublicationStatus(body.status, ctx, body.categoryId);
    const slug = await slugifyUnique(body.name, 'products');
    const ts = now();
    const productId = genId('prd');

    await runInTransaction(async () => {
      await db.prepare(
        `INSERT INTO products (
           id, slug, vendor_id, category_id, name, description, materials, dimensions,
           weight_kg, price_gnf, compare_at_price_gnf, mode, status, removal_reason,
           stock_qty, is_unique_piece, keywords_json, delivery_config_json, featured,
           views_count, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 0, 0, ?, ?)`
      ).run(
        productId,
        slug,
        ctx.userId,
        body.categoryId,
        body.name,
        body.description,
        body.materials,
        body.dimensions,
        body.weightKg,
        body.mode === 'sur_devis' ? 0 : body.priceGnf,
        body.compareAtPriceGnf ?? null,
        body.mode,
        finalStatus,
        body.stockQty,
        body.isUniquePiece ? 1 : 0,
        JSON.stringify(body.keywords),
        JSON.stringify(body.deliveryConfig),
        ts,
        ts
      );
      await insertProductMedia(
        productId,
        body.media.map((m, idx) => ({ ...m, sortOrder: m.sortOrder ?? idx }))
      );
    });

    if (finalStatus === 'published') logAnalyticsEvent('product_published', productId);

    res.status(201).json({ id: productId, slug, status: finalStatus });
  })
);

vendorRouter.put(
  '/vendor/products/:id',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const productId = String(req.params.id);
    const existing = await db
      .prepare(`SELECT * FROM products WHERE id = ? AND vendor_id = ? AND status != 'removed'`)
      .get(productId, ctx.userId) as Record<string, unknown> | undefined;
    if (!existing) throw new HttpError(404, 'Produit introuvable.');

    const body = parseBody(productUpsertSchema, req);
    const finalStatus = await resolvePublicationStatus(body.status, ctx, body.categoryId);
    const ts = now();

    await runInTransaction(async () => {
      await db.prepare(
        `UPDATE products SET category_id = ?, name = ?, description = ?, materials = ?, dimensions = ?,
           weight_kg = ?, price_gnf = ?, compare_at_price_gnf = ?, mode = ?, status = ?,
           stock_qty = ?, is_unique_piece = ?, keywords_json = ?, delivery_config_json = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        body.categoryId,
        body.name,
        body.description,
        body.materials,
        body.dimensions,
        body.weightKg,
        body.mode === 'sur_devis' ? 0 : body.priceGnf,
        body.compareAtPriceGnf ?? null,
        body.mode,
        finalStatus,
        body.stockQty,
        body.isUniquePiece ? 1 : 0,
        JSON.stringify(body.keywords),
        JSON.stringify(body.deliveryConfig),
        ts,
        productId
      );
      await db.prepare(`DELETE FROM product_media WHERE product_id = ?`).run(productId);
      await insertProductMedia(
        productId,
        body.media.map((m, idx) => ({ ...m, sortOrder: m.sortOrder ?? idx }))
      );
    });

    if (finalStatus === 'published' && String(existing.status) !== 'published') {
      logAnalyticsEvent('product_published', productId);
    }

    res.json({ id: productId, status: finalStatus });
  })
);

/* POST /api/vendor/products/:id/duplicate — clone as draft */
vendorRouter.post(
  '/vendor/products/:id/duplicate',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const productId = String(req.params.id);
    const src = await db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug
         FROM products p JOIN categories c ON c.id = p.category_id
         WHERE p.id = ? AND p.vendor_id = ? AND p.status != 'removed'`
      )
      .get(productId, ctx.userId) as Record<string, unknown> | undefined;
    if (!src) throw new HttpError(404, 'Produit introuvable.');

    const hydrated = (await hydrateProducts([src]))[0];
    const newId = genId('prd');
    const newName = `${hydrated.name} (copie)`;
    const slug = await slugifyUnique(newName, 'products');
    const ts = now();

    await runInTransaction(async () => {
      await db.prepare(
        `INSERT INTO products (
           id, slug, vendor_id, category_id, name, description, materials, dimensions,
           weight_kg, price_gnf, compare_at_price_gnf, mode, status, removal_reason,
           stock_qty, is_unique_piece, keywords_json, delivery_config_json, featured,
           views_count, created_at, updated_at
         )
         SELECT ?, ?, vendor_id, category_id, ?, description, materials, dimensions,
           weight_kg, price_gnf, compare_at_price_gnf, mode, 'draft', '',
           stock_qty, is_unique_piece, keywords_json, delivery_config_json, 0,
           0, ?, ?
         FROM products WHERE id = ?`
      ).run(newId, slug, newName, ts, ts, productId);
      const media = await db
        .prepare(`SELECT type, url, poster_url, alt_text, sort_order FROM product_media WHERE product_id = ?`)
        .all(productId) as Array<Record<string, unknown>>;
      for (const m of media) {
        await db.prepare(
          `INSERT INTO product_media (id, product_id, type, url, poster_url, alt_text, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          genId('pm'),
          newId,
          String(m.type),
          String(m.url),
          (m.poster_url as string | null) || null,
          String(m.alt_text),
          Number(m.sort_order || 0)
        );
      }
    });

    res.status(201).json({ id: newId, status: 'draft' });
  })
);

/* PATCH /api/vendor/profile — shop identity + bank transfer settings */
vendorRouter.patch(
  '/vendor/profile',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const body = parseBody(vendorProfileUpdateSchema, req);
    const ts = now();

    const sets: string[] = [];
    const values: Array<string | number> = [];
    if (body.shopName !== undefined) {
      sets.push('shop_name = ?');
      values.push(body.shopName);
    }
    if (body.location !== undefined) {
      sets.push('location = ?');
      values.push(body.location);
    }
    if (body.description !== undefined) {
      sets.push('description = ?');
      values.push(body.description);
    }
    if (body.story !== undefined) {
      sets.push('story = ?');
      values.push(body.story);
    }
    if (body.responseTimeLabel !== undefined) {
      sets.push('response_time_label = ?');
      values.push(body.responseTimeLabel);
    }
    if (body.customFields !== undefined) {
      sets.push('custom_fields_json = ?');
      values.push(JSON.stringify(body.customFields));
    }
    if (body.bankTransferEnabled !== undefined) {
      sets.push('bank_transfer_enabled = ?');
      values.push(body.bankTransferEnabled ? 1 : 0);
    }
    for (const [field, column] of [
      ['bankName', 'bank_name'],
      ['bankAccountHolder', 'bank_account_holder'],
      ['bankIbanRib', 'bank_iban_rib'],
      ['bankSwiftBic', 'bank_swift_bic'],
      ['bankInstructions', 'bank_instructions'],
    ] as const) {
      if (body[field] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(body[field]);
      }
    }

    if (sets.length > 0) {
      await db.prepare(`UPDATE vendor_profiles SET ${sets.join(', ')} WHERE user_id = ?`).run(
        ...values,
        ctx.userId
      );
      await db.prepare(`UPDATE users SET updated_at = ? WHERE id = ?`).run(ts, ctx.userId);
    }

    res.json({ ok: true });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * Vendor order workflow — status machine + bank-transfer confirmation
 * ──────────────────────────────────────────────────────────────────────── */

async function orderRowForVendor(ctx: VendorContext, orderId: string): Promise<Record<string, unknown> & { id: string; status: string; order_number: string; buyer_email: string; buyer_name: string; payment_plan: string; balance_due_gnf: number; total_gnf: number; amount_paid_now_gnf: number }> {
  if (!(await vendorOwnsOrder(ctx.userId, orderId))) throw new HttpError(404, 'Commande introuvable.');
  const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as
    | (Record<string, unknown> & {
        id: string;
        status: string;
        order_number: string;
        buyer_email: string;
        buyer_name: string;
        payment_plan: string;
        balance_due_gnf: number;
        total_gnf: number;
        amount_paid_now_gnf: number;
      })
    | undefined;
  if (!order) throw new HttpError(404, 'Commande introuvable.');
  return order;
}

vendorRouter.patch(
  '/vendor/orders/:id/status',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const body = parseBody(vendorOrderStatusPatchSchema, req);
    const order = await orderRowForVendor(ctx, String(req.params.id));
    const next = body.status as OrderStatus;

    const guard = canVendorAdvanceOrder({
      status: order.status as OrderStatus,
      paymentPlan: order.payment_plan as import('../../src/shared/types').PaymentPlan,
      balanceDueGnf: Number(order.balance_due_gnf || 0),
      paymentStatus: null,
    });
    if (!guard.allowed) throw new HttpError(409, guard.reason || 'Transition non autorisée.');

    assertTransition(order.status as OrderStatus, next, 'vendor', body.comment);
    await insertOrderEvent(order.id, next, 'vendor', ctx.profile.shop_name, body.comment || '');

    if (next === 'Annulée') {
      // Restock every line and drop the pending payout projections
      const items = await db
        .prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`)
        .all(order.id) as Array<{ product_id: string; quantity: number }>;
      for (const it of items) {
        await db.prepare(`UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?`).run(it.quantity, it.product_id);
      }
      await db.prepare(`DELETE FROM payouts WHERE order_id = ? AND status != 'paid'`).run(order.id);
    }

    await db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`).run(next, now(), order.id);

    if (['Expédiée', 'En livraison', 'Livrée', 'Annulée'].includes(next)) {
      sendMail({
        to: order.buyer_email,
        subject: `Commande ${order.order_number} — ${next}`,
        text: `Bonjour ${order.buyer_name},\n\nLe statut de votre commande ${order.order_number} est : ${next}.\nSuivez-la depuis votre lien de suivi personnel EMROD.\n\nEMROD SARL · ${ctx.profile.shop_name}`,
        html: `<p>Bonjour ${order.buyer_name},</p><p>Le statut de votre commande <strong>${order.order_number}</strong> est : <strong>${next}</strong>.</p><p>Suivez-la depuis votre lien de suivi personnel EMROD.</p><p>EMROD SARL · ${ctx.profile.shop_name}</p>`,
      });
    }

    res.json({ status: next });
  })
);

/* PATCH /api/vendor/orders/:id/confirm-bank-transfer — virement reçu en banque */
vendorRouter.patch(
  '/vendor/orders/:id/confirm-bank-transfer',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const order = await orderRowForVendor(ctx, String(req.params.id));

    if (order.payment_plan !== 'bank_transfer') {
      throw new HttpError(400, 'Cette commande n’est pas réglée par virement bancaire.');
    }
    if (Number(order.balance_due_gnf || 0) <= 0) {
      throw new HttpError(409, 'Le virement de cette commande a déjà été confirmé.');
    }

    const ts = now();
    const paymentId = genId('pay');
    const reference = `VIR-${order.order_number.replace(/[^A-Z0-9]/gi, '').slice(-10)}-${Date.now().toString(36).toUpperCase()}`;
    await db.prepare(
      `INSERT INTO payments (id, order_id, djomy_reference, type, method, operator, amount_gnf, status, merchant_payment_reference, created_at, updated_at)
       VALUES (?, ?, ?, 'payment', 'bank_transfer', 'Virement bancaire', ?, 'pending', ?, ?, ?)`
    ).run(paymentId, order.id, reference, Number(order.balance_due_gnf), reference, ts, ts);

    await db.prepare(
      `UPDATE orders SET amount_paid_now_gnf = ?, balance_due_gnf = 0, updated_at = ? WHERE id = ?`
    ).run(Number(order.total_gnf), ts, order.id);

    await settlePaymentRow({ id: paymentId }, 'vendor_bank_transfer_confirm');

    let finalStatus = order.status;
    const target: OrderStatus = 'Confirmée';
    if (canTransitionOrderStatus(order.status as OrderStatus, target, 'vendor')) {
      await insertOrderEvent(order.id, target, 'vendor', ctx.profile.shop_name, 'Virement bancaire reçu et confirmé par l’atelier.');
      await db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`).run(target, now(), order.id);
      finalStatus = target;
    }

    sendMail({
      to: order.buyer_email,
      subject: `Virement confirmé — commande ${order.order_number}`,
      text: `Bonjour ${order.buyer_name},\n\nL'atelier a confirmé la réception de votre virement (${formatGNF(Number(order.total_gnf))}). La fabrication de la commande ${order.order_number} démarre.\n\nEMROD SARL · ${ctx.profile.shop_name}`,
      html: `<p>Bonjour ${order.buyer_name},</p><p>L'atelier a confirmé la réception de votre virement (<strong>${formatGNF(Number(order.total_gnf))}</strong>). La fabrication de la commande <strong>${order.order_number}</strong> démarre.</p><p>EMROD SARL · ${ctx.profile.shop_name}</p>`,
    });

    res.json({ status: finalStatus, paymentId, reference });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * Quote workflow — step progression + Djomy payment link
 * ──────────────────────────────────────────────────────────────────────── */

async function quoteRowForVendor(ctx: VendorContext, quoteId: string): Promise<Record<string, unknown> & { id: string; step_status: string; buyer_email: string; buyer_name: string; buyer_phone: string; payment_link_url: string | null; djomy_reference: string | null }> {
  const quote = await db
    .prepare(`SELECT * FROM quote_requests WHERE id = ? AND vendor_id = ?`)
    .get(quoteId, ctx.userId) as
    | (Record<string, unknown> & {
        id: string;
        step_status: string;
        buyer_email: string;
        buyer_name: string;
        buyer_phone: string;
        payment_link_url: string | null;
        djomy_reference: string | null;
      })
    | undefined;
  if (!quote) throw new HttpError(404, 'Devis introuvable.');
  return quote;
}

vendorRouter.patch(
  '/vendor/quotes/:id/step',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const body = parseBody(quoteStepPatchSchema, req);
    const quote = await quoteRowForVendor(ctx, String(req.params.id));
    await db.prepare(`UPDATE quote_requests SET step_status = ?, updated_at = ? WHERE id = ?`).run(
      body.stepStatus,
      now(),
      quote.id
    );
    res.json({ ok: true, stepStatus: body.stepStatus });
  })
);

vendorRouter.post(
  '/vendor/quotes/:id/send-link',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const body = parseBody(quoteSendLinkSchema, req);
    const quote = await quoteRowForVendor(ctx, String(req.params.id));

    if (quote.step_status === 'paid') {
      throw new HttpError(409, 'Ce devis est déjà réglé — aucune modification possible.');
    }

    const ts = now();
    const reference = `QTL-${String(quote.id).replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    const base = process.env.APP_URL?.replace(/\/$/, '') || '';
    const link = await paymentProvider.createPaymentLink({
      title: `Devis sur mesure EMROD — ${ctx.profile.shop_name}`,
      description: 'Règlement de votre devis validé sur la marketplace EMROD.',
      amountGnf: body.amountGnf,
      buyerEmail: quote.buyer_email,
      buyerPhone: quote.buyer_phone || undefined,
      reference,
      returnUrl: `${base}/paiement/${encodeURIComponent(reference)}`,
      cancelUrl: `${base}/catalogue`,
      metadata: { quoteId: String(quote.id), vendorSlug: String(ctx.profile.slug) },
    });

    await db.prepare(
      `UPDATE quote_requests SET step_status = 'quoted', quoted_amount_gnf = ?, payment_link_url = ?, djomy_reference = ?, updated_at = ? WHERE id = ?`
    ).run(body.amountGnf, link.url, link.djomyReference, ts, quote.id);

    // Payment row for reconciliation (settlement happens via verify/webhook)
    const existingPayment = await db
      .prepare(`SELECT id FROM payments WHERE quote_id = ? AND status = 'pending' LIMIT 1`)
      .get(quote.id) as { id: string } | undefined;
    if (!existingPayment) {
      await db.prepare(
        `INSERT INTO payments (id, quote_id, djomy_reference, type, method, operator, amount_gnf, status, created_at, updated_at)
         VALUES (?, ?, ?, 'payment_link', 'link', 'Djomy', ?, 'pending', ?, ?)`
      ).run(genId('pay'), quote.id, link.djomyReference, body.amountGnf, ts, ts);
    } else {
      await db.prepare(`UPDATE payments SET djomy_reference = ?, amount_gnf = ?, updated_at = ? WHERE id = ?`).run(
        link.djomyReference,
        body.amountGnf,
        ts,
        existingPayment.id
      );
    }

    sendMail({
      to: quote.buyer_email,
      subject: 'Votre devis EMROD est prêt — règlement sécurisé Djomy',
      text: `Bonjour ${quote.buyer_name},\n\nVotre devis (${formatGNF(body.amountGnf)}) est disponible. Réglez en toute sécurité via le lien officiel Djomy :\n${link.url}\n\nSuivez votre projet depuis votre lien de suivi EMROD.\nEMROD SARL · ${ctx.profile.shop_name}`,
      html: `<p>Bonjour ${quote.buyer_name},</p><p>Votre devis (<strong>${formatGNF(body.amountGnf)}</strong>) est disponible. Réglez via le lien officiel Djomy :</p><p><a href="${link.url}">${link.url}</a></p><p>EMROD SARL · ${ctx.profile.shop_name}</p>`,
    });

    res.json({ paymentLinkUrl: link.url, djomyReference: link.djomyReference });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * Reviews replies + conversation messaging
 * ──────────────────────────────────────────────────────────────────────── */

vendorRouter.post(
  '/vendor/reviews/:id/reply',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const body = parseBody(reviewReplySchema, req);
    const review = await db
      .prepare(`SELECT id FROM reviews WHERE id = ? AND vendor_id = ?`)
      .get(String(req.params.id), ctx.userId) as { id: string } | undefined;
    if (!review) throw new HttpError(404, 'Avis introuvable.');

    await db.prepare(`UPDATE reviews SET vendor_reply = ?, vendor_replied_at = ? WHERE id = ?`).run(
      body.reply,
      now(),
      review.id
    );
    res.json({ ok: true });
  })
);

vendorRouter.post(
  '/vendor/conversations/:id/messages',
  requireAuth(['vendor', 'admin']),
  wrap(async (req: AuthenticatedRequest, res) => {
    const ctx = await loadVendorContext(req);
    const body = parseBody(messageSubmitSchema, req);
    const conv = await db
      .prepare(`SELECT id, type, buyer_email, buyer_name FROM conversations WHERE id = ? AND vendor_id = ?`)
      .get(String(req.params.id), ctx.userId) as
      | { id: string; type: string; buyer_email: string; buyer_name: string }
      | undefined;
    if (!conv) throw new HttpError(404, 'Conversation introuvable.');

    const restrictions = await getCommercialRestrictions();
    if (!restrictions.allowExternalContactsInMessages) {
      const check = detectExternalContactAttempt(body.content);
      if (check.blocked) throw new HttpError(400, check.reason || 'Message non conforme aux règles EMROD.');
    }

    const msgId = genId('msg');
    await db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_role, sender_name, content, is_public, is_flagged, status, created_at)
       VALUES (?, ?, 'vendor', ?, ?, 1, 0, 'visible', ?)`
    ).run(msgId, conv.id, ctx.profile.shop_name, body.content, now());

    if (conv.buyer_email) {
      sendMail({
        to: conv.buyer_email,
        subject: `Nouvelle réponse de ${ctx.profile.shop_name} — EMROD`,
        text: `Bonjour ${conv.buyer_name},\n\n${ctx.profile.shop_name} vous a répondu sur EMROD :\n${body.content}\n\nRetrouvez la conversation complète depuis votre page de suivi.`,
        html: `<p>Bonjour ${conv.buyer_name},</p><p><strong>${ctx.profile.shop_name}</strong> vous a répondu sur EMROD :</p><blockquote>${body.content}</blockquote><p>Retrouvez la conversation complète depuis votre page de suivi.</p>`,
      });
    }

    res.status(201).json({ id: msgId, ok: true });
  })
);
