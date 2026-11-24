import { db } from './db';
import {
  evaluateVendorCompliance,
  filterAndSortVendors,
  normalizeSearchText,
  type VendorSearchFilters,
} from '../src/shared/domain';
import type {
  BadgeDefinition,
  CategoryItem,
  CommercialRestrictionsConfig,
  ComplianceReport,
  DeliveryZoneRule,
  ProductItem,
  RegistrationFieldRule,
  RequiredDocumentRule,
  VendorAccountStatus,
  VendorPublicSummary,
} from '../src/shared/types';

export async function getRule<T>(key: string, fallback: T): Promise<T> {
  const row = await db.prepare(`SELECT value_json FROM platform_rules WHERE key = ?`).get(key) as
    | { value_json: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

export async function setRule(key: string, value: unknown): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO platform_rules (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), now);
}

export async function getAllBadges(): Promise<BadgeDefinition[]> {
  const rows = await db.prepare(`SELECT * FROM badge_definitions ORDER BY created_at ASC`).all() as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    icon: String(r.icon),
    criteriaDescription: String(r.criteria_description),
    publicDescription: String(r.public_description),
    isMandatory: Boolean(r.is_mandatory),
    autoAssign: Boolean(r.auto_assign),
    autoCriteria: JSON.parse(String(r.auto_criteria_json || '{}')),
    effect: JSON.parse(String(r.effect_json || '{}')),
  }));
}

export async function getAllCategories(): Promise<CategoryItem[]> {
  const rows = await db
    .prepare(
      `SELECT c.*, b.name AS required_badge_name
       FROM categories c
       LEFT JOIN badge_definitions b ON b.id = c.required_badge_id
       ORDER BY c.sort_order ASC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    description: String(r.description),
    requiredBadgeId: r.required_badge_id ? String(r.required_badge_id) : null,
    requiredBadgeName: r.required_badge_name ? String(r.required_badge_name) : null,
    isRestricted: Boolean(r.is_restricted),
    sortOrder: Number(r.sort_order),
  }));
}

export async function getVendorCompliance(vendorId: string): Promise<ComplianceReport | null> {
  const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(vendorId) as
    | Record<string, unknown>
    | undefined;
  const profile = await db.prepare(`SELECT * FROM vendor_profiles WHERE user_id = ?`).get(vendorId) as
    | Record<string, unknown>
    | undefined;
  if (!user || !profile) return null;

  const docs = await db
    .prepare(`SELECT doc_type, status FROM kyc_documents WHERE vendor_id = ?`)
    .all(vendorId) as Array<{ doc_type: string; status: 'pending' | 'approved' | 'rejected' }>;

  const certs = await db
    .prepare(`SELECT badge_id, status FROM certifications WHERE vendor_id = ?`)
    .all(vendorId) as Array<{ badge_id: string; status: 'active' | 'revoked' }>;

  const prodCountRow = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM products WHERE vendor_id = ? AND status = 'published'`)
    .get(vendorId) as { cnt: number };

  const ratingRow = await db
    .prepare(`SELECT AVG(rating) AS avg_r FROM reviews WHERE vendor_id = ? AND status = 'published'`)
    .get(vendorId) as { avg_r: number | null };

  const regReq = await getRule<{ fields: RegistrationFieldRule[]; documents: RequiredDocumentRule[] }>(
    'registration_requirements',
    { fields: [], documents: [] }
  );
  const badges = await getAllBadges();

  return evaluateVendorCompliance(
    {
      accountStatus: String(user.status) as VendorAccountStatus,
      entityType: (String(user.entity_type) === 'company' ? 'company' : 'individual'),
      shopName: String(profile.shop_name),
      description: String(profile.description),
      location: String(profile.location),
      customFields: JSON.parse(String(profile.custom_fields_json || '{}')),
      documents: docs.map((d) => ({ docType: d.doc_type, status: d.status })),
      manualBadgeIds: certs.filter((c) => c.status === 'active').map((c) => c.badge_id),
      revokedBadgeIds: certs.filter((c) => c.status === 'revoked').map((c) => c.badge_id),
      publishedProductsCount: Number(prodCountRow?.cnt || 0),
      averageRating: Number(ratingRow?.avg_r || 0),
    },
    regReq.fields,
    regReq.documents,
    badges
  );
}

