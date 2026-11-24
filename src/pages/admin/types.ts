import type {
  BadgeDefinition,
  CategoryItem,
  CommercialRestrictionsConfig,
  DeliveryZoneRule,
  ProductItem,
  RegistrationFieldRule,
  RequiredDocumentRule,
  VendorAccountStatus,
} from '../../shared/types';
export type DeliveryFeeResult = ReturnType<typeof import('../../shared/domain').calculateDeliveryFee>;

/** Djomy integration diagnostics exposed on the payments tab. */
export interface DjomyDiagnostics {
  diagnostics: {
    mode: 'live_api' | 'sandbox_simulator';
    baseUrl: string;
    hasClientId: boolean;
    hasClientSecret: boolean;
    hasWebhookSecretOverride: boolean;
    webhookPath: string;
  };
  recentWebhooks: Array<{
    event_id: string;
    event_type: string;
    djomy_reference: string;
    created_at: string;
  }>;
}

/** Shape of GET /api/admin/overview (snake_case mirrors the API payload). */
export interface AdminOverviewPayload {
  kpis: {
    salesTodayGnf: number;
    salesMonthGnf: number;
    ordersCount: number;
    ordersByStatus: Record<string, number>;
    vendorsPending: number;
    vendorsValidated: number;
    productsPublished: number;
    openDisputes: number;
    flaggedMessagesCount: number;
    subscribersCount: number;
  };
  vendors: Array<{
    id: string;
    email: string;
    phone: string;
    status: VendorAccountStatus;
    status_reason: string;
    entity_type: string;
    shop_name: string;
    slug: string;
    location: string;
    is_emrod_official: number;
    documents: Array<{
      id: string;
      doc_type: string;
      doc_label: string;
      file_name: string;
      status: string;
      rejection_reason: string;
    }>;
    compliance: {
      isValidated: boolean;
      isCertified: boolean;
      earnedBadgeIds: string[];
      missingItems: Array<{ label: string; detail: string }>;
    };
  }>;
  orders: Array<{
    id: string;
    order_number: string;
    buyer_name: string;
    total_gnf: number;
    status: string;
    created_at: string;
  }>;
  products: ProductItem[];
  reviews: Array<{
    id: string;
    product_name: string;
    buyer_name: string;
    rating: number;
    comment: string;
    status: string;
    created_at: string;
  }>;
  flaggedMessages: Array<{
    id: string;
    sender_name: string;
    content: string;
    flag_reason: string;
    status: string;
    created_at: string;
  }>;
  disputes: Array<{
    id: string;
    order_number: string;
    buyer_name: string;
    reason: string;
    status: string;
    created_at: string;
  }>;
  payments: Array<{
    id: string;
    djomy_reference: string;
    provider_reference?: string;
    operator?: string;
    amount_gnf: number;
    status: string;
    created_at: string;
  }>;
  payouts: Array<{
    id: string;
    reference: string;
    order_number?: string;
    shop_name?: string;
    amount_gnf: number;
    commission_gnf?: number;
    net_amount_gnf?: number;
    status: string;
    created_at: string;
  }>;
  notifications: Array<{
    id: string;
    title: string;
    body: string;
    created_at: string;
    sent_count?: number;
    delivered_count?: number;
    opened_count?: number;
  }>;
  auditLogs: Array<{
    id: string;
    created_at: string;
    actor_name: string;
    action: string;
    target_type: string;
    target_id: string;
  }>;
  privacyRequests: Array<{
    id: string;
    email: string;
    phone: string;
    request_type: string;
    status: string;
    created_at: string;
  }>;
  badges: BadgeDefinition[];
  categories: CategoryItem[];
  zones: DeliveryZoneRule[];
  registrationRequirements: {
    fields: RegistrationFieldRule[];
    documents: RequiredDocumentRule[];
  };
  restrictions: CommercialRestrictionsConfig;
  editorial: Record<string, string>;
  legal: Record<string, string>;
}

/** Shared handler signatures passed from AdminPortalPage to its tabs. */
export interface AdminTabHandlers {
  loadAdminOverview: () => void | Promise<void>;
}

