import type {
  BadgeDefinition,
  ComplianceMissingItem,
  ComplianceReport,
  DeliveryZoneRule,
  OrderStatus,
  PaymentPlan,
  ProductDeliveryConfig,
  RegistrationFieldRule,
  RequiredDocumentRule,
  VendorAccountStatus,
  VendorPublicSummary,
} from './types';

export const ORDER_STATUS_FLOW: OrderStatus[] = [
  'Commandée',
  'Confirmée',
  'En préparation',
  'Expédiée',
  'En livraison',
  'Livrée',
];

export function formatGNF(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `${safe.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} GNF`;
}

export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'avec',
  'pour',
  'dans',
  'cette',
  'une',
  'des',
  'les',
  'sur',
  'par',
  'qui',
  'que',
  'aux',
  'du',
  'de',
  'la',
  'le',
  'et',
  'en',
  'est',
  'sont',
  'plus',
  'tres',
  'afin',
  'sous',
  'sans',
  'comme',
  'tout',
  'tous',
  'piece',
  'pieces',
  'facon',
  'maison',
]);

const CRAFT_VOCABULARY = [
  'chene',
  'noyer',
  'iroko',
  'teck',
  'acajou',
  'cuir',
  'pleine fleur',
  'laiton',
  'bronze',
  'acier',
  'metal',
  'bibliotheque',
  'console',
  'buffet',
  'fauteuil',
  'table',
  'rangement',
  'sur mesure',
  'fait main',
  'artisanat',
  'conakry',
  'guinee',
  'bois noble',
  'cannele',
  'patine',
  'salon',
  'bureau',
  'entree',
];

