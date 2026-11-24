import React, { useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { useRouter } from '../context/RouterContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import { formatGNF } from '../shared/domain';

export const PaymentLinkPage: React.FC<{ djomyRef: string }> = ({ djomyRef }) => {
  const { navigate, search } = useRouter();
  const { addToast } = useToast();

  const [quote, setQuote] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [trackingInfo, setTrackingInfo] = useState<{
    orderNumber?: string;
    trackingToken?: string;
  }>(() => {
    try {
      const raw = sessionStorage.getItem(`emrod_quote_track_${djomyRef}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const fetchQuoteData = () =>
    fetch(`/api/quotes/${encodeURIComponent(djomyRef)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setQuote(d.quote);
        if (d.quote?.order_number) {
          setTrackingInfo((prev) => ({ ...prev, orderNumber: d.quote.order_number }));
        }
      });

  const handleVerifyLiveLink = async (fromReturn = false) => {
    setPaying(true);
    try {
      const res = await apiFetch<{
        paid: boolean;
        status: string;
        orderNumber?: string;
      }>(`/api/quotes/${encodeURIComponent(djomyRef)}/verify-djomy`, { method: 'POST' });
      await fetchQuoteData();
      if (res.paid) {
        addToast({
          type: 'success',
          title: 'Paiement Djomy confirmé',
          description: res.orderNumber
            ? `Commande ${res.orderNumber} confirmée.`
            : 'Votre devis sur mesure est réglé.',
        });
      } else if (!fromReturn) {
        addToast({
          type: 'info',
          title: 'Règlement en attente',
          description: `Statut du lien Djomy : ${res.status}.`,
        });
      }
    } catch (err: any) {
      if (!fromReturn) {
        addToast({ type: 'error', title: 'Vérification impossible', description: err.message });
      }
    } finally {
      setPaying(false);
    }
  };

  useEffect(() => {
    document.title = `Règlement Devis ${djomyRef} — Djomy · EMROD`;
    const params = new URLSearchParams(search);
    const run = async () => {
      try {
        if (params.get('djomy_return') === '1') {
          await handleVerifyLiveLink(true);
        } else {
          await fetchQuoteData();
        }
      } catch {
        setQuote(null);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [djomyRef, search]);

  const handlePay = async () => {
    setPaying(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        status: string;
        orderId?: string;
        orderNumber?: string;
        trackingToken?: string;
      }>(`/api/quotes/${encodeURIComponent(djomyRef)}/pay`, { method: 'POST' });

      const nextTrack = {
        orderNumber: res.orderNumber || trackingInfo.orderNumber,
        trackingToken: res.trackingToken || trackingInfo.trackingToken,
      };
      setTrackingInfo(nextTrack);
      try {
        sessionStorage.setItem(`emrod_quote_track_${djomyRef}`, JSON.stringify(nextTrack));
      } catch {
        // ignore storage quota
      }

      setQuote((prev: any) =>
        prev ? { ...prev, step_status: 'paid', order_number: res.orderNumber || prev.order_number } : prev
      );
      addToast({
        type: 'success',
        title: 'Devis réglé avec succès',
        description: res.orderNumber
          ? `Commande ${res.orderNumber} confirmée. L’atelier démarre la fabrication.`
          : 'L’atelier démarre la fabrication sur mesure de votre pièce.',
      });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Paiement refusé', description: err.message });
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16">
        <div className="h-64 rounded-[var(--radius-m)] emrod-skeleton" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
        <h1 className="font-display text-2xl text-[var(--color-ink)]">Lien de paiement introuvable</h1>
        <button
          type="button"
          onClick={() => navigate('/catalogue')}
          className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm"
        >
          Retour au catalogue
        </button>
      </div>
    );
  }

  const paid = quote.step_status === 'paid';
  const resolvedOrderNumber = trackingInfo.orderNumber || quote.order_number;
  const externalLinkUrl =
    typeof quote.payment_link_url === 'string' && quote.payment_link_url.startsWith('http')
      ? quote.payment_link_url
      : null;

  return (
    <div className="max-w-xl mx-auto px-4 py-14">
      <div className="p-8 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-[var(--color-line)]">
          <CreditCard className="w-6 h-6 text-[var(--color-gold-deep)]" />
          <div>
            <p className="text-xs text-[var(--color-wood)]">
              Lien sécurisé Djomy · {quote.djomy_reference || djomyRef}
            </p>
            <h1 className="font-display text-2xl font-semibold text-[var(--color-ink)]">
              Règlement de projet sur mesure
            </h1>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <p>
            <strong>Pièce :</strong> {quote.product_name}
          </p>
          <p>
            <strong>Atelier :</strong> {quote.shop_name}
          </p>
          <p>
            <strong>Client :</strong> {quote.buyer_name} ({quote.buyer_email})
          </p>
          <p>
            <strong>Essence & dimensions :</strong> {quote.preferred_material} · {quote.dimensions_notes}
          </p>
        </div>

        <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between">
          <span className="text-sm text-[var(--color-wood)]">Montant du devis validé</span>
          <span className="font-mono-num text-xl font-bold text-[var(--color-ink)]">
            {formatGNF(Number(quote.quoted_amount_gnf || 0))}
          </span>
        </div>

        {paid ? (
          <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-success)]/40 text-sm space-y-3">
            <div className="text-[var(--color-success)] flex items-center gap-2 font-semibold">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>
                Règlement confirmé via Djomy
                {resolvedOrderNumber ? ` · Commande ${resolvedOrderNumber}` : '.'}
              </span>
            </div>
            {trackingInfo.trackingToken && (
              <button
                type="button"
                onClick={() => navigate(`/suivi/${encodeURIComponent(trackingInfo.trackingToken!)}`)}
                className="w-full py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold hover:bg-[var(--color-wood)] transition-colors"
              >
                Suivre la fabrication & livraison sans compte
              </button>
            )}
          </div>
        ) : externalLinkUrl ? (
          <div className="space-y-2.5">
            <a
              href={externalLinkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3.5 px-5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
            >
              <span>Ouvrir le lien officiel Djomy</span>
              <ExternalLink className="w-4 h-4" strokeWidth={1.5} />
            </a>
            <button
              type="button"
              onClick={() => void handleVerifyLiveLink(false)}
              disabled={paying}
              className="w-full py-2.5 px-4 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-cream)] inline-flex items-center justify-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${paying ? 'animate-spin' : ''}`} strokeWidth={1.5} />
              <span>{paying ? 'Vérification...' : 'Vérifier le paiement auprès de Djomy'}</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void handlePay()}
            disabled={paying}
            className="w-full py-3.5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white font-semibold text-sm transition-colors"
          >
            {paying ? 'Traitement Djomy...' : 'Régler maintenant via Djomy'}
          </button>
        )}

        <p className="text-[11px] text-[var(--color-wood)] flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <span>Orange Money, MTN MoMo, Kulu, Soutra Money, PayCard & Cartes bancaires.</span>
        </p>
      </div>
    </div>
  );
};
