import { Router } from 'express';
import type { Request } from 'express';
import { djomyPortalCompleteSchema, djomyConfirmOtpSchema } from '../../src/shared/schemas';
import { db } from '../db';
import { paymentProvider } from '../djomy';
import { sendMail } from '../mailer';
import { HttpError, applyOrderRefund, applyPaymentSuccess, now, parseBody, wrap } from './_helpers';
import { settleQuotePayment } from './quotes';

export const paymentsRouter = Router();

/* ─────────────────────────────────────────────────────────────────────────
 * Shared settlement plumbing
 * ──────────────────────────────────────────────────────────────────────── */

async function findPaymentByReference(djomyReference: string): Promise<Record<string, unknown> | null> {
  const clean = String(djomyReference || '').trim();
  if (!clean) return null;
  const direct = await db
    .prepare(`SELECT * FROM payments WHERE djomy_reference = ? ORDER BY created_at DESC LIMIT 1`)
    .get(clean) as Record<string, unknown> | undefined;
  if (direct) return direct;
  // Fallback: merchant reference echoes our order number
  const viaOrder = await db
    .prepare(
      `SELECT p.* FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE o.order_number = ? ORDER BY p.created_at DESC LIMIT 1`
    )
    .get(clean) as Record<string, unknown> | undefined;
  return viaOrder || null;
}

export async function markPaymentFailed(paymentId: string): Promise<void> {
  await db.prepare(`UPDATE payments SET status = 'failed', updated_at = ? WHERE id = ?`).run(now(), paymentId);
}

export async function markPaymentRefunded(paymentId: string): Promise<void> {
  await db.prepare(`UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?`).run(now(), paymentId);
}

async function markPaymentSucceeded(paymentId: string, providerReference: string | null): Promise<void> {
  await db.prepare(
    `UPDATE payments SET status = 'succeeded', provider_reference = COALESCE(?, provider_reference), updated_at = ? WHERE id = ?`
  ).run(providerReference, now(), paymentId);
}

/**
 * Runs the post-success pipeline for a payment row already marked `succeeded`:
 * orders → applyPaymentSuccess; quotes → quote conversion + same pipeline.
 * No-op when the pipeline already ran (guarded by payments.status + conversions).
 */
