import React from 'react';
import {
  AlertTriangle,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import type { AdminOverviewPayload } from './types';

interface AdminModerationTabProps {
  data: AdminOverviewPayload;
  loadAdminOverview: () => void | Promise<void>;
}

/** Tab extracted from AdminPortalPage — presentation only, state lives in the parent. */
export const AdminModerationTab: React.FC<AdminModerationTabProps> = ({
    data,
    loadAdminOverview
}) => {
  const { addToast } = useToast();
  return (
      <div className="space-y-8">
        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)] flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-[var(--color-gold-deep)]" />
            <span>Litiges ouverts ({data.disputes.length})</span>
          </h2>
          {data.disputes.length === 0 ? (
            <p className="text-xs text-[var(--color-wood)]">Aucun litige en cours.</p>
          ) : (
            data.disputes.map((d) => (
              <div
                key={d.id}
                className="p-4 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-[var(--color-ink)]">
                    {d.order_number} · {d.buyer_name} · Statut : {d.status}
                  </p>
                  <p className="text-[var(--color-body)]">{d.reason}</p>
                </div>
                {d.status === 'open' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void apiFetch(`/api/admin/disputes/${d.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({
                            status: 'resolved_refund',
                            resolutionNotes: 'Remboursement accordé à l’acheteur par EMROD',
                          }),
                        }).then(() => loadAdminOverview())
                      }
                      className="px-3 py-1.5 rounded bg-[var(--color-danger)] text-white text-xs font-medium"
                    >
                      Rembourser acheteur
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void apiFetch(`/api/admin/disputes/${d.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({
                            status: 'resolved_release',
                            resolutionNotes: 'Commande validée conforme, fonds maintenus au vendeur',
                          }),
                        }).then(() => loadAdminOverview())
                      }
                      className="px-3 py-1.5 rounded bg-[var(--color-success)] text-white text-xs font-medium"
                    >
                      Libérer au vendeur
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
            Modération & pré-modération des fiches produits
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...data.products]
              .sort((a, b) => (a.status === 'in_review' ? -1 : b.status === 'in_review' ? 1 : 0))
              .map((p) => (
                <div
                  key={p.id}
                  className={`p-4 rounded-[var(--radius-s)] border flex items-center justify-between gap-3 text-xs ${
                    p.status === 'in_review'
                      ? 'bg-[var(--color-cream)] border-[var(--color-gold-deep)]'
                      : 'bg-[var(--color-surface)] border-[var(--color-line)]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--color-ink)] truncate">{p.name}</p>
                    <p className="text-[var(--color-wood)]">
                      {p.vendor.shopName} ·{' '}
                      <strong>
                        {p.status === 'in_review'
                          ? 'En pré-modération'
                          : p.status === 'published'
                            ? 'Publié'
                            : p.status === 'removed'
                              ? 'Retiré'
                              : p.status}
                      </strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void apiFetch(`/api/admin/moderation/product/${p.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          status: p.status === 'published' ? 'removed' : 'published',
                          reason:
                            p.status === 'published'
                              ? 'Retiré par la modération EMROD'
                              : 'Validé par EMROD',
                        }),
                      }).then(() => loadAdminOverview())
                    }
                    className="px-2.5 py-1.5 rounded border border-[var(--color-line)] font-medium shrink-0"
                  >
                    {p.status === 'published' ? 'Retirer' : 'Approuver'}
                  </button>
                </div>
              ))}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              Messages & Q&R signalés ({data.flaggedMessages.length})
            </h2>
            {data.flaggedMessages.length === 0 ? (
              <p className="text-xs text-[var(--color-wood)]">Aucun message signalé.</p>
            ) : (
              data.flaggedMessages.map((m) => (
                <div
                  key={m.id}
                  className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--color-ink)]">
                      {m.sender_name} · Statut : {m.status}
                    </p>
                    <p className="text-[var(--color-body)] mt-0.5">{m.content}</p>
                    {m.flag_reason && (
                      <p className="text-[var(--color-wood)] mt-0.5">Motif : {m.flag_reason}</p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        void apiFetch(`/api/admin/moderation/message/${m.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: 'visible' }),
                        }).then(() => loadAdminOverview())
                      }
                      className="px-2.5 py-1 rounded border border-[var(--color-line)] font-medium"
                    >
                      Rétablir
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void apiFetch(`/api/admin/moderation/message/${m.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: 'hidden' }),
                        }).then(() => loadAdminOverview())
                      }
                      className="px-2.5 py-1 rounded bg-[var(--color-danger)] text-white font-medium"
                    >
                      Masquer
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              Avis clients vérifiés ({data.reviews.length})
            </h2>
            {data.reviews.length === 0 ? (
              <p className="text-xs text-[var(--color-wood)]">Aucun avis enregistré.</p>
            ) : (
              data.reviews.map((r) => (
                <div
                  key={r.id}
                  className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--color-ink)]">
                      {r.product_name} · {r.buyer_name} ({r.rating}/5) · {r.status}
                    </p>
                    <p className="text-[var(--color-body)] mt-0.5">{r.comment}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void apiFetch(`/api/admin/moderation/review/${r.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          status: r.status === 'published' ? 'hidden' : 'published',
                          reason:
                            r.status === 'published'
                              ? 'Masqué par la modération EMROD'
                              : 'Réhabilité par EMROD',
                        }),
                      }).then(() => loadAdminOverview())
                    }
                    className="px-2.5 py-1 rounded border border-[var(--color-line)] font-medium shrink-0"
                  >
                    {r.status === 'published' ? 'Masquer' : 'Rétablir'}
                  </button>
                </div>
              ))
            )}
          </section>
        </div>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
            Demandes données personnelles & confidentialité ({data.privacyRequests.length})
          </h2>
          {data.privacyRequests.length === 0 ? (
            <p className="text-xs text-[var(--color-wood)]">Aucune demande en attente.</p>
          ) : (
            <div className="space-y-2">
              {data.privacyRequests.map((pr) => (
                <div
                  key={pr.id}
                  className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <p className="font-semibold text-[var(--color-ink)]">
                      {pr.request_type === 'deletion' ? 'Effacement' : 'Export données'} ·{' '}
                      {pr.email} ({pr.phone})
                    </p>
                    <p className="text-[var(--color-wood)]">
                      Statut : <strong>{pr.status}</strong> ·{' '}
                      {new Date(pr.created_at).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                  {pr.status === 'received' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void apiFetch(`/api/admin/privacy/${pr.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: 'processed' }),
                          }).then(() => {
                            addToast({
                              type: 'success',
                              title:
                                pr.request_type === 'deletion'
                                  ? 'Données acheteur anonymisées'
                                  : 'Demande traitée',
                            });
                            void loadAdminOverview();
                          })
                        }
                        className="px-3 py-1.5 rounded bg-[var(--color-ink)] text-white font-medium"
                      >
                        {pr.request_type === 'deletion' ? 'Exécuter l’effacement' : 'Marquer traité'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void apiFetch(`/api/admin/privacy/${pr.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: 'rejected' }),
                          }).then(() => loadAdminOverview())
                        }
                        className="px-3 py-1.5 rounded border border-[var(--color-line)] font-medium"
                      >
                        Refuser
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
  );
};
