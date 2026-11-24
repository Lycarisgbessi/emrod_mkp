import { Router } from 'express';
import { z } from 'zod';
import {
  guestCheckoutSchema,
  reviewSubmitSchema,
  messageSubmitSchema,
} from '../../src/shared/schemas';
import {
  calculateDeliveryFee,
  calculatePaymentPlanAmounts,
  canTransitionOrderStatus,
  detectExternalContactAttempt,
  isBankTransferEligible,
  formatGNF,
} from '../../src/shared/domain';
import type { CartDeliveryCalculationItem } from '../../src/shared/domain';
import type { OrderStatus, PaymentPlan, VendorBankDetails } from '../../src/shared/types';
import { db, runInTransaction } from '../db';
import { paymentProvider } from '../djomy';
import { generateTrackingToken, hashTrackingToken } from '../auth';
import {
  getCommercialRestrictions,
  getDeliveryZones,
  getVendorPublicSummaries,
  hydrateProducts,
} from '../queries';
import { sendMail, trackingUrl } from '../mailer';
import {
  HttpError,
  applyOrderRefund,
  genId,
  getMaintenance,
  isBlacklistedGuest,
  logAnalyticsEvent,
  nextOrderNumber,
  now,
  parseBody,
  wrap,
} from './_helpers';
import { markPaymentFailed, settlePaymentRow } from './payments';

export const ordersRouter = Router();

/* ─────────────────────────────────────────────────────────────────────────
 * POST /api/checkout — guest checkout (no account), Djomy or bank transfer
 * ──────────────────────────────────────────────────────────────────────── */

