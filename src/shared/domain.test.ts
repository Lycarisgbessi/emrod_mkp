import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  calculateDeliveryFee,
  computeCommissionShare,
  calculatePaymentPlanAmounts,
  canTransitionOrderStatus,
  canVendorAdvanceOrder,
  detectExternalContactAttempt,
  evaluateVendorCompliance,
  extractKeywordsFromDescription,
  extractTrackingTokenFromText,
  filterAndSortVendors,
  formatGNF,
  getVendorAccountStatusLabel,
  isBankTransferEligible,
  normalizeSearchText,
  resolveCommissionRate,
} from './domain';
import type {
  BadgeDefinition,
  DeliveryZoneRule,
  RegistrationFieldRule,
  RequiredDocumentRule,
  VendorPublicSummary,
} from './types';

test('formatGNF formats Guinean Franc amounts with thin spaces and GNF suffix', () => {
  assert.equal(formatGNF(4850000), '4 850 000 GNF');
  assert.equal(formatGNF(75000), '75 000 GNF');
  assert.equal(formatGNF(0), '0 GNF');
});

test('normalizeSearchText handles accents and punctuation cleanly', () => {
  assert.equal(
    normalizeSearchText('Bibliothèque en Chêne & Noyer — Édition Guinée'),
    'bibliotheque en chene noyer edition guinee'
  );
});

test('extractKeywordsFromDescription extracts craft vocabulary and relevant keywords', () => {
  const keywords = extractKeywordsFromDescription(
    'Bibliothèque Corniche',
    'Pièce unique façonnée à la main en noyer massif de Guinée avec montants en acier forgé et laiton brossé pour votre salon.',
    'Bibliothèques',
    'Noyer, Acier, Laiton'
  );
  assert.ok(keywords.includes('noyer'));
  assert.ok(keywords.includes('laiton'));
  assert.ok(keywords.includes('acier'));
  assert.ok(keywords.length <= 10);
});

test('calculateDeliveryFee handles fixed, weight-tier, product override, and pickup', () => {
  const fixedZone: DeliveryZoneRule = {
    id: 'kaloum',
    name: 'Kaloum & Centre',
    region: 'Conakry',
    landmarks: 'Almamya, Boulbinet',
    pricingMode: 'fixed',
    fixedFeeGnf: 150000,
    weightTiers: [],
    estimatedDays: '24-48h',
    active: true,
  };

  assert.equal(calculateDeliveryFee(fixedZone, [{ weightKg: 45, quantity: 1 }]).fee, 150000);
  assert.equal(calculateDeliveryFee(null, [{ weightKg: 45, quantity: 1 }]).pickupOnly, true);

  const tieredZone: DeliveryZoneRule = {
    id: 'ratoma',
    name: 'Ratoma & Sonfonia',
    region: 'Conakry',
    landmarks: 'Kipé, Lambanyi, Sonfonia',
    pricingMode: 'weight_tier',
    fixedFeeGnf: 120000,
    weightTiers: [
      { maxKg: 25, feeGnf: 100000 },
      { maxKg: 80, feeGnf: 200000 },
      { maxKg: 250, feeGnf: 350000 },
    ],
    estimatedDays: '48h',
    active: true,
  };

  assert.equal(calculateDeliveryFee(tieredZone, [{ weightKg: 20, quantity: 1 }]).fee, 100000);
  assert.equal(calculateDeliveryFee(tieredZone, [{ weightKg: 35, quantity: 2 }]).fee, 200000);
  assert.equal(
    calculateDeliveryFee(tieredZone, [
      {
        weightKg: 35,
        quantity: 2,
        deliveryConfig: {
          pickupAvailable: true,
          pickupAddress: 'Sonfonia',
          estimatedDelay: '48h',
          zoneFees: { ratoma: 90000 },
        },
      },
    ]).fee,
    180000
  );
  // Mixed cart: 1 overridden item (90 000) + 1 standard item of 20 kg (100 000) = 190 000
  assert.equal(
    calculateDeliveryFee(tieredZone, [
      {
        weightKg: 35,
        quantity: 1,
        deliveryConfig: {
          pickupAvailable: true,
          pickupAddress: 'Sonfonia',
          estimatedDelay: '48h',
          zoneFees: { ratoma: 90000 },
        },
      },
      { weightKg: 20, quantity: 1 },
    ]).fee,
    190000
  );
});

