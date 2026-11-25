import React, { useEffect, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { formatGNF } from '../../shared/domain';
import { KpiTile, HBarChart } from './charts';
import type { CommissionsPayload, MonthlyReportsPayload } from './types';

interface AdminFinanceTabProps {
  data: { vendors: Array<{ id: string; shop_name: string; status: string }>; categories: Array<{ id: string; name: string }> };
}

/** TAB FINANCE — moteur de commissions EMROD : configuration, grand livre, rapports mensuels. */
export const AdminFinanceTab: React.FC<AdminFinanceTabProps> = ({ data }) => {
  const { addToast } = useToast();
  const [payload, setPayload] = useState<CommissionsPayload | null>(null);
  const [monthly, setMonthly] = useState<MonthlyReportsPayload | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [configDraft, setConfigDraft] = useState<CommissionsPayload['config'] | null>(null);
  const [newVendorOverride, setNewVendorOverride] = useState('');
  const [newVendorRate, setNewVendorRate] = useState(10);
  const [newCategoryOverride, setNewCategoryOverride] = useState('');
  const [newCategoryRate, setNewCategoryRate] = useState(10);
  const [ledgerStatus, setLedgerStatus] = useState('all');

  const loadCommissions = async () => {
    try {
      const res = await apiFetch<CommissionsPayload>('/api/admin/commissions');
      setPayload(res);
      setConfigDraft(res.config);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Chargement commissions impossible', description: err.message });
    }
  };

  useEffect(() => {
    void loadCommissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    apiFetch<MonthlyReportsPayload>(`/api/admin/reports/monthly?year=${year}`)
      .then(setMonthly)
      .catch(() => {});
  }, [year]);

  const saveConfig = async () => {
    if (!configDraft) return;
    try {
      const res = await apiFetch<{ ok: boolean; config: CommissionsPayload['config'] }>('/api/admin/commissions/config', {
        method: 'PUT',
        body: JSON.stringify(configDraft),
      });
      setConfigDraft(res.config);
      addToast({ type: 'success', title: 'Configuration des commissions enregistrée' });
      await loadCommissions();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Enregistrement impossible', description: err.message });
    }
  };

  if (!payload || !configDraft) {
    return <div className="h-64 w-full rounded-[var(--radius-m)] emrod-skeleton" />;
  }

  const s = payload.summary;
  const filteredLines =
    ledgerStatus === 'all' ? payload.lines : payload.lines.filter((l) => l.status === ledgerStatus);
  const validVendors = data.vendors.filter((v) => v.status === 'validated');
  const vendorName = (id: string) => validVendors.find((v) => v.id === id)?.shop_name || id;
  const categoryName = (id: string) => data.categories.find((c) => c.id === id)?.name || id;

  return (
    <div className="space-y-8">
      {/* Encaissements cumulés */}
      <section className="space-y-3">
        <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)]">
          Part EMROD sur les transactions (grand livre des commissions)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiTile label="Volume brut facturé" value={formatGNF(s.grossGnf)} />
          <KpiTile label="Commissions EMROD" value={formatGNF(s.commissionGnf)} accent="gold" sub={`${s.earnedCount} ligne(s)`} />
          <KpiTile label="Net versé ateliers" value={formatGNF(s.netVendorGnf)} accent="success" />
          <KpiTile label="Reversals (remboursements)" value={`−${formatGNF(s.reversalGnf)}`} accent="danger" sub={`${s.reversalCount} ligne(s)`} />
          <KpiTile
            label="Taux effectif moyen"
            value={s.grossGnf > 0 ? `${((s.commissionGnf / s.grossGnf) * 100).toFixed(1)} %` : '—'}
          />
          <KpiTile label="Taux net EMROD" value={s.grossGnf > 0 ? `${((s.commissionGnf / (s.commissionGnf + s.netVendorGnf || 1)) * 100).toFixed(1)} %` : '—'} />
        </div>
      </section>

      {/* Configuration moteur */}
      <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4">
        <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
          Configuration du prélèvement EMROD
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex items-center gap-2 text-xs sm:col-span-2">
            <input
              type="checkbox"
              checked={configDraft.enabled}
              onChange={(e) => setConfigDraft({ ...configDraft, enabled: e.target.checked })}
            />
            <span>Activer la commission plateforme sur chaque paiement réussi</span>
          </label>
          <label className="flex items-center gap-2 text-xs sm:col-span-2">
            <input
              type="checkbox"
              checked={configDraft.applyToQuotes}
              onChange={(e) => setConfigDraft({ ...configDraft, applyToQuotes: e.target.checked })}
            />
            <span>Appliquer aussi aux paiements de devis sur mesure</span>
          </label>
          <div>
            <label className="block text-[11px] text-[var(--color-wood)] mb-1">Taux global par défaut (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={configDraft.defaultPercent}
              onChange={(e) => setConfigDraft({ ...configDraft, defaultPercent: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[var(--color-wood)] mb-1">Assiette</label>
            <select
              value={configDraft.base}
              onChange={(e) => setConfigDraft({ ...configDraft, base: e.target.value as 'subtotal' | 'total' })}
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
            >
              <option value="subtotal">Sous-total produits (hors livraison)</option>
              <option value="total">Total payé (livraison incluse)</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-[var(--color-wood)] mb-1">Commission minimale (GNF)</label>
            <input
              type="number"
              min={0}
              step={1000}
              value={configDraft.minCommissionGnf}
              onChange={(e) => setConfigDraft({ ...configDraft, minCommissionGnf: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
            />
          </div>
        </div>

        {/* Overrides par vendeur */}
        <div className="pt-3 border-t border-[var(--color-line)] grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[var(--color-wood)]">
              Taux spécifiques par atelier ({Object.keys(configDraft.vendorOverrides).length})
            </p>
            {Object.entries(configDraft.vendorOverrides).map(([vid, rate]) => (
              <div key={vid} className="flex items-center justify-between gap-2 p-2 rounded-[var(--radius-s)] bg-[var(--color-surface)] text-xs">
                <span className="truncate">{vendorName(vid)}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={rate}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        vendorOverrides: { ...configDraft.vendorOverrides, [vid]: Number(e.target.value) },
                      })
                    }
                    className="w-16 px-2 py-1 rounded border border-[var(--color-line)] font-mono-num"
                  />
                  <span>%</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...configDraft.vendorOverrides };
                      delete next[vid];
                      setConfigDraft({ ...configDraft, vendorOverrides: next });
                    }}
                    className="text-[var(--color-danger)] px-1"
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
            <div className="flex gap-2">
              <select
                value={newVendorOverride}
                onChange={(e) => setNewVendorOverride(e.target.value)}
                className="flex-1 px-2 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
              >
                <option value="">Choisir un atelier…</option>
                {validVendors
                  .filter((v) => !(v.id in configDraft.vendorOverrides))
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.shop_name}
                    </option>
                  ))}
              </select>
              <input
                type="number"
                min={0}
                max={100}
                value={newVendorRate}
                onChange={(e) => setNewVendorRate(Number(e.target.value))}
                className="w-16 px-2 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-mono-num"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newVendorOverride) return;
                  setConfigDraft({
                    ...configDraft,
                    vendorOverrides: { ...configDraft.vendorOverrides, [newVendorOverride]: newVendorRate },
                  });
                  setNewVendorOverride('');
                }}
                className="px-3 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-semibold hover:bg-[var(--color-surface)]"
              >
                + Ajouter
              </button>
            </div>
          </div>

          {/* Overrides par catégorie */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[var(--color-wood)]">
              Taux spécifiques par catégorie ({Object.keys(configDraft.categoryOverrides).length})
            </p>
            {Object.entries(configDraft.categoryOverrides).map(([cid, rate]) => (
              <div key={cid} className="flex items-center justify-between gap-2 p-2 rounded-[var(--radius-s)] bg-[var(--color-surface)] text-xs">
                <span className="truncate">{categoryName(cid)}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={rate}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        categoryOverrides: { ...configDraft.categoryOverrides, [cid]: Number(e.target.value) },
                      })
                    }
                    className="w-16 px-2 py-1 rounded border border-[var(--color-line)] font-mono-num"
                  />
                  <span>%</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...configDraft.categoryOverrides };
                      delete next[cid];
                      setConfigDraft({ ...configDraft, categoryOverrides: next });
                    }}
                    className="text-[var(--color-danger)] px-1"
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
            <div className="flex gap-2">
              <select
                value={newCategoryOverride}
                onChange={(e) => setNewCategoryOverride(e.target.value)}
                className="flex-1 px-2 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
              >
                <option value="">Choisir une catégorie…</option>
                {data.categories
                  .filter((c) => !(c.id in configDraft.categoryOverrides))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <input
                type="number"
                min={0}
                max={100}
                value={newCategoryRate}
                onChange={(e) => setNewCategoryRate(Number(e.target.value))}
                className="w-16 px-2 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-mono-num"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newCategoryOverride) return;
                  setConfigDraft({
                    ...configDraft,
                    categoryOverrides: { ...configDraft.categoryOverrides, [newCategoryOverride]: newCategoryRate },
                  });
                  setNewCategoryOverride('');
                }}
                className="px-3 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-semibold hover:bg-[var(--color-surface)]"
              >
                + Ajouter
              </button>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-[var(--color-wood)]">
          Priorité : taux atelier &gt; taux catégorie &gt; taux global. Le taux appliqué est figé sur chaque ligne du
          grand livre au moment du paiement.
        </p>
        <button
          type="button"
          onClick={() => void saveConfig()}
          className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
        >
          Enregistrer la configuration
        </button>
      </section>

      {/* Commissions par atelier */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
          <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">Commissions par atelier</h3>
          <HBarChart
            rows={payload.byVendor.slice(0, 12).map((v) => ({
              label: v.shop_name || v.vendor_id,
              value: v.commission_gnf,
              sub: `${v.avg_rate != null ? Number(v.avg_rate).toFixed(1) : '—'} % moy.`,
            }))}
            formatValue={formatGNF}
          />
        </div>

        {/* Rapport mensuel */}
        <div className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">Rapport mensuel {year}</h3>
            <div className="flex items-center gap-2 text-xs">
              <button type="button" onClick={() => setYear(year - 1)} className="px-2 py-1 rounded border border-[var(--color-line)]">
                ←
              </button>
              <span className="font-mono-num font-semibold">{year}</span>
              <button
                type="button"
                onClick={() => setYear(year + 1)}
                disabled={year >= new Date().getFullYear()}
                className="px-2 py-1 rounded border border-[var(--color-line)] disabled:opacity-40"
              >
                →
              </button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-72 overflow-y-auto border border-[var(--color-line)] rounded-[var(--radius-s)]">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] sticky top-0">
                <tr>
                  <th className="p-2 font-medium">Mois</th>
                  <th className="p-2 font-medium">GMV</th>
                  <th className="p-2 font-medium">Comm. EMROD</th>
                  <th className="p-2 font-medium">Net ateliers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {(monthly?.months || [])
                  .filter((m) => m.gmvGnf > 0 || m.ordersCount > 0 || m.commissions.commissionGnf > 0)
                  .map((m) => (
                    <tr key={m.period}>
                      <td className="p-2 font-mono-num">{m.period}</td>
                      <td className="p-2 font-mono-num">{formatGNF(m.gmvGnf)}</td>
                      <td className="p-2 font-mono-num font-semibold text-[var(--color-gold-deep)]">
                        {formatGNF(m.commissions.commissionGnf)}
                      </td>
                      <td className="p-2 font-mono-num">{formatGNF(m.commissions.netVendorGnf)}</td>
                    </tr>
                  ))}
                {(monthly?.months || []).every((m) => m.gmvGnf === 0 && m.ordersCount === 0) && (
                  <tr>
                    <td className="p-3 text-[var(--color-wood)]" colSpan={4}>
                      Aucune activité enregistrée pour {year}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Grand livre */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">
            Grand livre détaillé ({filteredLines.length})
          </h3>
          <select
            value={ledgerStatus}
            onChange={(e) => setLedgerStatus(e.target.value)}
            className="px-2.5 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
          >
            <option value="all">Tous les mouvements</option>
            <option value="earned">Commissions gagnées</option>
            <option value="reversed">Reversals (remboursements)</option>
          </select>
        </div>
        {filteredLines.length === 0 ? (
          <p className="text-xs text-[var(--color-wood)]">
            Aucun mouvement de commission encore enregistré — le grand livre se remplit au fil des paiements réussis.
          </p>
        ) : (
          <div className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-m)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] border-b border-[var(--color-line)]">
                <tr>
                  <th className="p-3 font-medium">Date</th>
                  <th className="p-3 font-medium">Commande</th>
                  <th className="p-3 font-medium">Atelier</th>
                  <th className="p-3 font-medium">Assiette</th>
                  <th className="p-3 font-medium">Taux</th>
                  <th className="p-3 font-medium">Commission</th>
                  <th className="p-3 font-medium">Net atelier</th>
                  <th className="p-3 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)] bg-[var(--color-surface)]">
                {filteredLines.slice(0, 200).map((l) => (
                  <tr key={l.id}>
                    <td className="p-3 font-mono-num">{new Date(l.created_at).toLocaleDateString('fr-FR')}</td>
                    <td className="p-3 font-mono-num">{l.order_number || l.quote_id || '—'}</td>
                    <td className="p-3">{l.shop_name || l.vendor_id}</td>
                    <td className="p-3 font-mono-num">{formatGNF(l.gross_gnf)}</td>
                    <td className="p-3 font-mono-num">{l.rate_percent} %</td>
                    <td className={`p-3 font-mono-num font-semibold ${l.commission_gnf < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-gold-deep)]'}`}>
                      {formatGNF(l.commission_gnf)}
                    </td>
                    <td className="p-3 font-mono-num">{formatGNF(l.net_vendor_gnf)}</td>
                    <td className="p-3">{l.commission_gnf < 0 ? 'Reversal' : 'Gagnée'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
