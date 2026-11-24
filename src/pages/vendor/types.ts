import type {
  BadgeDefinition,
  CategoryItem,
  ComplianceMissingItem,
  DeliveryZoneRule,
  OrderStatus,
  PaymentPlan,
  ProductItem,
  RegistrationFieldRule,
  RequiredDocumentRule,
  VendorAccountStatus,
  VendorBankDetails,
} from '../../shared/types';

/** Shape of GET /api/vendor/dashboard (snake_case mirrors the API payload). */
export interface VendorDashboardPayload {
  user: {
    id: string;
    email: string;
    phone: string;
    role: string;
    status: VendorAccountStatus;
    status_reason: string;
    entity_type: 'individual' | 'company';
    created_at: string;
  };
  profile: {
    user_id: string;
    slug: string;
    shop_name: string;
    description: string;
    story: string;
    location: string;
    response_time_label?: string;
    custom_fields_json?: string;
    is_emrod_official: number;
  };
  bankDetails?: VendorBankDetails | null;
  compliance: {
    isValidated: boolean;
    isCertified: boolean;
    earnedBadgeIds: string[];
    missingItems: ComplianceMissingItem[];
  };
  documents: Array<{
    id: string;
    doc_type: string;
    doc_label: string;
    file_name: string;
    status: 'pending' | 'approved' | 'rejected';
    rejection_reason: string;
    created_at: string;
  }>;
  registrationRequirements: {
    fields: RegistrationFieldRule[];
    documents: RequiredDocumentRule[];
  };
  restrictions: {
    vendorRegistrationEnabled: boolean;
    preModerationEnabled: boolean;
    maxProductsUncertified: number;
    payoutsEnabled: boolean;
    allowExternalContactsInMessages?: boolean;
    defaultDepositPercent?: number;
    bankTransferMinGnf?: number;
  };
  categories: CategoryItem[];
  badges: BadgeDefinition[];
  zones: DeliveryZoneRule[];
  products: ProductItem[];
  orders: Array<{
    id: string;
    order_number: string;
    buyer_name: string;
    buyer_phone: string;
    delivery_zone_name: string;
    delivery_address: string;
    total_gnf: number;
    vendor_subtotal_gnf?: number;
    payment_plan?: PaymentPlan;
    deposit_percent?: number;
    amount_paid_now_gnf?: number;
    balance_due_gnf?: number;
    bank_transfer_reference?: string;
    bank_transfer_declared_at?: string | null;
    payment_status?: string | null;
    status: OrderStatus;
    created_at: string;
    items: Array<{ id: string; product_name: string; quantity: number; unit_price_gnf: number }>;
  }>;
  quotes: Array<{
    id: string;
    product_name: string;
    buyer_name: string;
    buyer_email: string;
    buyer_phone: string;
    preferred_material: string;
    dimensions_notes: string;
    project_notes: string;
    quantity?: number;
    desired_zone_id?: string;
    step_status: string;
    quoted_amount_gnf: number | null;
    payment_link_url: string | null;
    djomy_reference: string | null;
    created_at: string;
  }>;
  reviews: Array<{
    id: string;
    product_name: string;
    buyer_name: string;
    rating: number;
    comment: string;
    vendor_reply: string;
    created_at: string;
  }>;
  threads: Array<{
    id: string;
    type: string;
    buyer_name: string;
    buyer_email: string;
    messages: Array<{
      id: string;
      sender_role: string;
      sender_name: string;
      content: string;
      created_at: string;
    }>;
  }>;
  payouts: Array<{
    id: string;
    order_id: string;
    amount_gnf: number;
    reference: string;
    status: string;
    created_at: string;
  }>;
  stats: {
    totalRevenueGnf: number;
    ordersCount: number;
    publishedProductsCount: number;
    pendingOrdersCount: number;
  };
}

/** Product editor form state (VendorPortalPage → ProductsTab). */
export interface VendorProductForm {
  name: string;
  categoryId: string;
  description: string;
  materials: string;
  dimensions: string;
  weightKg: number;
  priceGnf: number;
  compareAtPriceGnf: string;
  mode: 'direct' | 'sur_devis';
  status: 'draft' | 'published' | 'archived';
  stockQty: number;
  isUniquePiece: boolean;
  keywords: string[];
  keywordInput: string;
  media: Array<{ type: 'image' | 'video'; url: string; altText: string }>;
  newMediaUrl: string;
  videoUrl: string;
  pickupAvailable: boolean;
  pickupAddress: string;
  estimatedDelay: string;
  zoneFees: Record<string, string>;
}

/** Profile & bank details form state (VendorPortalPage → OverviewTab). */
export interface VendorProfileForm {
  shopName: string;
  location: string;
  description: string;
  story: string;
  responseTimeLabel: string;
  customFields: Record<string, string>;
  bankTransferEnabled: boolean;
  bankName: string;
  bankAccountHolder: string;
  bankIbanRib: string;
  bankSwiftBic: string;
  bankInstructions: string;
}

/** Bundled sample images offered in the product editor. */
export const SAMPLE_MEDIA_URLS = [
  '/assets/seed/product_bibliotheque_noyer_1795278978216.jpg',
  '/assets/seed/product_console_chene_cuir_1795278979332.jpg',
  '/assets/seed/product_table_basse_metal_1795278978181.jpg',
  '/assets/seed/product_fauteuil_cuir_bois_1795278979269.jpg',
  '/assets/seed/product_buffet_sonfonia_1795278978653.jpg',
];