/* ─────────────────────────────────────────────────────────────────────────
 * V2 admin platform payloads (GET /api/admin/stats, /commissions, /orders…)
 * ──────────────────────────────────────────────────────────────────────── */

/** GET /api/admin/stats — consolidated analytics dashboard. */
export interface AdminStatsPayload {
  period: { from: string; to: string; label: string };
  kpis: {
    period: string;
    periodLabel: string;
    from: string;
    to: string;
    gmv: { current: number; previous: number; deltaPercent: number | null };
    commissions: {
      current: number;
      previous: number;
      deltaPercent: number | null;
      grossGnf: number;
      netVendorGnf: number;
      reversalGnf: number;
    };
    orders: {
      current: number;
      previous: number;
      deltaPercent: number | null;
      averageBasketGnf: number;
      byStatus: Record<string, number>;
      cancelRatePercent: number;
    };
    payments: { collectedGnf: number; refundedGnf: number; refundCount: number; refundRatePercent: number; failRatePercent: number };
    buyers: { unique: number; newCount: number; repeatCount: number };
    vendors: { validated: number; pending: number; suspended: number };
    openDisputes: number;
    pushSubscribers: number;
    quotesPipeline: QuotesPipelineSummary;
  };
  salesSeries: Array<{ day: string; ordersCount: number; gmvGnf: number; commissionGnf: number }>;
  funnel: {
    days: number;
    productViews: number;
    cartAdds: number;
    checkoutStarts: number;
    paymentSuccess: number;
    viewToCartPercent: number | null;
    cartToCheckoutPercent: number | null;
    checkoutToPaidPercent: number | null;
    viewToPaidPercent: number | null;
  };
  operators: Array<{ operator: string; total: number; ok: number; failed: number; amount: number }>;
  plans: Array<{ payment_plan: string; cnt: number; amount: number }>;
  quotes: QuotesPipelineSummary;
  delivery: {
    days: number;
    byZone: Array<{ zone: string; count: number; feesGnf: number; avgDeliveryDays: number | null }>;
    pickupCount: number;
    totalDelivered: number;
    avgOrderToDeliveredDays: number | null;
  };
  reviews: {
    average: number | null;
    distribution: Record<string, number>;
    replyRatePercent: number;
    avgReplyDays: number | null;
    totalCount: number;
  };
  searches: {
    days: number;
    topQueries: Array<{ q: string; count: number; avgResults: number }>;
    zeroResultQueries: string[];
    topViewedProducts: Array<Record<string, unknown>>;
    sitemapProductCount: number;
  };
  seasonality: Array<{ weekday: number; morning: number; afternoon: number; evening: number }>;
  topProducts: {
    sales: AdminTopProductRow[];
    views: AdminTopProductRow[];
    conversion: AdminTopProductRow[];
  };
  categories: Array<{ category: string; items_sold: number; amount: number }>;
  buyers: AdminBuyerRow[];
}

export interface QuotesPipelineSummary {
  byStep: Record<string, { count: number; valueGnf: number }>;
  totalRequests: number;
  paidCount: number;
  conversionPercent: number;
  avgDaysToQuote: number | null;
  avgDaysToPay: number | null;
  staleQuotedCount: number;
}

export interface AdminTopProductRow {
  id: string;
  name: string;
  slug: string;
  views_count: number;
  sales_count: number;
  price_gnf: number;
  stock_qty: number;
  shop_name: string;
  conversion_percent?: number;
}

export interface AdminBuyerRow {
  email: string;
  name: string | null;
  phone: string | null;
  zone: string | null;
  orders_count: number;
  valid_orders: number;
  total_gnf: number;
  first_order_at: string | null;
  last_order_at: string | null;
}

/** GET /api/admin/commissions — commission engine state. */
export interface CommissionsPayload {
  config: {
    enabled: boolean;
    defaultPercent: number;
    vendorOverrides: Record<string, number>;
    categoryOverrides: Record<string, number>;
    base: 'subtotal' | 'total';
    minCommissionGnf: number;
    applyToQuotes: boolean;
  };
  summary: {
    grossGnf: number;
    commissionGnf: number;
    netVendorGnf: number;
    earnedCount: number;
    reversalGnf: number;
    reversalCount: number;
  };
  byVendor: Array<{
    vendor_id: string;
    shop_name: string | null;
    gross_gnf: number;
    commission_gnf: number;
    net_vendor_gnf: number;
    avg_rate: number | null;
  }>;
  lines: CommissionLedgerLine[];
}

