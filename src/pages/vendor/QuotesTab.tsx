import React from 'react';
import {
  formatGNF,
} from '../../shared/domain';
import type { VendorDashboardPayload } from './types';

interface QuotesTabProps {
  navigate: (to: string, options?: { replace?: boolean }) => void;
  zones: VendorDashboardPayload['zones'];
  quotes: VendorDashboardPayload['quotes'];
  quoteAmounts: Record<string, string>;
  setQuoteAmounts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleUpdateQuoteStep: (quoteId: string, stepStatus: string) => void;
  handleSendQuoteLink: (quoteId: string) => void;
}

/** Tab extracted from VendorPortalPage — presentation only, state lives in the parent. */
export const QuotesTab: React.FC<QuotesTabProps> = ({
    navigate,
    zones,
    quotes,
    quoteAmounts,
    setQuoteAmounts,
    handleUpdateQuoteStep,
    handleSendQuoteLink
}) => {
  return (
      <div className="space-y-4">
        <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)]">
          Demandes de projets sur mesure
        </h2>
        {quotes.length === 0 ? (
          <p className="text-sm text-[var(--color-wood)]">
            Aucune demande de devis enregistrée pour votre atelier.
          </p>
        ) : (
          quotes.map((q) => (
            <div
              key={q.id}
              className="p-5 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-[var(--color-wood)]">
                    Pièce : <strong>{q.product_name}</strong>
                  </p>
                  <p className="text-sm font-semibold text-[var(--color-ink)] mt-0.5">
                    {q.buyer_name} ({q.buyer_email} · {q.buyer_phone})
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    aria-label={`Étape sur mesure pour ${q.buyer_name}`}
                    value={q.step_status}
                    onChange={(e) => void handleUpdateQuoteStep(q.id, e.target.value)}
                    className="px-3 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-cream)] text-xs font-medium"
                  >
                    <option value="material">1. Choix matériaux</option>
                    <option value="design">2. Validation croquis & plan</option>
                    <option value="quoted">Devis Djomy transmis</option>
                    <option value="paid" disabled={q.step_status !== 'paid'}>
                      Réglé via Djomy
                    </option>
                    <option value="fabrication">3. Fabrication atelier</option>
                    <option value="delivery">4. Livraison & montage</option>
                    <option value="completed">Projet terminé</option>
                  </select>
                  {q.quoted_amount_gnf && (
                    <span className="font-mono-num text-base font-semibold text-[var(--color-ink)]">
                      {formatGNF(q.quoted_amount_gnf)}
                    </span>
                  )}
                </div>
              </div>

              <p className="text-xs text-[var(--color-body)]">
                <strong>Quantité :</strong> {q.quantity || 1} ·{' '}
                <strong>Essence souhaitée :</strong> {q.preferred_material || 'Non précisée'} ·{' '}
                <strong>Dimensions :</strong> {q.dimensions_notes || 'Standard'} ·{' '}
                <strong>Zone :</strong>{' '}
                {zones.find((z) => z.id === q.desired_zone_id)?.name ||
                  (q.desired_zone_id === 'pickup' ? 'Retrait en atelier' : q.desired_zone_id || 'Conakry')}
              </p>
              <p className="text-xs text-[var(--color-body)]">{q.project_notes}</p>

              {q.payment_link_url ? (
                <div className="pt-2 border-t border-[var(--color-line)] flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-[var(--color-success)] font-medium">
                    Lien Djomy généré ({q.djomy_reference})
                  </span>
                  {q.payment_link_url.startsWith('http') ? (
                    <a
                      href={q.payment_link_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-semibold text-[var(--color-ink)]"
                    >
                      Ouvrir le lien Djomy
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate(q.payment_link_url!)}
                      className="underline font-semibold text-[var(--color-ink)]"
                    >
                      Ouvrir {q.payment_link_url}
                    </button>
                  )}
                </div>
              ) : (
                <div className="pt-2 border-t border-[var(--color-line)] flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    placeholder="Montant devis GNF (ex. 8500000)"
                    value={quoteAmounts[q.id] || ''}
                    onChange={(e) =>
                      setQuoteAmounts((prev) => ({ ...prev, [q.id]: e.target.value }))
                    }
                    className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-mono-num w-56"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSendQuoteLink(q.id)}
                    className="px-4 py-2 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] text-xs font-semibold hover:bg-[var(--color-gold-deep)] hover:text-white"
                  >
                    Envoyer un lien de paiement Djomy
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
  );
};