export async function getVendorPublicSummary(vendorIdOrSlug: string): Promise<VendorPublicSummary | null> {
  const summaries = await getVendorPublicSummaries([vendorIdOrSlug]);
  const byId = summaries.get(vendorIdOrSlug);
  if (byId) return byId;
  // Legacy behavior: callers may pass the shop slug instead of the user id
  const row = await db
    .prepare(`SELECT user_id FROM vendor_profiles WHERE slug = ?`)
    .get(vendorIdOrSlug) as { user_id: string } | undefined;
  if (!row) return null;
  return (await getVendorPublicSummaries([row.user_id])).get(row.user_id) ?? null;
}

/** Splits ids into chunks small enough for IN(...) parameter limits. */
function chunkIds<T>(ids: T[], size = 400): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

/**
 * Batched vendor summaries: 6 grouped queries for N vendors instead of 5N+ queries
 * (the old per-vendor path caused a hard N+1 on every catalog / homepage render).
 */
export async function getVendorPublicSummaries(vendorIdsInput: string[]): Promise<Map<string, VendorPublicSummary>> {
  const result = new Map<string, VendorPublicSummary>();
  const vendorIds = [...new Set(vendorIdsInput.filter(Boolean))];
  if (vendorIds.length === 0) return result;

  const profileRows: Array<Record<string, unknown>> = [];
  for (const chunk of chunkIds(vendorIds)) {
    const ph = chunk.map(() => '?').join(',');
    profileRows.push(
      ...((await db
        .prepare(
          `SELECT u.id AS uid, u.status, u.entity_type, vp.*
           FROM users u
           JOIN vendor_profiles vp ON vp.user_id = u.id
           WHERE u.id IN (${ph})`
        )
        .all(...chunk)) as Array<Record<string, unknown>>)
    );
  }
  if (profileRows.length === 0) return result;

  const ids = profileRows.map((r) => String(r.uid));
  const docRows: Array<{ vendor_id: string; doc_type: string; status: 'pending' | 'approved' | 'rejected' }> = [];
  const certRows: Array<{ vendor_id: string; badge_id: string; status: 'active' | 'revoked' }> = [];
  const ratingMap = new Map<string, { cnt: number; avg: number }>();
  const salesMap = new Map<string, number>();
  const prodCountMap = new Map<string, number>();

  for (const chunk of chunkIds(ids)) {
    const ph = chunk.map(() => '?').join(',');
    docRows.push(
      ...((await db
        .prepare(`SELECT vendor_id, doc_type, status FROM kyc_documents WHERE vendor_id IN (${ph})`)
        .all(...chunk)) as typeof docRows)
    );
    certRows.push(
      ...((await db
        .prepare(`SELECT vendor_id, badge_id, status FROM certifications WHERE vendor_id IN (${ph})`)
        .all(...chunk)) as typeof certRows)
    );
    for (const r of await db
      .prepare(
        `SELECT vendor_id, COUNT(*) AS cnt, COALESCE(AVG(rating), 0) AS avg_rating
         FROM reviews WHERE status = 'published' AND vendor_id IN (${ph}) GROUP BY vendor_id`
      )
      .all(...chunk) as Array<{ vendor_id: string; cnt: number; avg_rating: number }>) {
      ratingMap.set(r.vendor_id, { cnt: Number(r.cnt), avg: Number(r.avg_rating) });
    }
    for (const r of await db
      .prepare(
        `SELECT oi.vendor_id, COUNT(DISTINCT o.id) AS cnt
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.status NOT IN ('Annulée', 'Remboursée') AND oi.vendor_id IN (${ph})
         GROUP BY oi.vendor_id`
      )
      .all(...chunk) as Array<{ vendor_id: string; cnt: number }>) {
      salesMap.set(r.vendor_id, Number(r.cnt));
    }
    for (const r of await db
      .prepare(
        `SELECT vendor_id, COUNT(*) AS cnt FROM products
         WHERE status = 'published' AND vendor_id IN (${ph}) GROUP BY vendor_id`
      )
      .all(...chunk) as Array<{ vendor_id: string; cnt: number }>) {
      prodCountMap.set(r.vendor_id, Number(r.cnt));
    }
  }

  const regReq = await getRule<{ fields: RegistrationFieldRule[]; documents: RequiredDocumentRule[] }>(
    'registration_requirements',
    { fields: [], documents: [] }
  );
  const badges = await getAllBadges();

  for (const row of profileRows) {
    const uid = String(row.uid);
    const docs = docRows.filter((d) => d.vendor_id === uid);
    const certs = certRows.filter((c) => c.vendor_id === uid);
    const compliance = evaluateVendorCompliance(
      {
        accountStatus: String(row.status) as VendorAccountStatus,
        entityType: String(row.entity_type) === 'company' ? 'company' : 'individual',
        shopName: String(row.shop_name),
        description: String(row.description),
        location: String(row.location),
        customFields: JSON.parse(String(row.custom_fields_json || '{}')),
        documents: docs.map((d) => ({ docType: d.doc_type, status: d.status })),
        manualBadgeIds: certs.filter((c) => c.status === 'active').map((c) => c.badge_id),
        revokedBadgeIds: certs.filter((c) => c.status === 'revoked').map((c) => c.badge_id),
        publishedProductsCount: prodCountMap.get(uid) ?? 0,
        averageRating: ratingMap.get(uid)?.avg ?? 0,
      },
      regReq.fields,
      regReq.documents,
      badges
    );

    const earnedIds = new Set(compliance?.earnedBadgeIds || []);
    const stats = ratingMap.get(uid) ?? { cnt: 0, avg: 0 };

    result.set(uid, {
      userId: uid,
      slug: String(row.slug),
      shopName: String(row.shop_name),
      description: String(row.description),
      story: String(row.story || ''),
      location: String(row.location),
      logoUrl: String(row.logo_url || ''),
      isEmrodOfficial: Boolean(row.is_emrod_official),
      responseTimeLabel: String(row.response_time_label || 'Répond sous 2h'),
      averageRating: Number(Number(stats.avg || 0).toFixed(1)),
      reviewCount: stats.cnt,
      completedSalesCount: salesMap.get(uid) ?? 0,
      publishedProductsCount: prodCountMap.get(uid) ?? 0,
      bankTransferAvailable:
        Boolean(Number(row.bank_transfer_enabled || 0) === 1) &&
        String(row.bank_iban_rib || '').trim().length > 5,
      badges: badges
        .filter((b) => earnedIds.has(b.id))
        .map((b) => ({
          id: b.id,
          slug: b.slug,
          name: b.name,
          icon: b.icon,
          publicDescription: b.publicDescription,
          criteriaDescription: b.criteriaDescription,
        })),
    });
  }

  return result;
}