export function extractKeywordsFromDescription(
  name: string,
  description: string,
  category = '',
  materials = ''
): string[] {
  const combinedRaw = `${name} ${category} ${materials} ${description}`;
  const normalized = normalizeSearchText(combinedRaw);
  const scores = new Map<string, number>();

  for (const term of CRAFT_VOCABULARY) {
    if (normalized.includes(term)) {
      scores.set(term, (scores.get(term) ?? 0) + 5);
    }
  }

  const tokens = normalized.split(' ').filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  for (const token of tokens) {
    scores.set(token, (scores.get(token) ?? 0) + 1);
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

export function slugify(input: string): string {
  return normalizeSearchText(input)
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
}

export interface CartDeliveryCalculationItem {
  weightKg: number;
  quantity: number;
  deliveryConfig?: ProductDeliveryConfig;
}

export function calculateDeliveryFee(
  zone: DeliveryZoneRule | null | undefined,
  items: CartDeliveryCalculationItem[]
): { fee: number; pickupOnly: boolean; label: string } {
  if (!zone || zone.id === 'pickup') {
    return {
      fee: 0,
      pickupOnly: true,
      label: 'Retrait en atelier EMROD (Sonfonia, Conakry)',
    };
  }

  if (items.length === 0) {
    return { fee: 0, pickupOnly: false, label: zone.name };
  }

  // Separate items with explicit per-product zone overrides from standard-rate items
  let overrideTotal = 0;
  const standardItems: CartDeliveryCalculationItem[] = [];

  for (const item of items) {
    const customFees = item.deliveryConfig?.zoneFees;
    if (customFees && typeof customFees[zone.id] === 'number') {
      overrideTotal += customFees[zone.id] * item.quantity;
    } else {
      standardItems.push(item);
    }
  }

  if (standardItems.length === 0) {
    return {
      fee: Math.round(overrideTotal),
      pickupOnly: false,
      label: `${zone.name} · Tarif atelier (${zone.estimatedDays})`,
    };
  }

  if (zone.pricingMode === 'fixed') {
    return {
      fee: Math.round(overrideTotal + zone.fixedFeeGnf),
      pickupOnly: false,
      label: `${zone.name} · Tarif fixe (${zone.estimatedDays})`,
    };
  }

  const standardWeight = standardItems.reduce((sum, item) => sum + item.weightKg * item.quantity, 0);
  const sortedTiers = [...zone.weightTiers].sort((a, b) => a.maxKg - b.maxKg);
  const matchedTier = sortedTiers.find((tier) => standardWeight <= tier.maxKg);
  const standardFee = matchedTier
    ? matchedTier.feeGnf
    : sortedTiers.length > 0
      ? sortedTiers[sortedTiers.length - 1].feeGnf
      : zone.fixedFeeGnf;

  const totalWeight = items.reduce((sum, item) => sum + item.weightKg * item.quantity, 0);
  return {
    fee: Math.round(overrideTotal + standardFee),
    pickupOnly: false,
    label: `${zone.name} · ${Math.round(totalWeight)} kg (${zone.estimatedDays})`,
  };
}

export function canTransitionOrderStatus(
  current: OrderStatus,
  next: OrderStatus,
  actorRole: 'system' | 'vendor' | 'admin' | 'buyer'
): boolean {
  if (current === next) return false;

  if (next === 'Remboursée') {
    return actorRole === 'admin' && (current === 'Annulée' || current === 'Commandée' || current === 'Confirmée');
  }

  if (next === 'Annulée') {
    const cancellableBeforeShipment: OrderStatus[] = ['Commandée', 'Confirmée', 'En préparation'];
    if (!cancellableBeforeShipment.includes(current)) {
      return false;
    }
    return actorRole === 'buyer' || actorRole === 'vendor' || actorRole === 'admin';
  }

  if (actorRole === 'buyer') {
    return false;
  }

  const currentIdx = ORDER_STATUS_FLOW.indexOf(current);
  const nextIdx = ORDER_STATUS_FLOW.indexOf(next);
  if (currentIdx === -1 || nextIdx === -1) return false;

  // Vendor / Admin can advance step-by-step or confirm directly
  if (actorRole === 'vendor' || actorRole === 'admin') {
    return nextIdx > currentIdx;
  }

  return actorRole === 'system' && next === 'Commandée';
}

export function getVendorAccountStatusLabel(status: VendorAccountStatus): string {
  switch (status) {
    case 'pending':
      return 'En attente de justificatifs';
    case 'in_review':
      return 'En cours de vérification KYC';
    case 'validated':
      return 'Atelier validé';
    case 'rejected':
      return 'Dossier refusé';
    case 'suspended':
      return 'Boutique suspendue';
    default:
      return String(status);
  }
}

export function canVendorAdvanceOrder(params: {
  status: OrderStatus;
  paymentPlan?: PaymentPlan;
  balanceDueGnf?: number;
  paymentStatus?: string | null;
}): { allowed: boolean; reason?: string } {
  if (params.status === 'Annulée' || params.status === 'Remboursée' || params.status === 'Livrée') {
    return { allowed: false, reason: 'Cette commande est déjà clôturée.' };
  }
  const plan = params.paymentPlan || 'full';
  if (plan === 'bank_transfer' && Number(params.balanceDueGnf ?? 0) > 0) {
    return {
      allowed: false,
      reason: 'Veuillez d’abord confirmer la réception du virement bancaire avant d’avancer la commande.',
    };
  }
  if (plan !== 'bank_transfer' && (params.paymentStatus === 'pending' || params.paymentStatus === 'failed')) {
    return {
      allowed: false,
      reason: 'Le paiement Djomy n’a pas encore été confirmé pour cette commande.',
    };
  }
  return { allowed: true };
}

export function extractTrackingTokenFromText(text: string): string | null {
  const m = text.match(/\bemr_[a-zA-Z0-9_]{6,}\b/);
  return m ? m[0] : null;
}

export interface VendorComplianceInput {
  accountStatus: VendorAccountStatus;
  entityType: 'individual' | 'company';
  shopName: string;
  description: string;
  location: string;
  customFields: Record<string, string>;
  documents: Array<{ docType: string; status: 'pending' | 'approved' | 'rejected' }>;
  manualBadgeIds: string[];
  revokedBadgeIds: string[];
  publishedProductsCount: number;
  averageRating: number;
}

export function evaluateVendorCompliance(
  vendor: VendorComplianceInput,
  registrationFields: RegistrationFieldRule[],
  requiredDocs: RequiredDocumentRule[],
  badgeDefinitions: BadgeDefinition[]
): ComplianceReport {
  const missingItems: ComplianceMissingItem[] = [];
  const isValidated = vendor.accountStatus === 'validated';

  if (!isValidated) {
    missingItems.push({
      type: 'status',
      code: 'ACCOUNT_NOT_VALIDATED',
      label: 'Validation administrative du compte',
      detail:
        vendor.accountStatus === 'rejected'
          ? 'Votre dossier a été refusé. Veuillez corriger les pièces et soumettre à nouveau.'
          : vendor.accountStatus === 'suspended'
            ? 'Votre boutique est actuellement suspendue par la modération.'
            : 'Votre dossier est en attente de validation par EMROD.',
    });
  }

  // Check dynamic registration fields
  for (const field of registrationFields) {
    if (!field.required) continue;
    const baseMap: Record<string, string> = {
      shopName: vendor.shopName,
      description: vendor.description,
      location: vendor.location,
    };
    const val = (baseMap[field.key] ?? vendor.customFields[field.key] ?? '').trim();
    if (!val) {
      missingItems.push({
        type: 'field',
        code: field.key,
        label: field.label,
        detail: `Champ obligatoire manquant : ${field.label}.`,
      });
    }
  }

  // Check required KYC documents
  let approvedDocsCount = 0;
  for (const doc of vendor.documents) {
    if (doc.status === 'approved') approvedDocsCount += 1;
  }

  for (const rule of requiredDocs) {
    if (!rule.required) continue;
    if (rule.appliesTo === 'company' && vendor.entityType !== 'company') continue;

    const matched = vendor.documents.find((d) => d.docType === rule.type);
    if (!matched) {
      missingItems.push({
        type: 'document',
        code: rule.type,
        label: rule.label,
        detail: `Document requis non déposé : ${rule.label}.`,
      });
    } else if (matched.status !== 'approved') {
      missingItems.push({
        type: 'document',
        code: rule.type,
        label: rule.label,
        detail:
          matched.status === 'rejected'
            ? `Document refusé (${rule.label}) : veuillez soumettre une nouvelle copie lisible.`
            : `Document en attente d’examen (${rule.label}).`,
      });
    }
  }

  // Evaluate badges (manual + auto criteria)
  const earnedSet = new Set<string>(
    vendor.manualBadgeIds.filter((id) => !vendor.revokedBadgeIds.includes(id))
  );

  for (const badge of badgeDefinitions) {
    if (vendor.revokedBadgeIds.includes(badge.id)) continue;
    if (badge.autoAssign && isValidated) {
      const meetsDocs = approvedDocsCount >= badge.autoCriteria.minApprovedDocs;
      const meetsProducts = vendor.publishedProductsCount >= badge.autoCriteria.minPublishedProducts;
      const meetsRating =
        badge.autoCriteria.minAverageRating <= 0 ||
        vendor.averageRating >= badge.autoCriteria.minAverageRating;
      if (meetsDocs && meetsProducts && meetsRating) {
        earnedSet.add(badge.id);
      }
    }

    if (badge.isMandatory && !earnedSet.has(badge.id)) {
      missingItems.push({
        type: 'badge',
        code: badge.id,
        label: `Badge « ${badge.name} »`,
        detail: badge.criteriaDescription,
      });
    }
  }

  const earnedBadgeIds = Array.from(earnedSet);

  return {
    isValidated,
    isCertified: earnedBadgeIds.length > 0,
    earnedBadgeIds,
    missingItems,
    canPublishInCategory: (category) => {
      if (!isValidated) {
        return {
          allowed: false,
          reason: 'Votre boutique doit être validée par EMROD avant de publier des créations.',
        };
      }
      if (category.isRestricted && category.requiredBadgeId) {
        if (!earnedSet.has(category.requiredBadgeId)) {
          const requiredBadge = badgeDefinitions.find((b) => b.id === category.requiredBadgeId);
          return {
            allowed: false,
            reason: `La catégorie « ${category.name} » exige le badge « ${
              requiredBadge?.name ?? 'Atelier vérifié'
            } ». Complétez votre mise en conformité.`,
          };
        }
      }
      return { allowed: true };
    },
    canAddMoreProducts: (currentPublishedCount, maxUncertified) => {
      if (!isValidated) {
        return {
          allowed: false,
          reason: 'Compte vendeur non validé.',
        };
      }
      if (earnedBadgeIds.length === 0 && currentPublishedCount >= maxUncertified) {
        return {
          allowed: false,
          reason: `Plafond atteint : les vendeurs non certifiés sont limités à ${maxUncertified} produit(s) publié(s). Obtenez un badge de certification pour publier sans limite.`,
        };
      }
      return { allowed: true };
    },
  };
}

export function calculatePaymentPlanAmounts(
  totalGnf: number,
  plan: PaymentPlan,
  depositPercent = 30
): { amountPaidNowGnf: number; balanceDueGnf: number; depositPercentApplied: number } {
  const safeTotal = Math.max(0, Math.round(totalGnf));
  if (plan === 'bank_transfer') {
    return {
      amountPaidNowGnf: 0,
      balanceDueGnf: safeTotal,
      depositPercentApplied: 0,
    };
  }
  if (plan === 'deposit') {
    const clampedPct = Math.min(80, Math.max(10, Math.round(depositPercent)));
    const amountPaidNowGnf = Math.round((safeTotal * clampedPct) / 100);
    return {
      amountPaidNowGnf,
      balanceDueGnf: Math.max(0, safeTotal - amountPaidNowGnf),
      depositPercentApplied: clampedPct,
    };
  }
  return {
    amountPaidNowGnf: safeTotal,
    balanceDueGnf: 0,
    depositPercentApplied: 100,
  };
}

export function isBankTransferEligible(params: {
  totalGnf: number;
  minGnf: number;
  singleVendor: boolean;
  vendorBankEnabled: boolean;
}): { eligible: boolean; reason?: string } {
  if (!params.singleVendor) {
    return {
      eligible: false,
      reason:
        'Le virement bancaire direct est réservé aux commandes provenant d’un seul atelier.',
    };
  }
  if (!params.vendorBankEnabled) {
    return {
      eligible: false,
      reason: 'Cet atelier n’a pas encore activé la réception par virement bancaire.',
    };
  }
  if (params.totalGnf < params.minGnf) {
    return {
      eligible: false,
      reason: `Le virement bancaire direct est ouvert aux commandes importantes dès ${formatGNF(params.minGnf)}.`,
    };
  }
  return { eligible: true };
}

// ---------------------------------------------------------------------------
// COMMISSIONS PLATEFORME (moteur partagé front/back, testé dans domain.test.ts)
// ---------------------------------------------------------------------------

export interface CommissionBreakdown {
  grossGnf: number;
  ratePercent: number;
  commissionGnf: number;
  netVendorGnf: number;
}

/**
 * Computes the platform commission share attributable to ONE vendor for a given
 * payment amount. Priority of rates is resolved upstream (vendor > category > default).
 *
 * - base 'subtotal': delivery fees are excluded from the taxable base (the payment is
 *   scaled by products/total before being split between vendors).
 * - base 'total': the whole payment amount is taxable and split between vendors
 *   proportionally to their product subtotal.
 */
export function computeCommissionShare(params: {
  amountGnf: number;
  orderSubtotalGnf: number;
  orderTotalGnf: number;
  vendorSubtotalGnf: number;
  ratePercent: number;
  base: 'subtotal' | 'total';
  minCommissionGnf?: number;
}): CommissionBreakdown {
  const amount = Math.max(0, Math.round(params.amountGnf));
  const subtotal = Math.max(0, Math.round(params.orderSubtotalGnf));
  const total = Math.max(0, Math.round(params.orderTotalGnf));
  const vendorSubtotal = Math.max(0, Math.round(params.vendorSubtotalGnf));
  const rate = Math.max(0, Math.min(100, Number(params.ratePercent) || 0));

  // Part of the payment that is taxable
  const taxable =
    params.base === 'total' ? amount : subtotal > 0 && total > 0 ? (amount * subtotal) / total : amount;
  // Vendor share of the taxable base (proportional to product subtotals)
  const ratio = subtotal > 0 ? vendorSubtotal / subtotal : 1;
  const gross = Math.round(taxable * ratio);

  let commission = rate > 0 ? Math.round((gross * rate) / 100) : 0;
  if (rate > 0 && params.minCommissionGnf && commission > 0) {
    commission = Math.max(params.minCommissionGnf, commission);
  }
  commission = Math.min(commission, gross);

  return {
    grossGnf: gross,
    ratePercent: rate,
    commissionGnf: commission,
    netVendorGnf: gross - commission,
  };
}

/** Resolves the effective commission rate: vendor override > category override > default. */
export function resolveCommissionRate(params: {
  defaultPercent: number;
  vendorOverrides: Record<string, number>;
  categoryOverrides: Record<string, number>;
  vendorId: string;
  categoryId: string;
}): number {
  const vendorRate = params.vendorOverrides[params.vendorId];
  if (typeof vendorRate === 'number' && Number.isFinite(vendorRate)) return vendorRate;
  const categoryRate = params.categoryOverrides[params.categoryId];
  if (typeof categoryRate === 'number' && Number.isFinite(categoryRate)) return categoryRate;
  return params.defaultPercent;
}

export interface ExternalContactCheckResult {
  blocked: boolean;
  matchedKind?: 'email' | 'phone' | 'external_app' | 'url';
  reason?: string;
}

export function detectExternalContactAttempt(rawText: string): ExternalContactCheckResult {
  const text = String(rawText || '').trim();
  if (!text) return { blocked: false };

  // 1. Check email addresses
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) {
    return {
      blocked: true,
      matchedKind: 'email',
      reason:
        'Pour votre sécurité et la garantie EMROD, le partage d’adresses courriel externes est bloqué. Tous les échanges restent sur la plateforme.',
    };
  }

  // 2. Check off-platform messaging apps & social links/handles
  if (
    /\b(whatsapp|whatsap|watsapp|wa\.me|telegram|t\.me|viber|signal|snapchat|instagram\.com|facebook\.com|fb\.com|fb\.me|hors[\s-]+plateforme)\b/i.test(
      text
    )
  ) {
    return {
      blocked: true,
      matchedKind: 'external_app',
      reason:
        'Les échanges via WhatsApp, Telegram ou réseaux externes sont interdits afin de sécuriser votre transaction et votre garantie EMROD.',
    };
  }

  // 3. Check external URLs
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(text)) {
    return {
      blocked: true,
      matchedKind: 'url',
      reason:
        'L’envoi de liens externes est désactivé dans la messagerie EMROD. Utilisez exclusivement cet espace sécurisé.',
    };
  }

  // 4. Strip legitimate dimensions, order references, and GNF prices before checking phone patterns
  const sanitized = text
    // Strip order/Djomy/quote codes like EMR-2026-1042, DJM-SEED-1042, DEV-2026-001
    .replace(/\b(?:EMR|DJM|QTE|ORD|DEV)[-_A-Z0-9]{3,}\b/gi, ' ')
    // Strip legitimate bank transfer slip references (e.g. VIR-BICIGUI-2026-9912, REF-2026-0412)
    .replace(/\b(?:VIR|REF|TRN|TXN|BORD)[-_](?:[A-Z]{2,}|20\d{2})[-_A-Z0-9]{2,}\b/gi, ' ')
    // Strip dimensions like "210 x 38 x 225 cm" or "180x90"
    .replace(/\b\d+(?:[.,]\d+)?\s*[x×*]\s*\d+(?:[.,]\d+)?(?:\s*[x×*]\s*\d+(?:[.,]\d+)?)?\s*(?:cm|mm|m)?\b/gi, ' ')
    // Strip numbers followed by currency or measurement units
    .replace(/\b\d[\d\s.,]{1,15}\s*(?:gnf|fg|francs?|fcfa|eur|usd|kg|cm|mm|m)\b/gi, ' ')
    // Strip formatted thousands/millions like "15 000 000" or "8 500 000"
    .replace(/\b\d{1,3}(?:[\s.]000){1,3}\b/g, ' ');

  // Match Guinea phone (+224 6xx xx xx xx / 6xx-xx-xx-xx / 623885959) or general 8+ digit phone sequences
  const phoneRegex =
    /(?:\+|00)?224[\s.-]*6[\d\s.-]{6,12}\d|\b6\d{2}[\s.-]*\d{2}[\s.-]*\d{2}[\s.-]*\d{2}\b|\b(?:\+?\d[\d\s.-]{7,15}\d)\b/;

  const match = sanitized.match(phoneRegex);
  if (match) {
    const digitsOnly = match[0].replace(/\D/g, '');
    if (digitsOnly.length >= 8) {
      return {
        blocked: true,
        matchedKind: 'phone',
        reason:
          'Par sécurité, le partage de numéros de téléphone directs est bloqué. Communiquez et finalisez votre commande exclusivement sur EMROD.',
      };
    }
  }

  return { blocked: false };
}

