import { z } from 'zod';

export const guineaPhoneRegex = /^(\+?224)?[\s-]?6[0-9]{2}[\s-]?[0-9]{2}[\s-]?[0-9]{2}[\s-]?[0-9]{2}$|^\+?[0-9]{8,15}$/;

export const guestCheckoutSchema = z
  .object({
    buyerName: z.string().trim().min(2, 'Veuillez indiquer votre nom complet.'),
    buyerEmail: z.string().trim().email('Adresse courriel invalide.'),
    buyerEmailConfirm: z.string().trim().email('Confirmation du courriel invalide.'),
    buyerPhone: z
      .string()
      .trim()
      .regex(guineaPhoneRegex, 'Numéro de téléphone invalide (ex. +224 623 88 59 59).'),
    deliveryZoneId: z.string().trim().min(1, 'Veuillez sélectionner une zone de livraison.'),
    deliveryAddress: z.string().trim().min(4, 'Veuillez préciser votre adresse ou choix de retrait.'),
    deliveryLandmark: z.string().trim().optional().default(''),
    paymentMethod: z.enum(['mobile_money', 'card', 'qr', 'bank_transfer']),
    paymentOperator: z.string().trim().optional().default('Orange Money'),
    paymentMode: z.enum(['redirect', 'direct', 'bank_transfer']).default('redirect'),
    paymentPlan: z.enum(['full', 'deposit', 'bank_transfer']).default('full'),
    idempotencyKey: z.string().trim().min(8),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          quantity: z.number().int().min(1).max(50),
        })
      )
      .min(1, 'Votre panier est vide.'),
  })
  .refine((data) => data.buyerEmail.toLowerCase() === data.buyerEmailConfirm.toLowerCase(), {
    message: 'Les deux adresses courriel doivent correspondre.',
    path: ['buyerEmailConfirm'],
  });

export const quoteRequestSchema = z.object({
  productId: z.string().min(1),
  buyerName: z.string().trim().min(2, 'Nom requis.'),
  buyerEmail: z.string().trim().email('Courriel invalide.'),
  buyerPhone: z.string().trim().regex(guineaPhoneRegex, 'Téléphone invalide.'),
  preferredMaterial: z.string().trim().min(2, 'Veuillez choisir ou préciser le matériau.'),
  dimensionsNotes: z.string().trim().min(3, 'Indiquez vos dimensions souhaitées.'),
  projectNotes: z.string().trim().min(10, 'Décrivez votre projet en quelques mots (10 car. min).'),
  quantity: z.number().int().min(1).max(50).optional().default(1),
  desiredZoneId: z.string().trim().optional().default('ratoma-sonfonia'),
});

export const vendorRegisterSchema = z.object({
  email: z.string().trim().email('Courriel professionnel invalide.'),
  phone: z.string().trim().regex(guineaPhoneRegex, 'Téléphone invalide.'),
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères.'),
  shopName: z.string().trim().min(2, 'Nom de boutique requis.'),
  entityType: z.enum(['individual', 'company']).default('individual'),
  location: z.string().trim().min(2, 'Localisation requise (ex. Conakry, Ratoma).'),
  description: z.string().trim().min(20, 'Décrivez votre atelier (20 caractères minimum).'),
  story: z.string().trim().optional().default(''),
  customFields: z.record(z.string(), z.string()).optional().default({}),
});

export const productUpsertSchema = z.object({
  name: z.string().trim().min(3, 'Le nom du produit est requis (3 car. min).'),
  categoryId: z.string().trim().min(1, 'La catégorie est requise.'),
  description: z
    .string()
    .trim()
    .min(80, 'La description doit contenir au moins 80 caractères pour le référencement.'),
  materials: z.string().trim().min(2, 'Précisez les matériaux (ex. Chêne, cuir pleine fleur).'),
  dimensions: z.string().trim().min(2, 'Précisez les dimensions.'),
  weightKg: z.number().min(0.5).max(1000),
  priceGnf: z.number().int().min(0),
  compareAtPriceGnf: z.number().int().min(0).nullable().optional(),
  mode: z.enum(['direct', 'sur_devis']),
  status: z.enum(['draft', 'in_review', 'published', 'archived']),
  stockQty: z.number().int().min(0).max(500),
  isUniquePiece: z.boolean(),
  keywords: z.array(z.string().trim().min(1)).max(20),
  deliveryConfig: z.object({
    pickupAvailable: z.boolean(),
    pickupAddress: z.string().trim(),
    estimatedDelay: z.string().trim().min(2),
    zoneFees: z.record(z.string(), z.number().min(0)),
  }),
  media: z
    .array(
      z.object({
        type: z.enum(['image', 'video']),
        url: z.string().trim().min(1),
        posterUrl: z.string().trim().nullable().optional(),
        altText: z.string().trim().min(2),
        sortOrder: z.number().int().min(0),
      })
    )
    .min(1, 'Ajoutez au moins une image produit.')
    .max(11),
});