export async function hydrateProduct(row: Record<string, unknown>): Promise<ProductItem> {
  return (await hydrateProducts([row]))[0];
}

/**
 * Batched product hydration: media, review stats, sales and vendor summaries are
 * loaded with grouped queries for the whole batch (no per-product N+1).
 */
export async function hydrateProducts(rows: Array<Record<string, unknown>>): Promise<ProductItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => String(r.id));
  const vendorIds = [...new Set(rows.map((r) => String(r.vendor_id)))];

  const mediaMap = new Map<string, Array<Record<string, unknown>>>();
  const reviewMap = new Map<string, { cnt: number; avg: number }>();
  const salesMap = new Map<string, number>();

  for (const chunk of chunkIds(ids)) {
    const ph = chunk.map(() => '?').join(',');
    for (const m of (await db
      .prepare(`SELECT * FROM product_media WHERE product_id IN (${ph}) ORDER BY sort_order ASC`)
      .all(...chunk)) as Array<Record<string, unknown>>) {
      const pid = String(m.product_id);
      const list = mediaMap.get(pid) || [];
      list.push(m);
      mediaMap.set(pid, list);
    }
    for (const r of await db
      .prepare(
        `SELECT product_id, COUNT(*) AS cnt, COALESCE(AVG(rating), 0) AS avg_rating
         FROM reviews WHERE status = 'published' AND product_id IN (${ph}) GROUP BY product_id`
      )
      .all(...chunk) as Array<{ product_id: string; cnt: number; avg_rating: number }>) {
      reviewMap.set(r.product_id, { cnt: Number(r.cnt), avg: Number(r.avg_rating) });
    }
    for (const r of await db
      .prepare(
        `SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0) AS qty
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.status NOT IN ('Annulée', 'Remboursée') AND oi.product_id IN (${ph})
         GROUP BY oi.product_id`
      )
      .all(...chunk) as Array<{ product_id: string; qty: number }>) {
      salesMap.set(r.product_id, Number(r.qty));
    }
  }

  const vendors = await getVendorPublicSummaries(vendorIds);

  return rows.map((row) => {
    const id = String(row.id);
    const reviewStats = reviewMap.get(id) ?? { cnt: 0, avg: 0 };
    return {
      id,
      slug: String(row.slug),
      vendorId: String(row.vendor_id),
      categoryId: String(row.category_id),
      categoryName: String(row.category_name || ''),
      categorySlug: String(row.category_slug || ''),
      name: String(row.name),
      description: String(row.description),
      materials: String(row.materials),
      dimensions: String(row.dimensions),
      weightKg: Number(row.weight_kg),
      priceGnf: Number(row.price_gnf),
      compareAtPriceGnf: row.compare_at_price_gnf ? Number(row.compare_at_price_gnf) : null,
      mode: String(row.mode) === 'sur_devis' ? 'sur_devis' : 'direct',
      status: String(row.status) as ProductItem['status'],
      removalReason: row.removal_reason ? String(row.removal_reason) : null,
      stockQty: Number(row.stock_qty),
      isUniquePiece: Boolean(row.is_unique_piece),
      keywords: JSON.parse(String(row.keywords_json || '[]')),
      deliveryConfig: JSON.parse(String(row.delivery_config_json || '{}')),
      featured: Boolean(row.featured),
      viewsCount: Number(row.views_count || 0),
      salesCount: salesMap.get(id) ?? 0,
      averageRating: Number(Number(reviewStats.avg || 0).toFixed(1)),
      reviewCount: reviewStats.cnt,
      media: (mediaMap.get(id) || []).map((m) => ({
        id: String(m.id),
        type: String(m.type) === 'video' ? 'video' : 'image',
        url: String(m.url),
        posterUrl: m.poster_url ? String(m.poster_url) : null,
        altText: String(m.alt_text),
        sortOrder: Number(m.sort_order),
      })),
      vendor: vendors.get(String(row.vendor_id))!,
      createdAt: String(row.created_at),
    };
  });
}