export interface CommissionLedgerLine {
  id: string;
  order_id: string | null;
  vendor_id: string;
  payment_id: string | null;
  quote_id: string | null;
  rate_percent: number;
  gross_gnf: number;
  commission_gnf: number;
  net_vendor_gnf: number;
  status: string;
  created_at: string;
  shop_name?: string | null;
  order_number?: string | null;
  djomy_reference?: string | null;
}

/** GET /api/admin/reports/monthly. */
export interface MonthlyReportsPayload {
  year: number;
  months: Array<{
    period: string;
    gmvGnf: number;
    ordersCount: number;
    averageBasketGnf: number;
    commissions: { commissionGnf: number; netVendorGnf: number; reversalGnf: number; earnedCount: number };
    byVendor: Array<Record<string, unknown>>;
    paymentsByOperator: Array<{ operator: string; cnt: number; amount: number }>;
  }>;
}

/** GET /api/admin/orders (+ detail). */
export interface AdminOrderRow {
  id: string;
  order_number: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone?: string;
  total_gnf: number;
  status: string;
  payment_plan: string;
  created_at: string;
}

export interface AdminOrderDetailPayload {
  order: AdminOrderRow & {
    delivery_zone_name: string;
    delivery_address: string;
    subtotal_gnf: number;
    delivery_fee_gnf: number;
    tracking_token_expires_at?: string | null;
  };
  items: Array<{ id: string; product_name: string; shop_name: string; quantity: number; unit_price_gnf: number }>;
  events: Array<{ status: string; actor_role: string; actor_name: string; comment: string; created_at: string }>;
  payments: Array<{ id: string; djomy_reference: string; type: string; method: string; operator: string; amount_gnf: number; status: string; created_at: string }>;
  payouts: Array<{ id: string; reference: string; amount_gnf: number; commission_gnf: number; net_amount_gnf: number; status: string }>;
  disputes: Array<{ id: string; reason: string; status: string }>;
  commissions: Array<{ id: string; commission_gnf: number; rate_percent: number; status: string }>;
}

/** GET /api/admin/products — hydrated ProductItem rows (camelCase, vendor summary included). */
export type AdminProductRow = ProductItem;

export interface AdminBuyerDossierPayload {
  email: string;
  orders: Array<{ id: string; order_number: string; total_gnf: number; status: string; created_at: string }>;
  quotes: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  disputes: Array<Record<string, unknown>>;
  lifetimeValueGnf: number;
}

/** GET /api/admin/security. */
export interface AdminSecurityPayload {
  failedAttempts: Array<{ ip: string; created_at: string }>;
  activeSessions: Array<{ jti: string; sub: string; role: string; email: string; exp: number; created_at: string }>;
  revokedCount: number;
  securityLogs: Array<{ id: string; created_at: string; actor_name: string; action: string; target_type: string; target_id: string }>;
  passcodeConfigured: boolean;
}

/** GET /api/admin/system. */
export interface AdminSystemPayload {
  health: {
    uptimeSeconds: number;
    nodeVersion: string;
    platform: string;
    memoryMb: number;
    database: { path: string; sizeMb: number; walSizeMb: number };
    integrations: { smtpConfigured: boolean; smtpFrom: string; vapidSource: string; appUrl: string; nodeEnv: string };
    webhookEventsTotal: number;
    emails: { sent: number; errors: number };
  };
  counts: Record<string, number>;
  maintenance: { enabled: boolean; message: string };
  integration: { djomy: string; smtpConfigured: boolean; vapidConfigured: boolean; appUrl: string; nodeVersion: string };
  webhooks: Array<{ event_id: string; event_type: string; djomy_reference: string; created_at: string }>;
  emails: Array<{ to_email: string; subject: string; status: string; error: string | null; created_at: string }>;
}

/** GET/POST/DELETE /api/admin/blacklist. */
export interface BlacklistEntry {
  id: string;
  value: string;
  kind: 'email' | 'phone';
  reason: string | null;
  created_at: string;
}
