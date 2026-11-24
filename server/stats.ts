import { db } from './db';
import { commissionSummary } from './commissions';
import { mailerEnabled } from './mailer';

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
function num(v: unknown): number {
  return Number(v || 0);
}

/** Period bounds helper: 'today' | '7d' | '30d' | 'month' | 'quarter' | 'year' */
export function periodBounds(period: string): { from: string; to: string; label: string } {
  const now = new Date();
  switch (period) {
    case 'today':
      return { from: isoDay(0), to: isoDay(1), label: "Aujourd'hui" };
    case '7d':
      return { from: isoDay(-6), to: isoDay(1), label: '7 derniers jours' };
    case 'quarter':
      return { from: isoDay(-89), to: isoDay(1), label: '90 derniers jours' };
    case 'year':
      return { from: isoDay(-364), to: isoDay(1), label: '12 derniers mois' };
    case 'month':
    default:
      return { from: isoDay(-29), to: isoDay(1), label: '30 derniers jours' };
  }
}

async function salesStats(fromIso: string, toIso: string): Promise<Record<string, number>> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_gnf),0) AS gmv, COALESCE(AVG(total_gnf),0) AS avg_basket
       FROM orders
       WHERE created_at >= ? AND created_at < ?
         AND status NOT IN ('Annulée','Remboursée')`
    )
    .get(fromIso + (fromIso.length === 10 ? 'T00:00:00.000Z' : ''), toIso + (toIso.length === 10 ? 'T00:00:00.000Z' : '')) as Record<string, unknown>;
  return {
    ordersCount: num(row.cnt),
    gmvGnf: num(row.gmv),
    averageBasketGnf: Math.round(num(row.avg_basket)),
  };
}

/** ═══ DASHBOARD v2 — everything the admin overview KPI strip needs ═══ */
export async function dashboardStats(period: string): Promise<Record<string, unknown>> {
  const { from, to, label } = periodBounds(period);
  const spanMs = Date.parse(to + 'T00:00:00.000Z') - Date.parse(from + 'T00:00:00.000Z');
  const prevFrom = new Date(Date.parse(from + 'T00:00:00.000Z') - spanMs).toISOString().slice(0, 10);

  const cur = await salesStats(from, to);
  const prev = await salesStats(prevFrom, from);
  const curCom = await commissionSummary(from, to);
  const prevCom = await commissionSummary(prevFrom, from);

  const payments = await db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN status='succeeded' THEN amount_gnf ELSE 0 END),0) AS collected,
        SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS ok_count,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS fail_count,
        SUM(CASE WHEN status='refunded' THEN 1 ELSE 0 END) AS refund_count,
        COALESCE(SUM(CASE WHEN status='refunded' THEN amount_gnf ELSE 0 END),0) AS refunded
       FROM payments WHERE created_at >= ? AND created_at < ?`
    )
    .get(from + 'T00:00:00.000Z', to + 'T00:00:00.000Z') as Record<string, unknown>;

  const ordersByStatus = await db
    .prepare(
      `SELECT status, COUNT(*) AS cnt FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY status`
    )
    .all(from + 'T00:00:00.000Z', to + 'T00:00:00.000Z') as Array<{ status: string; cnt: number }>;

  const cancelled = ordersByStatus.filter((s) => s.status === 'Annulée').reduce((a, s) => a + s.cnt, 0);
  const refundedCnt = num(payments.refund_count);
  const okCount = num(payments.ok_count);
  const failCount = num(payments.fail_count);

  // Buyers: unique + new + repeat in period
  const buyers = await db
    .prepare(
      `SELECT buyer_email, COUNT(*) AS c FROM orders
       WHERE created_at >= ? AND created_at < ? AND buyer_email != ''
       GROUP BY buyer_email`
    )
    .all(from + 'T00:00:00.000Z', to + 'T00:00:00.000Z') as Array<{ buyer_email: string; c: number }>;
  const firstEver = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT buyer_email, MIN(created_at) AS first_at FROM orders WHERE buyer_email != '' GROUP BY buyer_email
       ) WHERE first_at >= ? AND first_at < ?`
    )
    .get(from + 'T00:00:00.000Z', to + 'T00:00:00.000Z') as { c: number };

  const vendors = await db
    .prepare(
      `SELECT
        SUM(CASE WHEN status='validated' THEN 1 ELSE 0 END) AS validated,
        SUM(CASE WHEN status IN ('pending','in_review') THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='suspended' THEN 1 ELSE 0 END) AS suspended
       FROM users WHERE role='vendor'`
    )
    .get() as Record<string, unknown>;

  const openDisputes = num(
    (await db.prepare(`SELECT COUNT(*) AS c FROM disputes WHERE status='open'`).get() as { c: number }).c
  );
  const subscribers = num(
    (
      await db.prepare(`SELECT COUNT(*) AS c FROM push_subscriptions WHERE frequency != 'disabled'`).get() as {
        c: number;
      }
    ).c
  );
  const quotesPipe = await quotesPipeline();

  const delta = (a: number, b: number): number | null => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

  return {
    period,
    periodLabel: label,
    from,
    to,
    gmv: { current: cur.gmvGnf, previous: prev.gmvGnf, deltaPercent: delta(cur.gmvGnf, prev.gmvGnf) },
    commissions: {
      current: curCom.commissionGnf,
      previous: prevCom.commissionGnf,
      deltaPercent: delta(curCom.commissionGnf, prevCom.commissionGnf),
      grossGnf: curCom.grossGnf,
      netVendorGnf: curCom.netVendorGnf,
      reversalGnf: curCom.reversalGnf,
    },
    orders: {
      current: cur.ordersCount,
      previous: prev.ordersCount,
      deltaPercent: delta(cur.ordersCount, prev.ordersCount),
      averageBasketGnf: cur.averageBasketGnf,
      byStatus: Object.fromEntries(ordersByStatus.map((s) => [s.status, s.cnt])),
      cancelRatePercent: cur.ordersCount + cancelled > 0 ? Math.round((cancelled / (cur.ordersCount + cancelled)) * 1000) / 10 : 0,
    },
    payments: {
      collectedGnf: num(payments.collected),
      refundedGnf: num(payments.refunded),
      refundCount: refundedCnt,
      refundRatePercent: okCount > 0 ? Math.round((refundedCnt / okCount) * 1000) / 10 : 0,
      failRatePercent: okCount + failCount > 0 ? Math.round((failCount / (okCount + failCount)) * 1000) / 10 : 0,
    },
    buyers: {
      unique: buyers.length,
      newCount: num(firstEver.c),
      repeatCount: buyers.filter((b) => b.c >= 2).length,
    },
    vendors: {
      validated: num(vendors.validated),
      pending: num(vendors.pending),
      suspended: num(vendors.suspended),
    },
    openDisputes,
    pushSubscribers: subscribers,
    quotesPipeline: quotesPipe,
  };
}

/** Daily GMV + commissions series for charts (default 30 days). */
export async function salesSeries(days = 30): Promise<Array<Record<string, unknown>>> {
  const from = isoDay(-(days - 1));
  const rows = await db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day,
              COUNT(*) AS orders_count,
              COALESCE(SUM(total_gnf),0) AS gmv
       FROM orders
       WHERE created_at >= ? AND status NOT IN ('Annulée','Remboursée')
       GROUP BY day`
    )
    .all(from + 'T00:00:00.000Z') as Array<{ day: string; orders_count: number; gmv: number }>;
  const com = await db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, COALESCE(SUM(commission_gnf),0) AS commission
       FROM commissions WHERE created_at >= ? GROUP BY day`
    )
    .all(from + 'T00:00:00.000Z') as Array<{ day: string; commission: number }>;
  const comMap = new Map(com.map((c) => [c.day, num(c.commission)]));

  const series: Array<Record<string, unknown>> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = isoDay(-i);
    const row = rows.find((r) => r.day === day);
    series.push({
      day,
      ordersCount: num(row?.orders_count),
      gmvGnf: num(row?.gmv),
      commissionGnf: comMap.get(day) ?? 0,
    });
  }
  return series;
}

/** Conversion funnel: product views → cart adds → checkout starts → paid orders. */
export async function conversionFunnel(days = 30): Promise<Record<string, unknown>> {
  const from = isoDaysAgo(days);
  const count = async (type: string): Promise<number> =>
    num(
      (
        await db
          .prepare(`SELECT COUNT(*) AS c FROM analytics_events WHERE type = ? AND created_at >= ?`)
          .get(type, from) as { c: number }
      ).c
    );
  const productViews = await count('product_view');
  const cartAdds = await count('cart_add');
  const checkoutStarts = await count('checkout_start');
  const paymentSuccess = await count('payment_success');
  const rate = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  return {
    days,
    productViews,
    cartAdds,
    checkoutStarts,
    paymentSuccess,
    viewToCartPercent: rate(cartAdds, productViews),
    cartToCheckoutPercent: rate(checkoutStarts, cartAdds),
    checkoutToPaidPercent: rate(paymentSuccess, checkoutStarts),
    viewToPaidPercent: rate(paymentSuccess, productViews),
  };
}

/** Payments split by operator (Orange Money, MTN MoMo, …) with failure rates. */
export async function operatorStats(days = 30): Promise<Array<Record<string, unknown>>> {
  const from = isoDaysAgo(days);
  return await db
    .prepare(
      `SELECT operator,
              COUNT(*) AS total,
              SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
              COALESCE(SUM(CASE WHEN status='succeeded' THEN amount_gnf ELSE 0 END),0) AS amount
       FROM payments WHERE created_at >= ? AND operator != ''
       GROUP BY operator ORDER BY amount DESC`
    )
    .all(from) as Array<Record<string, unknown>>;
}

/** Sales split by payment plan (full / deposit / bank transfer). */
export async function planStats(days = 30): Promise<Array<Record<string, unknown>>> {
  const from = isoDaysAgo(days);
  return await db
    .prepare(
      `SELECT payment_plan, COUNT(*) AS cnt, COALESCE(SUM(total_gnf),0) AS amount
       FROM orders WHERE created_at >= ? AND status NOT IN ('Annulée')
       GROUP BY payment_plan`
    )
    .all(from) as Array<Record<string, unknown>>;
}

/** Bespoke quote pipeline: requests → quoted → paid → delivered, with delays. */
export async function quotesPipeline(): Promise<Record<string, unknown>> {
  const rows = await db
    .prepare(
      `SELECT step_status, COUNT(*) AS cnt, COALESCE(SUM(quoted_amount_gnf),0) AS value
       FROM quote_requests GROUP BY step_status`
    )
    .all() as Array<{ step_status: string; cnt: number; value: number }>;
  const byStep = Object.fromEntries(rows.map((r) => [r.step_status, { count: num(r.cnt), valueGnf: num(r.value) }]));
  const total = rows.reduce((a, r) => a + num(r.cnt), 0);
  const paid = num(byStep.paid?.count ?? 0) + num(byStep.fabrication?.count ?? 0) + num(byStep.delivery?.count ?? 0) + num(byStep.completed?.count ?? 0);
  const delays = await db
    .prepare(
      `SELECT
         AVG(CASE WHEN quoted_amount_gnf > 0 THEN (EXTRACT(EPOCH FROM (updated_at::timestamptz - created_at::timestamptz)) / 86400.0) END) AS quote_days,
         AVG(CASE WHEN step_status IN ('paid','fabrication','delivery','completed') THEN (EXTRACT(EPOCH FROM (updated_at::timestamptz - created_at::timestamptz)) / 86400.0) END) AS pay_days
       FROM quote_requests`
    )
    .get() as Record<string, unknown>;
  const staleQuoted = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM quote_requests
       WHERE step_status = 'quoted' AND quoted_amount_gnf > 0 AND updated_at < ?`
    )
    .get(isoDaysAgo(14)) as { c: number };
  return {
    byStep,
    totalRequests: total,
    paidCount: paid,
    conversionPercent: total > 0 ? Math.round((paid / total) * 1000) / 10 : 0,
    avgDaysToQuote: delays.quote_days != null ? Math.round(num(delays.quote_days) * 10) / 10 : null,
    avgDaysToPay: delays.pay_days != null ? Math.round(num(delays.pay_days) * 10) / 10 : null,
    staleQuotedCount: num(staleQuoted.c),
  };
}