ordersRouter.post(
  '/checkout',
  wrap(async (req, res) => {
    const maintenance = await getMaintenance();
    if (maintenance.enabled) {
      throw new HttpError(503, `Commandes suspendues : ${maintenance.message}`);
    }

    const body = parseBody(guestCheckoutSchema, req);
    if (await isBlacklistedGuest(body.buyerEmail, body.buyerPhone)) {
      throw new HttpError(403, 'Commande refusée : cette identité est bloquée sur la plateforme.');
    }
    logAnalyticsEvent('checkout_start');

    // Idempotency: same form submitted twice → recover the existing order
    const existing = await db
      .prepare(
        `SELECT id, order_number, payment_plan, total_gnf, deposit_percent, amount_paid_now_gnf,
                balance_due_gnf, payment_mode, status, tracking_token_hash, tracking_token_expires_at
         FROM orders WHERE idempotency_key = ?`
      )
      .get(body.idempotencyKey) as
      | {
          id: string;
          order_number: string;
          payment_plan: string;
          total_gnf: number;
          deposit_percent: number;
          amount_paid_now_gnf: number;
          balance_due_gnf: number;
          payment_mode: string;
          status: string;
          tracking_token_hash: string;
          tracking_token_expires_at: string;
        }
      | undefined;

    if (existing) {
      const paidPayment = await db
        .prepare(
          `SELECT id FROM payments WHERE order_id = ? AND status = 'succeeded' LIMIT 1`
        )
        .get(existing.id);
      if (paidPayment) {
        throw new HttpError(
          409,
          `Commande ${existing.order_number} déjà enregistrée et payée — consultez votre courriel.`
        );
      }
      // Unpaid duplicate: rotate the tracking link so the retry gets a working token
      const rotated = generateTrackingToken();
      const restrictions = await getCommercialRestrictions();
      const expires = new Date(
        Date.now() + restrictions.trackingTokenValidityMonths * 30 * 24 * 60 * 60 * 1000
      ).toISOString();
      await db.prepare(
        `UPDATE orders SET tracking_token_hash = ?, tracking_token_expires_at = ?, updated_at = ? WHERE id = ?`
      ).run(rotated.tokenHash, expires, now(), existing.id);
      const payment = await db
        .prepare(
          `SELECT djomy_reference, payment_url, otp_required FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(existing.id) as
        | { djomy_reference: string; payment_url: string | null; otp_required: number }
        | undefined;
      res.json({
        orderNumber: existing.order_number,
        trackingToken: rotated.rawToken,
        djomyReference: payment?.djomy_reference || '',
        paymentUrl: payment?.payment_url || null,
        sandbox: paymentProvider.getDiagnostics().mode === 'sandbox_simulator',
        otpRequired: Boolean(payment?.otp_required),
        totalGnf: existing.total_gnf,
        paymentPlan: existing.payment_plan,
        depositPercent: existing.deposit_percent,
        amountPaidNowGnf: existing.amount_paid_now_gnf,
        balanceDueGnf: existing.balance_due_gnf,
        bankTransfer: existing.payment_mode === 'bank_transfer',
        bankDetails: null,
      });
      return;
    }

    // ── Load & validate the cart server-side ──────────────────────────────
    const productIds = body.items.map((i) => i.productId);
    const placeholders = productIds.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug
         FROM products p
         JOIN categories c ON c.id = p.category_id
         JOIN users u ON u.id = p.vendor_id
         WHERE p.id IN (${placeholders}) AND p.status = 'published' AND u.status = 'validated'`
      )
      .all(...productIds) as Array<Record<string, unknown>>;
    const products = await hydrateProducts(rows);
    if (products.length !== body.items.length) {
      throw new HttpError(400, 'Un article du panier n’est plus disponible. Actualisez le catalogue.');
    }

    let subtotalGnf = 0;
    const calcItems: CartDeliveryCalculationItem[] = [];
    for (const item of body.items) {
      const product = products.find((p) => p.id === item.productId)!;
      if (product.mode !== 'direct') {
        throw new HttpError(400, `« ${product.name} » est vendu sur devis uniquement.`);
      }
      if (product.stockQty < item.quantity) {
        throw new HttpError(400, `Stock insuffisant pour « ${product.name} » (${product.stockQty} disponible).`);
      }
      subtotalGnf += product.priceGnf * item.quantity;
      calcItems.push({ weightKg: product.weightKg, quantity: item.quantity, deliveryConfig: product.deliveryConfig });
    }

    // ── Delivery ──────────────────────────────────────────────────────────
    const zones = await getDeliveryZones();
    const zone = body.deliveryZoneId === 'pickup' ? null : zones.find((zn) => zn.id === body.deliveryZoneId) || null;
    if (body.deliveryZoneId !== 'pickup' && !zone) {
      throw new HttpError(400, 'Zone de livraison inconnue.');
    }
    const delivery = calculateDeliveryFee(zone, calcItems);
    const totalGnf = subtotalGnf + delivery.fee;

    // ── Payment plan ──────────────────────────────────────────────────────
    const restrictions = await getCommercialRestrictions();
    const plan: PaymentPlan = body.paymentPlan;
    const vendorIds = [...new Set(products.map((p) => p.vendorId))];
    const singleVendor = vendorIds.length === 1;
    const vendorBankEnabled = singleVendor ? Boolean(products[0].vendor.bankTransferAvailable) : false;
    const planAmounts = calculatePaymentPlanAmounts(totalGnf, plan, restrictions.defaultDepositPercent);

    const bankTransfer = plan === 'bank_transfer';
    if (bankTransfer) {
      const eligibility = isBankTransferEligible({
        totalGnf,
        minGnf: restrictions.bankTransferMinGnf,
        singleVendor,
        vendorBankEnabled,
      });
      if (!eligibility.eligible) throw new HttpError(400, eligibility.reason || 'Virement bancaire non éligible.');
    }

    // ── Identity of the order (needed BEFORE the Djomy session) ──────────
    const tracking = generateTrackingToken();
    const expires = new Date(
      Date.now() + restrictions.trackingTokenValidityMonths * 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    const orderId = genId('ord');
    const orderNumber = await nextOrderNumber();
    const ts = now();

    // ── Djomy session (created BEFORE persisting anything) ───────────────
    const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    let djomy: Awaited<ReturnType<typeof paymentProvider.createPayment>> | null = null;
    if (!bankTransfer) {
      try {
        djomy = await paymentProvider.createPayment({
          orderNumber,
          amountGnf: planAmounts.amountPaidNowGnf,
          currency: 'GNF',
          method: body.paymentMethod as 'mobile_money' | 'card' | 'qr',
          operator: body.paymentOperator,
          mode: (body.paymentMode === 'direct' ? 'direct' : 'redirect'),
          buyerName: body.buyerName,
          buyerEmail: body.buyerEmail,
          buyerPhone: body.buyerPhone,
          returnUrl: `${appUrl}/suivi?djomy_return=1`,
          cancelUrl: `${appUrl}/suivi?djomy_cancel=1`,
          description: 'Commande EMROD Marketplace',
        });
      } catch (err) {
        console.error('[checkout] Djomy createPayment failed:', err);
        throw new HttpError(502, 'Passerelle Djomy momentanément indisponible. Réessayez dans un instant.');
      }
    }

    const vendorSummaries = await getVendorPublicSummaries(vendorIds);
    const bankDetails: VendorBankDetails | null = bankTransfer
      ? await (async () => {
          const vendorId = vendorIds[0];
          const profile = await db
            .prepare(`SELECT * FROM vendor_profiles WHERE user_id = ?`)
            .get(vendorId) as Record<string, unknown> | undefined;
          if (!profile) return null;
          return {
            bankTransferEnabled: Boolean(profile.bank_transfer_enabled),
            bankName: String(profile.bank_name || ''),
            bankAccountHolder: String(profile.bank_account_holder || ''),
            bankIbanRib: String(profile.bank_iban_rib || ''),
            bankSwiftBic: String(profile.bank_swift_bic || ''),
            bankInstructions: String(profile.bank_instructions || ''),
          };
        })()
      : null;

    await runInTransaction(async () => {
      await db.prepare(
        `INSERT INTO orders (
           id, order_number, idempotency_key, buyer_name, buyer_email, buyer_phone,
           delivery_zone_id, delivery_zone_name, delivery_address, delivery_landmark,
           subtotal_gnf, delivery_fee_gnf, total_gnf, status, tracking_token_hash,
           tracking_token_expires_at, notifications_enabled, payment_mode, payment_plan,
           deposit_percent, amount_paid_now_gnf, balance_due_gnf, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Commandée', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        orderId,
        orderNumber,
        body.idempotencyKey,
        body.buyerName,
        body.buyerEmail,
        body.buyerPhone,
        body.deliveryZoneId,
        body.deliveryZoneId === 'pickup' ? 'Retrait atelier' : zone?.name || body.deliveryZoneId,
        body.deliveryAddress,
        body.deliveryLandmark || '',
        subtotalGnf,
        delivery.fee,
        totalGnf,
        tracking.tokenHash,
        expires,
        bankTransfer ? 'bank_transfer' : body.paymentMode === 'direct' ? 'direct' : 'redirect',
        plan,
        planAmounts.depositPercentApplied,
        // La DB trace uniquement l'ENCAISSÉ (0 à la création) : applyPaymentSuccess
        // additionnera le montant réellement réglé. Les montants *planifiés*
        // (planAmounts) restent réservés à l'affichage « à payer maintenant ».
        0,
        totalGnf,
        ts,
        ts
      );

      // Per-line delivery fee split pro-rata of line value (drives vendor payouts)
      const withProduct = body.items.map((item) => ({
        ...item,
        product: products.find((p) => p.id === item.productId)!,
        lineValue: products.find((p) => p.id === item.productId)!.priceGnf * item.quantity,
      }));
      let allocatedFee = 0;
      for (let idx = 0; idx < withProduct.length; idx++) {
        const item = withProduct[idx]!;
        const isLast = idx === withProduct.length - 1;
        const lineFee = isLast
          ? delivery.fee - allocatedFee
          : Math.round((delivery.fee * item.lineValue) / Math.max(subtotalGnf, 1));
        allocatedFee += lineFee;
        await db.prepare(
          `INSERT INTO order_items (
             id, order_id, product_id, vendor_id, product_name, product_slug,
             product_image, quantity, unit_price_gnf, delivery_fee_gnf
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          genId('oi'),
          orderId,
          item.product.id,
          item.product.vendorId,
          item.product.name,
          item.product.slug,
          item.product.media[0]?.url || '',
          item.quantity,
          item.product.priceGnf,
          Math.max(0, lineFee)
        );
      }

      await db.prepare(
        `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at)
         VALUES (?, ?, 'Commandée', 'buyer', ?, ?, ?)`
      ).run(
        genId('oe'),
        orderId,
        body.buyerName,
        bankTransfer
          ? 'Commande enregistrée — règlement par virement bancaire direct à l’atelier.'
          : `Commande enregistrée — session Djomy ${djomy?.djomyReference || ''} ouverte (${formatGNF(planAmounts.amountPaidNowGnf)}).`,
        ts
      );

      if (djomy) {
        await db.prepare(
          `INSERT INTO payments (
             id, order_id, djomy_reference, type, method, operator, amount_gnf,
             status, payment_url, otp_required, created_at, updated_at
           ) VALUES (?, ?, ?, 'payment', ?, ?, ?, 'pending', ?, ?, ?, ?)`
        ).run(
          genId('pay'),
          orderId,
          djomy.djomyReference,
          body.paymentMethod,
          body.paymentOperator,
          planAmounts.amountPaidNowGnf,
          djomy.paymentUrl,
          djomy.otpRequired ? 1 : 0,
          ts,
          ts
        );
      }
    });

    // Receipt / instructions e-mail (fire-and-forget)
    const firstVendorName = vendorSummaries.get(vendorIds[0])?.shopName || 'atelier EMROD';
    sendMail({
      to: body.buyerEmail,
      subject: `Commande ${orderNumber} enregistrée — EMROD Marketplace`,
      text: `Bonjour ${body.buyerName},\n\nVotre commande ${orderNumber} (${formatGNF(totalGnf)}) est enregistrée auprès de ${firstVendorName}.\n${
        bankTransfer
          ? 'Effectuez le virement bancaire aux coordonnées communiquées, puis déclarez votre référence depuis votre page de suivi.\n'
          : `Montant à régler maintenant : ${formatGNF(planAmounts.amountPaidNowGnf)}${planAmounts.balanceDueGnf > 0 ? ` — solde à la livraison : ${formatGNF(planAmounts.balanceDueGnf)}` : ''}\n`
      }\nVotre lien personnel de suivi : ${trackingUrl(tracking.rawToken)}\n\nEMROD SARL — Atelier Sonfonia, Conakry`,
      html: `<p>Bonjour ${body.buyerName},</p><p>Votre commande <strong>${orderNumber}</strong> (${formatGNF(totalGnf)}) est enregistrée auprès de <strong>${firstVendorName}</strong>.</p><p>Votre lien personnel de suivi : <a href="${trackingUrl(tracking.rawToken)}">${trackingUrl(tracking.rawToken)}</a></p><p>EMROD SARL — Atelier Sonfonia, Conakry</p>`,
    });

    res.status(201).json({
      orderNumber,
      trackingToken: tracking.rawToken,
      djomyReference: djomy?.djomyReference || '',
      paymentUrl: djomy?.paymentUrl || null,
      sandbox: djomy?.sandbox ?? true,
      otpRequired: Boolean(djomy?.otpRequired),
      totalGnf,
      paymentPlan: plan,
      depositPercent: planAmounts.depositPercentApplied,
      amountPaidNowGnf: planAmounts.amountPaidNowGnf,
      balanceDueGnf: planAmounts.balanceDueGnf,
      bankTransfer,
      bankDetails,
    });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * Guest tracking — token-scoped endpoints (`emr_…` HMAC tokens)
 * ──────────────────────────────────────────────────────────────────────── */

interface TrackedOrder {
  id: string;
  order_number: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  delivery_zone_name: string;
  delivery_address: string;
  delivery_landmark: string;
  subtotal_gnf: number;
  delivery_fee_gnf: number;
  total_gnf: number;
  payment_mode: string;
  payment_plan: string;
  deposit_percent: number;
  amount_paid_now_gnf: number;
  balance_due_gnf: number;
  bank_transfer_reference: string;
  bank_transfer_declared_at: string | null;
  status: string;
  notifications_enabled: number;
  tracking_token_expires_at: string;
  created_at: string;
}

async function requireTrackedOrder(token: string): Promise<TrackedOrder> {
  const tokenHash = hashTrackingToken(String(token || '').trim());
  const order = await db.prepare(`SELECT * FROM orders WHERE tracking_token_hash = ?`).get(tokenHash) as
    | TrackedOrder
    | undefined;
  if (!order) throw new HttpError(404, 'Lien de suivi introuvable.');
  if (order.tracking_token_expires_at && order.tracking_token_expires_at < now()) {
    throw new HttpError(410, 'Lien de suivi expiré — contactez l’atelier pour un nouveau lien.');
  }
  return order;
}

async function firstVendorIdOf(orderId: string): Promise<string> {
  const row = await db
    .prepare(`SELECT vendor_id FROM order_items WHERE order_id = ? LIMIT 1`)
    .get(orderId) as { vendor_id: string } | undefined;
  if (!row) throw new HttpError(404, 'Commande sans article.');
  return row.vendor_id;
}

async function ensureOrderConversation(order: TrackedOrder, vendorId: string): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM conversations WHERE type = 'order' AND order_id = ? LIMIT 1`)
    .get(order.id) as { id: string } | undefined;
  if (existing) return existing.id;
  const convId = genId('conv');
  await db.prepare(
    `INSERT INTO conversations (id, type, order_id, vendor_id, buyer_name, buyer_email, created_at)
     VALUES (?, 'order', ?, ?, ?, ?, ?)`
  ).run(convId, order.id, vendorId, order.buyer_name, order.buyer_email, now());
  return convId;
}

ordersRouter.get(
  '/orders/track/:token',
  wrap(async (req, res) => {
    const order = await requireTrackedOrder(req.params.token);

    const sortedItems = await db
      .prepare(`SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC`)
      .all(order.id) as Array<Record<string, unknown>>;

    const events = await db
      .prepare(`SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC, id ASC`)
      .all(order.id) as Array<Record<string, unknown>>;

    const payment = await db
      .prepare(
        `SELECT djomy_reference, provider_reference, method, operator, amount_gnf, status, payment_url
         FROM payments WHERE order_id = ? AND type != 'refund'
         ORDER BY created_at DESC, id DESC LIMIT 1`
      )
      .get(order.id) as Record<string, unknown> | undefined;

    const vendorId = await firstVendorIdOf(order.id);
    const vendorSummary = (await getVendorPublicSummaries([vendorId])).get(vendorId);
    const vendor = vendorSummary
      ? {
          shopName: vendorSummary.shopName,
          slug: vendorSummary.slug,
          location: vendorSummary.location,
          responseTimeLabel: vendorSummary.responseTimeLabel,
        }
      : null;

    const vendorBankDetails =
      order.payment_plan === 'bank_transfer'
        ? await (async () => {
            const profile = await db
              .prepare(`SELECT * FROM vendor_profiles WHERE user_id = ?`)
              .get(vendorId) as Record<string, unknown> | undefined;
            if (!profile) return null;
            return {
              bankTransferEnabled: Boolean(profile.bank_transfer_enabled),
              bankName: String(profile.bank_name || ''),
              bankAccountHolder: String(profile.bank_account_holder || ''),
              bankIbanRib: String(profile.bank_iban_rib || ''),
              bankSwiftBic: String(profile.bank_swift_bic || ''),
              bankInstructions: String(profile.bank_instructions || ''),
            } satisfies VendorBankDetails;
          })()
        : null;

    const review = await db
      .prepare(`SELECT id, rating, comment, vendor_reply FROM reviews WHERE order_id = ? LIMIT 1`)
      .get(order.id) as Record<string, unknown> | undefined;
    const dispute = await db
      .prepare(`SELECT id, status, reason, resolution_notes FROM disputes WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(order.id) as Record<string, unknown> | undefined;

    const convId = await ensureOrderConversation(order, vendorId);
    const messages = await db
      .prepare(
        `SELECT id, sender_role, sender_name, content, created_at FROM messages
         WHERE conversation_id = ? AND status = 'visible' ORDER BY created_at ASC, id ASC`
      )
      .all(convId) as Array<Record<string, unknown>>;

    const restrictions = await getCommercialRestrictions();

    res.json({
      order: {
        id: order.id,
        orderNumber: order.order_number,
        buyerName: order.buyer_name,
        buyerEmail: order.buyer_email,
        buyerPhone: order.buyer_phone,
        deliveryZoneName: order.delivery_zone_name,
        deliveryAddress: order.delivery_address,
        deliveryLandmark: order.delivery_landmark,
        subtotalGnf: order.subtotal_gnf,
        deliveryFeeGnf: order.delivery_fee_gnf,
        totalGnf: order.total_gnf,
        paymentPlan: order.payment_plan as PaymentPlan,
        depositPercent: order.deposit_percent,
        amountPaidNowGnf: order.amount_paid_now_gnf,
        balanceDueGnf: order.balance_due_gnf,
        bankTransferReference: order.bank_transfer_reference || '',
        bankTransferDeclaredAt: order.bank_transfer_declared_at,
        status: order.status as OrderStatus,
        notificationsEnabled: Boolean(order.notifications_enabled),
        createdAt: order.created_at,
        expiresAt: order.tracking_token_expires_at,
      },
      items: sortedItems.map((it) => ({
        id: String(it.id),
        product_name: String(it.product_name),
        product_slug: String(it.product_slug),
        product_image: String(it.product_image),
        quantity: Number(it.quantity),
        unit_price_gnf: Number(it.unit_price_gnf),
      })),
      events: events.map((ev) => ({
        id: String(ev.id),
        status: String(ev.status),
        actor_role: String(ev.actor_role),
        actor_name: String(ev.actor_name),
        comment: String(ev.comment || ''),
        created_at: String(ev.created_at),
      })),
      payment: payment
        ? {
            djomy_reference: String(payment.djomy_reference),
            provider_reference: payment.provider_reference ? String(payment.provider_reference) : undefined,
            method: String(payment.method),
            operator: String(payment.operator || ''),
            amount_gnf: Number(payment.amount_gnf),
            status: String(payment.status),
            payment_url: payment.payment_url ? String(payment.payment_url) : null,
          }
        : null,
      vendor,
      vendorBankDetails,
      review: review
        ? {
            id: String(review.id),
            rating: Number(review.rating),
            comment: String(review.comment),
            vendor_reply: String(review.vendor_reply || ''),
          }
        : null,
      dispute: dispute
        ? {
            id: String(dispute.id),
            status: String(dispute.status),
            reason: String(dispute.reason),
            resolution_notes: String(dispute.resolution_notes || ''),
          }
        : null,
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

/* POST /api/orders/track/:token/verify-djomy — pull payment status from Djomy */
ordersRouter.post(
  '/orders/track/:token/verify-djomy',
  wrap(async (req, res) => {
    const order = await requireTrackedOrder(req.params.token);
    const payment = await db
      .prepare(
        `SELECT * FROM payments WHERE order_id = ? AND type != 'refund'
         ORDER BY created_at DESC, id DESC LIMIT 1`
      )
      .get(order.id) as Record<string, unknown> | undefined;
    if (!payment) throw new HttpError(404, 'Aucun paiement Djomy rattaché à cette commande.');
    if (String(payment.status) === 'succeeded') {
      res.json({
        status: 'succeeded',
        rawStatus: 'SUCCESS',
        providerReference: payment.provider_reference ? String(payment.provider_reference) : null,
      });
      return;
    }

    const statusResult = await paymentProvider.getPaymentStatus(String(payment.djomy_reference));
    if (statusResult.status === 'succeeded') {
      await db.prepare(
        `UPDATE payments SET status = 'succeeded', provider_reference = ?, raw_webhook_json = ?, updated_at = ? WHERE id = ?`
      ).run(
        statusResult.transactionId || null,
        JSON.stringify(statusResult),
        now(),
        String(payment.id)
      );
      await settlePaymentRow({ id: payment.id }, 'verify');
      res.json({ status: 'succeeded', rawStatus: statusResult.rawStatus, providerReference: statusResult.transactionId || null });
      return;
    }
    if (statusResult.status === 'failed') {
      await markPaymentFailed(String(payment.id));
      res.json({ status: 'failed', rawStatus: statusResult.rawStatus });
      return;
    }
    res.json({ status: statusResult.status, rawStatus: statusResult.rawStatus || 'PENDING' });
  })
);

/* PATCH /api/orders/track/:token/notifications — toggle buyer alerts */
ordersRouter.patch(
  '/orders/track/:token/notifications',
  wrap(async (req, res) => {
    const order = await requireTrackedOrder(req.params.token);
    const { enabled } = parseBody(z.object({ enabled: z.boolean() }), req);
    await db.prepare(`UPDATE orders SET notifications_enabled = ?, updated_at = ? WHERE id = ?`).run(
      enabled ? 1 : 0,
      now(),
      order.id
    );
    res.json({ ok: true, enabled });
  })
);

/* POST /api/orders/track/:token/cancel — buyer self-service cancellation */
ordersRouter.post(
  '/orders/track/:token/cancel',
  wrap(async (req, res) => {
    const order = await requireTrackedOrder(req.params.token);
    const { reason } = parseBody(z.object({ reason: z.string().trim().max(240).optional() }), req);

    const current = order.status as OrderStatus;
    if (!canTransitionOrderStatus(current, 'Annulée', 'buyer')) {
      throw new HttpError(400, 'Cette commande ne peut plus être annulée (déjà expédiée ou livrée).');
    }

    const succeededPayment = await db
      .prepare(
        `SELECT * FROM payments WHERE order_id = ? AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1`
      )
      .get(order.id) as Record<string, unknown> | undefined;

    if (succeededPayment) {
      // Paid → trigger the Djomy refund, then run the full refund pipeline
      let refundOk = false;
      try {
        const refund = await paymentProvider.refundPayment(
          String(succeededPayment.djomy_reference),
          Number(order.amount_paid_now_gnf),
          reason || 'Annulation par l’acheteur'
        );
        refundOk = refund.status !== 'failed';
      } catch (err) {
        console.error('[track/cancel] Djomy refund failed:', err);
      }
      if (refundOk) {
        await applyOrderRefund({
          orderId: order.id,
          paymentId: String(succeededPayment.id),
          refundAmountGnf: Number(order.amount_paid_now_gnf),
          actorRole: 'buyer',
          actorName: order.buyer_name,
          comment: reason || 'Commande annulée par l’acheteur — remboursement Djomy.',
        });
        res.json({ ok: true, status: 'Remboursée' });
        return;
      }
      // Refund could not be executed → plain cancellation, manual refund to schedule
      await runInTransaction(async () => {
        await db.prepare(`UPDATE orders SET status = 'Annulée', updated_at = ? WHERE id = ?`).run(now(), order.id);
        await db.prepare(
          `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at)
           VALUES (?, ?, 'Annulée', 'buyer', ?, ?, ?)`
        )
          .run(
            genId('oe'),
            order.id,
            order.buyer_name,
            `${reason || 'Annulation par l’acheteur'} — remboursement Djomy à traiter manuellement.`,
            now()
          );
        const items = await db
          .prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`)
          .all(order.id) as Array<{ product_id: string; quantity: number }>;
        for (const item of items) {
          await db.prepare(`UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?`).run(item.quantity, item.product_id);
        }
        await db.prepare(`DELETE FROM payouts WHERE order_id = ? AND status IN ('pending','scheduled')`).run(order.id);
      });
      res.json({ ok: true, status: 'Annulée' });
      return;
    }

    // Unpaid → simple cancellation with stock restore
    await runInTransaction(async () => {
      await db.prepare(`UPDATE orders SET status = 'Annulée', updated_at = ? WHERE id = ?`).run(now(), order.id);
      await db.prepare(
        `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at)
         VALUES (?, ?, 'Annulée', 'buyer', ?, ?, ?)`
      ).run(genId('oe'), order.id, order.buyer_name, reason || 'Commande annulée par l’acheteur.', now());
      const items = await db
        .prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`)
        .all(order.id) as Array<{ product_id: string; quantity: number }>;
      for (const item of items) {
        await db.prepare(`UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?`).run(item.quantity, item.product_id);
      }
      await db.prepare(`DELETE FROM payouts WHERE order_id = ? AND status IN ('pending','scheduled')`).run(order.id);
    });
    res.json({ ok: true, status: 'Annulée' });
  })
);

/* POST /api/orders/track/:token/declare-bank-transfer — buyer SWIFT advice */
ordersRouter.post(
  '/orders/track/:token/declare-bank-transfer',
  wrap(async (req, res) => {
    const order = await requireTrackedOrder(req.params.token);
    if (order.payment_plan !== 'bank_transfer') {
      throw new HttpError(400, 'Cette commande n’est pas réglée par virement bancaire.');
    }
    const body = parseBody(
      z.object({
        reference: z.string().trim().min(3, 'Référence de virement requise.').max(160),
        notes: z.string().trim().max(1000).optional().default(''),
      }),
      req
    );
    const restrictions = await getCommercialRestrictions();
    if (!restrictions.allowExternalContactsInMessages) {
      const check = detectExternalContactAttempt(`${body.reference} ${body.notes}`);
      if (check.blocked) throw new HttpError(400, check.reason || 'Message non conforme aux règles EMROD.');
    }

    await db.prepare(
      `UPDATE orders SET bank_transfer_reference = ?, bank_transfer_declared_at = ?, updated_at = ? WHERE id = ?`
    ).run(body.reference, now(), now(), order.id);
    await db.prepare(
      `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at)
       VALUES (?, ?, ?, 'buyer', ?, ?, ?)`
    ).run(
      genId('oe'),
      order.id,
      order.status,
      order.buyer_name,
      `Avis de virement déclaré — référence ${body.reference}${body.notes ? ` · ${body.notes}` : ''}`,
      now()
    );

    // Heads-up e-mail to the vendor
    const vendorId = await firstVendorIdOf(order.id);
    const vendorUser = await db.prepare(`SELECT email FROM users WHERE id = ?`).get(vendorId) as
      | { email: string }
      | undefined;
    if (vendorUser) {
      sendMail({
        to: vendorUser.email,
        subject: `Avis de virement — commande ${order.order_number}`,
        text: `L'acheteur ${order.buyer_name} a déclaré le virement ${body.reference} pour la commande ${order.order_number} (${formatGNF(order.total_gnf)}).\nVérifiez votre relevé puis confirmez la commande depuis votre portail vendeur.`,
        html: `<p>L'acheteur <strong>${order.buyer_name}</strong> a déclaré le virement <strong>${body.reference}</strong> pour la commande <strong>${order.order_number}</strong> (${formatGNF(order.total_gnf)}).</p><p>Vérifiez votre relevé puis confirmez la commande depuis votre portail vendeur.</p>`,
      });
    }
    res.json({ ok: true });
  })
);

/* POST /api/orders/track/:token/messages — buyer ↔ vendor chat */
ordersRouter.post(
  '/orders/track/:token/messages',
  wrap(async (req, res) => {
    const order = await requireTrackedOrder(req.params.token);
    const body = parseBody(messageSubmitSchema, req);
    const restrictions = await getCommercialRestrictions();
    if (!restrictions.allowExternalContactsInMessages) {
      const check = detectExternalContactAttempt(body.content);
      if (check.blocked) throw new HttpError(400, check.reason || 'Message non conforme aux règles EMROD.');
    }

    const vendorId = await firstVendorIdOf(order.id);
    const convId = await ensureOrderConversation(order, vendorId);
    const msgId = genId('msg');
    const ts = now();
    await db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_role, sender_name, content, is_public, created_at)
       VALUES (?, ?, 'buyer', ?, ?, 1, ?)`
    ).run(msgId, convId, order.buyer_name, body.content, ts);

    // Vendor heads-up
    const vendorUser = await db.prepare(`SELECT email FROM users WHERE id = ?`).get(vendorId) as
      | { email: string }
      | undefined;
    if (vendorUser) {
      sendMail({
        to: vendorUser.email,
        subject: `Nouveau message — commande ${order.order_number}`,
        text: `${order.buyer_name} : ${body.content}\nRépondez depuis votre portail vendeur.`,
        html: `<p><strong>${order.buyer_name}</strong> : ${body.content}</p><p>Répondez depuis votre portail vendeur.</p>`,
      });
    }
    res.status(201).json({ id: msgId, sender_role: 'buyer', sender_name: order.buyer_name, content: body.content, created_at: ts });
  })
);

/* POST /api/orders/track/:token/review — verified review (Livrée only) */
ordersRouter.post(
  '/orders/track/:token/review',
  wrap(async (req, res) => {
    const order = await requireTrackedOrder(req.params.token);
    if (order.status !== 'Livrée') {
      throw new HttpError(400, 'Les avis vérifiés sont ouverts après la livraison de la commande.');
    }
    const existing = await db.prepare(`SELECT id FROM reviews WHERE order_id = ? LIMIT 1`).get(order.id);
    if (existing) throw new HttpError(409, 'Un avis a déjà été publié pour cette commande.');

    const body = parseBody(reviewSubmitSchema, req);
    const firstItem = await db
      .prepare(`SELECT product_id, vendor_id FROM order_items WHERE order_id = ? LIMIT 1`)
      .get(order.id) as { product_id: string; vendor_id: string };

    await db.prepare(
      `INSERT INTO reviews (id, order_id, product_id, vendor_id, buyer_name, rating, comment, photos_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`
    ).run(genId('rev'), order.id, firstItem.product_id, firstItem.vendor_id, order.buyer_name, body.rating, body.comment, JSON.stringify(body.photos || []), now());
    res.status(201).json({ ok: true });
  })
);

/* POST /api/orders/track/:token/disputes — buyer opens a dispute */
ordersRouter.post(
  '/orders/track/:token/disputes',
  wrap(async (req, res) => {
    const order = await requireTrackedOrder(req.params.token);
    if (['Annulée', 'Remboursée'].includes(order.status)) {
      throw new HttpError(400, 'Impossible d’ouvrir un litige sur une commande clôturée.');
    }
    const body = parseBody(
      z.object({ reason: z.string().trim().min(10, 'Décrivez le problème (10 caractères min).').max(1000) }),
      req
    );
    const existing = await db
      .prepare(`SELECT id FROM disputes WHERE order_id = ? AND status = 'open' LIMIT 1`)
      .get(order.id);
    if (existing) throw new HttpError(409, 'Un litige est déjà ouvert pour cette commande.');

    const disputeId = genId('dsp');
    await db.prepare(
      `INSERT INTO disputes (id, order_id, opened_by, reason, status, created_at, updated_at)
       VALUES (?, ?, 'buyer', ?, 'open', ?, ?)`
    ).run(disputeId, order.id, body.reason, now(), now());
    await db.prepare(
      `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at)
       VALUES (?, ?, ?, 'buyer', ?, 'Litige ouvert par l’acheteur.', ?)`
    ).run(genId('oe'), order.id, order.status, order.buyer_name, now());
    res.status(201).json({ ok: true, id: disputeId });
  })
);