export interface VendorSearchFilters {
  q?: string;
  minSales?: number;
  badge?: string;
  minRating?: number;
  location?: string;
  bankTransferOnly?: boolean;
  sort?: string;
}

export function filterAndSortVendors(
  vendors: VendorPublicSummary[],
  filters: VendorSearchFilters
): VendorPublicSummary[] {
  let list = [...vendors];

  if (typeof filters.minSales === 'number' && filters.minSales > 0) {
    list = list.filter((v) => v.completedSalesCount >= filters.minSales!);
  }
  if (typeof filters.minRating === 'number' && filters.minRating > 0) {
    list = list.filter((v) => v.averageRating >= filters.minRating!);
  }
  if (filters.badge && filters.badge !== 'all') {
    list = list.filter((v) =>
      v.badges.some((b) => b.slug === filters.badge || b.id === filters.badge)
    );
  }
  if (filters.location && filters.location !== 'all') {
    const locNorm = normalizeSearchText(filters.location);
    list = list.filter((v) => normalizeSearchText(v.location).includes(locNorm));
  }
  if (filters.bankTransferOnly) {
    list = list.filter((v) => Boolean(v.bankTransferAvailable));
  }
  if (filters.q && filters.q.trim()) {
    const terms = normalizeSearchText(filters.q).split(' ').filter(Boolean);
    list = list.filter((v) => {
      const haystack = normalizeSearchText(
        `${v.shopName} ${v.description} ${v.story} ${v.location} ${v.badges.map((b) => b.name).join(' ')}`
      );
      return terms.every((t) => {
        if (haystack.includes(t)) return true;
        if (t.length >= 4) {
          return haystack.split(' ').some((w) => w.startsWith(t.slice(0, -1)));
        }
        return false;
      });
    });
  }

  switch (filters.sort) {
    case 'sales_desc':
      list.sort(
        (a, b) =>
          b.completedSalesCount - a.completedSalesCount || b.averageRating - a.averageRating
      );
      break;
    case 'rating':
      list.sort(
        (a, b) =>
          b.averageRating - a.averageRating || b.reviewCount - a.reviewCount
      );
      break;
    case 'products_desc':
      list.sort(
        (a, b) =>
          b.publishedProductsCount - a.publishedProductsCount ||
          b.completedSalesCount - a.completedSalesCount
      );
      break;
    default:
      list.sort(
        (a, b) =>
          b.badges.length * 10 +
          b.completedSalesCount -
          (a.badges.length * 10 + a.completedSalesCount)
      );
  }

  return list;
}
