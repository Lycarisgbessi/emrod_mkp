import { db, runInTransaction } from './db';
import { computeCommissionShare, resolveCommissionRate } from '../src/shared/domain';

/** Platform commission configuration stored in platform_rules.commission_config. */
export interface CommissionConfig {
  enabled: boolean;
  defaultPercent: number;
  vendorOverrides: Record<string, number>;
  categoryOverrides: Record<string, number>;
  base: 'subtotal' | 'total';
  minCommissionGnf: number;
  applyToQuotes: boolean;
}

const DEFAULT_CONFIG: CommissionConfig = {
  enabled: true,
  defaultPercent: 10,
  vendorOverrides: {},
  categoryOverrides: {},
  base: 'subtotal',
  minCommissionGnf: 0,
  applyToQuotes: true,
};

export async function getCommissionConfig(): Promise<CommissionConfig> {
  const row = await db
    .prepare(`SELECT value_json FROM platform_rules WHERE key = 'commission_config'`)
    .get() as { value_json: string } | undefined;
  if (!row) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(row.value_json) as Partial<CommissionConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      vendorOverrides: parsed.vendorOverrides || {},
      categoryOverrides: parsed.categoryOverrides || {},
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function setCommissionConfig(config: CommissionConfig): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO platform_rules (key, value_json, updated_at) VALUES ('commission_config', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(JSON.stringify(config), now);
}

/**
 * Records commission ledger lines for a successful payment on an order
 * (webhook, OTP confirmation, bank transfer validation or paid quote link).
 * The rate in force at calculation time is snapshotted on each line.
 */
export async function recordCommissionForPayment(params: {
  orderId: string;
  paymentId: string | null;
  amountGnf: number;
  source: string;
}): Promise<void> {
  const config = await getCommissionConfig();
  const order = await db
    .prepare(`SELECT id, subtotal_gnf, total_gnf, payment_mode FROM orders WHERE id = ?`)
    .get(params.orderId) as
    | { id: string; subtotal_gnf: number; total_gnf: number; payment_mode: string }
    | undefined;
  if (!order || params.amountGnf <= 0) return;
  if (order.payment_mode === 'link' && !config.applyToQuotes) return;

  const vendorRows = await db
    .prepare(
      `SELECT oi.vendor_id, SUM(unit_price_gnf * quantity) AS subtotal, MAX(p.category_id) AS category_id
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ? GROUP BY oi.vendor_id`
    )
    .all(params.orderId) as Array<{ vendor_id: string; subtotal: number; category_id: string }>;
  if (vendorRows.length === 0) return;

  const now = new Date().toISOString();
  const rate = config.enabled ? 1 : 0; // when disabled, lines are recorded with 0% (full history)
  void rate;

  const insertLine = await db.prepare(
    `INSERT INTO commissions (id, order_id, payment_id, vendor_id, gross_gnf, rate_percent, commission_gnf, net_vendor_gnf, base, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'earned', ?, ?, ?)`
  );

  await runInTransaction(async () => {
    for (const v of vendorRows) {
      const effectiveRate = config.enabled
        ? resolveCommissionRate({
            defaultPercent: config.defaultPercent,
            vendorOverrides: config.vendorOverrides,
            categoryOverrides: config.categoryOverrides,
            vendorId: v.vendor_id,
            categoryId: String(v.category_id || ''),
          })
        : 0;
      const share = computeCommissionShare({
        amountGnf: params.amountGnf,
        orderSubtotalGnf: Number(order.subtotal_gnf),
        orderTotalGnf: Number(order.total_gnf),
        vendorSubtotalGnf: Number(v.subtotal),
        ratePercent: effectiveRate,
        base: config.base,
        minCommissionGnf: config.minCommissionGnf,
      });
      await insertLine.run(
        `cms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        params.orderId,
        params.paymentId,
        v.vendor_id,
        share.grossGnf,
        share.ratePercent,
        share.commissionGnf,
        share.netVendorGnf,
        config.base,
        params.source,
        now,
        now
      );

      // Reflect the commission on the vendor's scheduled payout for this order
      await db.prepare(
        `UPDATE payouts
         SET commission_gnf = ?, net_amount_gnf = GREATEST(0, amount_gnf - ?), updated_at = ?
         WHERE order_id = ? AND vendor_id = ? AND status IN ('pending','scheduled')`
      ).run(share.commissionGnf, share.commissionGnf, now, params.orderId, v.vendor_id);
    }
  });
}

/**
 * Reverses commission lines proportionally when an order (or part of it) is refunded.
 * Reversal lines hold negative amounts so ledger SUMs stay meaningful.
 */
export async function reverseCommissionForRefund(orderId: string, refundAmountGnf: number): Promise<void> {
  const lines = await db
    .prepare(
      `SELECT * FROM commissions WHERE order_id = ? AND commission_gnf > 0 AND status = 'earned'`
    )
    .all(orderId) as Array<{
    id: string;
    vendor_id: string;
    payment_id: string | null;
    gross_gnf: number;
    rate_percent: number;
    commission_gnf: number;
    net_vendor_gnf: number;
    base: string;
  }>;
  if (lines.length === 0 || refundAmountGnf <= 0) return;

  const totalGross = lines.reduce((acc, l) => acc + Number(l.gross_gnf), 0);
  if (totalGross <= 0) return;
  const ratio = Math.min(1, refundAmountGnf / totalGross);
  const now = new Date().toISOString();

  const insert = await db.prepare(
    `INSERT INTO commissions (id, order_id, payment_id, vendor_id, gross_gnf, rate_percent, commission_gnf, net_vendor_gnf, base, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reversed', 'refund_reversal', ?, ?)`
  );
  await runInTransaction(async () => {
    for (const l of lines) {
      const gross = -Math.round(Number(l.gross_gnf) * ratio);
      const commission = -Math.round(Number(l.commission_gnf) * ratio);
      await insert.run(
        `cms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        orderId,
        l.payment_id,
        l.vendor_id,
        gross,
        Number(l.rate_percent),
        commission,
        gross - commission,
        l.base,
        now,
        now
      );
    }
  });
}

/** Ledger rows with vendor/shop context, filtered & paginated. */
export async function queryCommissionLedger(filters: {
  from?: string;
  to?: string;
  vendorId?: string;
  status?: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (filters.from) {
    where.push('c.created_at >= ?');
    args.push(filters.from);
  }
  if (filters.to) {
    where.push('c.created_at <= ?');
    args.push(filters.to + (filters.to.length === 10 ? 'T23:59:59.999Z' : ''));
  }
  if (filters.vendorId && filters.vendorId !== 'all') {
    where.push('c.vendor_id = ?');
    args.push(filters.vendorId);
  }
  if (filters.status && filters.status !== 'all') {
    where.push('c.status = ?');
    args.push(filters.status);
  }
  const limit = Math.min(Math.max(filters.limit || 200, 1), 1000);
  const sql = `
    SELECT c.*, vp.shop_name, o.order_number, pay.djomy_reference
    FROM commissions c
    LEFT JOIN vendor_profiles vp ON vp.user_id = c.vendor_id
    LEFT JOIN orders o ON o.id = c.order_id
    LEFT JOIN payments pay ON pay.id = c.payment_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ${limit}`;
  return await db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
}

/** Commission totals for a period (used by dashboard, reports & accounting export). */
export async function commissionSummary(fromIso?: string, toIso?: string): Promise<{
  grossGnf: number;
  commissionGnf: number;
  netVendorGnf: number;
  earnedCount: number;
  reversalGnf: number;
  reversalCount: number;
}> {
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (fromIso) {
    where.push('created_at >= ?');
    args.push(fromIso);
  }
  if (toIso) {
    where.push('created_at <= ?');
    args.push(toIso + (toIso.length === 10 ? 'T23:59:59.999Z' : ''));
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN commission_gnf > 0 THEN gross_gnf ELSE 0 END), 0) AS gross_gnf,
         COALESCE(SUM(commission_gnf), 0) AS commission_gnf,
         COALESCE(SUM(net_vendor_gnf), 0) AS net_vendor_gnf,
         COALESCE(SUM(CASE WHEN commission_gnf > 0 THEN 1 ELSE 0 END), 0) AS earned_count,
         COALESCE(SUM(CASE WHEN commission_gnf < 0 THEN -commission_gnf ELSE 0 END), 0) AS reversal_gnf,
         COALESCE(SUM(CASE WHEN commission_gnf < 0 THEN 1 ELSE 0 END), 0) AS reversal_count
       FROM commissions ${whereSql}`
    )
    .get(...args) as Record<string, number>;
  return {
    grossGnf: Number(row.gross_gnf || 0),
    commissionGnf: Number(row.commission_gnf || 0),
    netVendorGnf: Number(row.net_vendor_gnf || 0),
    earnedCount: Number(row.earned_count || 0),
    reversalGnf: Number(row.reversal_gnf || 0),
    reversalCount: Number(row.reversal_count || 0),
  };
}

/** Per-vendor commission statement (rates in force, generated revenue, net). */
export async function commissionByVendor(fromIso?: string, toIso?: string): Promise<Array<Record<string, unknown>>> {
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (fromIso) {
    where.push('c.created_at >= ?');
    args.push(fromIso);
  }
  if (toIso) {
    where.push('c.created_at <= ?');
    args.push(toIso + (toIso.length === 10 ? 'T23:59:59.999Z' : ''));
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return await db
    .prepare(
      `SELECT c.vendor_id, vp.shop_name,
              SUM(CASE WHEN c.commission_gnf > 0 THEN c.gross_gnf ELSE 0 END) AS gross_gnf,
              SUM(c.commission_gnf) AS commission_gnf,
              SUM(c.net_vendor_gnf) AS net_vendor_gnf,
              AVG(c.rate_percent) AS avg_rate
       FROM commissions c
       LEFT JOIN vendor_profiles vp ON vp.user_id = c.vendor_id
       ${whereSql}
       GROUP BY c.vendor_id, vp.shop_name
       ORDER BY commission_gnf DESC`
    )
    .all(...args) as Array<Record<string, unknown>>;
}

/** Monthly consolidated report (GMV, commissions, orders, KPIs) for finance & exports. */
export async function monthlyReport(yearMonth: string): Promise<Record<string, unknown>> {
  const from = `${yearMonth}-01T00:00:00.000Z`;
  const to = new Date(Date.parse(from) + 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sales = await db
    .prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_gnf),0) AS gmv,
              COALESCE(AVG(total_gnf),0) AS avg_basket
       FROM orders WHERE created_at >= ? AND created_at < ? AND status NOT IN ('Annulée')`
    )
    .get(from, `${to}T00:00:00.000Z`) as Record<string, number>;
  const summary = await commissionSummary(from.slice(0, 10), to);
  const byVendor = await commissionByVendor(from.slice(0, 10), to);
  const payments = await db
    .prepare(
      `SELECT operator, COUNT(*) AS cnt, COALESCE(SUM(amount_gnf),0) AS amount
       FROM payments WHERE created_at >= ? AND created_at < ? AND status = 'succeeded'
       GROUP BY operator ORDER BY amount DESC`
    )
    .all(from, `${to}T00:00:00.000Z`);
  return {
    period: yearMonth,
    gmvGnf: Number(sales.gmv || 0),
    ordersCount: Number(sales.cnt || 0),
    averageBasketGnf: Math.round(Number(sales.avg_basket || 0)),
    commissions: summary,
    byVendor,
    paymentsByOperator: payments,
  };
}
