import React from 'react';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import {
  formatGNF,
} from '../../shared/domain';
import type { AdminOverviewPayload, DjomyDiagnostics } from './types';

interface AdminPaymentsTabProps {
  data: AdminOverviewPayload;
  djomyDiag: DjomyDiagnostics | null;
  loadAdminOverview: () => void | Promise<void>;
}

/** Tab extracted from AdminPortalPage — presentation only, state lives in the parent. */
export const AdminPaymentsTab: React.FC<AdminPaymentsTabProps> = ({
    data,
    djomyDiag,
    loadAdminOverview
}) => {
  const { addToast } = useToast();
  return (
      <div className="space-y-8">
        {djomyDiag && (
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--color-line)]">
              <div>
                <p className="text-xs font-medium text-[var(--color-wood)]">
                  Passerelle de paiement officielle Djomy Guinée
                </p>
                <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
                  État de l’intégration API Djomy v1
                </h2>
              </div>
              <span
                className={`text-xs font-semibold ${
                  djomyDiag.diagnostics.mode === 'live_api'
                    ? 'text-[var(--color-success)]'
                    : 'text-[var(--color-gold-deep)]'
                }`}
              >
                {djomyDiag.diagnostics.mode === 'live_api'
                  ? 'API Djomy v1 connectée'
                  : 'Simulateur sandbox local (sans clés DJOMY_*)'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="p-3.5 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)]">
                <p className="text-[var(--color-wood)]">URL API cible</p>
                <p className="font-mono-num font-semibold text-[var(--color-ink)] mt-1 break-all">
                  {djomyDiag.diagnostics.baseUrl}
                </p>
              </div>
              <div className="p-3.5 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)]">
                <p className="text-[var(--color-wood)]">Authentification X-API-KEY & Bearer</p>
                <p className="font-semibold text-[var(--color-ink)] mt-1">
                  {djomyDiag.diagnostics.hasClientId && djomyDiag.diagnostics.hasClientSecret
                    ? 'Identifiants configurés (HMAC-SHA256)'
                    : 'Variables DJOMY_CLIENT_ID / SECRET absentes'}
                </p>
              </div>
              <div className="p-3.5 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)]">
                <p className="text-[var(--color-wood)]">Endpoint Webhook (HTTPS requis)</p>
                <p className="font-mono-num font-semibold text-[var(--color-ink)] mt-1 break-all">
                  {djomyDiag.diagnostics.webhookPath}
                </p>
              </div>
            </div>

            {djomyDiag.recentWebhooks.length > 0 && (
              <div className="pt-2 space-y-2">
                <p className="text-xs font-semibold text-[var(--color-wood)]">
                  Derniers événements webhook reçus ({djomyDiag.recentWebhooks.length})
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {djomyDiag.recentWebhooks.map((wh) => (
                    <div
                      key={wh.event_id}
                      className="p-2.5 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between gap-2 text-[11px]"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-[var(--color-ink)]">{wh.event_type}</span>{' '}
                        <span className="font-mono-num text-[var(--color-wood)]">({wh.djomy_reference})</span>
                      </div>
                      <span className="font-mono-num text-[var(--color-wood)] shrink-0">
                        {new Date(wh.created_at).toLocaleString('fr-FR')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <div className="space-y-4">
          <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)]">
            Transactions & webhooks Djomy
          </h2>
          <div className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-m)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] border-b border-[var(--color-line)]">
                <tr>
                  <th className="p-3 font-medium">Référence Djomy</th>
                  <th className="p-3 font-medium">Opérateur</th>
                  <th className="p-3 font-medium">Montant</th>
                  <th className="p-3 font-medium">Statut</th>
                  <th className="p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)] bg-[var(--color-surface)]">
                {data.payments.map((pay) => (
                  <tr key={pay.id}>
                    <td className="p-3">
                      <span className="font-mono-num block">{pay.djomy_reference}</span>
                      {pay.provider_reference && (
                        <span className="font-mono-num text-[11px] text-[var(--color-wood)]">
                          Op. {pay.provider_reference}
                        </span>
                      )}
                    </td>
                    <td className="p-3">{pay.operator}</td>
                    <td className="p-3 font-mono-num font-semibold">{formatGNF(pay.amount_gnf)}</td>
                    <td className="p-3 font-semibold">{pay.status}</td>
                    <td className="p-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void apiFetch(`/api/admin/payments/${pay.djomy_reference}/reconcile`, {
                            method: 'POST',
                          }).then(() => {
                            addToast({ type: 'success', title: 'Statut réconcilié avec Djomy' });
                            void loadAdminOverview();
                          })
                        }
                        className="px-2.5 py-1 rounded border border-[var(--color-line)] hover:bg-[var(--color-cream)]"
                      >
                        Réconcilier
                      </button>
                      {pay.status === 'succeeded' && (
                        <button
                          type="button"
                          onClick={() =>
                            void apiFetch(`/api/admin/payments/${pay.djomy_reference}/refund`, {
                              method: 'POST',
                              body: JSON.stringify({ reason: 'Remboursement admin EMROD' }),
                            }).then(() => {
                              addToast({ type: 'success', title: 'Remboursement Djomy exécuté' });
                              void loadAdminOverview();
                            })
                          }
                          className="px-2.5 py-1 rounded border border-[var(--color-danger)]/40 text-[var(--color-danger)]"
                        >
                          Rembourser
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)]">
            Versements ateliers ({data.payouts.length})
          </h2>
          {data.payouts.length === 0 ? (
            <p className="text-xs text-[var(--color-wood)]">Aucun versement programmé.</p>
          ) : (
            <div className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-m)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] border-b border-[var(--color-line)]">
                  <tr>
                    <th className="p-3 font-medium">Référence</th>
                    <th className="p-3 font-medium">Atelier</th>
                    <th className="p-3 font-medium">Commande</th>
                    <th className="p-3 font-medium">Brut</th>
                    <th className="p-3 font-medium">Commission EMROD</th>
                    <th className="p-3 font-medium">Net atelier</th>
                    <th className="p-3 font-medium">Statut</th>
                    <th className="p-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)] bg-[var(--color-surface)]">
                  {data.payouts.map((po) => (
                    <tr key={po.id}>
                      <td className="p-3 font-mono-num">{po.reference}</td>
                      <td className="p-3">{po.shop_name}</td>
                      <td className="p-3 font-mono-num">{po.order_number}</td>
                      <td className="p-3 font-mono-num">{formatGNF(po.amount_gnf)}</td>
                      <td className="p-3 font-mono-num font-semibold text-[var(--color-gold-deep)]">
                        {po.commission_gnf != null ? formatGNF(po.commission_gnf) : '—'}
                      </td>
                      <td className="p-3 font-mono-num font-semibold">
                        {po.net_amount_gnf != null ? formatGNF(po.net_amount_gnf) : formatGNF(po.amount_gnf)}
                      </td>
                      <td className="p-3 font-semibold">
                        {po.status === 'paid' ? 'Versé' : 'Programmé'}
                      </td>
                      <td className="p-3">
                        {po.status !== 'paid' && (
                          <button
                            type="button"
                            onClick={() =>
                              void apiFetch(`/api/admin/payouts/${po.id}/mark-paid`, {
                                method: 'PATCH',
                              }).then(() => {
                                addToast({ type: 'success', title: 'Versement marqué comme payé' });
                                void loadAdminOverview();
                              })
                            }
                            className="px-2.5 py-1 rounded bg-[var(--color-ink)] text-white font-medium"
                          >
                            Marquer comme versé
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
  );
};
