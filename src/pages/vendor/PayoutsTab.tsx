import React from 'react';
import {
  Wallet,
} from 'lucide-react';
import {
  formatGNF,
} from '../../shared/domain';
import type { VendorDashboardPayload } from './types';

interface PayoutsTabProps {
  restrictions: VendorDashboardPayload['restrictions'];
  payouts: VendorDashboardPayload['payouts'];
}

/** Tab extracted from VendorPortalPage — presentation only, state lives in the parent. */
export const PayoutsTab: React.FC<PayoutsTabProps> = ({
    restrictions,
    payouts
}) => {
  return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)] flex items-center gap-2">
            <Wallet className="w-5 h-5 text-[var(--color-gold-deep)]" />
            <span>Suivi des versements Djomy</span>
          </h2>
          <span className="text-xs text-[var(--color-wood)]">
            {restrictions.payoutsEnabled ? 'Versements actifs' : 'Versements en pause'}
          </span>
        </div>
        {payouts.length === 0 ? (
          <p className="text-sm text-[var(--color-wood)]">Aucun versement programmé.</p>
        ) : (
          <div className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-m)]">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] border-b border-[var(--color-line)]">
                <tr>
                  <th className="p-3.5 font-medium">Référence Djomy</th>
                  <th className="p-3.5 font-medium">Commande</th>
                  <th className="p-3.5 font-medium">Montant net</th>
                  <th className="p-3.5 font-medium">Statut</th>
                  <th className="p-3.5 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {payouts.map((po) => (
                  <tr key={po.id} className="bg-[var(--color-surface)]">
                    <td className="p-3.5 font-mono-num">{po.reference}</td>
                    <td className="p-3.5 font-mono-num">{po.order_id}</td>
                    <td className="p-3.5 font-mono-num font-semibold">{formatGNF(po.amount_gnf)}</td>
                    <td className="p-3.5">{po.status === 'paid' ? 'Versé' : 'Programmé'}</td>
                    <td className="p-3.5">{new Date(po.created_at).toLocaleDateString('fr-FR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
  );
};
