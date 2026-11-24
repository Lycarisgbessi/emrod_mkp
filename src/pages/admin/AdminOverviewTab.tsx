import React from 'react';
import {
  Download,
} from 'lucide-react';
import {
  formatGNF,
} from '../../shared/domain';
import type { AdminOverviewPayload } from './types';
import { AnimatedCounter } from '../../components/motion/Reveal';

interface AdminOverviewTabProps {
  data: AdminOverviewPayload;
  handleDownloadCsv: (type: 'orders' | 'vendors' | 'products') => void;
}

/** Tab extracted from AdminPortalPage — presentation only, state lives in the parent. */
export const AdminOverviewTab: React.FC<AdminOverviewTabProps> = ({
    data,
    handleDownloadCsv
}) => {
  return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)]">
            <p className="text-xs text-[var(--color-wood)]">Ventes du jour</p>
            <p className="font-mono-num text-2xl font-semibold text-[var(--color-ink)] mt-2">
              <AnimatedCounter value={data.kpis.salesTodayGnf} formatter={formatGNF} />
            </p>
          </div>
          <div className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)]">
            <p className="text-xs text-[var(--color-wood)]">Volume mensuel</p>
            <p className="font-mono-num text-2xl font-semibold text-[var(--color-ink)] mt-2">
              <AnimatedCounter value={data.kpis.salesMonthGnf} formatter={formatGNF} />
            </p>
          </div>
          <div className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)]">
            <p className="text-xs text-[var(--color-wood)]">Dossiers vendeurs en attente</p>
            <p className="font-mono-num text-2xl font-semibold text-[var(--color-ink)] mt-2">
              <AnimatedCounter value={data.kpis.vendorsPending} />
            </p>
          </div>
          <div className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)]">
            <p className="text-xs text-[var(--color-wood)]">Abonnés Alertes Web Push</p>
            <p className="font-mono-num text-2xl font-semibold text-[var(--color-ink)] mt-2">
              <AnimatedCounter value={data.kpis.subscribersCount} />
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              Répartition des commandes ({data.kpis.ordersCount})
            </h2>
            <div className="space-y-2.5">
              {Object.entries(data.kpis.ordersByStatus).map(([status, cnt]) => (
                <div key={status} className="flex items-center justify-between text-sm">
                  <span className="text-[var(--color-body)]">{status}</span>
                  <span className="font-mono-num font-semibold text-[var(--color-ink)]">{cnt}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              Exports comptables & conformité (CSV UTF-8)
            </h2>
            <p className="text-xs text-[var(--color-wood)]">
              Téléchargez les registres encodés avec BOM UTF-8 compatible Excel pour les accents
              français.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleDownloadCsv('orders')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold hover:bg-[var(--color-wood)]"
              >
                <Download className="w-4 h-4" />
                <span>Commandes (.csv)</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadCsv('vendors')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs font-semibold"
              >
                <Download className="w-4 h-4" />
                <span>Vendeurs (.csv)</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadCsv('products')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs font-semibold"
              >
                <Download className="w-4 h-4" />
                <span>Produits (.csv)</span>
              </button>
            </div>
          </section>
        </div>
      </div>
  );
};
