import React, { useEffect, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { formatGNF } from '../../shared/domain';
import type { AdminProductRow } from './types';

const PRODUCT_STATUSES = ['draft', 'in_review', 'published', 'suspended', 'removed'];

const statusLabel = (s: string): string =>
  ({
    draft: 'Brouillon',
    in_review: 'En modération',
    published: 'Publié',
    suspended: 'Suspendu',
    removed: 'Retiré',
  })[s] || s;

const statusClass = (s: string): string =>
  s === 'published'
    ? 'text-[var(--color-success)]'
    : s === 'suspended' || s === 'removed'
      ? 'text-[var(--color-danger)]'
      : 'text-[var(--color-gold-deep)]';

/** TAB PRODUITS — catalogue global direction : recherche, statut, mise en avant. */
export const AdminProductsTab: React.FC = () => {
  const { addToast } = useToast();
  const [products, setProducts] = useState<AdminProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status) params.set('status', status);
      const res = await apiFetch<{ products: AdminProductRow[] }>(`/api/admin/products?${params.toString()}`);
      setProducts(res.products);
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

  const toggleFeatured = async (p: AdminProductRow) => {
    try {
      await apiFetch(`/api/admin/products/${p.id}/featured`, {
        method: 'PATCH',
        body: JSON.stringify({ featured: !p.featured }),
      });
      addToast({ type: 'success', title: p.featured ? 'Produit retiré de la vitrine' : 'Produit mis en avant' });
      await load();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Action impossible', description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <section className="p-4 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[11px] text-[var(--color-wood)] mb-1">Recherche (nom ou slug)</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
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
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
        >
          Filtrer
        </button>
      </section>

      <section className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-m)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] border-b border-[var(--color-line)]">
            <tr>
              <th className="p-3 font-medium">Produit</th>
              <th className="p-3 font-medium">Catégorie</th>
              <th className="p-3 font-medium">Atelier</th>
              <th className="p-3 font-medium text-right">Prix</th>
              <th className="p-3 font-medium text-right">Stock</th>
              <th className="p-3 font-medium text-right">Vues</th>
              <th className="p-3 font-medium">Statut</th>
              <th className="p-3 font-medium text-center">Vitrine</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)] bg-[var(--color-surface)]">
            {loading ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-[var(--color-wood)]">
                  Chargement…
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-[var(--color-wood)]">
                  Aucun produit ne correspond aux filtres.
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="hover:bg-[var(--color-cream)]">
                  <td className="p-3 max-w-[240px]">
                    <span className="block truncate font-medium text-[var(--color-ink)]">{p.name}</span>
                    <span className="text-[10px] text-[var(--color-wood)] font-mono-num truncate block">{p.slug}</span>
                  </td>
                  <td className="p-3">{p.categoryName}</td>
                  <td className="p-3">{p.vendor.shopName}</td>
                  <td className="p-3 text-right font-mono-num font-semibold">
                    {p.mode === 'sur_devis' ? 'Sur devis' : formatGNF(p.priceGnf)}
                  </td>
                  <td className="p-3 text-right font-mono-num">{p.stockQty}</td>
                  <td className="p-3 text-right font-mono-num">{p.viewsCount}</td>
                  <td className={`p-3 font-semibold ${statusClass(p.status)}`}>{statusLabel(p.status)}</td>
                  <td className="p-3 text-center">
                    <button
                      type="button"
                      onClick={() => void toggleFeatured(p)}
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold ${
                        p.featured
                          ? 'bg-[var(--color-gold)] text-[var(--color-ink)]'
                          : 'border border-[var(--color-line)] text-[var(--color-wood)] hover:bg-[var(--color-cream)]'
                      }`}
                    >
                      {p.featured ? '★ En avant' : '☆ Mettre en avant'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
};
