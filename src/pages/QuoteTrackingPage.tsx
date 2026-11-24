import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Lock,
  MessageSquare,
  RefreshCw,
  Ruler,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useRouter } from '../context/RouterContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import {
  detectExternalContactAttempt,
  extractTrackingTokenFromText,
  formatGNF,
} from '../shared/domain';
import type { VendorPublicSummary } from '../shared/types';

interface QuoteTrackPayload {
  quote: {
    id: string;
    productId: string;
    productName: string;
    productSlug: string;
    buyerName: string;
    buyerEmail: string;
    preferredMaterial: string;
    dimensionsNotes: string;
    projectNotes: string;
    quantity: number;
    desiredZoneId: string;
    stepStatus: string;
    quotedAmountGnf: number | null;
    paymentLinkUrl: string | null;
    djomyReference: string | null;
    orderNumber: string | null;
    orderStatus: string | null;
    createdAt: string;
    updatedAt: string;
  };
  vendor: VendorPublicSummary | null;
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

const QUOTE_STEPS = [
  { key: 'material', label: '1. Matériaux' },
  { key: 'design', label: '2. Plans & croquis' },
  { key: 'quoted', label: '3. Devis Djomy' },
  { key: 'paid', label: '4. Validé & payé' },
  { key: 'fabrication', label: '5. Façonnage' },
  { key: 'delivery', label: '6. Livraison' },
];

export const QuoteTrackingPage: React.FC<{ token?: string }> = ({ token }) => {
  const { navigate } = useRouter();
  const { addToast } = useToast();

  const [lookupToken, setLookupToken] = useState(token || '');
  const [data, setData] = useState<QuoteTrackPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');
  const [msgText, setMsgText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [verifyingDjomy, setVerifyingDjomy] = useState(false);

  const loadQuote = async (tk: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<QuoteTrackPayload>(`/api/quotes/track/${encodeURIComponent(tk)}`);
      setData(res);
      document.title = `Devis sur mesure ${res.quote.productName} — EMROD`;
    } catch (err: any) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      setLookupToken(token);
      void loadQuote(token);
    } else {
      document.title = 'Suivi de devis personnalisé — EMROD';
      setData(null);
      setLoading(false);
    }
  }, [token]);

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupToken.trim()) return;
    navigate(`/devis/${encodeURIComponent(lookupToken.trim())}`);
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
      const created = await apiFetch<any>(`/api/quotes/track/${encodeURIComponent(token)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: msgText.trim() }),
      });
      setData((prev) => (prev ? { ...prev, messages: [...prev.messages, created] } : prev));
      setMsgText('');
      addToast({ type: 'success', title: 'Message transmis à l’atelier' });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Envoi refusé', description: err.message });
    } finally {
      setSendingMsg(false);
    }
  };

  const handleVerifyQuotePayment = async () => {
    if (!token || !data?.quote) return;
    const ref = data.quote.djomyReference || data.quote.id;
    setVerifyingDjomy(true);
    try {
      const res = await apiFetch<{ paid: boolean; status: string; orderNumber?: string }>(
        `/api/quotes/${encodeURIComponent(ref)}/verify-djomy`,
        { method: 'POST' }
      );
      await loadQuote(token);
      if (res.paid) {
        addToast({
          type: 'success',
          title: 'Paiement Djomy confirmé',
          description: res.orderNumber
            ? `Commande ${res.orderNumber} créée, l’atelier démarre le façonnage.`
            : 'Votre devis sur mesure est réglé.',
        });
      } else {
        addToast({
          type: 'info',
          title: 'Lien Djomy en attente de règlement',
          description: `Statut actuel : ${res.status}.`,
        });
      }
    } catch (err: any) {
      addToast({ type: 'error', title: 'Vérification impossible', description: err.message });
    } finally {
      setVerifyingDjomy(false);
    }
  };

  if (!token) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-14 space-y-8">
        <div className="text-center">
          <p className="text-xs font-medium text-[var(--color-wood)]">
            Projets personnalisés · Messagerie sécurisée EMROD
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] mt-2">
            Suivre votre devis sur mesure
          </h1>
          <p className="text-sm text-[var(--color-body)] mt-2">
            Saisissez le jeton remis lors de l’envoi de votre demande personnalisée pour échanger avec l’atelier et recevoir votre lien de règlement.
          </p>
        </div>

        <form
          onSubmit={handleLookup}
          className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4"
        >
          <label htmlFor="quote-token-input" className="block text-xs font-medium text-[var(--color-wood)]">
            Jeton de suivi de devis
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id="quote-token-input"
              required
              value={lookupToken}
              onChange={(e) => setLookupToken(e.target.value)}
              placeholder="Collez votre jeton de devis..."
              className="flex-1 px-4 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] font-mono-num text-sm"
            />
            <button
              type="submit"
              className="px-6 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm font-semibold hover:bg-[var(--color-wood)] transition-colors"
            >
              Ouvrir le devis
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-14 space-y-4">
        <div className="h-10 w-64 rounded emrod-skeleton" />
        <div className="h-48 w-full rounded-[var(--radius-m)] emrod-skeleton" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
        <XCircle className="w-12 h-12 text-[var(--color-danger)] mx-auto" strokeWidth={1.5} />
        <h1 className="font-display text-2xl text-[var(--color-ink)]">Devis introuvable</h1>
        <p className="text-sm text-[var(--color-wood)]">{error}</p>
        <button
          type="button"
          onClick={() => navigate('/catalogue')}
          className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm font-medium"
        >
          Retour au catalogue
        </button>
      </div>
    );
  }

  const { quote, vendor, messages, restrictions } = data;
  const allowExternal = restrictions?.allowExternalContactsInMessages ?? false;
  const currentStepIdx = Math.max(
    0,
    QUOTE_STEPS.findIndex((s) => s.key === quote.stepStatus)
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[var(--color-line)]">
        <div>
          <p className="text-xs font-medium text-[var(--color-wood)]">
            Devis personnalisé sans paiement préalable · {new Date(quote.createdAt).toLocaleDateString('fr-FR')}
          </p>
          <h1 className="font-display text-3xl font-semibold text-[var(--color-ink)] mt-1">
            {quote.productName}
          </h1>
        </div>
        {vendor && (
          <button
            type="button"
            onClick={() => navigate(`/artisan/${vendor.slug}`)}
            className="text-xs font-semibold text-[var(--color-ink)] underline underline-offset-4"
          >
            Atelier : {vendor.shopName}
          </button>
        )}
      </div>

      {/* Progress steps */}
      <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)]">
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
          {QUOTE_STEPS.map((st, idx) => {
            const reached = currentStepIdx >= idx || quote.stepStatus === 'completed';
            const isCurrent = quote.stepStatus === st.key;
            return (
              <div key={st.key} className="flex flex-col items-start sm:items-center text-left sm:text-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono-num font-semibold border ${
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
                  {st.label}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Specifications & Djomy Quote Proposal */}
        <div className="lg:col-span-6 space-y-6">
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)] flex items-center gap-2">
              <Ruler className="w-4 h-4 text-[var(--color-wood)]" strokeWidth={1.5} />
              <span>Spécificités demandées</span>
            </h2>
            <dl className="space-y-3 text-xs sm:text-sm">
              <div className="flex justify-between gap-2 pb-2 border-b border-[var(--color-line)]/60">
                <dt className="text-[var(--color-wood)]">Client</dt>
                <dd className="font-medium text-[var(--color-ink)]">{quote.buyerName}</dd>
              </div>
              <div className="flex justify-between gap-2 pb-2 border-b border-[var(--color-line)]/60">
                <dt className="text-[var(--color-wood)]">Quantité</dt>
                <dd className="font-mono-num font-medium text-[var(--color-ink)]">
                  {quote.quantity} pièce{quote.quantity > 1 ? 's' : ''}
                </dd>
              </div>
              <div className="flex justify-between gap-2 pb-2 border-b border-[var(--color-line)]/60">
                <dt className="text-[var(--color-wood)]">Matériau & essence</dt>
                <dd className="font-medium text-[var(--color-ink)] text-right">
                  {quote.preferredMaterial}
                </dd>
              </div>
              <div className="flex justify-between gap-2 pb-2 border-b border-[var(--color-line)]/60">
                <dt className="text-[var(--color-wood)]">Dimensions souhaitées</dt>
                <dd className="font-medium text-[var(--color-ink)] text-right">
                  {quote.dimensionsNotes}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-wood)]">Notes du projet</dt>
                <dd className="text-[var(--color-body)] mt-1 leading-relaxed">{quote.projectNotes}</dd>
              </div>
            </dl>
          </section>

          {/* Quoted Price & Payment Link */}
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)] flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[var(--color-gold-deep)]" strokeWidth={1.5} />
              <span>Proposition tarifaire de l’atelier</span>
            </h2>

            {quote.quotedAmountGnf && quote.paymentLinkUrl ? (
              <div className="space-y-4">
                <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between">
                  <span className="text-xs sm:text-sm text-[var(--color-wood)]">Montant validé</span>
                  <span className="font-mono-num text-xl font-bold text-[var(--color-ink)]">
                    {formatGNF(quote.quotedAmountGnf)}
                  </span>
                </div>

                {quote.orderNumber ? (
                  (() => {
                    const orderToken = messages
                      .map((m) => extractTrackingTokenFromText(m.content))
                      .find(Boolean);
                    return (
                      <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-success)]/40 text-xs space-y-2.5">
                        <p className="font-semibold text-[var(--color-success)] flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                          <span>
                            Devis réglé · Commande {quote.orderNumber} ({quote.orderStatus})
                          </span>
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(orderToken ? `/suivi/${encodeURIComponent(orderToken)}` : '/suivi')
                          }
                          className="w-full py-2.5 px-4 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold hover:bg-[var(--color-wood)] inline-flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <span>Suivre la fabrication & livraison ({quote.orderNumber})</span>
                          <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                      </div>
                    );
                  })()
                ) : quote.paymentLinkUrl.startsWith('http') ? (
                  <div className="space-y-2.5">
                    <a
                      href={quote.paymentLinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-3.5 px-5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      <span>Valider & payer sur Djomy ({quote.djomyReference})</span>
                      <ExternalLink className="w-4 h-4" strokeWidth={1.5} />
                    </a>
                    <button
                      type="button"
                      disabled={verifyingDjomy}
                      onClick={() => void handleVerifyQuotePayment()}
                      className="w-full py-2.5 px-4 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-cream)] inline-flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${verifyingDjomy ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                      <span>J’ai déjà payé · Vérifier le statut Djomy</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate(quote.paymentLinkUrl!)}
                    className="w-full py-3.5 px-5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    <span>Valider & payer via Djomy ({quote.djomyReference})</span>
                    <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs sm:text-sm text-[var(--color-body)] leading-relaxed">
                L’atelier étudie actuellement vos dimensions et finitions. Dès que vous aurez convenu des détails via la messagerie ci-contre, l’artisan émettra votre proposition tarifaire et le lien de paiement Djomy apparaîtra ici.
              </p>
            )}
          </section>
        </div>

        {/* Right: Mandatory In-Platform Messaging Thread */}
        <section className="lg:col-span-6 p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[var(--color-line)]">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)] flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[var(--color-wood)]" strokeWidth={1.5} />
              <span>Messagerie sécurisée avec l’atelier</span>
            </h2>
            <Lock className="w-4 h-4 text-[var(--color-gold-deep)] shrink-0" strokeWidth={1.5} />
          </div>

          {!allowExternal && (
            <div className="p-3 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-line)] text-[11px] text-[var(--color-body)] flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-[var(--color-gold-deep)] shrink-0 mt-0.5" strokeWidth={1.5} />
              <span>
                Pour garantir votre fabrication et vos paiements, tous les échanges doivent rester sur EMROD. Les numéros de téléphone, adresses courriel et liens externes sont automatiquement bloqués.
              </span>
            </div>
          )}

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <p className="text-xs text-[var(--color-wood)]">
                Aucun message pour l’instant.
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`p-3 rounded-[var(--radius-s)] text-xs ${
                    m.sender_role === 'buyer'
                      ? 'bg-[var(--color-cream)] ml-4 text-[var(--color-ink)]'
                      : 'bg-[var(--color-ink)] text-white mr-4'
                  }`}
                >
                  <div className="flex justify-between gap-2 opacity-75 mb-1">
                    <span className="font-semibold">
                      {m.sender_name} {m.sender_role === 'vendor' ? '(Atelier)' : ''}
                    </span>
                    <span>
                      {new Date(m.created_at).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="whitespace-pre-line break-words">{m.content}</p>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSendMessage} className="flex gap-2 pt-2 border-t border-[var(--color-line)]">
            <input
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              placeholder="Préciser un détail, valider un croquis..."
              className="flex-1 px-3 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
            />
            <button
              type="submit"
              disabled={sendingMsg}
              aria-label="Envoyer le message"
              className="px-4 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white hover:bg-[var(--color-wood)] text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Send className="w-4 h-4" strokeWidth={1.5} />
              <span>Envoyer</span>
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};
