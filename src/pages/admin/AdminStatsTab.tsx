import React, { useEffect, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { formatGNF } from '../../shared/domain';
import { KpiTile, SalesSeriesChart, HBarChart, FunnelChart, SeasonalityGrid } from './charts';
import type { AdminStatsPayload, AdminTopProductRow } from './types';

const PERIODS = [
  { id: '7d', label: '7 jours' },
  { id: '30d', label: '30 jours' },
  { id: '90d', label: '90 jours' },
];

const deltaText = (d: number | null): string =>
  d == null ? 'pas de période précédente' : `${d >= 0 ? '+' : ''}${d.toFixed(1)} % vs période précédente`;

/** TAB STATISTIQUES — tableau de bord analytique consolidé (période 7/30/90 j). */
export const AdminStatsTab: React.FC = () => {
  const { addToast } = useToast();
  const [period, setPeriod] = useState('30d');
  const [stats, setStats] = useState<AdminStatsPayload | null>(null);
  const [topMetric, setTopMetric] = useState<'sales' | 'views' | 'conversion'>('sales');

  useEffect(() => {
    setStats(null);
    apiFetch<AdminStatsPayload>(`/api/admin/stats?period=${period}`)
      .then(setStats)
      .catch((err: any) => addToast({ type: 'error', title: 'Statistiques indisponibles', description: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  if (!stats) {
    return <div className="h-96 w-full rounded-[var(--radius-m)] emrod-skeleton" />;
  }

  const k = stats.kpis;
  const topRows: AdminTopProductRow[] = stats.topProducts[topMetric] || [];

  return (
    <div className="space-y-8">
      {/* Sélecteur de période */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPeriod(p.id)}
            className={`px-4 py-2 rounded-[var(--radius-s)] text-xs font-semibold transition-colors ${
              period === p.id
                ? 'bg-[var(--color-ink)] text-white'
                : 'border border-[var(--color-line)] text-[var(--color-wood)] hover:bg-[var(--color-cream)]'
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="text-[11px] text-[var(--color-wood)] font-mono-num ml-2">
          {new Date(stats.period.from).toLocaleDateString('fr-FR')} → {new Date(stats.period.to).toLocaleDateString('fr-FR')}
        </span>
      </div>

      {/* KPIs principaux */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiTile label="GMV période" value={formatGNF(k.gmv.current)} sub={deltaText(k.gmv.deltaPercent)} accent="gold" />
        <KpiTile label="Commissions EMROD" value={formatGNF(k.commissions.current)} sub={deltaText(k.commissions.deltaPercent)} accent="gold" />
        <KpiTile label="Commandes" value={String(k.orders.current)} sub={`${k.orders.averageBasketGnf.toLocaleString('fr-FR')} GNF panier moy.`} />
        <KpiTile label="Encaissé (Djomy)" value={formatGNF(k.payments.collectedGnf)} sub={`Remboursé ${formatGNF(k.payments.refundedGnf)}`} accent="success" />
        <KpiTile label="Acheteurs uniques" value={String(k.buyers.unique)} sub={`${k.buyers.newCount} nouveaux · ${k.buyers.repeatCount} récurrents`} />
        <KpiTile label="Litiges ouverts" value={String(k.openDisputes)} accent={k.openDisputes > 0 ? 'danger' : 'neutral'} sub={`${k.vendors.validated} ateliers actifs`} />
      </section>

      {/* Courbe des ventes */}
      <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3">
        <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
          Ventes & commissions, jour par jour
        </h2>
        <SalesSeriesChart points={stats.salesSeries} />
      </section>

      {/* Entonnoir + opérateurs */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
          <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">
            Entonnoir de conversion ({stats.funnel.days} j)
          </h3>
          <FunnelChart
            steps={[
              { label: 'Vues produit', value: stats.funnel.productViews },
              { label: 'Ajouts panier', value: stats.funnel.cartAdds },
              { label: 'Démarrages paiement', value: stats.funnel.checkoutStarts },
              { label: 'Paiements réussis', value: stats.funnel.paymentSuccess },
            ]}
          />
          <p className="text-[11px] text-[var(--color-wood)]">
            Vue → achat : {stats.funnel.viewToPaidPercent != null ? `${stats.funnel.viewToPaidPercent} %` : '—'} · Panier →
            paiement : {stats.funnel.cartToCheckoutPercent != null ? `${stats.funnel.cartToCheckoutPercent} %` : '—'} →{' '}
            {stats.funnel.checkoutToPaidPercent != null ? `${stats.funnel.checkoutToPaidPercent} %` : '—'}
          </p>
        </div>
        <div className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
          <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">Opérateurs de paiement</h3>
          <HBarChart
            rows={stats.operators.map((o) => ({
              label: `${o.operator} (${o.ok}/${o.total} OK)`,
              value: o.amount,
              sub: `${o.failed} échec(s)`,
            }))}
            formatValue={formatGNF}
          />
          <div className="pt-2 space-y-1.5">
            {stats.plans.map((pl) => (
              <div key={pl.payment_plan} className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--color-wood)]">
                  {pl.payment_plan === 'full'
                    ? 'Paiement complet'
                    : pl.payment_plan === 'deposit'
                      ? 'Acompte 30 %'
                      : 'Virement bancaire'}{' '}
                  × {pl.cnt}
                </span>
                <span className="font-mono-num text-[var(--color-ink)]">{formatGNF(pl.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[var(--color-line)]">
              <span className="text-[var(--color-wood)]">Taux d’échec paiement / remboursement</span>
              <span className="font-mono-num">
                {stats.kpis.payments.failRatePercent} % / {stats.kpis.payments.refundRatePercent} %
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Catégories + saisonnalité */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
          <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">Ventes par catégorie</h3>
          <HBarChart
            rows={stats.categories.map((c) => ({
              label: `${c.category} (${c.items_sold} art.)`,
              value: c.amount,
            }))}
            formatValue={formatGNF}
          />
        </div>
        <div className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3">
          <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">Saisonnalité des commandes</h3>
          <SeasonalityGrid rows={stats.seasonality} />
        </div>
      </section>

      {/* Pipeline devis + livraison */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-3">
          <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">Pipeline devis sur mesure</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            {['material', 'quoted', 'paid'].map((step) => {
              const st = stats.quotes.byStep[step];
              const label = step === 'material' ? 'Demandes matière' : step === 'quoted' ? 'Devis émis' : 'Devis payés';
              return (
                <div key={step} className="p-2.5 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)]">
                  <p className="text-[10px] text-[var(--color-wood)]">{label}</p>
                  <p className="font-mono-num font-semibold text-[var(--color-ink)]">{st?.count ?? 0}</p>
                  <p className="text-[10px] font-mono-num text-[var(--color-wood)]">{formatGNF(st?.valueGnf || 0)}</p>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <p>Conversion demande → payé : <strong className="font-mono-num">{stats.quotes.conversionPercent} %</strong></p>
            <p>Devis sans réponse : <strong className="font-mono-num">{stats.quotes.staleQuotedCount}</strong></p>
            <p>Délai moyen devis : <strong className="font-mono-num">{stats.quotes.avgDaysToQuote ?? '—'} j</strong></p>
            <p>Délai moyen paiement : <strong className="font-mono-num">{stats.quotes.avgDaysToPay ?? '—'} j</strong></p>
          </div>
        </div>
        <div className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-3">
          <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">Livraison</h3>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <p>Commandes livrées : <strong className="font-mono-num">{stats.delivery.totalDelivered}</strong></p>
            <p>Retraits atelier : <strong className="font-mono-num">{stats.delivery.pickupCount}</strong></p>
            <p>
              Délai moyen livraison :{' '}
              <strong className="font-mono-num">{stats.delivery.avgOrderToDeliveredDays != null ? `${stats.delivery.avgOrderToDeliveredDays} j` : '—'}</strong>
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[var(--color-wood)] border-b border-[var(--color-line)]">
                <th className="text-left p-1.5 font-medium">Zone</th>
                <th className="p-1.5 font-medium">Livraisons</th>
                <th className="p-1.5 font-medium">Frais</th>
                <th className="p-1.5 font-medium">Délai moy.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {stats.delivery.byZone.map((z) => (
                <tr key={z.zone}>
                  <td className="p-1.5">{z.zone}</td>
                  <td className="p-1.5 text-center font-mono-num">{z.count}</td>
                  <td className="p-1.5 text-right font-mono-num">{formatGNF(z.feesGnf)}</td>
                  <td className="p-1.5 text-right font-mono-num">{z.avgDeliveryDays != null ? `${z.avgDeliveryDays} j` : '—'}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Top produits */}
      <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">Top produits</h3>
          <div className="flex gap-2">
            {(
              [
                { id: 'sales', label: 'Par ventes' },
                { id: 'views', label: 'Par vues' },
                { id: 'conversion', label: 'Par conversion' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTopMetric(t.id)}
                className={`px-3 py-1.5 rounded-[var(--radius-s)] text-[11px] font-semibold ${
                  topMetric === t.id ? 'bg-[var(--color-ink)] text-white' : 'border border-[var(--color-line)] text-[var(--color-wood)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-s)]">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-[var(--color-cream)] text-[var(--color-wood)]">
              <tr>
                <th className="p-2 font-medium">Produit</th>
                <th className="p-2 font-medium">Atelier</th>
                <th className="p-2 font-medium text-right">Vues</th>
                <th className="p-2 font-medium text-right">Ventes</th>
                <th className="p-2 font-medium text-right">Conversion</th>
                <th className="p-2 font-medium text-right">Prix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {topRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-3 text-[var(--color-wood)]">
                    Aucune donnée sur la période.
                  </td>
                </tr>
              ) : (
                topRows.map((p) => (
                  <tr key={p.id}>
                    <td className="p-2 max-w-[220px] truncate">{p.name}</td>
                    <td className="p-2">{p.shop_name}</td>
                    <td className="p-2 text-right font-mono-num">{p.views_count}</td>
                    <td className="p-2 text-right font-mono-num font-semibold">{p.sales_count}</td>
                    <td className="p-2 text-right font-mono-num">{p.conversion_percent ?? '—'} %</td>
                    <td className="p-2 text-right font-mono-num">{formatGNF(p.price_gnf)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Avis + recherches */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3">
          <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">Satisfaction ({stats.reviews.totalCount} avis)</h3>
          <p className="font-display font-mono-num text-3xl font-semibold text-[var(--color-gold-deep)]">
            {stats.reviews.average != null ? `${stats.reviews.average} / 5` : '—'}
          </p>
          <div className="space-y-1">
            {[5, 4, 3, 2, 1].map((r) => {
              const cnt = stats.reviews.distribution[String(r)] || 0;
              const total = Math.max(1, stats.reviews.totalCount);
              return (
                <div key={r} className="flex items-center gap-2 text-[11px]">
                  <span className="w-8 font-mono-num">{r} ★</span>
                  <div className="flex-1 h-2 rounded-full bg-[var(--color-cream)] overflow-hidden">
                    <div className="h-full bg-[var(--color-gold)] rounded-full" style={{ width: `${(cnt / total) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right font-mono-num text-[var(--color-wood)]">{cnt}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-[var(--color-wood)]">
            Taux de réponse ateliers : {stats.reviews.replyRatePercent} %
            {stats.reviews.avgReplyDays != null ? ` · délai moyen ${stats.reviews.avgReplyDays} j` : ''}
          </p>
        </div>
        <div className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3">
          <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">Recherches ({stats.searches.days} j)</h3>
          {stats.searches.topQueries.length === 0 ? (
            <p className="text-xs text-[var(--color-wood)]">Aucune requête enregistrée.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {stats.searches.topQueries.slice(0, 14).map((tq) => (
                <span key={tq.q} className="px-2 py-1 rounded-full bg-[var(--color-cream)] text-[11px] font-mono-num">
                  {tq.q} × {tq.count}
                </span>
              ))}
            </div>
          )}
          {stats.searches.zeroResultQueries.length > 0 && (
            <p className="text-[11px] text-[var(--color-danger)]">
              Sans résultat (opportunité catalogue) : {stats.searches.zeroResultQueries.join(', ')}
            </p>
          )}
          <p className="text-[11px] text-[var(--color-wood)]">
            Produits publiés indexés sitemap : <span className="font-mono-num">{stats.searches.sitemapProductCount}</span>
          </p>
        </div>
      </section>

      {/* Acheteurs */}
      <section className="space-y-3">
        <h3 className="font-display text-lg font-semibold text-[var(--color-ink)]">Meilleurs acheteurs (CRM)</h3>
        <div className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-m)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] border-b border-[var(--color-line)]">
              <tr>
                <th className="p-3 font-medium">Acheteur</th>
                <th className="p-3 font-medium">Zone</th>
                <th className="p-3 font-medium text-right">Commandes</th>
                <th className="p-3 font-medium text-right">Cumul</th>
                <th className="p-3 font-medium">Dernière commande</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)] bg-[var(--color-surface)]">
              {stats.buyers.slice(0, 20).map((b) => (
                <tr key={b.email}>
                  <td className="p-3">
                    <span className="block">{b.name || '—'}</span>
                    <span className="text-[11px] text-[var(--color-wood)]">{b.email}</span>
                  </td>
                  <td className="p-3">{b.zone || '—'}</td>
                  <td className="p-3 text-right font-mono-num">{b.orders_count}</td>
                  <td className="p-3 text-right font-mono-num font-semibold">{formatGNF(b.total_gnf)}</td>
                  <td className="p-3 font-mono-num">
                    {b.last_order_at ? new Date(b.last_order_at).toLocaleDateString('fr-FR') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