export async function queryPublicProducts(filters: {
  q?: string;
  category?: string;
  material?: string;
  badge?: string;
  zone?: string;
  vendor?: string;
  minPrice?: number;
  maxPrice?: number;
  minQty?: number;
  inStockOnly?: boolean;
  minRating?: number;
  sort?: string;
  mode?: string;
}): Promise<ProductItem[]> {
  const rows = await db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN users u ON u.id = p.vendor_id
       WHERE p.status = 'published' AND u.status = 'validated'
       ORDER BY p.featured DESC, p.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;

  let items = await hydrateProducts(rows);

  if (filters.category && filters.category !== 'all') {
    items = items.filter(
      (p) => p.categorySlug === filters.category || p.categoryId === filters.category
    );
  }
  if (filters.vendor && filters.vendor !== 'all') {
    items = items.filter(
      (p) => p.vendorId === filters.vendor || p.vendor.slug === filters.vendor
    );
  }
  if (filters.mode && filters.mode !== 'all') {
    items = items.filter((p) => p.mode === filters.mode);
  }
  if (filters.material && filters.material !== 'all') {
    const mNorm = normalizeSearchText(filters.material);
    items = items.filter((p) => normalizeSearchText(p.materials).includes(mNorm));
  }
  if (filters.badge && filters.badge !== 'all') {
    items = items.filter((p) =>
      p.vendor.badges.some((b) => b.slug === filters.badge || b.id === filters.badge)
    );
  }
  if (filters.zone && filters.zone !== 'all') {
    items = items.filter((p) => {
      const zKeys = Object.keys(p.deliveryConfig.zoneFees || {});
      return zKeys.length === 0 || zKeys.includes(filters.zone!) || p.deliveryConfig.pickupAvailable;
    });
  }
  if (filters.inStockOnly) {
    items = items.filter((p) => p.stockQty > 0);
  }
  if (typeof filters.minQty === 'number' && filters.minQty > 0) {
    items = items.filter((p) => p.stockQty >= filters.minQty!);
  }
  if (typeof filters.minRating === 'number' && filters.minRating > 0) {
    items = items.filter((p) => p.averageRating >= filters.minRating!);
  }
  if (typeof filters.minPrice === 'number' && filters.minPrice > 0) {
    items = items.filter((p) => p.mode === 'direct' && p.priceGnf >= filters.minPrice!);
  }
  if (typeof filters.maxPrice === 'number' && filters.maxPrice > 0) {
    items = items.filter((p) => p.mode === 'direct' && p.priceGnf <= filters.maxPrice!);
  }
  if (filters.q && filters.q.trim()) {
    const qNorm = normalizeSearchText(filters.q);
    const terms = qNorm.split(' ').filter(Boolean);
    items = items.filter((p) => {
      const haystack = normalizeSearchText(
        `${p.name} ${p.description} ${p.materials} ${p.categoryName} ${p.keywords.join(' ')} ${p.vendor.shopName}`
      );
      return terms.every((t) => {
        if (haystack.includes(t)) return true;
        // Mild typo tolerance: prefix match for terms >= 4 chars
        if (t.length >= 4) {
          return haystack.split(' ').some((w) => w.startsWith(t.slice(0, -1)));
        }
        return false;
      });
    });
  }

  switch (filters.sort) {
    case 'price_asc':
      items.sort((a, b) => (a.priceGnf || 999999999) - (b.priceGnf || 999999999));
      break;
    case 'price_desc':
      items.sort((a, b) => b.priceGnf - a.priceGnf);
      break;
    case 'rating':
      items.sort((a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount);
      break;
    case 'sales_desc':
      items.sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0) || b.viewsCount - a.viewsCount);
      break;
    case 'newest':
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    default:
      // Priority boost for certified badges + featured
      items.sort((a, b) => {
        const boostA = a.vendor.badges.length * 10 + (a.featured ? 5 : 0);
        const boostB = b.vendor.badges.length * 10 + (b.featured ? 5 : 0);
        return boostB - boostA;
      });
  }

  return items;
}

