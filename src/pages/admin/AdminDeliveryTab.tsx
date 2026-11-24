import React from 'react';
import {
  formatGNF,
} from '../../shared/domain';
import type { AdminOverviewPayload, DeliveryFeeResult } from './types';

interface AdminDeliveryTabProps {
  zonesDraft: AdminOverviewPayload['zones'];
  setZonesDraft: React.Dispatch<React.SetStateAction<AdminOverviewPayload['zones']>>;
  simZoneId: string;
  setSimZoneId: React.Dispatch<React.SetStateAction<string>>;
  simWeightKg: number;
  setSimWeightKg: React.Dispatch<React.SetStateAction<number>>;
  simResult: DeliveryFeeResult;
  editorialDraft: AdminOverviewPayload['editorial'];
  setEditorialDraft: React.Dispatch<React.SetStateAction<AdminOverviewPayload['editorial']>>;
  legalDraft: AdminOverviewPayload['legal'];
  setLegalDraft: React.Dispatch<React.SetStateAction<AdminOverviewPayload['legal']>>;
  handleSaveZones: () => void;
  handleSaveEditorial: () => void;
  handleSaveLegal: () => void;
}

/** Tab extracted from AdminPortalPage — presentation only, state lives in the parent. */
export const AdminDeliveryTab: React.FC<AdminDeliveryTabProps> = ({
    zonesDraft,
    setZonesDraft,
    simZoneId,
    setSimZoneId,
    simWeightKg,
    setSimWeightKg,
    simResult,
    editorialDraft,
    setEditorialDraft,
    legalDraft,
    setLegalDraft,
    handleSaveZones,
    handleSaveEditorial,
    handleSaveLegal
}) => {
  return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <section className="lg:col-span-8 p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              Zones & grilles tarifaires de livraison
            </h2>
            <div className="space-y-3">
              {zonesDraft.map((z, idx) => (
                <div
                  key={z.id}
                  className="p-3.5 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-line)] grid grid-cols-1 sm:grid-cols-4 gap-3 items-center text-xs"
                >
                  <div>
                    <p className="font-semibold text-[var(--color-ink)]">{z.name}</p>
                    <p className="text-[var(--color-wood)]">{z.region}</p>
                  </div>
                  <select
                    value={z.pricingMode}
                    onChange={(e) => {
                      const arr = [...zonesDraft];
                      arr[idx] = { ...arr[idx], pricingMode: e.target.value as any };
                      setZonesDraft(arr);
                    }}
                    className="px-2 py-1.5 rounded border border-[var(--color-line)] bg-[var(--color-surface)]"
                  >
                    <option value="fixed">Tarif fixe</option>
                    <option value="weight_tier">Tranches de poids</option>
                  </select>
                  <input
                    type="number"
                    value={z.fixedFeeGnf}
                    onChange={(e) => {
                      const arr = [...zonesDraft];
                      arr[idx] = { ...arr[idx], fixedFeeGnf: Number(e.target.value) };
                      setZonesDraft(arr);
                    }}
                    className="px-2 py-1.5 rounded border border-[var(--color-line)] bg-[var(--color-surface)] font-mono-num"
                  />
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={z.active}
                      onChange={(e) => {
                        const arr = [...zonesDraft];
                        arr[idx] = { ...arr[idx], active: e.target.checked };
                        setZonesDraft(arr);
                      }}
                    />
                    <span>Active</span>
                  </label>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void handleSaveZones()}
              className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
            >
              Enregistrer les zones de livraison
            </button>
          </section>

          {/* Live Simulator (US-A09) */}
          <section className="lg:col-span-4 p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4">
            <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">
              Simulateur de tarif en direct
            </h2>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[var(--color-wood)] mb-1">Zone testée</label>
                <select
                  value={simZoneId}
                  onChange={(e) => setSimZoneId(e.target.value)}
                  className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)]"
                >
                  {zonesDraft.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[var(--color-wood)] mb-1">Poids du colis (kg)</label>
                <input
                  type="number"
                  min={1}
                  value={simWeightKg}
                  onChange={(e) => setSimWeightKg(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] font-mono-num"
                />
              </div>
              <div className="p-3 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)]">
                <p className="text-[var(--color-wood)]">{simResult.label}</p>
                <p className="font-mono-num text-lg font-semibold text-[var(--color-ink)] mt-1">
                  {formatGNF(simResult.fee)}
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              Éditorial vitrine (Page d’accueil)
            </h2>
            <input
              value={editorialDraft.announcementText || ''}
              onChange={(e) =>
                setEditorialDraft({ ...editorialDraft, announcementText: e.target.value })
              }
              placeholder="Bandeau supérieur"
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
            />
            <input
              value={editorialDraft.heroTitle || ''}
              onChange={(e) =>
                setEditorialDraft({ ...editorialDraft, heroTitle: e.target.value })
              }
              placeholder="Titre principal Hero"
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
            />
            <textarea
              rows={2}
              value={editorialDraft.heroSubtitle || ''}
              onChange={(e) =>
                setEditorialDraft({ ...editorialDraft, heroSubtitle: e.target.value })
              }
              placeholder="Sous-titre Hero"
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={editorialDraft.heroCtaLabel || ''}
                onChange={(e) =>
                  setEditorialDraft({ ...editorialDraft, heroCtaLabel: e.target.value })
                }
                placeholder="Libellé bouton CTA Hero"
                className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
              />
              <input
                value={editorialDraft.featuredTitle || ''}
                onChange={(e) =>
                  setEditorialDraft({ ...editorialDraft, featuredTitle: e.target.value })
                }
                placeholder="Titre section pièces signatures"
                className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
              />
            </div>
            <input
              value={editorialDraft.featuredSubtitle || ''}
              onChange={(e) =>
                setEditorialDraft({ ...editorialDraft, featuredSubtitle: e.target.value })
              }
              placeholder="Sous-titre section pièces signatures"
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
            />
            <button
              type="button"
              onClick={() => void handleSaveEditorial()}
              className="px-5 py-2 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
            >
              Mettre à jour la vitrine
            </button>
          </section>

          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              Textes institutionnels & légaux
            </h2>
            <textarea
              rows={2}
              value={legalDraft.mentions || ''}
              onChange={(e) => setLegalDraft({ ...legalDraft, mentions: e.target.value })}
              placeholder="Mentions légales..."
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
            />
            <textarea
              rows={2}
              value={legalDraft.cgv || ''}
              onChange={(e) => setLegalDraft({ ...legalDraft, cgv: e.target.value })}
              placeholder="Conditions générales de vente..."
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
            />
            <textarea
              rows={2}
              value={legalDraft.confidentialite || ''}
              onChange={(e) =>
                setLegalDraft({ ...legalDraft, confidentialite: e.target.value })
              }
              placeholder="Politique de confidentialité..."
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
            />
            <button
              type="button"
              onClick={() => void handleSaveLegal()}
              className="px-5 py-2 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
            >
              Enregistrer les textes légaux
            </button>
          </section>
        </div>
      </div>
  );
};