/** Delivery analytics: volumes & fees per zone, real vs estimated delays, pickup share. */
export async function deliveryStats(days = 90): Promise<Record<string, unknown>> {
  const from = isoDaysAgo(days);
  const byZone = await db
    .prepare(
      `SELECT delivery_zone_id AS zone, COUNT(*) AS cnt, COALESCE(SUM(delivery_fee_gnf),0) AS fees,
              AVG(CASE WHEN status='Livrée' THEN EXTRACT(EPOCH FROM (updated_at::timestamptz - created_at::timestamptz)) / 86400.0 END) AS avg_days
       FROM orders WHERE created_at >= ? AND delivery_zone_id != 'pickup'
       GROUP BY zone ORDER BY cnt DESC`
    )
    .all(from) as Array<Record<string, unknown>>;
  const pickup = await db
    .prepare(`SELECT COUNT(*) AS c FROM orders WHERE created_at >= ? AND delivery_zone_id = 'pickup'`)
    .get(from) as { c: number };
  const totalDelivered = num(
    (
      await db.prepare(
        `SELECT COUNT(*) AS c FROM orders WHERE status='Livrée' AND updated_at >= ?`
      ).get(from) as { c: number }
    ).c
  );
  const avgFabricationDays = await db
    .prepare(
      `SELECT AVG(EXTRACT(EPOCH FROM (updated_at::timestamptz - created_at::timestamptz)) / 86400.0) AS d FROM orders WHERE status='Livrée'`
    )
    .get() as { d: number | null };
  return {
    days,
    byZone: byZone.map((z) => ({
      zone: z.zone,
      count: num(z.cnt),
      feesGnf: num(z.fees),
      avgDeliveryDays: z.avg_days != null ? Math.round(num(z.avg_days) * 10) / 10 : null,
    })),
    pickupCount: num(pickup.c),
    totalDelivered,
    avgOrderToDeliveredDays:
      avgFabricationDays.d != null ? Math.round(num(avgFabricationDays.d) * 10) / 10 : null,
  };
}