test('canTransitionOrderStatus enforces Tableau 5 order lifecycle rules', () => {
  assert.equal(canTransitionOrderStatus('Commandée', 'Confirmée', 'vendor'), true);
  assert.equal(canTransitionOrderStatus('Confirmée', 'Livrée', 'vendor'), true);
  assert.equal(canTransitionOrderStatus('Livrée', 'Confirmée', 'vendor'), false);
  assert.equal(canTransitionOrderStatus('Commandée', 'Annulée', 'buyer'), true);
  assert.equal(canTransitionOrderStatus('Expédiée', 'Annulée', 'buyer'), false);
  assert.equal(canTransitionOrderStatus('Annulée', 'Remboursée', 'admin'), true);
  assert.equal(canTransitionOrderStatus('Annulée', 'Remboursée', 'vendor'), false);
});

test('evaluateVendorCompliance enforces KYC, restrictions, and category badges', () => {
  const fields: RegistrationFieldRule[] = [
    { key: 'shopName', label: 'Nom de boutique', type: 'text', required: true },
  ];
  const docs: RequiredDocumentRule[] = [
    {
      type: 'id_card',
      label: 'Pièce d’identité',
      description: 'CNI ou passeport',
      required: true,
      appliesTo: 'all',
    },
    {
      type: 'rccm',
      label: 'Registre de commerce',
      description: 'RCCM entreprise',
      required: true,
      appliesTo: 'company',
    },
  ];
  const badges: BadgeDefinition[] = [
    {
      id: 'badge-atelier',
      slug: 'atelier-verifie',
      name: 'Atelier vérifié',
      icon: 'shield',
      criteriaDescription: 'Documents validés',
      publicDescription: 'Atelier contrôlé par EMROD',
      isMandatory: false,
      autoAssign: false,
      autoCriteria: { minApprovedDocs: 1, minPublishedProducts: 0, minAverageRating: 0 },
      effect: {
        showOnProductCard: true,
        searchPriorityBoost: 10,
        unlocksRestrictedCategories: true,
      },
    },
  ];

  const uncertifiedReport = evaluateVendorCompliance(
    {
      accountStatus: 'validated',
      entityType: 'company',
      shopName: 'Atelier Test',
      description: 'Description complète de test',
      location: 'Conakry',
      customFields: {},
      documents: [{ docType: 'id_card', status: 'approved' }],
      manualBadgeIds: [],
      revokedBadgeIds: [],
      publishedProductsCount: 3,
      averageRating: 4.8,
    },
    fields,
    docs,
    badges
  );

  // Missing RCCM for company
  assert.ok(uncertifiedReport.missingItems.some((m) => m.code === 'rccm'));
  // Blocked from restricted category without badge-atelier
  assert.equal(
    uncertifiedReport.canPublishInCategory({
      isRestricted: true,
      requiredBadgeId: 'badge-atelier',
      name: 'Mobilier de prestige',
    }).allowed,
    false
  );
  // Blocked from adding 4th product when cap is 3
  assert.equal(uncertifiedReport.canAddMoreProducts(3, 3).allowed, false);

  const certifiedReport = evaluateVendorCompliance(
    {
      accountStatus: 'validated',
      entityType: 'company',
      shopName: 'EMROD SARL',
      description: 'Atelier fondateur',
      location: 'Conakry',
      customFields: {},
      documents: [
        { docType: 'id_card', status: 'approved' },
        { docType: 'rccm', status: 'approved' },
      ],
      manualBadgeIds: ['badge-atelier'],
      revokedBadgeIds: [],
      publishedProductsCount: 12,
      averageRating: 4.9,
    },
    fields,
    docs,
    badges
  );

  assert.equal(certifiedReport.isCertified, true);
  assert.equal(
    certifiedReport.canPublishInCategory({
      isRestricted: true,
      requiredBadgeId: 'badge-atelier',
      name: 'Mobilier de prestige',
    }).allowed,
    true
  );
  assert.equal(certifiedReport.canAddMoreProducts(12, 3).allowed, true);
});

test('HMAC-SHA256 Djomy signature matches hex specification', () => {
  const clientId = 'emrod-client-123';
  const clientSecret = 'secret-test-key';
  const sig = crypto.createHmac('sha256', clientSecret).update(clientId).digest('hex');
  assert.equal(sig.length, 64);
  assert.match(sig, /^[0-9a-f]{64}$/);
});

