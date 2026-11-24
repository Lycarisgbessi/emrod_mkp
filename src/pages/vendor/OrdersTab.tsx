import React from 'react';
import {
  canVendorAdvanceOrder,
  formatGNF,
  ORDER_STATUS_FLOW,
} from '../../shared/domain';
import type {
  OrderStatus,
} from '../../shared/types';
import type { VendorDashboardPayload } from './types';

interface OrdersTabProps {
  orders: VendorDashboardPayload['orders'];
  handleAdvanceOrder: (orderId: string, nextStatus: OrderStatus) => void;
  handleConfirmBankTransfer: (orderId: string) => void;
}

/** Tab extracted from VendorPortalPage — presentation only, state lives in the parent. */
export const OrdersTab: React.FC<OrdersTabProps> = ({
    orders,
    handleAdvanceOrder,
    handleConfirmBankTransfer
}) => {
  return (
      <div className="space-y-4">
        <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)]">
          Commandes à préparer & expédier
        </h2>
        {orders.length === 0 ? (
          <p className="text-sm text-[var(--color-wood)]">Aucune commande pour l’instant.</p>
        ) : (
          orders.map((o) => {
            const isTerminal = ['Livrée', 'Annulée', 'Remboursée'].includes(o.status);
            const curIdx = ORDER_STATUS_FLOW.indexOf(o.status);
            const nextStatus =
              !isTerminal && curIdx >= 0 && curIdx < ORDER_STATUS_FLOW.length - 1
                ? ORDER_STATUS_FLOW[curIdx + 1]
                : null;
            const isClosed = o.status === 'Annulée' || o.status === 'Remboursée';
            const canVendorCancel = ['Commandée', 'Confirmée', 'En préparation'].includes(o.status);
            const isBankTransfer = o.payment_plan === 'bank_transfer';
            const bankTransferPending =
              isBankTransfer && !isClosed && Number(o.balance_due_gnf ?? 0) > 0;
            const advanceGuard = canVendorAdvanceOrder({
              status: o.status,
              paymentPlan: o.payment_plan,
              balanceDueGnf: o.balance_due_gnf,
              paymentStatus: o.payment_status,
            });
            const hasSucceededPayment =
              o.payment_status === 'succeeded' || (isBankTransfer && Number(o.balance_due_gnf ?? 0) === 0);
            return (
              <div
                key={o.id}
                className="p-5 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-wood)]">
                    <span className="font-mono-num font-semibold text-[var(--color-ink)]">
                      {o.order_number}
                    </span>
                    <span>·</span>
                    <span>{new Date(o.created_at).toLocaleDateString('fr-FR')}</span>
                    <span>·</span>
                    <span className="font-semibold text-[var(--color-gold-deep)]">{o.status}</span>
                    <span>·</span>
                    <span className="font-medium text-[var(--color-ink)]">
                      {o.payment_plan === 'deposit'
                        ? Number(o.balance_due_gnf || 0) === 0
                          ? `Acompte ${o.deposit_percent || 30}% + Solde encaissé à la livraison`
                          : `Acompte ${o.deposit_percent || 30}% (Solde à la livraison : ${formatGNF(Number(o.balance_due_gnf || 0))})`
                        : isBankTransfer
                          ? isClosed
                            ? 'Virement bancaire (commande clôturée)'
                            : bankTransferPending
                              ? 'Virement bancaire en attente de vérification'
                              : 'Virement bancaire confirmé'
                          : o.payment_status === 'pending'
                            ? 'Djomy en attente de paiement'
                            : o.payment_status === 'failed'
                              ? 'Paiement Djomy refusé'
                              : 'Paiement intégral Djomy'}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-[var(--color-ink)]">
                    {o.buyer_name} ({o.buyer_phone}) — {o.delivery_zone_name}
                  </p>
                  <p className="text-xs text-[var(--color-wood)]">{o.delivery_address}</p>
                  <p className="text-xs text-[var(--color-body)] pt-1">
                    {o.items.map((i) => `${i.product_name} × ${i.quantity}`).join(', ')}
                  </p>
                  {isBankTransfer && o.bank_transfer_reference && (
                    <p className="text-xs font-mono-num text-[var(--color-ink)] pt-1">
                      Réf. virement déclarée : <strong>{o.bank_transfer_reference}</strong>
                    </p>
                  )}
                  {!isClosed && nextStatus && !advanceGuard.allowed && (
                    <p className="text-[11px] text-[var(--color-gold-deep)] font-medium pt-1">
                      {advanceGuard.reason}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <span className="font-mono-num text-base font-semibold text-[var(--color-ink)]">
                    {formatGNF(o.vendor_subtotal_gnf ?? o.total_gnf)}
                  </span>
                  {bankTransferPending && (
                    <button
                      type="button"
                      onClick={() => void handleConfirmBankTransfer(o.id)}
                      className="px-4 py-2 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] text-xs font-semibold hover:bg-[var(--color-gold-deep)] hover:text-white"
                    >
                      Confirmer réception du virement
                    </button>
                  )}
                  {nextStatus && (
                    <button
                      type="button"
                      disabled={!advanceGuard.allowed}
                      title={!advanceGuard.allowed ? advanceGuard.reason : undefined}
                      onClick={() => void handleAdvanceOrder(o.id, nextStatus)}
                      className="px-4 py-2 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold hover:bg-[var(--color-wood)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Passer à : {nextStatus}
                    </button>
                  )}
                  {canVendorCancel && (
                    <button
                      type="button"
                      onClick={() => void handleAdvanceOrder(o.id, 'Annulée')}
                      className="px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-danger)]/40 text-[var(--color-danger)] text-xs font-medium hover:bg-[#A63B2E]/10"
                    >
                      {hasSucceededPayment ? 'Annuler & rembourser' : 'Annuler la commande'}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
  );
};