/** Reviews & reputation analytics. */
export async function reviewsStats(): Promise<Record<string, unknown>> {
  const dist = await db
    .prepare(`SELECT rating, COUNT(*) AS cnt FROM reviews WHERE status='published' GROUP BY rating`)
    .all() as Array<{ rating: number; cnt: number }>;
  const avg = await db
    .prepare(`SELECT AVG(rating) AS a FROM reviews WHERE status='published'`)
    .get() as { a: number | null };
  const reply = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN vendor_reply != '' THEN 1 ELSE 0 END) AS replied,
         AVG(CASE WHEN vendor_reply != '' THEN EXTRACT(EPOCH FROM (vendor_replied_at::timestamptz - created_at::timestamptz)) / 86400.0 END) AS avg_days,
         COUNT(*) AS total
       FROM reviews WHERE status='published'`
    )
    .get() as Record<string, unknown>;
  const total = num(reply.total);
  return {
    average: avg.a != null ? Math.round(num(avg.a) * 10) / 10 : null,
    distribution: Object.fromEntries([1, 2, 3, 4, 5].map((r) => [r, num(dist.find((d) => d.rating === r)?.cnt)])),
    replyRatePercent: total > 0 ? Math.round((num(reply.replied) / total) * 1000) / 10 : 0,
    avgReplyDays: reply.avg_days != null ? Math.round(num(reply.avg_days) * 10) / 10 : null,
    totalCount: total,
  };
}

/** SEO / search: top queries, zero-result queries, most viewed products. */
export async function searchStats(days = 30): Promise<Record<string, unknown>> {
  const from = isoDaysAgo(days);
  const top = await db
    .prepare(
      `SELECT q, COUNT(*) AS cnt, AVG(results_count) AS avg_results
       FROM search_queries WHERE created_at >= ? GROUP BY q ORDER BY cnt DESC LIMIT 20`
    )
    .all(from) as Array<Record<string, unknown>>;
  const zero = top.filter((t) => num(t.avg_results) < 1);
  const topProducts = await db
    .prepare(
      `SELECT p.name, p.slug, p.views_count AS views_count,
              (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi
               JOIN orders o ON o.id = oi.order_id
               WHERE oi.product_id = p.id AND o.status NOT IN ('Annulée', 'Remboursée')) AS sales_count
       FROM products p WHERE p.status = 'published'
       ORDER BY p.views_count DESC LIMIT 10`
    )
    .all() as Array<Record<string, unknown>>;
  const sitemapCount = await db
    .prepare(`SELECT COUNT(*) AS c FROM products WHERE status='published'`)
    .get() as { c: number };
  return {
    days,
    topQueries: top.map((t) => ({ q: String(t.q), count: num(t.cnt), avgResults: Math.round(num(t.avg_results) * 10) / 10 })),
    zeroResultQueries: zero.map((t) => String(t.q)),
    topViewedProducts: topProducts,
    sitemapProductCount: num(sitemapCount.c),
  };
}

/** Seasonality heatmap: sales by weekday × hour bucket. */
export async function seasonalityStats(days = 90): Promise<Array<Record<string, unknown>>> {
  const from = isoDaysAgo(days);
  return await db
    .prepare(
      `SELECT
         (EXTRACT(DOW FROM created_at::timestamptz)::int) AS weekday,
         SUM(CASE WHEN (EXTRACT(HOUR FROM created_at::timestamptz)::int) < 12 THEN 1 ELSE 0 END) AS morning,
         SUM(CASE WHEN (EXTRACT(HOUR FROM created_at::timestamptz)::int) >= 12 AND (EXTRACT(HOUR FROM created_at::timestamptz)::int) < 18 THEN 1 ELSE 0 END) AS afternoon,
         SUM(CASE WHEN (EXTRACT(HOUR FROM created_at::timestamptz)::int) >= 18 THEN 1 ELSE 0 END) AS evening
       FROM orders WHERE created_at >= ? GROUP BY weekday ORDER BY weekday`
    )
    .all(from) as Array<Record<string, unknown>>;
}

/** Buyer CRM: consolidated guest buyers from orders. */
export async function queryBuyers(filters: { q?: string; limit?: number }): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(Math.max(filters.limit || 100, 1), 500);
  const q = (filters.q || '').trim().toLowerCase();
  const rows = await db
    .prepare(
      `SELECT buyer_email AS email,
              MAX(buyer_name) AS name,
              MAX(buyer_phone) AS phone,
              MAX(delivery_zone_id) AS zone,
              COUNT(*) AS orders_count,
              COALESCE(SUM(CASE WHEN status NOT IN ('Annulée','Remboursée') THEN total_gnf ELSE 0 END),0) AS total_gnf,
              MIN(created_at) AS first_order_at,
              MAX(created_at) AS last_order_at,
              SUM(CASE WHEN status NOT IN ('Annulée','Remboursée') THEN 1 ELSE 0 END) AS valid_orders
       FROM orders WHERE buyer_email != ''
       GROUP BY buyer_email
       ORDER BY total_gnf DESC
       LIMIT ${limit}`
    )
    .all() as Array<Record<string, unknown>>;
  if (!q) return rows;
  return rows.filter(
    (r) =>
      String(r.email).toLowerCase().includes(q) ||
      String(r.name).toLowerCase().includes(q) ||
      String(r.phone).toLowerCase().includes(q)
  );
}

/** Single buyer dossier (orders, quotes, reviews, disputes). */
export async function buyerDossier(email: string): Promise<Record<string, unknown> | null> {
  const orders = (await db
    .prepare(
      `SELECT id, order_number, status, total_gnf, payment_plan, created_at FROM orders
       WHERE buyer_email = ? ORDER BY created_at DESC`
    )
    .all(email)) as Array<Record<string, unknown>>;
  if (orders.length === 0) return null;
  const quotes = await db
    .prepare(
      `SELECT id, step_status, quoted_amount_gnf, created_at FROM quote_requests WHERE buyer_email = ? ORDER BY created_at DESC`
    )
    .all(email);
  const reviews = await db
    .prepare(`SELECT id, rating, comment, created_at FROM reviews WHERE buyer_name = ? ORDER BY created_at DESC`)
    .all(String(orders[0]?.buyer_name || ''));
  const disputes = await db
    .prepare(`SELECT id, status, reason, created_at FROM disputes WHERE order_id IN (SELECT id FROM orders WHERE buyer_email = ?)`)
    .all(email);
  const totals = orders.reduce<{ totalGnf: number }>(
    (acc, o) => {
      const row = o as Record<string, unknown>;
      if (!['Annulée', 'Remboursée'].includes(String(row.status))) {
        acc.totalGnf += num(row.total_gnf);
      }
      return acc;
    },
    { totalGnf: 0 }
  );
  return { email, orders, quotes, reviews, disputes, lifetimeValueGnf: totals.totalGnf };
}

/** Top products by sales / conversion / views. */
export async function topProducts(metric: 'sales' | 'views' | 'conversion', limit = 10): Promise<Array<Record<string, unknown>>> {
  const salesExpr = `(SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = p.id AND o.status NOT IN ('Annulée', 'Remboursée'))`;
  const order =
    metric === 'views'
      ? 'p.views_count DESC'
      : metric === 'conversion'
        ? `(CASE WHEN p.views_count > 0 THEN ${salesExpr} * 1.0 / p.views_count ELSE 0 END) DESC`
        : `${salesExpr} DESC`;
  return await db
    .prepare(
      `SELECT p.id, p.name, p.slug, p.views_count, ${salesExpr} AS sales_count, p.price_gnf, p.stock_qty, vp.shop_name,
              (CASE WHEN p.views_count > 0 THEN ROUND(${salesExpr} * 100.0 / p.views_count, 1) ELSE 0 END) AS conversion_percent
       FROM products p JOIN vendor_profiles vp ON vp.user_id = p.vendor_id
       WHERE p.status='published' ORDER BY ${order} LIMIT ${Math.min(limit, 50)}`
    )
    .all() as Array<Record<string, unknown>>;
}

/** Sales split by category with commissions. */
export async function categoryStats(days = 30): Promise<Array<Record<string, unknown>>> {
  const from = isoDaysAgo(days);
  return await db
    .prepare(
      `SELECT c.name AS category, COUNT(oi.id) AS items_sold,
              COALESCE(SUM(oi.unit_price_gnf * oi.quantity),0) AS amount
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN categories c ON c.id = p.category_id
       JOIN orders o ON o.id = oi.order_id
       WHERE o.created_at >= ? AND o.status NOT IN ('Annulée','Remboursée')
       GROUP BY c.id ORDER BY amount DESC`
    )
    .all(from) as Array<Record<string, unknown>>;
}

/** ═══ SYSTEM HEALTH ═══ */
export async function systemHealth(): Promise<Record<string, unknown>> {
  const sizeRow = (await db
    .prepare(`SELECT pg_database_size(current_database()) AS size`)
    .get()) as { size: number };
  const dbSizeBytes = Number(sizeRow?.size || 0);
  const tables = [
    'users', 'vendor_profiles', 'products', 'orders', 'order_items', 'payments',
    'payouts', 'commissions', 'reviews', 'quote_requests',
    'conversations', 'messages', 'disputes', 'notifications', 'push_subscriptions',
    'audit_logs', 'webhook_events', 'analytics_events', 'search_queries', 'email_log',
    'issued_tokens', 'token_revocations', 'login_attempts', 'kyc_documents',
  ];
  const tableCounts: Record<string, number> = {};
  for (const t of tables) {
    tableCounts[t] = num((await db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c);
  }
  const webhookStats = await db
    .prepare(`SELECT COUNT(*) AS total FROM webhook_events`)
    .get() as { total: number };
  const emailStats = await db
    .prepare(
      `SELECT SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors
       FROM email_log`
    )
    .get() as Record<string, unknown>;

  return {
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    database: {
      engine: 'PostgreSQL (Neon)',
      sizeMb: Math.round(dbSizeBytes / 1024 / 1024 * 10) / 10,
      tableCounts,
    },
    integrations: {
      smtpConfigured: mailerEnabled,
      smtpFrom: process.env.SMTP_FROM || '(défaut)',
      vapidSource: process.env.VAPID_PUBLIC_KEY ? 'env' : 'base (auto-persistée)',
      appUrl: process.env.APP_URL || '(non défini)',
      nodeEnv: process.env.NODE_ENV || 'development',
    },
    webhookEventsTotal: num(webhookStats.total),
    emails: { sent: num(emailStats.sent), errors: num(emailStats.errors) },
  };
}
