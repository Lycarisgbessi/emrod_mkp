import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Info,
  Lock,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useRouter } from '../context/RouterContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import {
  calculatePaymentPlanAmounts,
  formatGNF,
  isBankTransferEligible,
} from '../shared/domain';
import type {
  CommercialRestrictionsConfig,
  PaymentPlan,
  VendorBankDetails,
  VendorPublicSummary,
} from '../shared/types';

export const CheckoutPage: React.FC = () => {
  const {
    items,
    selectedZoneId,
    setSelectedZoneId,
    zones,
    subtotalGnf,
    deliverySummary,
    totalGnf,
    clearCart,
  } = useCart();
  const { navigate } = useRouter();
  const { addToast } = useToast();

  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerEmailConfirm, setBuyerEmailConfirm] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryLandmark, setDeliveryLandmark] = useState('');

  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan>('full');
  const [paymentMethod, setPaymentMethod] = useState<'mobile_money' | 'card' | 'qr'>('mobile_money');
  const [paymentOperator, setPaymentOperator] = useState('Orange Money');
  const [paymentMode, setPaymentMode] = useState<'redirect' | 'direct'>('redirect');
  const [idempotencyKey] = useState(
    () => `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );

  // Rules & Vendor Bank Availability
  const [restrictions, setRestrictions] = useState<CommercialRestrictionsConfig | null>(null);
  const [vendorsMap, setVendorsMap] = useState<Record<string, VendorPublicSummary>>({});

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Post-checkout state (Djomy Portal / OTP / Confirmed / Direct Bank Transfer)
  const [checkoutResult, setCheckoutResult] = useState<{
    orderNumber: string;
    trackingToken: string;
    djomyReference: string;
    paymentUrl: string | null;
    sandbox: boolean;
    paymentMode: 'redirect' | 'direct' | 'bank_transfer';
    paymentPlan: PaymentPlan;
    depositPercent: number;
    amountPaidNowGnf: number;
    balanceDueGnf: number;
    totalGnf: number;
    bankDetails: VendorBankDetails | null;
    stage: 'portal' | 'otp' | 'confirmed' | 'bank_transfer';
  } | null>(null);

  const [otpCode, setOtpCode] = useState('');
  const [processingPayment, setProcessingPayment] = useState(false);

  useEffect(() => {
    document.title = 'Paiement & Finalisation sans compte — EMROD Marketplace';
    // Funnel analytics: checkout_start (fire-and-forget)
    if (items.length > 0) {
      void fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'checkout_start' }),
        keepalive: true,
      }).catch(() => {});
    }
    Promise.all([
      fetch('/api/rules/public').then((r) => r.json()),
      fetch('/api/vendors').then((r) => r.json()),
    ])
      .then(([rulesRes, vendorsRes]) => {
        if (rulesRes?.restrictions) setRestrictions(rulesRes.restrictions);
        if (Array.isArray(vendorsRes?.vendors)) {
          const map: Record<string, VendorPublicSummary> = {};
          vendorsRes.vendors.forEach((v: VendorPublicSummary) => {
            map[v.userId] = v;
          });
          setVendorsMap(map);
        }
      })
      .catch(() => {});
  }, []);

  const defaultDepositPercent = restrictions?.defaultDepositPercent ?? 30;
  const bankTransferMinGnf = restrictions?.bankTransferMinGnf ?? 15_000_000;

  const distinctVendors = Array.from(new Set(items.map((i) => i.vendorId)));
  const singleVendor = distinctVendors.length === 1;
  const singleVendorSummary = singleVendor ? vendorsMap[distinctVendors[0]] : undefined;
  const vendorBankEnabled = singleVendor
    ? Boolean(
        singleVendorSummary?.bankTransferAvailable ?? items[0]?.bankTransferAvailable ?? false
      )
    : false;

  const bankEligibility = isBankTransferEligible({
    totalGnf,
    minGnf: bankTransferMinGnf,
    singleVendor,
    vendorBankEnabled,
  });

  // Reset to 'full' if user had bank_transfer selected and cart drops below eligibility
  useEffect(() => {
    if (paymentPlan === 'bank_transfer' && !bankEligibility.eligible) {
      setPaymentPlan('full');
    }
  }, [paymentPlan, bankEligibility.eligible]);

  const planAmounts = calculatePaymentPlanAmounts(totalGnf, paymentPlan, defaultDepositPercent);
  const currentStep = !buyerName || !buyerEmail || !buyerPhone ? 1 : !deliveryAddress ? 2 : 3;

  const handleCopyText = async (label: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      addToast({ type: 'success', title: `${label} copié`, description: val });
    } catch {
      addToast({ type: 'info', title: label, description: val });
    }
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (items.length === 0) return;

    setSubmitting(true);
    try {
      const isBank = paymentPlan === 'bank_transfer';
      const res = await apiFetch<{
        orderNumber: string;
        trackingToken: string;
        djomyReference: string;
        paymentUrl?: string | null;
        sandbox?: boolean;
        otpRequired: boolean;
        totalGnf: number;
        paymentPlan: PaymentPlan;
        depositPercent: number;
        amountPaidNowGnf: number;
        balanceDueGnf: number;
        bankTransfer?: boolean;
        bankDetails?: VendorBankDetails | null;
      }>('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({
          buyerName,
          buyerEmail,
          buyerEmailConfirm,
          buyerPhone,
          deliveryZoneId: selectedZoneId,
          deliveryAddress,
          deliveryLandmark,
          paymentPlan,
          paymentMethod: isBank ? 'bank_transfer' : paymentMethod,
          paymentOperator: isBank ? 'Virement bancaire' : paymentOperator,
          paymentMode: isBank ? 'bank_transfer' : paymentMode,
          idempotencyKey,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        }),
      });

      clearCart();
      setCheckoutResult({
        orderNumber: res.orderNumber,
        trackingToken: res.trackingToken,
        djomyReference: res.djomyReference,
        paymentUrl: res.paymentUrl ?? null,
        sandbox: res.sandbox ?? true,
        paymentMode: isBank ? 'bank_transfer' : paymentMode,
        paymentPlan: res.paymentPlan || paymentPlan,
        depositPercent: res.depositPercent ?? planAmounts.depositPercentApplied,
        amountPaidNowGnf: res.amountPaidNowGnf ?? planAmounts.amountPaidNowGnf,
        balanceDueGnf: res.balanceDueGnf ?? planAmounts.balanceDueGnf,
        totalGnf: res.totalGnf,
        bankDetails: res.bankDetails || null,
        stage: res.bankTransfer ? 'bank_transfer' : res.otpRequired ? 'otp' : 'portal',
      });
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyDjomyStatus = async () => {
    if (!checkoutResult) return;
    setProcessingPayment(true);
    try {
      const res = await apiFetch<{
        status: 'pending' | 'authorized' | 'succeeded' | 'failed' | 'refunded';
        rawStatus?: string;
        providerReference?: string | null;
      }>(`/api/orders/track/${encodeURIComponent(checkoutResult.trackingToken)}/verify-djomy`, {
        method: 'POST',
      });
      if (res.status === 'succeeded') {
        setCheckoutResult({ ...checkoutResult, stage: 'confirmed' });
        addToast({
          type: 'success',
          title:
            checkoutResult.paymentPlan === 'deposit'
              ? 'Acompte Djomy vérifié'
              : 'Paiement Djomy vérifié',
          description: res.providerReference
            ? `Réf. opérateur ${res.providerReference} · Commande ${checkoutResult.orderNumber}`
            : `Commande ${checkoutResult.orderNumber} confirmée.`,
        });
      } else if (res.status === 'failed') {
        addToast({
          type: 'error',
          title: 'Paiement refusé par Djomy',
          description: 'La transaction a échoué ou a été annulée.',
        });
      } else {
        addToast({
          type: 'info',
          title: 'Paiement toujours en attente',
          description: `Statut Djomy actuel : ${res.rawStatus || 'PENDING'}. Validez sur votre mobile ou le portail puis revérifiez.`,
        });
      }
    } catch (err: any) {
      addToast({ type: 'error', title: 'Vérification Djomy impossible', description: err.message });
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleCompletePortal = async (outcome: 'succeeded' | 'failed') => {
    if (!checkoutResult) return;
    setProcessingPayment(true);
    try {
      const res = await apiFetch<{ status: string }>('/api/payments/djomy/portal-complete', {
        method: 'POST',
        body: JSON.stringify({
          djomyReference: checkoutResult.djomyReference,
          outcome,
        }),
      });
      if (res.status === 'succeeded') {
        setCheckoutResult({ ...checkoutResult, stage: 'confirmed' });
        addToast({
          type: 'success',
          title:
            checkoutResult.paymentPlan === 'deposit'
              ? 'Acompte Djomy confirmé'
              : 'Paiement Djomy confirmé',
          description: `Commande ${checkoutResult.orderNumber} enregistrée.`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'Paiement refusé',
          description: 'La transaction a échoué sur le portail Djomy. Vous pouvez réessayer.',
        });
      }
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur Djomy', description: err.message });
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleConfirmOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutResult) return;
    setProcessingPayment(true);
    try {
      const res = await apiFetch<{
        status: 'succeeded' | 'pending' | 'failed';
        rawStatus?: string;
        message?: string;
      }>('/api/payments/djomy/confirm-otp', {
        method: 'POST',
        body: JSON.stringify({
          djomyReference: checkoutResult.djomyReference,
          otpCode,
        }),
      });
      if (res.status === 'succeeded') {
        setCheckoutResult({ ...checkoutResult, stage: 'confirmed' });
        addToast({
          type: 'success',
          title: 'Code OTP validé',
          description: 'Votre commande est confirmée.',
        });
      } else {
        addToast({
          type: 'info',
          title: 'Validation en cours chez l’opérateur',
          description:
            res.message ||
            'Code OTP transmis à Djomy. Cliquez sur « Vérifier le statut Djomy » après confirmation mobile.',
        });
      }
    } catch (err: any) {
      addToast({ type: 'error', title: 'Code OTP invalide', description: err.message });
    } finally {
      setProcessingPayment(false);
    }
  };

  // Confirmed / Djomy Portal / OTP / Bank Transfer states
  if (checkoutResult) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-14">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 sm:p-8 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] shadow-[var(--shadow-elevated)] space-y-6"
        >
          {checkoutResult.stage === 'bank_transfer' && (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-[var(--color-line)]">
                <div>
                  <p className="text-xs font-medium text-[var(--color-wood)]">
                    Commande importante · Virement bancaire direct
                  </p>
                  <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[var(--color-ink)] mt-1">
                    Commande {checkoutResult.orderNumber} enregistrée
                  </h1>
                </div>
                <Building2 className="w-7 h-7 text-[var(--color-gold-deep)] shrink-0" strokeWidth={1.5} />
              </div>

              <p className="text-sm text-[var(--color-body)] leading-relaxed">
                Effectuez le virement de{' '}
                <strong className="font-mono-num text-[var(--color-ink)]">
                  {formatGNF(checkoutResult.totalGnf)}
                </strong>{' '}
                sur les coordonnées bancaires du vendeur ci-dessous, puis déclarez votre référence de virement et échangez directement avec l’atelier sur votre page de suivi EMROD pour finaliser la vente.
              </p>

              {checkoutResult.bankDetails && (
                <div className="p-5 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-gold-deep)]/40 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs sm:text-sm">
                  <div>
                    <p className="text-[var(--color-wood)]">Banque</p>
                    <p className="font-semibold text-[var(--color-ink)] mt-0.5">
                      {checkoutResult.bankDetails.bankName}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--color-wood)]">Titulaire</p>
                    <p className="font-semibold text-[var(--color-ink)] mt-0.5">
                      {checkoutResult.bankDetails.bankAccountHolder}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-[var(--color-wood)]">IBAN / RIB</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="font-mono-num font-semibold text-[var(--color-ink)] break-all">
                        {checkoutResult.bankDetails.bankIbanRib}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopyText('RIB / IBAN', checkoutResult.bankDetails!.bankIbanRib)
                        }
                        aria-label="Copier l’IBAN / RIB"
                        className="p-1 text-[var(--color-wood)] hover:text-[var(--color-ink)]"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-[var(--color-wood)]">SWIFT / BIC</p>
                    <p className="font-mono-num font-semibold text-[var(--color-ink)] mt-0.5">
                      {checkoutResult.bankDetails.bankSwiftBic || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--color-wood)]">Motif / Référence obligatoire</p>
                    <p className="font-mono-num font-semibold text-[var(--color-ink)] mt-0.5">
                      {checkoutResult.orderNumber}
                    </p>
                  </div>
                  {checkoutResult.bankDetails.bankInstructions && (
                    <div className="sm:col-span-2 pt-2 border-t border-[var(--color-line)] text-xs text-[var(--color-body)]">
                      <strong>Instructions :</strong> {checkoutResult.bankDetails.bankInstructions}
                    </div>
                  )}
                </div>
              )}

              <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-line)] text-left">
                <p className="text-xs text-[var(--color-wood)]">Votre jeton de suivi personnel :</p>
                <p className="font-mono-num text-sm font-semibold text-[var(--color-ink)] break-all mt-1">
                  {checkoutResult.trackingToken}
                </p>
              </div>

              <button
                type="button"
                onClick={() => navigate(`/suivi/${checkoutResult.trackingToken}`)}
                className="w-full py-3.5 px-6 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white font-semibold text-sm hover:bg-[var(--color-wood)] inline-flex items-center justify-center gap-2 transition-colors"
              >
                <span>Déclarer mon virement & contacter l’atelier sur EMROD</span>
                <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          )}

          {checkoutResult.stage === 'portal' && (
            <>
              <div className="flex items-center justify-between pb-4 border-b border-[var(--color-line)]">
                <div>
                  <p className="text-xs font-medium text-[var(--color-wood)]">
                    Portail de paiement sécurisé
                  </p>
                  <h1 className="font-display text-2xl font-semibold text-[var(--color-ink)] mt-1">
                    Passerelle Djomy Guinée
                  </h1>
                </div>
                <span className="font-mono-num text-xs px-2.5 py-1 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-[var(--color-gold)]">
                  {checkoutResult.djomyReference}
                </span>
              </div>

              <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-cream)] space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--color-wood)]">Commande</span>
                  <span className="font-mono-num font-semibold text-[var(--color-ink)]">
                    {checkoutResult.orderNumber}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-wood)]">Moyen sélectionné</span>
                  <span className="font-medium text-[var(--color-ink)]">
                    {paymentMethod === 'mobile_money'
                      ? paymentOperator
                      : paymentMethod === 'card'
                        ? 'Carte bancaire'
                        : 'QR Code Djomy'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-wood)]">Formule</span>
                  <span className="font-medium text-[var(--color-ink)]">
                    {checkoutResult.paymentPlan === 'deposit'
                      ? `Acompte ${checkoutResult.depositPercent}% + solde à la livraison`
                      : 'Paiement intégral (100 %)'}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-[var(--color-line)] font-semibold text-base">
                  <span>Montant à régler maintenant</span>
                  <span className="font-mono-num">{formatGNF(checkoutResult.amountPaidNowGnf)}</span>
                </div>
                {checkoutResult.balanceDueGnf > 0 && (
                  <div className="flex justify-between text-xs text-[var(--color-wood)]">
                    <span>Solde prévu à la livraison</span>
                    <span className="font-mono-num">{formatGNF(checkoutResult.balanceDueGnf)}</span>
                  </div>
                )}
              </div>

              {!checkoutResult.sandbox && checkoutResult.paymentUrl ? (
                <div className="space-y-3">
                  <p className="text-xs text-[var(--color-body)] leading-relaxed">
                    Votre session de paiement sécurisée est prête sur le portail officiel Djomy. Réglez puis revenez confirmer le statut de votre commande :
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <a
                      href={checkoutResult.paymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-3 px-5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] font-semibold text-sm hover:bg-[var(--color-gold-deep)] hover:text-white transition-colors inline-flex items-center justify-center gap-2"
                    >
                      <span>Ouvrir le portail officiel Djomy</span>
                      <ExternalLink className="w-4 h-4" strokeWidth={1.5} />
                    </a>
                    <button
                      type="button"
                      disabled={processingPayment}
                      onClick={() => void handleVerifyDjomyStatus()}
                      className="py-3 px-4 rounded-[var(--radius-s)] border border-[var(--color-ink)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-cream)] inline-flex items-center justify-center gap-2"
                    >
                      <RefreshCw className={`w-4 h-4 ${processingPayment ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                      <span>Vérifier le paiement</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(`/suivi/${checkoutResult.trackingToken}`)}
                    className="text-xs text-[var(--color-wood)] underline hover:text-[var(--color-ink)]"
                  >
                    Accéder à ma page de suivi ({checkoutResult.trackingToken})
                  </button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    disabled={processingPayment}
                    onClick={() => void handleCompletePortal('succeeded')}
                    className="flex-1 py-3 px-5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] font-semibold text-sm hover:bg-[var(--color-gold-deep)] hover:text-white transition-colors"
                  >
                    {processingPayment
                      ? 'Validation Djomy...'
                      : `Autoriser & régler ${formatGNF(checkoutResult.amountPaidNowGnf)}`}
                  </button>
                  <button
                    type="button"
                    disabled={processingPayment}
                    onClick={() => void handleCompletePortal('failed')}
                    className="py-3 px-4 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm text-[var(--color-wood)] hover:text-[var(--color-danger)]"
                  >
                    Simuler un échec
                  </button>
                </div>
              )}
            </>
          )}

          {checkoutResult.stage === 'otp' && (
            <form onSubmit={handleConfirmOtp} className="space-y-5">
              <div>
                <p className="text-xs font-medium text-[var(--color-wood)]">
                  Paiement direct Djomy · Validation OTP
                </p>
                <h1 className="font-display text-2xl font-semibold text-[var(--color-ink)] mt-1">
                  Saisissez le code à usage unique (OTP)
                </h1>
                <p className="text-sm text-[var(--color-body)] mt-2">
                  Montant débité :{' '}
                  <strong className="font-mono-num">
                    {formatGNF(checkoutResult.amountPaidNowGnf)}
                  </strong>
                  . Entrez le code à 4–6 chiffres transmis sur {buyerPhone}
                  {checkoutResult.sandbox ? (
                    <>
                      {' '}
                      (ex. <span className="font-mono-num font-semibold">4829</span>).
                    </>
                  ) : (
                    '.'
                  )}
                </p>
              </div>
              <input
                type="text"
                required
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="Ex. 4829"
                className="w-full px-4 py-3 rounded-[var(--radius-s)] border border-[var(--color-line)] font-mono-num text-lg tracking-widest text-center"
              />
              <div className="space-y-2.5">
                <button
                  type="submit"
                  disabled={processingPayment}
                  className="w-full py-3 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] font-semibold text-sm hover:bg-[var(--color-gold-deep)] hover:text-white transition-colors"
                >
                  {processingPayment ? 'Vérification...' : 'Confirmer le code OTP'}
                </button>
                <button
                  type="button"
                  disabled={processingPayment}
                  onClick={() => void handleVerifyDjomyStatus()}
                  className="w-full py-2.5 px-4 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-cream)] inline-flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${processingPayment ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                  <span>J’ai déjà validé sur mon mobile · Vérifier le statut Djomy</span>
                </button>
              </div>
            </form>
          )}

          {checkoutResult.stage === 'confirmed' && (
            <div className="text-center space-y-5 py-4">
              <CheckCircle2
                className="w-14 h-14 text-[var(--color-success)] mx-auto"
                strokeWidth={1.5}
              />
              <div>
                <p className="text-xs font-medium text-[var(--color-wood)]">
                  Paiement autorisé · {checkoutResult.djomyReference}
                </p>
                <h1 className="font-display text-3xl font-semibold text-[var(--color-ink)] mt-1">
                  Commande {checkoutResult.orderNumber} confirmée
                </h1>
                <p className="text-sm text-[var(--color-body)] mt-2 max-w-md mx-auto">
                  {checkoutResult.paymentPlan === 'deposit'
                    ? `Acompte de ${formatGNF(checkoutResult.amountPaidNowGnf)} réglé via Djomy. Solde restant à la livraison : ${formatGNF(checkoutResult.balanceDueGnf)}.`
                    : `Règlement intégral de ${formatGNF(checkoutResult.totalGnf)} confirmé.`}
                </p>
              </div>

              <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-line)] text-left">
                <p className="text-xs text-[var(--color-wood)]">Votre jeton de suivi personnel :</p>
                <p className="font-mono-num text-sm font-semibold text-[var(--color-ink)] break-all mt-1">
                  {checkoutResult.trackingToken}
                </p>
              </div>

              <button
                type="button"
                onClick={() => navigate(`/suivi/${checkoutResult.trackingToken}`)}
                className="w-full py-3.5 px-6 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white font-semibold text-sm hover:bg-[var(--color-wood)] inline-flex items-center justify-center gap-2 transition-colors"
              >
                <span>Accéder à ma page de suivi</span>
                <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="font-display text-3xl text-[var(--color-ink)]">Votre panier est vide</h1>
        <p className="mt-2 text-sm text-[var(--color-wood)]">
          Ajoutez au moins une pièce depuis le catalogue avant de passer commande.
        </p>
        <button
          type="button"
          onClick={() => navigate('/catalogue')}
          className="mt-6 px-6 py-3 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm font-medium"
        >
          Explorer le catalogue
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-10 lg:py-14">
      <div className="max-w-3xl mb-8">
        <p className="text-xs font-medium text-[var(--color-wood)]">
          Parcours acheteur invité · Aucune création de compte requise
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] mt-1">
          Finaliser votre commande
        </h1>

        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            { n: 1, label: '01. Coordonnées' },
            { n: 2, label: '02. Livraison' },
            { n: 3, label: '03. Modalité & Paiement' },
          ].map((st) => (
            <div key={st.n} className="space-y-1.5">
              <div className="h-1.5 rounded-full bg-[var(--color-cream)] overflow-hidden">
                <motion.div
                  initial={false}
                  animate={{ width: currentStep >= st.n ? '100%' : '0%' }}
                  transition={{ duration: 0.25 }}
                  className="h-full bg-[var(--color-gold)]"
                />
              </div>
              <p
                className={`text-xs font-medium ${
                  currentStep >= st.n ? 'text-[var(--color-ink)]' : 'text-[var(--color-wood)]'
                }`}
              >
                {st.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmitOrder} className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-7 space-y-8">
          {errorMsg && (
            <div
              role="alert"
              className="p-4 rounded-[var(--radius-s)] bg-[#A63B2E]/10 border border-[var(--color-danger)] text-sm text-[var(--color-danger)] font-medium"
            >
              {errorMsg}
            </div>
          )}

          {/* 1. Coordonnées */}
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              1. Vos coordonnées de suivi
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="chk-name" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Nom complet *
                </label>
                <input
                  id="chk-name"
                  required
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="Ex. Fatoumata Barry"
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                />
              </div>
              <div>
                <label htmlFor="chk-email" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Adresse courriel *
                </label>
                <input
                  id="chk-email"
                  type="email"
                  required
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  placeholder="nom@exemple.gn"
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="chk-email-confirm"
                  className="block text-xs font-medium text-[var(--color-wood)] mb-1"
                >
                  Confirmer le courriel *
                </label>
                <input
                  id="chk-email-confirm"
                  type="email"
                  required
                  value={buyerEmailConfirm}
                  onChange={(e) => setBuyerEmailConfirm(e.target.value)}
                  placeholder="Retapez votre courriel"
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="chk-phone" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Téléphone guinéen (référence suivi & livraison) *
                </label>
                <input
                  id="chk-phone"
                  required
                  value={buyerPhone}
                  onChange={(e) => setBuyerPhone(e.target.value)}
                  placeholder="+224 623 88 59 59"
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                />
              </div>
            </div>
          </section>

          {/* 2. Livraison par zone */}
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              2. Zone et adresse de livraison
            </h2>
            <div>
              <label htmlFor="chk-zone" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                Zone géographique *
              </label>
              <select
                id="chk-zone"
                value={selectedZoneId}
                onChange={(e) => setSelectedZoneId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-cream)] text-sm"
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} — {z.landmarks} ({z.estimatedDays})
                  </option>
                ))}
                <option value="pickup">Retrait en atelier EMROD — Sonfonia Centre (Gratuit)</option>
              </select>
            </div>
            <div>
              <label htmlFor="chk-addr" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                Quartier, rue ou point de retrait *
              </label>
              <input
                id="chk-addr"
                required
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="Ex. Kipé Centre Émetteur, Immeuble Kaba"
                className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
              />
            </div>
            <div>
              <label htmlFor="chk-landmark" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                Point de repère (recommandé à Conakry)
              </label>
              <input
                id="chk-landmark"
                value={deliveryLandmark}
                onChange={(e) => setDeliveryLandmark(e.target.value)}
                placeholder="Ex. À 100 m de la pharmacie, portail marron"
                className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
              />
            </div>
          </section>

          {/* 3. Modalité de règlement (Intégral / Acompte + Solde / Virement bancaire) & Djomy */}
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
                3. Choisissez votre formule de règlement
              </h2>
              <Lock className="w-4 h-4 text-[var(--color-wood)]" strokeWidth={1.5} />
            </div>

            <div className="space-y-3">
              {/* Plan 1: Full */}
              <button
                type="button"
                onClick={() => setPaymentPlan('full')}
                className={`w-full p-4 rounded-[var(--radius-s)] border text-left transition-colors flex items-start justify-between gap-4 ${
                  paymentPlan === 'full'
                    ? 'border-[var(--color-gold-deep)] bg-[var(--color-cream)] ring-1 ring-[var(--color-gold-deep)]'
                    : 'border-[var(--color-line)] hover:border-[var(--color-wood)]'
                }`}
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    Option 1 · Paiement intégral (100 %)
                  </p>
                  <p className="text-xs text-[var(--color-wood)] mt-0.5">
                    Réglez la totalité maintenant via Djomy et attendez la livraison.
                  </p>
                </div>
                <span className="font-mono-num text-sm font-semibold text-[var(--color-ink)] shrink-0">
                  {formatGNF(totalGnf)}
                </span>
              </button>

              {/* Plan 2: Deposit */}
              <button
                type="button"
                onClick={() => setPaymentPlan('deposit')}
                className={`w-full p-4 rounded-[var(--radius-s)] border text-left transition-colors flex items-start justify-between gap-4 ${
                  paymentPlan === 'deposit'
                    ? 'border-[var(--color-gold-deep)] bg-[var(--color-cream)] ring-1 ring-[var(--color-gold-deep)]'
                    : 'border-[var(--color-line)] hover:border-[var(--color-wood)]'
                }`}
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    Option 2 · Acompte ({defaultDepositPercent} %) maintenant + solde à la livraison
                  </p>
                  <p className="text-xs text-[var(--color-wood)] mt-0.5">
                    Payez l’acompte de{' '}
                    <span className="font-mono-num font-semibold text-[var(--color-ink)]">
                      {formatGNF(calculatePaymentPlanAmounts(totalGnf, 'deposit', defaultDepositPercent).amountPaidNowGnf)}
                    </span>{' '}
                    via Djomy, puis le solde de{' '}
                    <span className="font-mono-num font-semibold text-[var(--color-ink)]">
                      {formatGNF(calculatePaymentPlanAmounts(totalGnf, 'deposit', defaultDepositPercent).balanceDueGnf)}
                    </span>{' '}
                    à la réception.
                  </p>
                </div>
                <span className="font-mono-num text-sm font-semibold text-[var(--color-ink)] shrink-0">
                  {formatGNF(calculatePaymentPlanAmounts(totalGnf, 'deposit', defaultDepositPercent).amountPaidNowGnf)}
                </span>
              </button>

              {/* Plan 3: Direct Bank Transfer */}
              <button
                type="button"
                disabled={!bankEligibility.eligible}
                onClick={() => setPaymentPlan('bank_transfer')}
                className={`w-full p-4 rounded-[var(--radius-s)] border text-left transition-colors flex items-start justify-between gap-4 ${
                  !bankEligibility.eligible
                    ? 'border-[var(--color-line)] bg-[var(--color-cream)]/40 opacity-65 cursor-not-allowed'
                    : paymentPlan === 'bank_transfer'
                      ? 'border-[var(--color-gold-deep)] bg-[var(--color-cream)] ring-1 ring-[var(--color-gold-deep)]'
                      : 'border-[var(--color-line)] hover:border-[var(--color-wood)]'
                }`}
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)] flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-[var(--color-gold-deep)]" strokeWidth={1.5} />
                    <span>Option 3 · Virement bancaire direct (grandes commandes)</span>
                  </p>
                  <p className="text-xs text-[var(--color-wood)] mt-0.5">
                    {bankEligibility.eligible
                      ? 'Accédez aux coordonnées bancaires (RIB/IBAN) du vendeur, effectuez le virement et finalisez avec lui dans la messagerie EMROD.'
                      : bankEligibility.reason}
                  </p>
                </div>
                <span className="font-mono-num text-sm font-semibold text-[var(--color-ink)] shrink-0">
                  {bankEligibility.eligible ? formatGNF(totalGnf) : `≥ ${formatGNF(bankTransferMinGnf)}`}
                </span>
              </button>
            </div>

            <div className="p-3.5 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-line)] text-xs text-[var(--color-body)] flex items-start gap-2">
              <Info className="w-4 h-4 text-[var(--color-wood)] shrink-0 mt-0.5" strokeWidth={1.5} />
              <span>
                <strong>Commande sans paiement (Devis) :</strong> seule une offre personnalisée avec dimensions ou spécificités particulières (demandée depuis la fiche produit) peut être transmise sans règlement préalable.
              </span>
            </div>

            {paymentPlan !== 'bank_transfer' && (
              <div className="pt-4 border-t border-[var(--color-line)] space-y-4">
                <p className="text-xs font-semibold text-[var(--color-wood)]">
                  Moyen de paiement Djomy ({formatGNF(planAmounts.amountPaidNowGnf)} à régler)
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'mobile_money', label: 'Mobile Money', icon: Smartphone },
                    { id: 'card', label: 'Carte bancaire', icon: CreditCard },
                    { id: 'qr', label: 'Paiement QR', icon: QrCode },
                  ].map((m) => {
                    const Icon = m.icon;
                    const active = paymentMethod === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPaymentMethod(m.id as any)}
                        className={`p-3.5 rounded-[var(--radius-s)] border text-left transition-colors ${
                          active
                            ? 'border-[var(--color-gold-deep)] bg-[var(--color-cream)]'
                            : 'border-[var(--color-line)] hover:border-[var(--color-wood)]'
                        }`}
                      >
                        <Icon className="w-5 h-5 text-[var(--color-ink)] mb-1.5" strokeWidth={1.5} />
                        <span className="block text-sm font-semibold text-[var(--color-ink)]">
                          {m.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {paymentMethod === 'mobile_money' && (
                  <div>
                    <label
                      htmlFor="chk-op"
                      className="block text-xs font-medium text-[var(--color-wood)] mb-1"
                    >
                      Opérateur guinéen
                    </label>
                    <select
                      id="chk-op"
                      value={paymentOperator}
                      onChange={(e) => setPaymentOperator(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                    >
                      <option value="Orange Money">Orange Money Guinée (OM)</option>
                      <option value="MTN Mobile Money">MTN MoMo Guinée (MOMO)</option>
                      <option value="Kulu">Kulu Guinée</option>
                      <option value="Soutra Money">Soutra Money</option>
                      <option value="PayCard">PayCard</option>
                    </select>
                  </div>
                )}

                <div>
                  <p className="block text-xs font-medium text-[var(--color-wood)] mb-1.5">
                    Mode d’intégration Djomy
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentMode('redirect')}
                      className={`px-3.5 py-2.5 rounded-[var(--radius-s)] border text-xs font-medium text-left ${
                        paymentMode === 'redirect'
                          ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white'
                          : 'border-[var(--color-line)] text-[var(--color-body)]'
                      }`}
                    >
                      Portail Djomy avec redirection (recommandé)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMode('direct')}
                      className={`px-3.5 py-2.5 rounded-[var(--radius-s)] border text-xs font-medium text-left ${
                        paymentMode === 'direct'
                          ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white'
                          : 'border-[var(--color-line)] text-[var(--color-body)]'
                      }`}
                    >
                      Paiement direct intégré (avec code OTP)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Right Summary */}
        <aside className="lg:col-span-5 lg:sticky lg:top-24 p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-5">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
            Récapitulatif de commande
          </h2>

          {!singleVendor && (
            <div className="p-3 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] text-xs text-[var(--color-body)]">
              Votre panier regroupe <strong>{distinctVendors.length} ateliers</strong> sous un suivi unifié. Pour régler par virement bancaire direct ou contacter un atelier séparément, commandez atelier par atelier.
            </div>
          )}

          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {items.map((item) => (
              <div key={item.productId} className="flex items-center gap-3 text-sm">
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="w-14 h-14 rounded-[var(--radius-s)] object-cover shrink-0 bg-[var(--color-surface)]"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--color-ink)] truncate">{item.name}</p>
                  <p className="text-xs text-[var(--color-wood)]">
                    Qté : {item.quantity} · {item.vendorName}
                  </p>
                </div>
                <span className="font-mono-num font-medium text-[var(--color-ink)] shrink-0">
                  {formatGNF(item.priceGnf * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-[var(--color-line)] space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--color-wood)]">Sous-total</span>
              <span className="font-mono-num">{formatGNF(subtotalGnf)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-wood)]">{deliverySummary.label}</span>
              <span className="font-mono-num">
                {deliverySummary.fee === 0 ? 'Gratuit' : formatGNF(deliverySummary.fee)}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-[var(--color-line)] font-semibold text-[var(--color-ink)]">
              <span>Total commande</span>
              <span className="font-mono-num">{formatGNF(totalGnf)}</span>
            </div>

            {paymentPlan === 'deposit' && (
              <div className="p-3 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-1 text-xs mt-2">
                <div className="flex justify-between font-semibold text-[var(--color-ink)]">
                  <span>Acompte à payer aujourd’hui ({planAmounts.depositPercentApplied} %)</span>
                  <span className="font-mono-num">{formatGNF(planAmounts.amountPaidNowGnf)}</span>
                </div>
                <div className="flex justify-between text-[var(--color-wood)]">
                  <span>Solde restant à la livraison</span>
                  <span className="font-mono-num">{formatGNF(planAmounts.balanceDueGnf)}</span>
                </div>
              </div>
            )}

            {paymentPlan === 'bank_transfer' && (
              <div className="p-3 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-gold-deep)]/40 space-y-1 text-xs mt-2">
                <div className="flex justify-between font-semibold text-[var(--color-ink)]">
                  <span>À régler par virement bancaire</span>
                  <span className="font-mono-num">{formatGNF(totalGnf)}</span>
                </div>
                <p className="text-[var(--color-wood)]">
                  Les coordonnées bancaires du vendeur s’afficheront à l’étape suivante.
                </p>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 px-5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white font-semibold text-sm transition-colors min-h-[48px]"
          >
            {submitting
              ? 'Enregistrement...'
              : paymentPlan === 'bank_transfer'
                ? 'Confirmer & afficher les coordonnées bancaires'
                : paymentPlan === 'deposit'
                  ? `Payer l’acompte (${formatGNF(planAmounts.amountPaidNowGnf)}) avec Djomy`
                  : `Payer ${formatGNF(totalGnf)} avec Djomy`}
          </button>

          <p className="text-xs text-[var(--color-wood)] flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            <span>Échanges et suivi 100 % protégés sur EMROD.</span>
          </p>
        </aside>
      </form>
    </div>
  );
};
