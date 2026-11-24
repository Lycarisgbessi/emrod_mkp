import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  Building2,
  CheckCircle2,
  Copy,
  ExternalLink,
  MessageSquare,
  Printer,
  RefreshCw,
  Send,
  ShieldCheck,
  Star,
  XCircle,
} from 'lucide-react';
import { useRouter } from '../context/RouterContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import { detectExternalContactAttempt, formatGNF, ORDER_STATUS_FLOW } from '../shared/domain';
import type { OrderStatus, PaymentPlan, VendorBankDetails } from '../shared/types';

interface TrackingPayload {
  order: {
    id: string;
    orderNumber: string;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    deliveryZoneName: string;
    deliveryAddress: string;
    deliveryLandmark: string;
    subtotalGnf: number;
    deliveryFeeGnf: number;
    totalGnf: number;
    paymentPlan?: PaymentPlan;
    depositPercent?: number;
    amountPaidNowGnf?: number;
    balanceDueGnf?: number;
    bankTransferReference?: string;
    bankTransferDeclaredAt?: string | null;
    status: OrderStatus;
    notificationsEnabled: boolean;
    createdAt: string;
    expiresAt: string;
  };
  items: Array<{
    id: string;
    product_name: string;
    product_slug: string;
    product_image: string;
    quantity: number;
    unit_price_gnf: number;
  }>;
  events: Array<{
    id: string;
    status: string;
    actor_role: string;
    actor_name: string;
    comment: string;
    created_at: string;
  }>;
  payment: {
    djomy_reference: string;
    provider_reference?: string;
    method: string;
    operator: string;
    amount_gnf: number;
    status: string;
    payment_url?: string | null;
  } | null;
  vendor: {
    shopName: string;
    slug: string;
    location: string;
    responseTimeLabel: string;
  } | null;
  vendorBankDetails?: VendorBankDetails | null;
  review: {
    id: string;
    rating: number;
    comment: string;
    vendor_reply: string;
  } | null;
  dispute: {
    id: string;
    status: string;
    reason: string;
    resolution_notes: string;
  } | null;
  messages: Array<{
    id: string;
    sender_role: string;
    sender_name: string;
    content: string;
    created_at: string;
  }>;
  restrictions?: {
    allowExternalContactsInMessages: boolean;
  };
}

