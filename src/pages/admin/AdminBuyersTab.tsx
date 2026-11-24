import React, { useEffect, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { formatGNF } from '../../shared/domain';
import type { AdminBuyerDossierPayload, AdminBuyerRow } from './types';

/** TAB ACHETEURS — CRM invités : liste consolidée + dossier 360° par courriel. */
export const AdminBuyersTab: React.FC = () => {
  const { addToast } = useToast();
  const [buyers, setBuyers] = useState<AdminBuyerRow[]>([]);
  const [q, setQ] = useState('');
  const [dossier, setDossier] = useState<(AdminBuyerDossierPayload & { email: string }) | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      const res = await apiFetch<{ buyers: AdminBuyerRow[] }>(`/api/admin/buyers?${params.toString()}`);
      setBuyers(res.buyers);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Chargement impossible', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDossier = async (email: string) => {
    setDossier(null);
    try {
      const res = await apiFetch<AdminBuyerDossierPayload>(`/api/admin/buyers/${encodeURIComponent(email)}`);
      setDossier({ ...res, email });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Dossier indisponible', description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <section className="p-4 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-[11px] text-[var(--color-wood)] mb-1">
            Recherche (nom, courriel, téléphone) — {buyers.length} acheteur(s) consolidé(s)
          </label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
            className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
        >
          Rechercher
        </button>
      </section>

      <section className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-m)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] border-b border-[var(--color-line)]">
            <tr>
              <th className="p-3 font-medium">Acheteur</th>
              <th className="p-3 font-medium">Zone</th>
              <th className="p-3 font-medium text-right">Commandes</th>
              <th className="p-3 font-medium text-right">Cumul</th>
              <th className="p-3 font-medium">Première</th>
              <th className="p-3 font-medium">Dernière</th>
              <th className="p-3 font-medium">Dossier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)] bg-[var(--color-surface)]">
            {loading ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-[var(--color-wood)]">
                  Chargement…
                </td>
              </tr>
            ) : buyers.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-[var(--color-wood)]">
                  Aucun acheteur trouvé.
                </td>
              </tr>
            ) : (
              buyers.map((b) => (
                <tr key={b.email} className="hover:bg-[var(--color-cream)]">
                  <td className="p-3">
                    <span className="block font-medium text-[var(--color-ink)]">{b.name || '—'}</span>
                    <span className="text-[11px] text-[var(--color-wood)]">{b.email}</span>
                    {b.phone && <span className="text-[11px] text-[var(--color-wood)] font-mono-num block">{b.phone}</span>}
                  </td>
                  <td className="p-3">{b.zone || '—'}</td>
                  <td className="p-3 text-right font-mono-num">{b.orders_count}</td>
                  <td className="p-3 text-right font-mono-num font-semibold">{formatGNF(b.total_gnf)}</td>
                  <td className="p-3 font-mono-num">
                    {b.first_order_at ? new Date(b.first_order_at).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="p-3 font-mono-num">
                    {b.last_order_at ? new Date(b.last_order_at).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => void openDossier(b.email)}
                      className="px-2.5 py-1 rounded border border-[var(--color-line)] hover:bg-[var(--color-cream)]"
                    >
                      Ouvrir
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {dossier && (
        <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border-2 border-[var(--color-wood)]/30 space-y-4">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-[var(--color-line)]">
            <div>
              <p className="text-xs text-[var(--color-wood)]">Dossier acheteur 360°</p>
              <h3 className="font-display text-xl font-semibold text-[var(--color-ink)]">{dossier.email}</h3>
              <p className="text-xs text-[var(--color-body)] mt-1">
                Valeur vie client :{' '}
                <strong className="font-mono-num text-[var(--color-gold-deep)]">
                  {formatGNF(dossier.lifetimeValueGnf)}
                </strong>{' '}
                · {dossier.orders.length} commande(s)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDossier(null)}
              className="text-xs text-[var(--color-wood)] hover:text-[var(--color-danger)]"
            >
              ✕ Fermer
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
            <div className="space-y-2">
              <p className="font-semibold text-[var(--color-wood)]">Commandes ({dossier.orders.length})</p>
              <div className="rounded-[var(--radius-s)] border border-[var(--color-line)] divide-y divide-[var(--color-line)] max-h-52 overflow-y-auto">
                {dossier.orders.length === 0 ? (
                  <p className="p-2.5 text-[11px] text-[var(--color-wood)]">Aucune commande.</p>
                ) : (
                  dossier.orders.map((o) => (
                    <div key={o.id} className="p-2.5 flex items-center justify-between gap-2">
                      <span className="font-mono-num">{o.order_number}</span>
                      <span className="font-mono-num font-semibold">{formatGNF(o.total_gnf)}</span>
                      <span>{o.status}</span>
                    </div>
                  ))
                )}
              </div>

              <p className="font-semibold text-[var(--color-wood)] pt-2">Avis ({dossier.reviews.length})</p>
              <div className="rounded-[var(--radius-s)] border border-[var(--color-line)] divide-y divide-[var(--color-line)] max-h-40 overflow-y-auto">
                {dossier.reviews.length === 0 ? (
                  <p className="p-2.5 text-[11px] text-[var(--color-wood)]">Aucun avis publié.</p>
                ) : (
                  (dossier.reviews as Array<{ id: string; rating?: number; comment?: string; product_name?: string }>).map((r) => (
                    <div key={r.id} className="p-2.5">
                      <p className="font-mono-num text-[var(--color-gold-deep)]">{r.rating ?? '—'} ★</p>
                      <p className="text-[var(--color-body)]">{r.comment}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-semibold text-[var(--color-wood)]">Devis sur mesure ({dossier.quotes.length})</p>
              <div className="rounded-[var(--radius-s)] border border-[var(--color-line)] divide-y divide-[var(--color-line)] max-h-40 overflow-y-auto">
                {dossier.quotes.length === 0 ? (
                  <p className="p-2.5 text-[11px] text-[var(--color-wood)]">Aucun devis.</p>
                ) : (
                  (dossier.quotes as Array<{ id: string; reference_number?: string; status?: string; quoted_price_gnf?: number }>).map(
                    (qt) => (
                      <div key={qt.id} className="p-2.5 flex items-center justify-between gap-2">
                        <span className="font-mono-num">{qt.reference_number || qt.id}</span>
                        <span className="font-mono-num">{qt.quoted_price_gnf ? formatGNF(qt.quoted_price_gnf) : '—'}</span>
                        <span>{qt.status || '—'}</span>
                      </div>
                    )
                  )
                )}
              </div>

              <p className="font-semibold text-[var(--color-wood)] pt-2">Litiges ({dossier.disputes.length})</p>
              <div className="rounded-[var(--radius-s)] border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
                {dossier.disputes.length === 0 ? (
                  <p className="p-2.5 text-[11px] text-[var(--color-wood)]">Aucun litige — client serein.</p>
                ) : (
                  (dossier.disputes as Array<{ id: string; reason?: string; status?: string }>).map((d) => (
                    <div key={d.id} className="p-2.5">
                      <p>{d.reason}</p>
                      <p className="text-[11px] text-[var(--color-wood)]">{d.status}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
