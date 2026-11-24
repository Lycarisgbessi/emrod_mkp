import { Router } from 'express';
import { z } from 'zod';
import { quoteRequestSchema, messageSubmitSchema } from '../../src/shared/schemas';
import { detectExternalContactAttempt, formatGNF } from '../../src/shared/domain';
import type { VendorPublicSummary } from '../../src/shared/types';
import { db, runInTransaction } from '../db';
import { paymentProvider } from '../djomy';
import { generateTrackingToken, hashTrackingToken } from '../auth';
import { getCommercialRestrictions, getVendorPublicSummaries, hydrateProducts } from '../queries';
import { sendMail, trackingUrl } from '../mailer';
import {
  HttpError,
  applyPaymentSuccess,
  genId,
  now,
  parseBody,
  wrap,
} from './_helpers';

export const quotesRouter = Router();

/* ─────────────────────────────────────────────────────────────────────────
 * POST /api/quotes — custom piece request (guest, no payment yet)
 * ──────────────────────────────────────────────────────────────────────── */

quotesRouter.post(
  '/quotes',
  wrap(async (req, res) => {
    const body = parseBody(quoteRequestSchema, req);

    const row = await db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug
         FROM products p
         JOIN categories c ON c.id = p.category_id
         JOIN users u ON u.id = p.vendor_id
         WHERE p.id = ? AND p.status = 'published' AND u.status = 'validated'`
      )
      .get(body.productId) as Record<string, unknown> | undefined;
    const products = row ? await hydrateProducts([row]) : [];
    const product = products[0];
    if (!product) throw new HttpError(404, 'Produit introuvable ou indisponible.');

    const tracking = generateTrackingToken();
    const quoteId = genId('qt');
    const ts = now();

    await db.prepare(
      `INSERT INTO quote_requests (
         id, product_id, vendor_id, buyer_name, buyer_email, buyer_phone,
         preferred_material, dimensions_notes, project_notes, step_status,
         quantity, desired_zone_id, tracking_token_hash, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'material', ?, ?, ?, ?, ?)`
    ).run(
      quoteId,
      product.id,
      product.vendorId,
      body.buyerName,
      body.buyerEmail,
      body.buyerPhone,
      body.preferredMaterial,
      body.dimensionsNotes,
      body.projectNotes,
      body.quantity ?? 1,
      body.desiredZoneId || 'ratoma-sonfonia',
      tracking.tokenHash,
      ts,
      ts
    );

    const vendorUser = await db.prepare(`SELECT email FROM users WHERE id = ?`).get(product.vendorId) as
      | { email: string }
      | undefined;
    if (vendorUser) {
      sendMail({
        to: vendorUser.email,
        subject: `Nouvelle demande sur mesure — ${product.name}`,
        text: `${body.buyerName} (${body.buyerEmail}, ${body.buyerPhone}) souhaite une pièce sur mesure :\nMatériau : ${body.preferredMaterial}\nDimensions : ${body.dimensionsNotes}\nProjet : ${body.projectNotes}\nQuantité : ${body.quantity ?? 1}\nRépondez avec un devis depuis votre portail vendeur.`,
        html: `<p><strong>${body.buyerName}</strong> (${body.buyerEmail}, ${body.buyerPhone}) souhaite une pièce sur mesure :</p><ul><li>Matériau : ${body.preferredMaterial}</li><li>Dimensions : ${body.dimensionsNotes}</li><li>Projet : ${body.projectNotes}</li><li>Quantité : ${body.quantity ?? 1}</li></ul><p>Répondez avec un devis depuis votre portail vendeur.</p>`,
      });
    }
    sendMail({
      to: body.buyerEmail,
      subject: `Demande sur mesure reçue — ${product.name} · EMROD`,
      text: `Bonjour ${body.buyerName},\n\nVotre demande sur mesure pour « ${product.name} » a été transmise à l'atelier ${product.vendor.shopName}.\nSuivez l'avancement du devis : ${trackingUrl(tracking.rawToken)}\n\nEMROD SARL`,
      html: `<p>Bonjour ${body.buyerName},</p><p>Votre demande sur mesure pour « <strong>${product.name}</strong> » a été transmise à l'atelier <strong>${product.vendor.shopName}</strong>. Réponse sous ${product.vendor.responseTimeLabel.toLowerCase()}.</p><p>Suivi du devis : <a href="${trackingUrl(tracking.rawToken)}">${trackingUrl(tracking.rawToken)}</a></p>`,
    });

    res.status(201).json({
      ok: true,
      id: quoteId,
      trackingToken: tracking.rawToken,
      message: `Demande transmise à l'atelier ${product.vendor.shopName}. Conservez votre jeton de suivi — vous pourrez échanger avec l'atelier directement sur EMROD.`,
    });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * Quote resolution helpers — `ref` may be a quote id OR a Djomy reference
 * ──────────────────────────────────────────────────────────────────────── */

interface QuoteRow {
  id: string;
  product_id: string;
  vendor_id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  preferred_material: string;
  dimensions_notes: string;
  project_notes: string;
  step_status: string;
  quoted_amount_gnf: number | null;
  payment_link_url: string | null;
  djomy_reference: string | null;
  quantity: number;
  desired_zone_id: string;
  created_at: string;
  updated_at: string;
}

async function resolveQuote(ref: string): Promise<QuoteRow> {
  const clean = String(ref || '').trim();
  let quote = await db.prepare(`SELECT * FROM quote_requests WHERE id = ?`).get(clean) as QuoteRow | undefined;
  if (!quote && clean) {
    quote = await db
      .prepare(`SELECT * FROM quote_requests WHERE djomy_reference = ?`)
      .get(clean) as QuoteRow | undefined;
  }
  if (!quote && clean) {
    const viaPayment = await db
      .prepare(`SELECT quote_id FROM payments WHERE djomy_reference = ? AND quote_id IS NOT NULL LIMIT 1`)
      .get(clean) as { quote_id: string } | undefined;
    if (viaPayment) {
      quote = await db.prepare(`SELECT * FROM quote_requests WHERE id = ?`).get(viaPayment.quote_id) as
        | QuoteRow
        | undefined;
    }
  }
  if (!quote) throw new HttpError(404, 'Devis introuvable.');
  return quote;
}

async function latestQuotePayment(quoteId: string): Promise<Record<string, unknown> | null> {
  return (
    (await db
      .prepare(
        `SELECT * FROM payments WHERE quote_id = ? AND type != 'refund'
         ORDER BY created_at DESC, id DESC LIMIT 1`
      )
      .get(quoteId) as Record<string, unknown> | undefined) || null
  );
}

async function quoteOrderInfo(quoteId: string): Promise<{ orderId: string; orderNumber: string } | null> {
  const row = await db
    .prepare(
      `SELECT o.id, o.order_number FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE p.quote_id = ? AND p.status = 'succeeded' LIMIT 1`
    )
    .get(quoteId) as { id: string; order_number: string } | undefined;
  return row ? { orderId: row.id, orderNumber: row.order_number } : null;
}

/**
 * Converts a paid quote into a real guest order (idempotent — returns the
 * existing order when the quote was already converted).
 */
export async function convertQuoteToOrder(quoteId: string): Promise<{
  orderId: string;
  orderNumber: string;
  trackingToken: string | null;
}> {
  const quote = await db.prepare(`SELECT * FROM quote_requests WHERE id = ?`).get(quoteId) as
    | QuoteRow
    | undefined;
  if (!quote) throw new HttpError(404, 'Devis introuvable pour conversion.');

  const existing = await quoteOrderInfo(quoteId);
  if (existing) return { orderId: existing.orderId, orderNumber: existing.orderNumber, trackingToken: null };

  const tracking = generateTrackingToken();
  const amount = Math.max(0, Number(quote.quoted_amount_gnf || 0));
  const orderId = genId('ord');
  const orderNumber = `EMR-Q-${quote.id.replace(/\D/g, '').slice(-6) || Date.now().toString().slice(-6)}`;
  const ts = now();

  const product = await db
    .prepare(`SELECT name, slug, vendor_id FROM products WHERE id = ?`)
    .get(quote.product_id) as { name: string; slug: string; vendor_id: string } | undefined;
  const vendorId = String(quote.vendor_id || product?.vendor_id || '');

  // Unique order number (collision-safe loop)
  let finalOrderNumber = orderNumber;
  let suffix = 2;
  while (await db.prepare(`SELECT 1 FROM orders WHERE order_number = ?`).get(finalOrderNumber)) {
    finalOrderNumber = `${orderNumber}-${suffix}`;
    suffix += 1;
  }

  await runInTransaction(async () => {
    await db.prepare(
      `INSERT INTO orders (
         id, order_number, idempotency_key, buyer_name, buyer_email, buyer_phone,
         delivery_zone_id, delivery_zone_name, delivery_address, delivery_landmark,
         subtotal_gnf, delivery_fee_gnf, total_gnf, status, tracking_token_hash,
         tracking_token_expires_at, notifications_enabled, payment_mode, payment_plan,
         deposit_percent, amount_paid_now_gnf, balance_due_gnf, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'Commandée', ?, ?, 1, 'redirect', 'full', 100, 0, ?, ?, ?)`
    ).run(
      orderId,
      finalOrderNumber,
      `quote_${quote.id}`,
      quote.buyer_name,
      quote.buyer_email,
      quote.buyer_phone,
      quote.desired_zone_id || 'ratoma-sonfonia',
      'Sur mesure',
      `Pièce sur mesure — ${quote.dimensions_notes}`,
      quote.preferred_material,
      amount,
      amount,
      tracking.tokenHash,
      new Date(Date.now() + 12 * 30 * 24 * 60 * 60 * 1000).toISOString(),
      amount,
      ts,
      ts
    );
    await db.prepare(
      `INSERT INTO order_items (
         id, order_id, product_id, vendor_id, product_name, product_slug,
         product_image, quantity, unit_price_gnf, delivery_fee_gnf
       ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 0)`
    ).run(
      genId('oi'),
      orderId,
      quote.product_id,
      vendorId,
      product?.name || 'Pièce sur mesure',
      product?.slug || '',
      quote.quantity || 1,
      amount
    );
    await db.prepare(
      `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at)
       VALUES (?, ?, 'Commandée', 'system', 'Devis EMROD', 'Devis validé et réglé via Djomy — fabrication lancée.', ?)`
    ).run(genId('oe'), orderId, ts);
    await db.prepare(
      `UPDATE quote_requests SET step_status = 'paid', updated_at = ? WHERE id = ?`
    ).run(ts, quote.id);
  });

  return { orderId, orderNumber: finalOrderNumber, trackingToken: tracking.rawToken };
}

/* ─────────────────────────────────────────────────────────────────────────
 * GET /api/quotes/track/:token — guest quote tracking page payload
 * ──────────────────────────────────────────────────────────────────────── */

quotesRouter.get(
  '/quotes/track/:token',
  wrap(async (req, res) => {
    const tokenHash = hashTrackingToken(String(req.params.token || '').trim());
    const quote = await db
      .prepare(`SELECT * FROM quote_requests WHERE tracking_token_hash = ?`)
      .get(tokenHash) as QuoteRow | undefined;
    if (!quote) throw new HttpError(404, 'Lien de suivi de devis introuvable.');

    const vendorSummary = (await getVendorPublicSummaries([quote.vendor_id])).get(quote.vendor_id) as
      | VendorPublicSummary
      | undefined;

    const convId = await ensureQuoteConversation(quote);
    const messages = await db
      .prepare(
        `SELECT id, sender_role, sender_name, content, created_at FROM messages
         WHERE conversation_id = ? AND status = 'visible' ORDER BY created_at ASC, id ASC`
      )
      .all(convId) as Array<Record<string, unknown>>;

    const orderInfo = await quoteOrderInfo(quote.id);
    const orderStatus = orderInfo
      ? (await db.prepare(`SELECT status FROM orders WHERE id = ?`).get(orderInfo.orderId) as
          | { status: string }
          | undefined)?.status || null
      : null;

    const restrictions = await getCommercialRestrictions();

    res.json({
      quote: {
        id: quote.id,
        productId: quote.product_id,
        productName: await productNameOf(quote.product_id),
        productSlug: await productSlugOf(quote.product_id),
        buyerName: quote.buyer_name,
        buyerEmail: quote.buyer_email,
        preferredMaterial: quote.preferred_material,
        dimensionsNotes: quote.dimensions_notes,
        projectNotes: quote.project_notes,
        quantity: quote.quantity,
        desiredZoneId: quote.desired_zone_id,
        stepStatus: quote.step_status,
        quotedAmountGnf: quote.quoted_amount_gnf,
        paymentLinkUrl: quote.payment_link_url,
        djomyReference: quote.djomy_reference,
        orderNumber: orderInfo?.orderNumber || null,
        orderStatus,
        createdAt: quote.created_at,
        updatedAt: quote.updated_at,
      },
      vendor: vendorSummary || null,
      messages: messages.map((m) => ({
        id: String(m.id),
        sender_role: String(m.sender_role),
        sender_name: String(m.sender_name),
        content: String(m.content),
        created_at: String(m.created_at),
      })),
      restrictions: { allowExternalContactsInMessages: restrictions.allowExternalContactsInMessages },
    });
  })
);

async function productNameOf(productId: string): Promise<string> {
  const row = await db.prepare(`SELECT name FROM products WHERE id = ?`).get(productId) as
    | { name: string }
    | undefined;
  return row?.name || 'Pièce sur mesure';
}

async function productSlugOf(productId: string): Promise<string> {
  const row = await db.prepare(`SELECT slug FROM products WHERE id = ?`).get(productId) as
    | { slug: string }
    | undefined;
  return row?.slug || '';
}

async function ensureQuoteConversation(quote: QuoteRow): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM conversations WHERE type = 'quote' AND quote_id = ? LIMIT 1`)
    .get(quote.id) as { id: string } | undefined;
  if (existing) return existing.id;
  const convId = genId('conv');
  await db.prepare(
    `INSERT INTO conversations (id, type, quote_id, vendor_id, buyer_name, buyer_email, created_at)
     VALUES (?, 'quote', ?, ?, ?, ?, ?)`
  ).run(convId, quote.id, quote.vendor_id, quote.buyer_name, quote.buyer_email, now());
  return convId;
}

/* POST /api/quotes/track/:token/messages — buyer ↔ vendor quote chat */
quotesRouter.post(
  '/quotes/track/:token/messages',
  wrap(async (req, res) => {
    const tokenHash = hashTrackingToken(String(req.params.token || '').trim());
    const quote = await db
      .prepare(`SELECT * FROM quote_requests WHERE tracking_token_hash = ?`)
      .get(tokenHash) as QuoteRow | undefined;
    if (!quote) throw new HttpError(404, 'Lien de suivi de devis introuvable.');

    const body = parseBody(messageSubmitSchema, req);
    const restrictions = await getCommercialRestrictions();
    if (!restrictions.allowExternalContactsInMessages) {
      const check = detectExternalContactAttempt(body.content);
      if (check.blocked) throw new HttpError(400, check.reason || 'Message non conforme aux règles EMROD.');
    }

    const convId = await ensureQuoteConversation(quote);
    const msgId = genId('msg');
    const ts = now();
    await db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_role, sender_name, content, is_public, created_at)
       VALUES (?, ?, 'buyer', ?, ?, 1, ?)`
    ).run(msgId, convId, quote.buyer_name, body.content, ts);

    const vendorUser = await db.prepare(`SELECT email FROM users WHERE id = ?`).get(quote.vendor_id) as
      | { email: string }
      | undefined;
    if (vendorUser) {
      sendMail({
        to: vendorUser.email,
        subject: `Nouveau message — devis sur mesure`,
        text: `${quote.buyer_name} : ${body.content}\nRépondez depuis votre portail vendeur.`,
        html: `<p><strong>${quote.buyer_name}</strong> : ${body.content}</p><p>Répondez depuis votre portail vendeur.</p>`,
      });
    }
    res.status(201).json({ id: msgId, sender_role: 'buyer', sender_name: quote.buyer_name, content: body.content, created_at: ts });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * GET /api/quotes/:ref — public payment-link page payload (flat snake_case)
 * ──────────────────────────────────────────────────────────────────────── */