export async function settlePaymentRow(payment: Record<string, unknown>, source: string): Promise<void> {
  const paymentId = String(payment.id);
  const fresh = await db.prepare(`SELECT * FROM payments WHERE id = ?`).get(paymentId) as
    | (Record<string, unknown> & { status: string; quote_id: string | null; order_id: string | null; amount_gnf: number })
    | undefined;
  if (!fresh || fresh.status !== 'succeeded') return;

  if (fresh.quote_id) {
    await settleQuotePayment(paymentId, source);
    return;
  }
  if (fresh.order_id) {
    await applyPaymentSuccess({
      orderId: String(fresh.order_id),
      paymentId,
      paidAmountGnf: Number(fresh.amount_gnf) || 0,
      source,
    });
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * POST /api/payments/djomy/portal-complete — buyer returns from the portal
 * ──────────────────────────────────────────────────────────────────────── */

paymentsRouter.post(
  '/payments/djomy/portal-complete',
  wrap(async (req, res) => {
    const body = parseBody(djomyPortalCompleteSchema, req);
    const payment = await findPaymentByReference(body.djomyReference);
    if (!payment) throw new HttpError(404, 'Session de paiement introuvable.');
    if (String(payment.status) === 'succeeded') {
      res.json({ status: 'succeeded' });
      return;
    }

    const sandbox = paymentProvider.getDiagnostics().mode === 'sandbox_simulator';
    const outcome = body.outcome || 'succeeded';

    if (sandbox) {
      if (outcome === 'failed') {
        await markPaymentFailed(String(payment.id));
        res.json({ status: 'failed' });
        return;
      }
      await markPaymentSucceeded(String(payment.id), null);
      await settlePaymentRow(payment, 'portal');
      res.json({ status: 'succeeded' });
      return;
    }

    // LIVE: never trust the browser outcome — verify with Djomy
    const statusResult = await paymentProvider.getPaymentStatus(String(payment.djomy_reference));
    if (statusResult.status === 'succeeded') {
      await markPaymentSucceeded(String(payment.id), statusResult.transactionId || null);
      await settlePaymentRow(payment, 'portal');
      res.json({ status: 'succeeded' });
      return;
    }
    if (statusResult.status === 'failed') {
      await markPaymentFailed(String(payment.id));
      res.json({ status: 'failed' });
      return;
    }
    res.json({ status: statusResult.status, rawStatus: statusResult.rawStatus });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * POST /api/payments/djomy/confirm-otp — direct integration OTP validation
 * ──────────────────────────────────────────────────────────────────────── */

paymentsRouter.post(
  '/payments/djomy/confirm-otp',
  wrap(async (req, res) => {
    const body = parseBody(djomyConfirmOtpSchema, req);
    const payment = await findPaymentByReference(body.djomyReference);
    if (!payment) throw new HttpError(404, 'Session de paiement introuvable.');
    if (String(payment.status) === 'succeeded') {
      res.json({ status: 'succeeded', message: 'Paiement déjà confirmé.' });
      return;
    }

    const result = await paymentProvider.confirmOtp(String(payment.djomy_reference), body.otpCode);
    if (result.status === 'succeeded') {
      await markPaymentSucceeded(String(payment.id), null);
      await settlePaymentRow(payment, 'otp');
    }
    res.json({ status: result.status, rawStatus: result.rawStatus, message: result.message });
  })
);

/* ─────────────────────────────────────────────────────────────────────────
 * POST /api/payments/djomy/webhook — server-to-server settlement (source of truth)
 * ──────────────────────────────────────────────────────────────────────── */

paymentsRouter.post(
  '/payments/djomy/webhook',
  wrap(async (req, res) => {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const signature = req.headers['x-djomy-signature'] as string | undefined;
    const signatureOk = paymentProvider.verifyWebhookSignature(
      rawBody || JSON.stringify(req.body || {}),
      signature
    );
    if (!signatureOk) {
      throw new HttpError(401, 'Signature webhook invalide.');
    }

    const parsed = paymentProvider.parseWebhookPayload(req.body);
    if (!parsed) {
      throw new HttpError(400, 'Contenu webhook illisible.');
    }

    // Idempotency ledger: replayed events are acknowledged but not re-processed
    const inserted = await db
      .prepare(
        `INSERT INTO webhook_events (event_id, event_type, djomy_reference, raw_json, processed, created_at)
         VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT (event_id) DO NOTHING`
      )
      .run(parsed.eventId, parsed.eventType, parsed.transactionId, JSON.stringify(req.body || {}), now());
    if (Number(inserted.changes) === 0) {
      res.json({ received: true, duplicate: true });
      return;
    }

    const payment =
      (await findPaymentByReference(parsed.transactionId)) ||
      (await findPaymentByReference(parsed.providerReference || '')) ||
      (await findPaymentByReference(parsed.merchantPaymentReference || ''));

    if (!payment) {
      await db.prepare(`UPDATE webhook_events SET processed = 1 WHERE event_id = ?`).run(parsed.eventId);
      res.json({ received: true, matched: false });
      return;
    }

    const paymentId = String(payment.id);
    switch (parsed.normalizedStatus) {
      case 'succeeded': {
        if (String(payment.status) !== 'succeeded') {
          await markPaymentSucceeded(paymentId, parsed.providerReference || parsed.transactionId || null);
          await settlePaymentRow(payment, 'webhook');
        }
        break;
      }
      case 'failed': {
        if (String(payment.status) !== 'failed') await markPaymentFailed(paymentId);
        break;
      }
      case 'refunded': {
        if (String(payment.status) !== 'refunded') {
          await markPaymentRefunded(paymentId);
          if (payment.order_id) {
            await applyOrderRefund({
              orderId: String(payment.order_id),
              paymentId,
              refundAmountGnf: Number(parsed.paidAmount ?? payment.amount_gnf) || Number(payment.amount_gnf),
              actorRole: 'system',
              actorName: 'Webhook Djomy',
              comment: `Remboursement confirmé par webhook (${parsed.eventId}).`,
            });
          }
        }
        break;
      }
      case 'pending':
      default:
        break;
    }

    await db.prepare(`UPDATE webhook_events SET processed = 1 WHERE event_id = ?`).run(parsed.eventId);
    res.json({ received: true });
  })
);
