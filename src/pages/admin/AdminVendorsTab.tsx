import React from 'react';
import type { AdminOverviewPayload } from './types';

interface AdminVendorsTabProps {
  data: AdminOverviewPayload;
  handleVendorStatus: (vendorId: string, status: import('../../../src/shared/types').VendorAccountStatus, reason: string) => void;
  handleDocReview: (docId: string, status: 'approved' | 'rejected') => void;
  handleCertToggle: (vendorId: string, badgeId: string, hasBadge: boolean) => void;
}

/** Tab extracted from AdminPortalPage — presentation only, state lives in the parent. */
export const AdminVendorsTab: React.FC<AdminVendorsTabProps> = ({
    data,
    handleVendorStatus,
    handleDocReview,
    handleCertToggle
}) => {
  return (
      <div className="space-y-5">
        {data.vendors.map((v) => (
          <div
            key={v.id}
            className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4"
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[var(--color-line)]">
              <div>
                <p className="text-xs text-[var(--color-wood)]">
                  {v.entity_type === 'company' ? 'Entreprise' : 'Indépendant'} · {v.location} ·{' '}
                  {v.email} · {v.phone}
                </p>
                <h3 className="font-display text-xl font-semibold text-[var(--color-ink)] mt-0.5">
                  {v.shop_name}{' '}
                  {v.is_emrod_official ? (
                    <span className="text-xs font-sans text-[var(--color-gold-deep)]">
                      (Fondateur)
                    </span>
                  ) : null}
                </h3>
                <p className="text-xs text-[var(--color-body)] mt-1">
                  Statut : <strong>{v.status}</strong> — {v.status_reason}
                </p>
              </div>

              {!v.is_emrod_official && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void handleVendorStatus(v.id, 'validated', 'Dossier validé par EMROD')
                    }
                    className="px-3.5 py-2 rounded-[var(--radius-s)] bg-[var(--color-success)] text-white text-xs font-semibold"
                  >
                    Valider l’atelier
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleVendorStatus(
                        v.id,
                        'rejected',
                        'Pièces justificatives insuffisantes'
                      )
                    }
                    className="px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-danger)]/40 text-[var(--color-danger)] text-xs font-semibold"
                  >
                    Refuser
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleVendorStatus(v.id, 'suspended', 'Boutique suspendue par modération')
                    }
                    className="px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-medium"
                  >
                    Suspendre
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Documents KYC */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[var(--color-wood)]">
                  Justificatifs déposés ({v.documents.length})
                </p>
                {v.documents.length === 0 ? (
                  <p className="text-xs text-[var(--color-wood)]">Aucune pièce déposée.</p>
                ) : (
                  v.documents.map((d) => (
                    <div
                      key={d.id}
                      className="p-3 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-line)] flex items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-[var(--color-ink)]">{d.doc_label}</p>
                        <p className="text-[var(--color-wood)]">
                          {d.file_name} · <strong>{d.status}</strong>
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <a
                          href={`/api/vendor/documents/${d.id}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 rounded border border-[var(--color-line)] text-[var(--color-ink)] font-medium hover:bg-[var(--color-surface)]"
                        >
                          Vérifier
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleDocReview(d.id, 'approved')}
                          className="px-2.5 py-1 rounded bg-[var(--color-success)] text-white font-medium"
                        >
                          Approuver
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDocReview(d.id, 'rejected')}
                          className="px-2.5 py-1 rounded bg-[var(--color-danger)] text-white font-medium"
                        >
                          Refuser
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Certification Badges */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[var(--color-wood)]">
                  Certifications & Sceaux d’atelier
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.badges.map((b) => {
                    const hasBadge = v.compliance?.earnedBadgeIds?.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => void handleCertToggle(v.id, b.id, Boolean(hasBadge))}
                        className={`px-3 py-1.5 rounded-[var(--radius-s)] border text-xs font-medium transition-colors ${
                          hasBadge
                            ? 'bg-[var(--color-ink)] text-[var(--color-gold)] border-[var(--color-ink)]'
                            : 'bg-[var(--color-surface)] text-[var(--color-wood)] border-[var(--color-line)] hover:border-[var(--color-gold-deep)]'
                        }`}
                      >
                        {hasBadge ? `✓ ${b.name} (Révoquer)` : `+ Accorder « ${b.name} »`}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
  );
};