test('calculatePaymentPlanAmounts splits full, deposit (30%), and bank_transfer correctly', () => {
  assert.deepEqual(calculatePaymentPlanAmounts(10_000_000, 'full', 30), {
    amountPaidNowGnf: 10_000_000,
    balanceDueGnf: 0,
    depositPercentApplied: 100,
  });
  assert.deepEqual(calculatePaymentPlanAmounts(10_000_000, 'deposit', 30), {
    amountPaidNowGnf: 3_000_000,
    balanceDueGnf: 7_000_000,
    depositPercentApplied: 30,
  });
  assert.deepEqual(calculatePaymentPlanAmounts(18_000_000, 'bank_transfer', 30), {
    amountPaidNowGnf: 0,
    balanceDueGnf: 18_000_000,
    depositPercentApplied: 0,
  });
});

test('isBankTransferEligible enforces threshold, single-vendor, and vendor bank capability', () => {
  assert.equal(
    isBankTransferEligible({
      totalGnf: 18_000_000,
      minGnf: 15_000_000,
      singleVendor: true,
      vendorBankEnabled: true,
    }).eligible,
    true
  );
  assert.equal(
    isBankTransferEligible({
      totalGnf: 12_000_000,
      minGnf: 15_000_000,
      singleVendor: true,
      vendorBankEnabled: true,
    }).eligible,
    false
  );
  assert.equal(
    isBankTransferEligible({
      totalGnf: 18_000_000,
      minGnf: 15_000_000,
      singleVendor: false,
      vendorBankEnabled: true,
    }).eligible,
    false
  );
  assert.equal(
    isBankTransferEligible({
      totalGnf: 18_000_000,
      minGnf: 15_000_000,
      singleVendor: true,
      vendorBankEnabled: false,
    }).eligible,
    false
  );
});

test('detectExternalContactAttempt blocks phone/email/whatsapp/urls while preserving dimensions & prices', () => {
  // Should block
  assert.equal(detectExternalContactAttempt('Appelez-moi au +224 623 88 59 59 svp').blocked, true);
  assert.equal(detectExternalContactAttempt('Mon numero est 621084146').blocked, true);
  assert.equal(detectExternalContactAttempt('Ecrivez-moi sur client@gmail.com').blocked, true);
  assert.equal(detectExternalContactAttempt('Contactez sur WhatsApp svp').blocked, true);
  assert.equal(detectExternalContactAttempt('Voir https://wa.me/224623885959').blocked, true);
  assert.equal(detectExternalContactAttempt('Rejoignez t.me/monatelier').blocked, true);

  // Legitimate craft/order inputs must pass
  assert.equal(
    detectExternalContactAttempt('Dimensions souhaitées 210 x 38 x 225 cm en noyer massif').blocked,
    false
  );
  assert.equal(
    detectExternalContactAttempt('Budget indicatif 14 500 000 GNF pour la commande EMR-2026-1042').blocked,
    false
  );
  assert.equal(
    detectExternalContactAttempt('Pouvez-vous livrer à Camayenne vendredi après-midi ?').blocked,
    false
  );
  assert.equal(
    detectExternalContactAttempt('VIR-BICIGUI-2026-9912 Virement effectué ce matin.').blocked,
    false
  );
  assert.equal(
    detectExternalContactAttempt('VIR-622112233').blocked,
    true
  );
});