export const OrderTrackingPage: React.FC<{ token?: string }> = ({ token }) => {
  const { navigate, search } = useRouter();
  const { addToast } = useToast();

  const [lookupToken, setLookupToken] = useState(token || '');
  const [data, setData] = useState<TrackingPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');
  const [verifyingDjomy, setVerifyingDjomy] = useState(false);

  // Private message state
  const [msgText, setMsgText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  // Bank transfer declaration state
  const [transferRefInput, setTransferRefInput] = useState('');
  const [transferNotesInput, setTransferNotesInput] = useState('');
  const [declaringTransfer, setDeclaringTransfer] = useState(false);

  // Verified Review state (F-AVI-01)
  const [rating, setRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  // Dispute state
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  const loadOrder = async (tk: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<TrackingPayload>(`/api/orders/track/${encodeURIComponent(tk)}`);
      setData(res);
      document.title = `Suivi ${res.order.orderNumber} — EMROD`;
    } catch (err: any) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyDjomy = async (tk: string, fromReturn = false) => {
    setVerifyingDjomy(true);
    try {
      const res = await apiFetch<{
        status: string;
        rawStatus?: string;
        providerReference?: string | null;
      }>(`/api/orders/track/${encodeURIComponent(tk)}/verify-djomy`, { method: 'POST' });

      await loadOrder(tk);

      if (res.status === 'succeeded') {
        addToast({
          type: 'success',
          title: 'Paiement Djomy confirmé',
          description: res.providerReference
            ? `Référence opérateur : ${res.providerReference}`
            : 'Votre règlement a été vérifié auprès de Djomy.',
        });
      } else if (res.status === 'failed') {
        addToast({
          type: 'error',
          title: 'Transaction Djomy non aboutie',
          description: 'Le paiement a été refusé ou annulé.',
        });
      } else if (!fromReturn) {
        addToast({
          type: 'info',
          title: 'Paiement toujours en attente',
          description: `Statut Djomy : ${res.rawStatus || 'PENDING'}.`,
        });
      }
    } catch (err: any) {
      if (!fromReturn) {
        addToast({ type: 'error', title: 'Vérification Djomy impossible', description: err.message });
      }
    } finally {
      setVerifyingDjomy(false);
    }
  };

  useEffect(() => {
    if (token) {
      setLookupToken(token);
      const params = new URLSearchParams(search);
      if (params.get('djomy_return') === '1') {
        void handleVerifyDjomy(token, true);
      } else {
        void loadOrder(token);
        if (params.get('djomy_cancel') === '1') {
          addToast({
            type: 'info',
            title: 'Paiement Djomy interrompu',
            description: 'Vous pouvez relancer ou vérifier votre paiement ci-dessous.',
          });
        }
      }
    } else {
      document.title = 'Suivi de commande sans compte — EMROD';
      setData(null);
      setLoading(false);
    }
  }, [token, search]);

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupToken.trim()) return;
    navigate(`/suivi/${encodeURIComponent(lookupToken.trim())}`);
  };

  const handleCopyText = async (label: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      addToast({ type: 'success', title: `${label} copié`, description: val });
    } catch {
      addToast({ type: 'info', title: label, description: val });
    }
  };

  const handleToggleNotif = async () => {
    if (!token || !data) return;
    const next = !data.order.notificationsEnabled;
    try {
      await apiFetch(`/api/orders/track/${encodeURIComponent(token)}/notifications`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      });
      setData({ ...data, order: { ...data.order, notificationsEnabled: next } });
      addToast({
        type: 'info',
        title: next ? 'Alertes activées' : 'Alertes désactivées pour cette commande',
      });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleCancelOrder = async () => {
    if (!token || !data) return;
    try {
      const res = await apiFetch<{ ok: boolean; status: string }>(
        `/api/orders/track/${encodeURIComponent(token)}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: 'Annulée par l’acheteur depuis le lien de suivi' }),
        }
      );
      addToast({
        type: 'success',
        title: res.status === 'Remboursée' ? 'Commande annulée & remboursée' : 'Commande annulée',
        description:
          res.status === 'Remboursée'
            ? 'Le remboursement via Djomy a été déclenché et les pièces ont été remises en stock.'
            : 'Votre commande a bien été annulée et les pièces ont été remises en stock.',
      });
      await loadOrder(token);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Annulation impossible', description: err.message });
    }
  };

  const handleDeclareBankTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !transferRefInput.trim()) return;
    const allowExternal = data?.restrictions?.allowExternalContactsInMessages ?? false;
    if (!allowExternal) {
      const check = detectExternalContactAttempt(`${transferRefInput} ${transferNotesInput}`);
      if (check.blocked) {
        addToast({ type: 'error', title: 'Échange hors plateforme bloqué', description: check.reason });
        return;
      }
    }
    setDeclaringTransfer(true);
    try {
      await apiFetch(`/api/orders/track/${encodeURIComponent(token)}/declare-bank-transfer`, {
        method: 'POST',
        body: JSON.stringify({
          reference: transferRefInput.trim(),
          notes: transferNotesInput.trim(),
        }),
      });
      addToast({
        type: 'success',
        title: 'Avis de virement transmis à l’atelier',
        description: 'L’atelier va vérifier la réception sur son relevé et confirmer la commande.',
      });
      setTransferRefInput('');
      setTransferNotesInput('');
      await loadOrder(token);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Déclaration refusée', description: err.message });
    } finally {
      setDeclaringTransfer(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !msgText.trim()) return;
    const allowExternal = data?.restrictions?.allowExternalContactsInMessages ?? false;
    if (!allowExternal) {
      const check = detectExternalContactAttempt(msgText);
      if (check.blocked) {
        addToast({
          type: 'error',
          title: 'Échange hors plateforme bloqué',
          description: check.reason,
        });
        return;
      }
    }
    setSendingMsg(true);
    try {
      const m = await apiFetch<any>(`/api/orders/track/${encodeURIComponent(token)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: msgText.trim() }),
      });
      setData((prev) => (prev ? { ...prev, messages: [...prev.messages, m] } : prev));
      setMsgText('');
      addToast({ type: 'success', title: 'Message envoyé à l’atelier' });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    } finally {
      setSendingMsg(false);
    }
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setReviewSubmitting(true);
    try {
      await apiFetch(`/api/orders/track/${encodeURIComponent(token)}/review`, {
        method: 'POST',
        body: JSON.stringify({ rating, comment: reviewComment }),
      });
      addToast({ type: 'success', title: 'Merci pour votre avis vérifié !' });
      await loadOrder(token);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Publication impossible', description: err.message });
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleOpenDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      await apiFetch(`/api/orders/track/${encodeURIComponent(token)}/disputes`, {
        method: 'POST',
        body: JSON.stringify({ reason: disputeReason }),
      });
      setDisputeOpen(false);
      addToast({
        type: 'info',
        title: 'Litige enregistré',
        description: 'L’équipe d’arbitrage EMROD a été saisie.',
      });
      await loadOrder(token);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  // Lookup view when no token provided
  if (!token) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-14 space-y-8">
        <div className="text-center">
          <p className="text-xs font-medium text-[var(--color-wood)]">
            Achat sans compte · Lien personnel sécurisé
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] mt-2">
            Suivre votre commande EMROD
          </h1>
          <p className="text-sm text-[var(--color-body)] mt-2">
            Saisissez le jeton de suivi remis lors de votre commande (également envoyé par
            e-mail de confirmation lorsque la messagerie est activée).
          </p>
        </div>

        <form
          onSubmit={handleLookup}
          className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4"
        >
          <label htmlFor="tracking-token-input" className="block text-xs font-medium text-[var(--color-wood)]">
            Jeton personnel de suivi (commençant par emr_…)
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id="tracking-token-input"
              required
              value={lookupToken}
              onChange={(e) => setLookupToken(e.target.value)}
              placeholder="emr_••••••••"
              className="flex-1 px-4 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] font-mono-num text-sm"
            />
            <button
              type="submit"
              className="px-6 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm font-semibold hover:bg-[var(--color-wood)] transition-colors"
            >
              Afficher le suivi
            </button>
          </div>
          <p className="text-xs text-[var(--color-wood)] pt-1">
            Vous avez déposé une demande personnalisée sans paiement ?{' '}
            <button
              type="button"
              onClick={() => navigate('/devis')}
              className="underline font-semibold text-[var(--color-ink)]"
            >
              Suivre un devis sur mesure
            </button>
          </p>
        </form>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-14 space-y-4">
        <div className="h-10 w-64 rounded emrod-skeleton" />
        <div className="h-44 w-full rounded-[var(--radius-m)] emrod-skeleton" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
        <XCircle className="w-12 h-12 text-[var(--color-danger)] mx-auto" strokeWidth={1.5} />
        <h1 className="font-display text-2xl text-[var(--color-ink)]">
          Lien de suivi introuvable ou expiré
        </h1>
        <p className="text-sm text-[var(--color-wood)]">{error}</p>
        <button
          type="button"
          onClick={() => navigate('/suivi')}
          className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm font-medium"
        >
          Saisir un autre jeton
        </button>
      </div>
    );
  }

  const { order, items, events, payment, vendor, vendorBankDetails, review, dispute, messages, restrictions } = data;
  const allowExternal = restrictions?.allowExternalContactsInMessages ?? false;
  const activeFlowIdx = ORDER_STATUS_FLOW.indexOf(order.status);
  const canCancel = ['Commandée', 'Confirmée', 'En préparation'].includes(order.status);
  const plan: PaymentPlan = order.paymentPlan || 'full';
  const amountPaidNow = order.amountPaidNowGnf ?? order.totalGnf;
  const balanceDue = order.balanceDueGnf ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-10 space-y-8 print-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[var(--color-line)]">
        <div>
          <p className="text-xs font-medium text-[var(--color-wood)]">
            Commande invité · {new Date(order.createdAt).toLocaleDateString('fr-FR')}
          </p>
          <h1 className="font-display text-3xl font-semibold text-[var(--color-ink)] mt-1">
            {order.orderNumber} — <span className="text-[var(--color-wood)]">{order.status}</span>
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 no-print">
          <button
            type="button"
            onClick={() => void handleToggleNotif()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-cream)]"
          >
            {order.notificationsEnabled ? (
              <Bell className="w-4 h-4 text-[var(--color-gold-deep)]" strokeWidth={1.5} />
            ) : (
              <BellOff className="w-4 h-4 text-[var(--color-wood)]" strokeWidth={1.5} />
            )}
            <span>{order.notificationsEnabled ? 'Alertes actives' : 'Alertes coupées'}</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-cream)]"
          >
            <Printer className="w-4 h-4" strokeWidth={1.5} />
            <span>Imprimer le reçu</span>
          </button>

          {canCancel && (
            <button
              type="button"
              onClick={() => void handleCancelOrder()}
              className="px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-danger)]/40 text-xs font-medium text-[var(--color-danger)] hover:bg-[#A63B2E]/10"
            >
              Annuler la commande
            </button>
          )}
        </div>
      </div>

      {/* Animated Status Progress Timeline */}
      {!['Annulée', 'Remboursée'].includes(order.status) && (
        <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)]">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
            {ORDER_STATUS_FLOW.map((step, idx) => {
              const reached = activeFlowIdx >= idx;
              const isCurrent = activeFlowIdx === idx;
              return (
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="flex flex-col items-start sm:items-center text-left sm:text-center"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono-num font-semibold border transition-all ${
                      isCurrent
                        ? 'bg-[var(--color-gold)] text-[var(--color-ink)] border-[var(--color-gold-deep)] ring-4 ring-[var(--color-gold)]/25'
                        : reached
                          ? 'bg-[var(--color-ink)] text-white border-[var(--color-ink)]'
                          : 'bg-[var(--color-surface)] text-[var(--color-wood)] border-[var(--color-line)]'
                    }`}
                  >
                    {reached ? '✓' : idx + 1}
                  </div>
                  <span
                    className={`mt-2 text-xs ${
                      isCurrent ? 'font-semibold text-[var(--color-ink)]' : 'text-[var(--color-wood)]'
                    }`}
                  >
                    {step}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      {/* Pending Djomy Payment Verification Banner */}
      {payment && payment.status === 'pending' && plan !== 'bank_transfer' && token && (
        <section className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-gold-deep)]/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
          <div>
            <p className="text-xs font-semibold text-[var(--color-ink)]">
              Paiement Djomy en attente de confirmation ({payment.djomy_reference})
            </p>
            <p className="text-xs text-[var(--color-wood)] mt-0.5">
              Avez-vous validé la transaction sur le portail ou sur votre téléphone ? Actualisez le statut en direct auprès de Djomy.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {payment.payment_url && payment.payment_url.startsWith('http') && (
              <a
                href={payment.payment_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] text-xs font-semibold hover:bg-[var(--color-gold-deep)] hover:text-white inline-flex items-center gap-1.5 transition-colors"
              >
                <span>Régler sur Djomy</span>
                <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.5} />
              </a>
            )}
            <button
              type="button"
              disabled={verifyingDjomy}
              onClick={() => void handleVerifyDjomy(token)}
              className="px-4 py-2 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold hover:bg-[var(--color-wood)] inline-flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${verifyingDjomy ? 'animate-spin' : ''}`} strokeWidth={1.5} />
              <span>{verifyingDjomy ? 'Vérification...' : 'Vérifier le statut Djomy'}</span>
            </button>
          </div>
        </section>
      )}

      {/* Bank Transfer Panel when order uses direct bank transfer */}
      {plan === 'bank_transfer' && vendorBankDetails && (
        <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-gold-deep)]/50 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--color-line)]">
            <div className="flex items-center gap-2.5">
              <Building2 className="w-5 h-5 text-[var(--color-gold-deep)]" strokeWidth={1.5} />
              <div>
                <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
                  Règlement par virement bancaire direct
                </h2>
                <p className="text-xs text-[var(--color-wood)]">
                  Coordonnées bancaires officielles de {vendor?.shopName || 'l’atelier'}
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-[var(--color-ink)]">
              {balanceDue === 0
                ? 'Virement confirmé par l’atelier'
                : order.bankTransferDeclaredAt
                  ? `Virement déclaré (${order.bankTransferReference})`
                  : 'En attente de virement'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm bg-[var(--color-surface)] p-4 rounded-[var(--radius-s)] border border-[var(--color-line)]">
            <div>
              <p className="text-[var(--color-wood)]">Établissement bancaire</p>
              <p className="font-semibold text-[var(--color-ink)] mt-0.5">
                {vendorBankDetails.bankName}
              </p>
            </div>
            <div>
              <p className="text-[var(--color-wood)]">Titulaire du compte</p>
              <p className="font-semibold text-[var(--color-ink)] mt-0.5">
                {vendorBankDetails.bankAccountHolder}
              </p>
            </div>
            <div>
              <p className="text-[var(--color-wood)]">IBAN / RIB</p>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="font-mono-num font-semibold text-[var(--color-ink)] break-all">
                  {vendorBankDetails.bankIbanRib}
                </p>
                <button
                  type="button"
                  onClick={() => void handleCopyText('RIB / IBAN', vendorBankDetails.bankIbanRib)}
                  aria-label="Copier l’IBAN / RIB"
                  className="p-1 text-[var(--color-wood)] hover:text-[var(--color-ink)]"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div>
              <p className="text-[var(--color-wood)]">Code SWIFT / BIC · Référence à indiquer</p>
              <p className="font-mono-num font-semibold text-[var(--color-ink)] mt-0.5">
                {vendorBankDetails.bankSwiftBic || 'N/A'} · Réf. {order.orderNumber}
              </p>
            </div>
            {vendorBankDetails.bankInstructions && (
              <div className="md:col-span-2 pt-2 border-t border-[var(--color-line)] text-xs text-[var(--color-body)]">
                <strong>Consignes atelier :</strong> {vendorBankDetails.bankInstructions}
              </div>
            )}
          </div>

          {balanceDue > 0 && !['Annulée', 'Remboursée', 'Livrée'].includes(order.status) && (
            <form onSubmit={handleDeclareBankTransfer} className="space-y-3 no-print">
              <p className="text-xs font-semibold text-[var(--color-ink)]">
                {order.bankTransferDeclaredAt
                  ? 'Mettre à jour votre référence de virement bancaire :'
                  : 'Une fois votre virement effectué, déclarez la référence ici et échangez avec l’atelier ci-dessous pour finaliser la vente :'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <input
                  required
                  value={transferRefInput}
                  onChange={(e) => setTransferRefInput(e.target.value)}
                  placeholder="Référence bordereau / virement (ex. VIR-BICIGUI-8492)"
                  className="sm:col-span-5 px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs sm:text-sm font-mono-num"
                />
                <input
                  value={transferNotesInput}
                  onChange={(e) => setTransferNotesInput(e.target.value)}
                  placeholder="Banque émettrice ou note pour l’atelier (optionnel)"
                  className="sm:col-span-4 px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs sm:text-sm"
                />
                <button
                  type="submit"
                  disabled={declaringTransfer}
                  className="sm:col-span-3 px-4 py-2 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold hover:bg-[var(--color-wood)] transition-colors"
                >
                  {declaringTransfer ? 'Envoi...' : 'Déclarer le virement'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Details + Chronological History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 space-y-6">
          {/* Items & Payment Plan Totals */}
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              Pièces commandées & règlement
            </h2>
            {items.map((it) => (
              <div
                key={it.id}
                className="flex items-center gap-4 pb-3 border-b border-[var(--color-line)]/60"
              >
                <img
                  src={it.product_image}
                  alt={it.product_name}
                  className="w-16 h-16 rounded-[var(--radius-s)] object-cover bg-[var(--color-cream)]"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">{it.product_name}</p>
                  <p className="text-xs text-[var(--color-wood)]">Quantité : {it.quantity}</p>
                </div>
                <span className="font-mono-num text-sm font-semibold text-[var(--color-ink)] whitespace-nowrap shrink-0">
                  {formatGNF(it.unit_price_gnf * it.quantity)}
                </span>
              </div>
            ))}
            <div className="text-sm space-y-1.5 pt-1">
              <div className="flex justify-between gap-3 text-[var(--color-wood)]">
                <span>Livraison ({order.deliveryZoneName})</span>
                <span className="font-mono-num whitespace-nowrap shrink-0">
                  {formatGNF(order.deliveryFeeGnf)}
                </span>
              </div>
              <div className="flex justify-between gap-3 text-[var(--color-wood)]">
                <span>Modalité choisie</span>
                <span className="font-medium text-[var(--color-ink)] text-right">
                  {plan === 'deposit'
                    ? `Acompte (${order.depositPercent || 30}%) + Solde à la livraison`
                    : plan === 'bank_transfer'
                      ? 'Virement bancaire direct'
                      : `Paiement intégral (${payment?.operator || 'Djomy'})`}
                </span>
              </div>
              {payment?.provider_reference && (
                <div className="flex justify-between text-xs text-[var(--color-wood)]">
                  <span>Référence opérateur Djomy</span>
                  <span className="font-mono-num text-[var(--color-ink)]">{payment.provider_reference}</span>
                </div>
              )}
              <div className="flex justify-between gap-3 font-semibold text-base text-[var(--color-ink)] pt-1 border-t border-[var(--color-line)]">
                <span>Total commande</span>
                <span className="font-mono-num whitespace-nowrap shrink-0">{formatGNF(order.totalGnf)}</span>
              </div>
              {(plan === 'deposit' || plan === 'bank_transfer') && (
                <div className="pt-2 space-y-1 text-xs">
                  <div className="flex justify-between gap-3 text-[var(--color-success)] font-medium">
                    <span>Montant déjà réglé</span>
                    <span className="font-mono-num whitespace-nowrap shrink-0">
                      {formatGNF(amountPaidNow)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 text-[var(--color-ink)] font-semibold">
                    <span>
                      {plan === 'deposit'
                        ? balanceDue === 0 && order.status === 'Livrée'
                          ? 'Solde à la livraison'
                          : 'Reste à payer à la livraison'
                        : balanceDue === 0
                          ? 'Virement bancaire'
                          : 'Solde en attente de validation virement'}
                    </span>
                    <span className="font-mono-num whitespace-nowrap shrink-0">
                      {balanceDue === 0 ? 'Soldé' : formatGNF(balanceDue)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Chronological Events */}
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              Historique horodaté
            </h2>
            <ul className="space-y-3">
              {events.map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-start gap-3 text-sm pb-3 border-b last:border-b-0 border-[var(--color-line)]/60"
                >
                  <CheckCircle2
                    className="w-4 h-4 text-[var(--color-gold-deep)] shrink-0 mt-0.5"
                    strokeWidth={1.5}
                  />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--color-ink)]">{ev.status}</span>
                      <span className="font-mono-num text-xs text-[var(--color-wood)]">
                        {new Date(ev.created_at).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-body)] mt-0.5">
                      {ev.comment} · <em>{ev.actor_name}</em>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Verified Review Box */}
          {order.status === 'Livrée' && (
            <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4 no-print">
              <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
                Votre avis vérifié
              </h2>
              {review ? (
                <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-2">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: review.rating }).map((_, i) => (
                      <Star
                        key={i}
                        className="w-4 h-4 fill-[var(--color-gold)] text-[var(--color-gold)]"
                      />
                    ))}
                  </div>
                  <p className="text-sm text-[var(--color-body)]">{review.comment}</p>
                  {review.vendor_reply && (
                    <p className="text-xs text-[var(--color-wood)] pt-2 border-t border-[var(--color-line)]">
                      <strong>Réponse de l’atelier :</strong> {review.vendor_reply}
                    </p>
                  )}
                </div>
              ) : (
                <form onSubmit={handleReviewSubmit} className="space-y-3">
                  <div>
                    <span className="block text-xs font-medium text-[var(--color-wood)] mb-1">Note</span>
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setRating(n)}
                          aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
                          className="p-1"
                        >
                          <Star
                            className={`w-6 h-6 ${
                              n <= rating
                                ? 'fill-[var(--color-gold)] text-[var(--color-gold)]'
                                : 'text-[var(--color-line)]'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    rows={3}
                    required
                    minLength={8}
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="Partagez votre impression sur la qualité du bois, des finitions et la livraison... (8 caractères minimum)"
                    className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  />
                  <button
                    type="submit"
                    disabled={reviewSubmitting}
                    className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] text-sm font-semibold hover:bg-[var(--color-gold-deep)] hover:text-white transition-colors"
                  >
                    {reviewSubmitting ? 'Envoi...' : 'Publier mon avis vérifié'}
                  </button>
                </form>
              )}
            </section>
          )}
        </div>

        {/* Right Column: Delivery Info, Private In-Platform Messaging & Dispute */}
        <div className="lg:col-span-5 space-y-6">
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-2 text-sm">
            <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">
              Coordonnées de livraison
            </h2>
            <p className="font-medium text-[var(--color-ink)]">{order.buyerName}</p>
            <p className="text-[var(--color-body)]">{order.deliveryAddress}</p>
            {order.deliveryLandmark && (
              <p className="text-xs text-[var(--color-wood)]">Repère : {order.deliveryLandmark}</p>
            )}
            <p className="text-xs text-[var(--color-wood)] pt-1">
              Tél : {order.buyerPhone} · {order.buyerEmail}
            </p>
            {vendor && (
              <p className="text-xs text-[var(--color-wood)] pt-2 border-t border-[var(--color-line)]">
                Atelier :{' '}
                <button
                  type="button"
                  onClick={() => navigate(`/artisan/${vendor.slug}`)}
                  className="font-semibold text-[var(--color-ink)] underline"
                >
                  {vendor.shopName}
                </button>{' '}
                ({vendor.location})
              </p>
            )}
          </section>

          {/* Private Order Messaging with Mandatory In-Platform Guardrail */}
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4 no-print">
            <h2 className="font-display text-lg font-semibold text-[var(--color-ink)] flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[var(--color-wood)]" strokeWidth={1.5} />
              <span>Messagerie privée avec l’atelier</span>
            </h2>

            {!allowExternal && (
              <p className="text-[11px] text-[var(--color-body)] p-2.5 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-line)] flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[var(--color-gold-deep)] shrink-0 mt-0.5" strokeWidth={1.5} />
                <span>
                  Échanges protégés sur EMROD uniquement : le partage de numéros, courriels ou liens externes est bloqué.
                </span>
              </p>
            )}

            <div className="space-y-3 max-h-64 overflow-y-auto">
              {messages.length === 0 ? (
                <p className="text-xs text-[var(--color-wood)]">
                  Aucun message pour l’instant. Posez une question sur votre livraison, virement ou montage.
                </p>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`p-3 rounded-[var(--radius-s)] text-xs ${
                      m.sender_role === 'buyer'
                        ? 'bg-[var(--color-cream)] ml-4'
                        : 'bg-[var(--color-ink)] text-white mr-4'
                    }`}
                  >
                    <div className="flex justify-between gap-2 opacity-75 mb-1">
                      <span className="font-semibold">{m.sender_name}</span>
                      <span>
                        {new Date(m.created_at).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p>{m.content}</p>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                placeholder="Écrire à l’atelier..."
                className="flex-1 px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
              />
              <button
                type="submit"
                disabled={sendingMsg}
                aria-label="Envoyer le message"
                className="px-3.5 py-2 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white hover:bg-[var(--color-wood)]"
              >
                <Send className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </form>
          </section>

          {/* Dispute / Arbitration */}
          <section className="p-5 rounded-[var(--radius-m)] border border-[var(--color-line)] bg-[var(--color-surface)] space-y-3 no-print">
            {dispute ? (
              <div className="text-xs space-y-1">
                <p className="font-semibold text-[var(--color-ink)] flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-[var(--color-gold-deep)]" strokeWidth={1.5} />
                  <span>Litige en cours ({dispute.status})</span>
                </p>
                <p className="text-[var(--color-body)]">{dispute.reason}</p>
                {dispute.resolution_notes && (
                  <p className="text-[var(--color-success)] font-medium">
                    Décision EMROD : {dispute.resolution_notes}
                  </p>
                )}
              </div>
            ) : !disputeOpen ? (
              <button
                type="button"
                onClick={() => setDisputeOpen(true)}
                className="text-xs text-[var(--color-wood)] hover:text-[var(--color-danger)] underline"
              >
                Signaler un problème ou ouvrir un litige auprès d’EMROD
              </button>
            ) : (
              <form onSubmit={handleOpenDispute} className="space-y-3">
                <textarea
                  rows={3}
                  required
                  minLength={10}
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="Décrivez le souci constaté afin que l’équipe EMROD arbitre... (10 caractères minimum)"
                  className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-[var(--radius-s)] bg-[var(--color-danger)] text-white text-xs font-medium"
                  >
                    Ouvrir un litige
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisputeOpen(false)}
                    className="px-3 py-2 text-xs text-[var(--color-wood)]"
                  >
                    Annuler
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