quotesRouter.get(
  '/quotes/:ref',
  wrap(async (req, res) => {
    const quote = await resolveQuote(req.params.ref);
    const orderInfo = await quoteOrderInfo(quote.id);
    res.json({
      quote: {
        id: quote.id,
        step_status: quote.step_status,
        order_number: orderInfo?.orderNumber || null,
        payment_link_url: quote.payment_link_url,
        djomy_reference: quote.djomy_reference,
        product_name: await productNameOf(quote.product_id),
        shop_name: (await getVendorPublicSummaries([quote.vendor_id])).get(quote.vendor_id)?.shopName || 'Atelier EMROD',
        buyer_name: quote.buyer_name,
        buyer_email: quote.buyer_email,
        preferred_material: quote.preferred_material,
        dimensions_notes: quote.dimensions_notes,
        quoted_amount_gnf: quote.quoted_amount_gnf,
      },
    });
  })
);

/* POST /api/quotes/:ref/verify-djomy — poll the Djomy link status */
quotesRouter.post(
  '/quotes/:ref/verify-djomy',
  wrap(async (req, res) => {
    const quote = await resolveQuote(req.params.ref);
    const orderInfo = await quoteOrderInfo(quote.id);
    if (orderInfo || quote.step_status === 'paid') {
      res.json({ paid: true, status: 'succeeded', orderNumber: orderInfo?.orderNumber || null });
      return;
    }

    const payment = await latestQuotePayment(quote.id);
    if (!payment || !quote.djomy_reference) {
      res.json({ paid: false, status: 'no_link' });
      return;
    }
    if (String(payment.status) === 'succeeded') {
      // orderInfo is provably null here (early return above), so no order exists yet
      res.json({ paid: true, status: 'succeeded', orderNumber: null });
      return;
    }

    const isLink = String(payment.type) === 'payment_link';
    const statusResult = isLink
      ? await paymentProvider.getPaymentLinkStatus(quote.djomy_reference)
      : await paymentProvider.getPaymentStatus(quote.djomy_reference);

    const paid = isLink
      ? (statusResult as { status: string }).status === 'PAID' ||
        Boolean((statusResult as { paid?: boolean }).paid)
      : (statusResult as { status: string }).status === 'succeeded';

    if (paid) {
      const settled = await settleQuotePayment(String(payment.id), 'quote_link_verify');
      res.json({ paid: true, status: 'succeeded', orderNumber: settled.orderNumber });
      return;
    }
    res.json({
      paid: false,
      status: isLink ? (statusResult as { status: string }).status : (statusResult as { rawStatus?: string; status: string }).rawStatus || 'PENDING',
    });
  })
);