test('filterAndSortVendors filters by minSales, badge, minRating, location, bankTransferOnly and sorts by sales_desc', () => {
  const vendors: VendorPublicSummary[] = [
    {
      userId: 'v1',
      slug: 'emrod-sarl',
      shopName: 'EMROD SARL — Atelier Conakry',
      description: 'Mobilier sur mesure',
      story: '',
      location: 'Sonfonia Centre, Conakry',
      logoUrl: '',
      isEmrodOfficial: true,
      responseTimeLabel: '2h',
      averageRating: 4.9,
      reviewCount: 12,
      completedSalesCount: 8,
      publishedProductsCount: 6,
      bankTransferAvailable: true,
      badges: [
        {
          id: 'b1',
          slug: 'atelier-verifie',
          name: 'Atelier vérifié',
          icon: 'shield-check',
          publicDescription: '',
          criteriaDescription: '',
        },
      ],
    },
    {
      userId: 'v2',
      slug: 'atelier-fouta',
      shopName: 'Atelier Fouta & Cuir',
      description: 'Bois d’iroko et sellerie',
      story: '',
      location: 'Dixinn, Conakry',
      logoUrl: '',
      isEmrodOfficial: false,
      responseTimeLabel: '4h',
      averageRating: 4.4,
      reviewCount: 3,
      completedSalesCount: 2,
      publishedProductsCount: 2,
      bankTransferAvailable: false,
      badges: [
        {
          id: 'b2',
          slug: 'vendeur-certifie',
          name: 'Vendeur certifié',
          icon: 'award',
          publicDescription: '',
          criteriaDescription: '',
        },
      ],
    },
  ];

  assert.equal(filterAndSortVendors(vendors, { minSales: 5 }).length, 1);
  assert.equal(filterAndSortVendors(vendors, { badge: 'vendeur-certifie' })[0].userId, 'v2');
  assert.equal(filterAndSortVendors(vendors, { location: 'Dixinn' })[0].userId, 'v2');
  assert.equal(filterAndSortVendors(vendors, { bankTransferOnly: true })[0].userId, 'v1');
  assert.equal(filterAndSortVendors(vendors, { minRating: 4.8 })[0].userId, 'v1');
  assert.equal(filterAndSortVendors(vendors, { sort: 'sales_desc' })[0].userId, 'v1');
});

test('getVendorAccountStatusLabel maps all vendor statuses to French labels', () => {
  assert.equal(getVendorAccountStatusLabel('pending'), 'En attente de justificatifs');
  assert.equal(getVendorAccountStatusLabel('in_review'), 'En cours de vérification KYC');
  assert.equal(getVendorAccountStatusLabel('validated'), 'Atelier validé');
  assert.equal(getVendorAccountStatusLabel('rejected'), 'Dossier refusé');
  assert.equal(getVendorAccountStatusLabel('suspended'), 'Boutique suspendue');
});

test('canVendorAdvanceOrder blocks advancing unpaid bank transfers, pending Djomy orders, and cancelled orders', () => {
  assert.equal(
    canVendorAdvanceOrder({
      status: 'Commandée',
      paymentPlan: 'bank_transfer',
      balanceDueGnf: 16500000,
    }).allowed,
    false
  );
  assert.equal(
    canVendorAdvanceOrder({
      status: 'Commandée',
      paymentPlan: 'bank_transfer',
      balanceDueGnf: 0,
    }).allowed,
    true
  );
  assert.equal(
    canVendorAdvanceOrder({
      status: 'Commandée',
      paymentPlan: 'full',
      paymentStatus: 'pending',
    }).allowed,
    false
  );
  assert.equal(
    canVendorAdvanceOrder({
      status: 'Commandée',
      paymentPlan: 'deposit',
      balanceDueGnf: 11000000,
      paymentStatus: 'succeeded',
    }).allowed,
    true
  );
  assert.equal(
    canVendorAdvanceOrder({
      status: 'Annulée',
      paymentPlan: 'bank_transfer',
      balanceDueGnf: 16500000,
    }).allowed,
    false
  );
});

test('extractTrackingTokenFromText finds emr_ tracking tokens inside confirmation messages', () => {
  assert.equal(
    extractTrackingTokenFromText(
      'Paiement confirmé (EMR-2026-4411). Suivi disponible sans compte avec le jeton : emr_abc12345_def678'
    ),
    'emr_abc12345_def678'
  );
  assert.equal(extractTrackingTokenFromText('Aucun jeton ici'), null);
});

test('resolveCommissionRate applies vendor > category > default priority', () => {
  const overrides = {
    defaultPercent: 10,
    vendorOverrides: { v1: 3, v_bad: Number.NaN },
    categoryOverrides: { c1: 7 },
  };
  assert.equal(resolveCommissionRate({ ...overrides, vendorId: 'v1', categoryId: 'c1' }), 3);
  assert.equal(resolveCommissionRate({ ...overrides, vendorId: 'v2', categoryId: 'c1' }), 7);
  assert.equal(resolveCommissionRate({ ...overrides, vendorId: 'v2', categoryId: 'c2' }), 10);
  // Non-finite vendor override is ignored → category fallback applies
  assert.equal(resolveCommissionRate({ ...overrides, vendorId: 'v_bad', categoryId: 'c1' }), 7);
});

