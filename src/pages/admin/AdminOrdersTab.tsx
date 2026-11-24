import React, { useEffect, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { formatGNF } from '../../shared/domain';
import type { AdminOrderDetailPayload, AdminOrderRow } from './types';

const ORDER_STATUSES = [
  'Commandée',
  'Confirmée',
  'En préparation',
  'Expédiée',
  'En livraison',
  'Livrée',
  'Annulée',
  'Remboursée',
];

const statusBadgeClass = (status: string): string => {
  if (status === 'Livrée') return 'text-[var(--color-success)]';
  if (status === 'Annulée' || status === 'Remboursée') return 'text-[var(--color-danger)]';
  if (status === 'Commandée') return 'text-[var(--color-gold-deep)]';
  return 'text-[var(--color-wood)]';
};

/** TAB COMMANDES — vue direction de toutes les commandes + override de statut + suivi. */
export const AdminOrdersTab: React.FC = () => {
  const { addToast } = useToast();
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<AdminOrderDetailPayload | null>(null);
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [rotated, setRotated] = useState<{ token: string; expiresAt: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status) params.set('status', status);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('limit', '100');
      const res = await apiFetch<{ orders: AdminOrderRow[] }>(`/api/admin/orders?${params.toString()}`);
      setOrders(res.orders);
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

  const openDetail = async (id: string) => {
    setDetail(null);
    setOverrideStatus('');
    setOverrideReason('');
    setRotated(null);
    try {
      const res = await apiFetch<AdminOrderDetailPayload>(`/api/admin/orders/${id}`);
      setDetail(res);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Détail indisponible', description: err.message });
    }
  };

  const applyOverride = async () => {
    if (!detail || !overrideStatus) return;
    if (overrideReason.trim().length < 3) {
      addToast({ type: 'error', title: 'Motif requis (3 caractères min.) — il est journalisé dans l’audit.' });
      return;
    }
    try {
      await apiFetch(`/api/admin/orders/${detail.order.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: overrideStatus, reason: overrideReason.trim() }),
      });
      addToast({ type: 'success', title: `Commande passée à « ${overrideStatus} »` });
      await openDetail(detail.order.id);
      await load();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Override refusé', description: err.message });
    }
  };

  const rotateToken = async () => {
    if (!detail) return;
    try {
      const res = await apiFetch<{ ok: boolean; trackingToken: string; expiresAt: string }>(
        `/api/admin/orders/${detail.order.id}/rotate-token`,
        { method: 'POST' }
      );
      setRotated({ token: res.trackingToken, expiresAt: res.expiresAt });
      addToast({ type: 'success', title: 'Jeton de suivi régénéré' });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Régénération impossible', description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      {/* Filtres */}
      <section className="p-4 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[11px] text-[var(--color-wood)] mb-1">Recherche (numéro, acheteur, courriel)</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
            placeholder="EMR-2026…"
            className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
          />
        </div>
        <div>
          <label className="block text-[11px] text-[var(--color-wood)] mb-1">Statut</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
          >
            <option value="">Tous</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-[var(--color-wood)] mb-1">Du</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
          />
        </div>
        <div>
          <label className="block text-[11px] text-[var(--color-wood)] mb-1">Au</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
        >
          Filtrer
        </button>
      </section>

      {/* Liste */}
      <section className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-m)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] border-b border-[var(--color-line)]">
            <tr>
              <th className="p-3 font-medium">Numéro</th>
              <th className="p-3 font-medium">Acheteur</th>
              <th className="p-3 font-medium">Montant</th>
              <th className="p-3 font-medium">Paiement</th>
              <th className="p-3 font-medium">Statut</th>
              <th className="p-3 font-medium">Date</th>
              <th className="p-3 font-medium">Détail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)] bg-[var(--color-surface)]">
            {loading ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-[var(--color-wood)]">
                  Chargement…
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-[var(--color-wood)]">
                  Aucune commande ne correspond aux filtres.
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="hover:bg-[var(--color-cream)]">
                  <td className="p-3 font-mono-num font-semibold">{o.order_number}</td>
                  <td className="p-3">
                    <span className="block">{o.buyer_name}</span>
                    <span className="text-[11px] text-[var(--color-wood)]">{o.buyer_email}</span>
                  </td>
                  <td className="p-3 font-mono-num font-semibold">{formatGNF(o.total_gnf)}</td>
                  <td className="p-3 text-[11px]">
                    {o.payment_plan === 'full'
                      ? 'Paiement complet'
                      : o.payment_plan === 'deposit'
                        ? 'Acompte 30 %'
                        : o.payment_plan === 'bank_transfer'
                          ? 'Virement bancaire'
                          : o.payment_plan}
                  </td>
                  <td className={`p-3 font-semibold ${statusBadgeClass(o.status)}`}>{o.status}</td>
                  <td className="p-3 font-mono-num">{new Date(o.created_at).toLocaleString('fr-FR')}</td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => void openDetail(o.id)}
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

      {/* Détail commande */}
      {detail && (
        <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border-2 border-[var(--color-wood)]/30 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[var(--color-line)]">
            <div>
              <p className="text-xs text-[var(--color-wood)]">Dossier commande</p>
              <h3 className="font-display text-xl font-semibold text-[var(--color-ink)] font-mono-num">
                {detail.order.order_number}
              </h3>
              <p className="text-xs text-[var(--color-body)] mt-1">
                {detail.order.buyer_name} · {detail.order.buyer_email} {detail.order.buyer_phone ? `· ${detail.order.buyer_phone}` : ''}
              </p>
              <p className="text-[11px] text-[var(--color-wood)] mt-1">
                {detail.order.delivery_zone_name} — {detail.order.delivery_address}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono-num font-display text-2xl font-semibold text-[var(--color-ink)]">
                {formatGNF(detail.order.total_gnf)}
              </p>
              <p className="text-[11px] text-[var(--color-wood)] font-mono-num">
                Sous-total {formatGNF(detail.order.subtotal_gnf)} · Livraison {formatGNF(detail.order.delivery_fee_gnf)}
              </p>
              <span className={`text-xs font-semibold ${statusBadgeClass(detail.order.status)}`}>{detail.order.status}</span>
            </div>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="text-xs text-[var(--color-wood)] hover:text-[var(--color-danger)]"
            >
              ✕ Fermer
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Articles */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[var(--color-wood)]">Articles ({detail.items.length})</p>
              <div className="rounded-[var(--radius-s)] border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
                {detail.items.map((it) => (
                  <div key={it.id} className="p-2.5 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="truncate text-[var(--color-ink)]">{it.product_name}</p>
                      <p className="text-[10px] text-[var(--color-wood)]">{it.shop_name}</p>
                    </div>
                    <span className="font-mono-num shrink-0">
                      {it.quantity} × {formatGNF(it.unit_price_gnf)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Paiements */}
              <p className="text-xs font-semibold text-[var(--color-wood)] pt-2">Paiements ({detail.payments.length})</p>
              <div className="rounded-[var(--radius-s)] border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
                {detail.payments.length === 0 ? (
                  <p className="p-2.5 text-[11px] text-[var(--color-wood)]">Aucun paiement enregistré.</p>
                ) : (
                  detail.payments.map((p) => (
                    <div key={p.id} className="p-2.5 flex items-center justify-between gap-2 text-[11px]">
                      <div className="min-w-0">
                        <span className="font-mono-num block truncate">{p.djomy_reference}</span>
                        <span className="text-[var(--color-wood)]">
                          {p.type} · {p.operator || p.method}
                        </span>
                      </div>
                      <span className="font-mono-num shrink-0 font-semibold">{formatGNF(p.amount_gnf)}</span>
                      <span className="shrink-0">{p.status}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Commissions */}
              <p className="text-xs font-semibold text-[var(--color-wood)] pt-2">
                Commissions EMROD ({detail.commissions.length})
              </p>
              <div className="rounded-[var(--radius-s)] border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
                {detail.commissions.length === 0 ? (
                  <p className="p-2.5 text-[11px] text-[var(--color-wood)]">Aucune commission sur cette commande.</p>
                ) : (
                  detail.commissions.map((c) => (
                    <div key={c.id} className="p-2.5 flex items-center justify-between gap-2 text-[11px]">
                      <span>{c.rate_percent} %</span>
                      <span className={`font-mono-num font-semibold ${c.commission_gnf < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-gold-deep)]'}`}>
                        {formatGNF(c.commission_gnf)}
                      </span>
                      <span>{c.status === 'earned' ? 'Gagnée' : 'Reversal'}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Timeline + versements */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[var(--color-wood)]">Historique ({detail.events.length})</p>
              <div className="rounded-[var(--radius-s)] border border-[var(--color-line)] divide-y divide-[var(--color-line)] max-h-56 overflow-y-auto">
                {detail.events.map((ev, i) => (
                  <div key={i} className="p-2.5 text-[11px]">
                    <p className="font-semibold text-[var(--color-ink)]">
                      {ev.status} <span className="text-[var(--color-wood)] font-normal">— {ev.actor_name}</span>
                    </p>
                    {ev.comment && <p className="text-[var(--color-body)]">{ev.comment}</p>}
                    <p className="font-mono-num text-[var(--color-wood)]">{new Date(ev.created_at).toLocaleString('fr-FR')}</p>
                  </div>
                ))}
              </div>

              {detail.payouts.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-[var(--color-wood)] pt-2">Versements ateliers</p>
                  <div className="rounded-[var(--radius-s)] border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
                    {detail.payouts.map((po) => (
                      <div key={po.id} className="p-2.5 text-[11px] flex items-center justify-between gap-2">
                        <span className="font-mono-num">{po.reference}</span>
                        <span className="text-[var(--color-wood)]">
                          Brut {formatGNF(po.amount_gnf)} · Comm. {formatGNF(po.commission_gnf)} · Net{' '}
                          {formatGNF(po.net_amount_gnf)}
                        </span>
                        <span>{po.status === 'paid' ? 'Versé' : 'Programmé'}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Override de statut */}
              <div className="pt-3 mt-3 border-t border-[var(--color-line)] space-y-2">
                <p className="text-xs font-semibold text-[var(--color-danger)]">
                  Override direction (journalisé, écrase les règles vendeur)
                </p>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={overrideStatus}
                    onChange={(e) => setOverrideStatus(e.target.value)}
                    className="px-2.5 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
                  >
                    <option value="">Nouveau statut…</option>
                    {ORDER_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <input
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Motif de la décision (obligatoire)"
                    className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => void applyOverride()}
                    className="px-4 py-1.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
                  >
                    Appliquer
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void rotateToken()}
                    className="px-4 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-semibold hover:bg-[var(--color-cream)]"
                  >
                    Régénérer le jeton de suivi
                  </button>
                  {rotated && (
                    <span className="text-[11px] font-mono-num text-[var(--color-wood)] break-all">
                      {rotated.token} (expire le {new Date(rotated.expiresAt).toLocaleDateString('fr-FR')})
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