/* POST /api/quotes/:ref/pay — sandbox direct settlement (link-less fallback) */
quotesRouter.post(
  '/quotes/:ref/pay',
  wrap(async (req, res) => {
    const quote = await resolveQuote(req.params.ref);
    if (quote.step_status === 'paid') {
      const existing = await quoteOrderInfo(quote.id);
      res.json({ ok: true, status: 'succeeded', orderId: existing?.orderId, orderNumber: existing?.orderNumber });
      return;
    }
    if (!quote.quoted_amount_gnf || quote.quoted_amount_gnf <= 0) {
      throw new HttpError(400, 'Aucun montant validé sur ce devis — demandez le devis à l’atelier.');
    }
    // Security: in LIVE mode the buyer must pay through the official Djomy link
    if (paymentProvider.getDiagnostics().mode !== 'sandbox_simulator' && !quote.payment_link_url) {
      throw new HttpError(400, 'Réglez via le lien Djomy officiel transmis par l’atelier.');
    }

    // Ensure a payment row exists (idempotent)
    let payment = await latestQuotePayment(quote.id);
    if (!payment) {
      const payId = genId('pay');
      const ts = now();
      const ref = quote.djomy_reference || `QTLINK-${quote.id.slice(-8).toUpperCase()}`;
      await db.prepare(
        `INSERT INTO payments (id, quote_id, djomy_reference, type, method, operator, amount_gnf, status, created_at, updated_at)
         VALUES (?, ?, ?, 'payment_link', 'link', 'Djomy', ?, 'pending', ?, ?)`
      ).run(payId, quote.id, ref, quote.quoted_amount_gnf, ts, ts);
      await db.prepare(`UPDATE quote_requests SET djomy_reference = ?, updated_at = ? WHERE id = ?`).run(
        ref,
        ts,
        quote.id
      );
      payment = await latestQuotePayment(quote.id);
    }

    const settled = await settleQuotePayment(String(payment!.id), 'quote_link_direct');
    res.json({
      ok: true,
      status: 'succeeded',
      orderId: settled.orderId,
      orderNumber: settled.orderNumber,
      trackingToken: settled.trackingToken || undefined,
    });
  })
);