test('computeCommissionShare computes the vendor share on the taxable base (base subtotal)', () => {
  // Single-vendor order: fees included in payment, commission computed on the subtotal only
  const simple = computeCommissionShare({
    amountGnf: 500000,
    orderSubtotalGnf: 500000,
    orderTotalGnf: 500000,
    vendorSubtotalGnf: 500000,
    ratePercent: 10,
    base: 'subtotal',
  });
  assert.deepEqual(simple, { grossGnf: 500000, ratePercent: 10, commissionGnf: 50000, netVendorGnf: 450000 });
});

test('computeCommissionShare prorates between vendors proportionally to subtotals', () => {
  // Payment 1 100 000 GNF (subtotal 1 000 000 + fees 100 000), vendor owns 40% of the subtotal
  const share = computeCommissionShare({
    amountGnf: 1100000,
    orderSubtotalGnf: 1000000,
    orderTotalGnf: 1100000,
    vendorSubtotalGnf: 400000,
    ratePercent: 10,
    base: 'subtotal',
  });
  assert.deepEqual(share, { grossGnf: 400000, ratePercent: 10, commissionGnf: 40000, netVendorGnf: 360000 });
});

test('computeCommissionShare with base total taxes the whole payment including fees', () => {
  const share = computeCommissionShare({
    amountGnf: 1100000,
    orderSubtotalGnf: 1000000,
    orderTotalGnf: 1100000,
    vendorSubtotalGnf: 400000,
    ratePercent: 10,
    base: 'total',
  });
  assert.deepEqual(share, { grossGnf: 440000, ratePercent: 10, commissionGnf: 44000, netVendorGnf: 396000 });
});

test('computeCommissionShare enforces minimum commission and caps it at the gross share', () => {
  const bumped = computeCommissionShare({
    amountGnf: 100000,
    orderSubtotalGnf: 100000,
    orderTotalGnf: 100000,
    vendorSubtotalGnf: 100000,
    ratePercent: 2,
    base: 'subtotal',
    minCommissionGnf: 3000,
  });
  assert.equal(bumped.commissionGnf, 3000);
  assert.equal(bumped.netVendorGnf, 97000);

  // Minimum above the gross share → commission capped at gross, vendor keeps 0
  const capped = computeCommissionShare({
    amountGnf: 100000,
    orderSubtotalGnf: 100000,
    orderTotalGnf: 100000,
    vendorSubtotalGnf: 100000,
    ratePercent: 2,
    base: 'subtotal',
    minCommissionGnf: 999999999,
  });
  assert.equal(capped.commissionGnf, 100000);
  assert.equal(capped.netVendorGnf, 0);
});

test('computeCommissionShare handles zero rate, clamped rate, and zero vendor share', () => {
  const zeroRate = computeCommissionShare({
    amountGnf: 80000,
    orderSubtotalGnf: 80000,
    orderTotalGnf: 80000,
    vendorSubtotalGnf: 80000,
    ratePercent: 0,
    base: 'subtotal',
  });
  assert.deepEqual(zeroRate, { grossGnf: 80000, ratePercent: 0, commissionGnf: 0, netVendorGnf: 80000 });

  // Rate above 100 is clamped to 100 → commission equals gross
  const clamped = computeCommissionShare({
    amountGnf: 50000,
    orderSubtotalGnf: 50000,
    orderTotalGnf: 50000,
    vendorSubtotalGnf: 50000,
    ratePercent: 250,
    base: 'subtotal',
  });
  assert.deepEqual(clamped, { grossGnf: 50000, ratePercent: 100, commissionGnf: 50000, netVendorGnf: 0 });

  // Vendor owns nothing of the order → no gross, no commission
  const noShare = computeCommissionShare({
    amountGnf: 100000,
    orderSubtotalGnf: 100000,
    orderTotalGnf: 100000,
    vendorSubtotalGnf: 0,
    ratePercent: 10,
    base: 'subtotal',
  });
  assert.deepEqual(noShare, { grossGnf: 0, ratePercent: 10, commissionGnf: 0, netVendorGnf: 0 });
});
