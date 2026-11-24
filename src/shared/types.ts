export type UserRole = 'admin' | 'vendor';

export type VendorAccountStatus =
  | 'pending'
  | 'in_review'
  | 'validated'
  | 'rejected'
  | 'suspended';

export type OrderStatus =
  | 'Commandée'
  | 'Confirmée'
  | 'En préparation'
  | 'Expédiée'
  | 'En livraison'
  | 'Livrée'
  | 'Annulée'
  | 'Remboursée';

export type ProductMode = 'direct' | 'sur_devis';
export type ProductStatus = 'draft' | 'in_review' | 'published' | 'archived' | 'removed';

export interface WeightTier {
  maxKg: number;
  feeGnf: number;
}

export interface DeliveryZoneRule {
  id: string;
  name: string;
  region: string;
  landmarks: string;
  pricingMode: 'fixed' | 'weight_tier';
  fixedFeeGnf: number;
  weightTiers: WeightTier[];
  estimatedDays: string;
  active: boolean;
}

export interface RegistrationFieldRule {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  required: boolean;
  options?: string[];
}

export interface RequiredDocumentRule {
  type: string;
  label: string;
  description: string;
  required: boolean;
  appliesTo: 'all' | 'company';
}

export type PaymentPlan = 'full' | 'deposit' | 'bank_transfer';

export interface CommercialRestrictionsConfig {
  vendorRegistrationEnabled: boolean;
  preModerationEnabled: boolean;
  maxProductsUncertified: number;
  allowExternalContactsInMessages: boolean;
  trackingTokenValidityMonths: number;
  payoutsEnabled: boolean;
  defaultDepositPercent: number;
  bankTransferMinGnf: number;
}

export interface VendorBankDetails {
  bankTransferEnabled: boolean;
  bankName: string;
  bankAccountHolder: string;
  bankIbanRib: string;
  bankSwiftBic: string;
  bankInstructions: string;
}

export interface BadgeEffect {
  showOnProductCard: boolean;
  searchPriorityBoost: number;
  unlocksRestrictedCategories: boolean;
}

export interface BadgeAutoCriteria {
  minApprovedDocs: number;
  minPublishedProducts: number;
  minAverageRating: number;
}

export interface BadgeDefinition {
  id: string;
  slug: string;
  name: string;
  icon: string;
  criteriaDescription: string;
  publicDescription: string;
  isMandatory: boolean;
  autoAssign: boolean;
  autoCriteria: BadgeAutoCriteria;
  effect: BadgeEffect;
}

export interface ProductDeliveryConfig {
  pickupAvailable: boolean;
  pickupAddress: string;
  estimatedDelay: string;
  zoneFees: Record<string, number>;
}

export interface ProductMediaItem {
  id: string;
  type: 'image' | 'video';
  url: string;
  posterUrl?: string | null;
  altText: string;
  sortOrder: number;
}

export interface CategoryItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  requiredBadgeId: string | null;
  requiredBadgeName?: string | null;
  isRestricted: boolean;
  sortOrder: number;
}

export interface VendorPublicSummary {
  userId: string;
  slug: string;
  shopName: string;
  description: string;
  story: string;
  location: string;
  logoUrl: string;
  isEmrodOfficial: boolean;
  responseTimeLabel: string;
  averageRating: number;
  reviewCount: number;
  completedSalesCount: number;
  publishedProductsCount: number;
  bankTransferAvailable?: boolean;
  badges: Array<{
    id: string;
    slug: string;
    name: string;
    icon: string;
    publicDescription: string;
    criteriaDescription: string;
  }>;
}

export interface ProductItem {
  id: string;
  slug: string;
  vendorId: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  name: string;
  description: string;
  materials: string;
  dimensions: string;
  weightKg: number;
  priceGnf: number;
  compareAtPriceGnf: number | null;
  mode: ProductMode;
  status: ProductStatus;
  removalReason?: string | null;
  stockQty: number;
  isUniquePiece: boolean;
  keywords: string[];
  deliveryConfig: ProductDeliveryConfig;
  featured: boolean;
  viewsCount: number;
  salesCount?: number;
  averageRating: number;
  reviewCount: number;
  media: ProductMediaItem[];
  vendor: VendorPublicSummary;
  createdAt: string;
}

export interface CartItem {
  productId: string;
  slug: string;
  name: string;
  vendorId: string;
  vendorName: string;
  priceGnf: number;
  weightKg: number;
  imageUrl: string;
  quantity: number;
  maxQty: number;
  deliveryConfig: ProductDeliveryConfig;
  bankTransferAvailable?: boolean;
}

export interface ComplianceMissingItem {
  type: 'field' | 'document' | 'badge' | 'status';
  code: string;
  label: string;
  detail: string;
}

export interface ComplianceReport {
  isValidated: boolean;
  isCertified: boolean;
  earnedBadgeIds: string[];
  missingItems: ComplianceMissingItem[];
  canPublishInCategory: (category: { isRestricted: boolean; requiredBadgeId: string | null; name: string }) => {
    allowed: boolean;
    reason?: string;
  };
  canAddMoreProducts: (currentPublishedCount: number, maxUncertified: number) => {
    allowed: boolean;
    reason?: string;
  };
}