export const reviewSubmitSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(8, 'Merci de partager un avis détaillé (8 caractères min).').max(1500),
  photos: z.array(z.string().trim().min(1)).max(3).optional().default([]),
});

export const messageSubmitSchema = z.object({
  content: z.string().trim().min(2, 'Le message ne peut pas être vide.').max(2000),
  senderName: z.string().trim().min(2).max(120).optional(),
  senderEmail: z.string().trim().email().optional(),
});

export const alertDispatchSchema = z.object({
  title: z.string().trim().min(3, 'Titre requis.').max(120),
  body: z.string().trim().min(5, 'Message requis.').max(280),
  targetCategory: z.string().trim().default('all'),
  targetRegion: z.string().trim().default('all'),
  targetUrl: z.string().trim().default('/catalogue'),
  scheduledFor: z.string().trim().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Vendor portal writes
// ---------------------------------------------------------------------------

export const vendorProfileUpdateSchema = z.object({
  shopName: z.string().trim().min(2).max(120).optional(),
  location: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().min(20).max(4000).optional(),
  story: z.string().trim().max(6000).optional(),
  responseTimeLabel: z.string().trim().min(2).max(80).optional(),
  customFields: z.record(z.string(), z.string()).optional(),
  bankTransferEnabled: z.boolean().optional(),
  bankName: z.string().trim().max(160).optional(),
  bankAccountHolder: z.string().trim().max(160).optional(),
  bankIbanRib: z.string().trim().max(64).optional(),
  bankSwiftBic: z.string().trim().max(16).optional(),
  bankInstructions: z.string().trim().max(1000).optional(),
});

const dataUrlRegex = /^data:(image\/(png|jpe?g|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/;

export const kycDocumentUploadSchema = z.object({
  docType: z.string().trim().min(2).max(64),
  docLabel: z.string().trim().max(160).optional(),
  fileName: z.string().trim().min(3).max(200),
  fileDataUrl: z
    .string()
    .trim()
    .regex(dataUrlRegex, 'Format de fichier invalide (image PNG/JPEG/WebP ou PDF attendu).')
    .max(2_500_000, 'Le fichier dépasse la taille maximale autorisée (2 Mo).'),
});

export const vendorOrderStatusPatchSchema = z.object({
  status: z.enum([
    'Commandée',
    'Confirmée',
    'En préparation',
    'Expédiée',
    'En livraison',
    'Livrée',
    'Annulée',
    'Remboursée',
  ]),
  comment: z.string().trim().max(600).optional(),
});

export const quoteStepPatchSchema = z.object({
  stepStatus: z.enum(['material', 'design', 'quoted', 'paid', 'fabrication', 'delivery', 'completed']),
});

export const quoteSendLinkSchema = z.object({
  amountGnf: z.number().int().min(1000, 'Montant du devis requis.'),
});

export const reviewReplySchema = z.object({
  reply: z.string().trim().min(2, 'La réponse ne peut pas être vide.').max(1500),
});

export const keywordsExtractSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(6000).optional(),
  category: z.string().max(120).optional(),
  materials: z.string().max(400).optional(),
});

// ---------------------------------------------------------------------------
// Admin portal writes
// ---------------------------------------------------------------------------

export const registrationRulesSchema = z.object({
  fields: z
    .array(
      z.object({
        key: z.string().trim().min(2).max(64),
        label: z.string().trim().min(2).max(160),
        type: z.enum(['text', 'textarea', 'select']),
        required: z.boolean(),
        options: z.array(z.string().trim().min(1)).optional(),
      })
    )
    .max(24),
  documents: z
    .array(
      z.object({
        type: z.string().trim().min(2).max(64),
        label: z.string().trim().min(2).max(160),
        description: z.string().trim().max(400).optional(),
        required: z.boolean(),
        appliesTo: z.enum(['all', 'company']),
      })
    )
    .max(16),
});

export const commercialRestrictionsSchema = z.object({
  vendorRegistrationEnabled: z.boolean(),
  preModerationEnabled: z.boolean(),
  maxProductsUncertified: z.number().int().min(0).max(500),
  allowExternalContactsInMessages: z.boolean(),
  trackingTokenValidityMonths: z.number().int().min(1).max(60),
  payoutsEnabled: z.boolean(),
  defaultDepositPercent: z.number().int().min(10).max(80),
  bankTransferMinGnf: z.number().int().min(0),
});

export const deliveryZonesSchema = z.object({
  zones: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        name: z.string().trim().min(2).max(120),
        region: z.string().trim().min(2).max(120),
        landmarks: z.string().trim().max(400),
        pricingMode: z.enum(['fixed', 'weight_tier']),
        fixedFeeGnf: z.number().int().min(0),
        weightTiers: z.array(
          z.object({
            maxKg: z.number().min(0.1),
            feeGnf: z.number().int().min(0),
          })
        ),
        estimatedDays: z.string().trim().min(1).max(60),
        active: z.boolean(),
      })
    )
    .max(30),
});