export async function queryPublicVendors(filters: VendorSearchFilters): Promise<VendorPublicSummary[]> {
  const rows = await db
    .prepare(
      `SELECT u.id
       FROM users u
       JOIN vendor_profiles vp ON vp.user_id = u.id
       WHERE u.status = 'validated'`
    )
    .all() as Array<{ id: string }>;

  const summaries = await getVendorPublicSummaries(rows.map((r) => r.id));
  const vendors = [...summaries.values()];
  return filterAndSortVendors(vendors, filters);
}

export async function getDeliveryZones(): Promise<DeliveryZoneRule[]> {
  return getRule<DeliveryZoneRule[]>('delivery_zones', []);
}

export async function getCommercialRestrictions(): Promise<CommercialRestrictionsConfig> {
  const defaults: CommercialRestrictionsConfig = {
    vendorRegistrationEnabled: true,
    preModerationEnabled: false,
    maxProductsUncertified: 3,
    allowExternalContactsInMessages: false,
    trackingTokenValidityMonths: 12,
    payoutsEnabled: true,
    defaultDepositPercent: 30,
    bankTransferMinGnf: 15000000,
  };
  return {
    ...defaults,
    ...(await getRule<Partial<CommercialRestrictionsConfig>>('commercial_restrictions', defaults)),
  };
}
