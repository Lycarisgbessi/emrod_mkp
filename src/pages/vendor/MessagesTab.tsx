import React from 'react';
import {
  Lock,
  MessageSquare,
  Send,
} from 'lucide-react';
import type { VendorDashboardPayload } from './types';

interface MessagesTabProps {
  restrictions: VendorDashboardPayload['restrictions'];
  threads: VendorDashboardPayload['threads'];
  reviews: VendorDashboardPayload['reviews'];
  threadInputs: Record<string, string>;
  setThreadInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  replyTexts: Record<string, string>;
  setReplyTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleSendThreadMessage: (convId: string) => void;
  handleReplyReview: (reviewId: string) => void;
}

/** Tab extracted from VendorPortalPage — presentation only, state lives in the parent. */
export const MessagesTab: React.FC<MessagesTabProps> = ({
    restrictions,
    threads,
    reviews,
    threadInputs,
    setThreadInputs,
    replyTexts,
    setReplyTexts,
    handleSendThreadMessage,
    handleReplyReview
}) => {
  return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)] flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[var(--color-wood)]" />
            <span>Fils de discussion clients (100 % sur EMROD)</span>
          </h2>
          {!(restrictions.allowExternalContactsInMessages ?? false) && (
            <p className="text-[11px] text-[var(--color-body)] p-2.5 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-line)] flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-[var(--color-gold-deep)] shrink-0" />
              <span>
                Messagerie sécurisée : le partage de numéros, courriels et liens externes est bloqué pour maintenir toutes les ventes sur EMROD.
              </span>
            </p>
          )}
          {threads.length === 0 ? (
            <p className="text-xs text-[var(--color-wood)]">Aucune conversation ouverte.</p>
          ) : (
            threads.map((t) => (
              <div
                key={t.id}
                className="p-4 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3"
              >
                <p className="text-xs font-semibold text-[var(--color-ink)]">
                  {t.type === 'order'
                    ? 'Commande'
                    : t.type === 'quote'
                      ? 'Devis sur mesure'
                      : 'Question produit'}{' '}
                  · {t.buyer_name}
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {t.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`p-2.5 rounded text-xs ${
                        m.sender_role === 'vendor'
                          ? 'bg-[var(--color-ink)] text-white ml-4'
                          : 'bg-[var(--color-cream)] mr-4'
                      }`}
                    >
                      <p className="font-semibold opacity-80">{m.sender_name}</p>
                      <p className="mt-0.5">{m.content}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={threadInputs[t.id] || ''}
                    onChange={(e) =>
                      setThreadInputs((prev) => ({ ...prev, [t.id]: e.target.value }))
                    }
                    placeholder="Répondre au client..."
                    className="flex-1 px-3 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSendThreadMessage(t.id)}
                    className="px-3 py-1.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
            Avis clients vérifiés
          </h2>
          {reviews.length === 0 ? (
            <p className="text-xs text-[var(--color-wood)]">Aucun avis publié pour l’instant.</p>
          ) : (
            reviews.map((r) => (
              <div
                key={r.id}
                className="p-4 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-2"
              >
                <p className="text-xs text-[var(--color-wood)]">
                  {r.product_name} · {r.buyer_name} · {r.rating}/5
                </p>
                <p className="text-sm text-[var(--color-ink)]">{r.comment}</p>
                {r.vendor_reply ? (
                  <p className="text-xs text-[var(--color-wood)] pt-2 border-t border-[var(--color-line)]">
                    <strong>Votre réponse :</strong> {r.vendor_reply}
                  </p>
                ) : (
                  <div className="flex gap-2 pt-2">
                    <input
                      value={replyTexts[r.id] || ''}
                      onChange={(e) =>
                        setReplyTexts((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      placeholder="Répondre publiquement..."
                      className="flex-1 px-3 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void handleReplyReview(r.id)}
                      className="px-3 py-1.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-medium"
                    >
                      Publier
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </section>
      </div>
  );
};