export const editorialSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const legalTextsSchema = z.record(z.string(), z.string());

export const adminBadgeCreateSchema = z.object({
  name: z.string().trim().min(2, 'Nom du badge requis.').max(80),
  icon: z.string().trim().max(40).optional(),
  criteriaDescription: z.string().trim().min(5, 'Critères requis.').max(400),
  publicDescription: z.string().trim().max(400).optional(),
  isMandatory: z.boolean().optional(),
  autoAssign: z.boolean().optional(),
  effect: z
    .object({
      showOnProductCard: z.boolean().optional(),
      searchPriorityBoost: z.number().int().min(0).max(100).optional(),
      unlocksRestrictedCategories: z.boolean().optional(),
    })
    .optional(),
});

export const adminCategoryPatchSchema = z.object({
  isRestricted: z.boolean().optional(),
  requiredBadgeId: z.string().trim().nullable().optional(),
});

export const adminVendorStatusPatchSchema = z.object({
  status: z.enum(['pending', 'in_review', 'validated', 'rejected', 'suspended']),
  reason: z.string().trim().max(400).optional(),
});

export const adminDocumentPatchSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().trim().max(400).optional(),
});

export const adminCertificationSchema = z.object({
  action: z.enum(['grant', 'revoke']),
  badgeId: z.string().trim().min(2),
  reason: z.string().trim().max(400).optional(),
});

export const disputePatchSchema = z.object({
  status: z.enum(['resolved_refund', 'resolved_release', 'closed']),
  resolutionNotes: z.string().trim().max(1000).optional(),
});

export const orderCancelSchema = z.object({
  reason: z.string().trim().max(240).optional(),
});

export const djomyPortalCompleteSchema = z.object({
  djomyReference: z.string().trim().min(4).max(120),
  outcome: z.enum(['succeeded', 'failed']).optional(),
});

export const djomyConfirmOtpSchema = z.object({
  djomyReference: z.string().trim().min(4).max(120),
  otpCode: z.string().trim().regex(/^\d{4,6}$/, 'Code OTP invalide (4 à 6 chiffres).'),
});

// ---------------------------------------------------------------------------
// Web Push subscription
// ---------------------------------------------------------------------------

export const pushSubscriptionSchema = z
  .object({
    // Web Push subscription (absent when the browser blocks push: email-only fallback)
    endpoint: z.string().trim().startsWith('https://', 'Endpoint push invalide.').optional(),
    keys: z
      .object({
        p256dh: z.string().min(20),
        auth: z.string().min(8),
      })
      .optional(),
    categories: z.array(z.string().trim().max(80)).max(20).optional(),
    region: z.string().trim().max(120).optional(),
    frequency: z.enum(['instant', 'weekly_digest', 'disabled']).optional(),
    emailFallback: z.string().trim().email('Courriel de repli invalide.').max(160).optional(),
  })
  .refine((data) => Boolean(data.endpoint) || Boolean(data.emailFallback), {
    message: 'Une inscription push ou un courriel de repli est requis.',
  });

export const messageFlagSchema = z.object({
  reason: z.string().trim().min(2, 'Motif du signalement requis.').max(400),
});

// ---------------------------------------------------------------------------
// v2 ADMIN PLATFORM: commissions, security, analytics, maintenance
// ---------------------------------------------------------------------------

export const commissionConfigSchema = z.object({
  enabled: z.boolean(),
  defaultPercent: z.number().min(0, 'Pourcentage invalide.').max(100, 'Maximum 100 %.'),
  vendorOverrides: z.record(z.string(), z.number().min(0).max(100)),
  categoryOverrides: z.record(z.string(), z.number().min(0).max(100)),
  base: z.enum(['subtotal', 'total']),
  minCommissionGnf: z.number().int().min(0),
  applyToQuotes: z.boolean(),
});

export const orderStatusOverrideSchema = z.object({
  status: z.enum([
    'Commandée',
    'Confirmée',
    'En préparation',
    'Expédiée',
    'En livraison',
    'Livrée',
    'Annulée',
    'Remboursée',
  ]),
  reason: z.string().trim().min(3, 'Motif requis (journalisé dans l’audit).').max(400),
});

export const analyticsTrackSchema = z.object({
  type: z.enum(['cart_add', 'checkout_start']),
  productId: z.string().trim().max(80).optional(),
});

export const maintenanceSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(300).optional(),
});

export const blacklistSchema = z.object({
  value: z.string().trim().min(3, 'Courriel ou téléphone requis.').max(160),
  reason: z.string().trim().max(300).optional(),
});

export const passcodeChangeSchema = z
  .object({
    current: z.string().min(1, 'Mot de passe actuel requis.'),
    next: z.string().min(8, 'Le nouveau mot de passe doit contenir au moins 8 caractères.').max(128),
    confirm: z.string().min(8),
  })
  .refine((d) => d.next === d.confirm, {
    message: 'La confirmation ne correspond pas.',
    path: ['confirm'],
  });