/**
 * Shared settlement for a quote payment: converts the quote into an order,
 * applies the standard payment-success pipeline (payouts, commissions, stock,
 * analytics) and notifies the buyer. Idempotent per payment row.
 */
export async function settleQuotePayment(
  paymentId: string,
  source: string
): Promise<{ orderId: string; orderNumber: string; trackingToken: string | null }> {
  const payment = await db.prepare(`SELECT * FROM payments WHERE id = ?`).get(paymentId) as
    | (Record<string, unknown> & { id: string; quote_id: string; status: string })
    | undefined;
  if (!payment || !payment.quote_id) throw new HttpError(404, 'Paiement introuvable.');

  const alreadyOrder = await quoteOrderInfo(String(payment.quote_id));
  if (alreadyOrder && payment.status === 'succeeded') {
    return { orderId: alreadyOrder.orderId, orderNumber: alreadyOrder.orderNumber, trackingToken: null };
  }

  const converted = await convertQuoteToOrder(String(payment.quote_id));
  const amount = Number(payment.amount_gnf) || 0;

  await db.prepare(
    `UPDATE payments SET status = 'succeeded', order_id = ?, updated_at = ? WHERE id = ?`
  ).run(converted.orderId, now(), payment.id);

  await applyPaymentSuccess({
    orderId: converted.orderId,
    paymentId: payment.id,
    paidAmountGnf: amount,
    source,
  });

  const order = await db
    .prepare(`SELECT buyer_email, buyer_name, order_number FROM orders WHERE id = ?`)
    .get(converted.orderId) as { buyer_email: string; buyer_name: string; order_number: string };
  sendMail({
    to: order.buyer_email,
    subject: `Commande ${order.order_number} confirmée — projet sur mesure · EMROD`,
    text: `Bonjour ${order.buyer_name},\n\nVotre devis est réglé (${formatGNF(amount)}). La commande ${order.order_number} est confirmée et l'atelier démarre la fabrication.\n${converted.trackingToken ? `Suivi : ${trackingUrl(converted.trackingToken)}\n` : ''}\nEMROD SARL`,
    html: `<p>Bonjour ${order.buyer_name},</p><p>Votre devis est réglé (<strong>${formatGNF(amount)}</strong>). La commande <strong>${order.order_number}</strong> est confirmée et l'atelier démarre la fabrication.</p>${converted.trackingToken ? `<p>Suivi : <a href="${trackingUrl(converted.trackingToken)}">${trackingUrl(converted.trackingToken)}</a></p>` : ''}<p>EMROD SARL</p>`,
  });

  return {
    orderId: converted.orderId,
    orderNumber: converted.orderNumber,
    trackingToken: converted.trackingToken,
  };
}
