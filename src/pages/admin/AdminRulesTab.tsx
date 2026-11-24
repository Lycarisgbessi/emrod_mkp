import React from 'react';
import {
  Settings,
} from 'lucide-react';
import type { AdminOverviewPayload } from './types';

interface AdminRulesTabProps {
  data: AdminOverviewPayload;
  restrictions: AdminOverviewPayload['restrictions'] | null;
  setRestrictions: React.Dispatch<React.SetStateAction<AdminOverviewPayload['restrictions'] | null>>;
  regRules: AdminOverviewPayload['registrationRequirements'] | null;
  setRegRules: React.Dispatch<React.SetStateAction<AdminOverviewPayload['registrationRequirements'] | null>>;
  newBadge: { name: string; criteriaDescription: string; publicDescription: string; isMandatory: boolean; autoAssign: boolean };
  setNewBadge: React.Dispatch<React.SetStateAction<{ name: string; criteriaDescription: string; publicDescription: string; isMandatory: boolean; autoAssign: boolean }>>;
  newField: { label: string; type: 'text' | 'textarea' | 'select'; options: string; required: boolean };
  setNewField: React.Dispatch<React.SetStateAction<{ label: string; type: 'text' | 'textarea' | 'select'; options: string; required: boolean }>>;
  handleSaveRestrictions: () => void;
  handleSaveRegRules: () => void;
  handleCreateBadge: (e: React.FormEvent) => void;
  handleCategoryRestriction: (catId: string, isRestricted: boolean, requiredBadgeId: string | null) => void;
}

/** Tab extracted from AdminPortalPage — presentation only, state lives in the parent. */
export const AdminRulesTab: React.FC<AdminRulesTabProps> = ({
    data,
    restrictions,
    setRestrictions,
    regRules,
    setRegRules,
    newBadge,
    setNewBadge,
    newField,
    setNewField,
    handleSaveRestrictions,
    handleSaveRegRules,
    handleCreateBadge,
    handleCategoryRestriction
}) => {
  if (!restrictions || !regRules) return null;
  return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Commercial Restrictions */}
        <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)] flex items-center gap-2">
            <Settings className="w-4 h-4 text-[var(--color-wood)]" />
            <span>Restrictions commerciales</span>
          </h2>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={restrictions.vendorRegistrationEnabled}
              onChange={(e) =>
                setRestrictions({ ...restrictions, vendorRegistrationEnabled: e.target.checked })
              }
            />
            <span>Autoriser l’inscription de nouveaux vendeurs tiers</span>
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={restrictions.preModerationEnabled}
              onChange={(e) =>
                setRestrictions({ ...restrictions, preModerationEnabled: e.target.checked })
              }
            />
            <span>Pré-modération obligatoire avant mise en ligne (vendeurs tiers)</span>
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={restrictions.payoutsEnabled}
              onChange={(e) =>
                setRestrictions({ ...restrictions, payoutsEnabled: e.target.checked })
              }
            />
            <span>Activer la génération automatique des versements vendeurs</span>
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={restrictions.allowExternalContactsInMessages}
              onChange={(e) =>
                setRestrictions({
                  ...restrictions,
                  allowExternalContactsInMessages: e.target.checked,
                })
              }
            />
            <span>
              Autoriser le partage de contacts externes dans la messagerie (décoché = échanges obligatoires sur EMROD)
            </span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div>
              <label className="block text-xs text-[var(--color-wood)] mb-1">
                Plafond produits non certifiés
              </label>
              <input
                type="number"
                min={0}
                value={restrictions.maxProductsUncertified}
                onChange={(e) =>
                  setRestrictions({
                    ...restrictions,
                    maxProductsUncertified: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-wood)] mb-1">
                Validité jeton suivi (mois)
              </label>
              <input
                type="number"
                min={1}
                value={restrictions.trackingTokenValidityMonths}
                onChange={(e) =>
                  setRestrictions({
                    ...restrictions,
                    trackingTokenValidityMonths: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-wood)] mb-1">
                Acompte par défaut (%)
              </label>
              <input
                type="number"
                min={10}
                max={80}
                value={restrictions.defaultDepositPercent ?? 30}
                onChange={(e) =>
                  setRestrictions({
                    ...restrictions,
                    defaultDepositPercent: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-wood)] mb-1">
                Seuil minimum virement bancaire (GNF)
              </label>
              <input
                type="number"
                min={1000000}
                step={1000000}
                value={restrictions.bankTransferMinGnf ?? 15000000}
                onChange={(e) =>
                  setRestrictions({
                    ...restrictions,
                    bankTransferMinGnf: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleSaveRestrictions()}
            className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
          >
            Enregistrer les restrictions
          </button>
        </section>

        {/* Dynamic KYC Documents & Registration Rules */}
        <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-5">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
            Pièces KYC & Champs requis à l’inscription
          </h2>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[var(--color-wood)]">Justificatifs KYC</p>
            {regRules.documents.map((doc, idx) => (
              <div
                key={doc.type}
                className="flex items-center justify-between gap-2 p-2.5 rounded-[var(--radius-s)] bg-[var(--color-cream)] text-xs"
              >
                <div>
                  <p className="font-semibold text-[var(--color-ink)]">{doc.label}</p>
                  <p className="text-[var(--color-wood)]">Cible : {doc.appliesTo}</p>
                </div>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={doc.required}
                    onChange={(e) => {
                      const docs = [...regRules.documents];
                      docs[idx] = { ...docs[idx], required: e.target.checked };
                      setRegRules({ ...regRules, documents: docs });
                    }}
                  />
                  <span>Obligatoire</span>
                </label>
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-3 border-t border-[var(--color-line)]">
            <p className="text-xs font-semibold text-[var(--color-wood)]">
              Champs du formulaire d’inscription ({regRules.fields.length})
            </p>
            {regRules.fields.map((fld, idx) => (
              <div
                key={fld.key}
                className="flex items-center justify-between gap-2 p-2.5 rounded-[var(--radius-s)] bg-[var(--color-cream)] text-xs"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--color-ink)] truncate">{fld.label}</p>
                  <p className="text-[var(--color-wood)]">
                    Clé : {fld.key} · Type : {fld.type}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={fld.required}
                      onChange={(e) => {
                        const fields = [...regRules.fields];
                        fields[idx] = { ...fields[idx], required: e.target.checked };
                        setRegRules({ ...regRules, fields });
                      }}
                    />
                    <span>Requis</span>
                  </label>
                  {!['shopName', 'location', 'description'].includes(fld.key) && (
                    <button
                      type="button"
                      onClick={() =>
                        setRegRules({
                          ...regRules,
                          fields: regRules.fields.filter((_, i) => i !== idx),
                        })
                      }
                      className="text-[var(--color-danger)] hover:underline"
                    >
                      Retirer
                    </button>
                  )}
                </div>
              </div>
            ))}

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-2">
              <input
                value={newField.label}
                onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                placeholder="Nouveau champ (ex. Spécialité bois)"
                className="sm:col-span-5 px-2.5 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
              />
              <select
                value={newField.type}
                onChange={(e) => setNewField({ ...newField, type: e.target.value as any })}
                className="sm:col-span-3 px-2 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
              >
                <option value="text">Texte court</option>
                <option value="textarea">Texte long</option>
                <option value="select">Liste choix</option>
              </select>
              {newField.type === 'select' && (
                <input
                  value={newField.options}
                  onChange={(e) => setNewField({ ...newField, options: e.target.value })}
                  placeholder="Options (virgules)"
                  className="sm:col-span-4 px-2.5 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
                />
              )}
              <button
                type="button"
                onClick={() => {
                  const label = newField.label.trim();
                  if (!label) return;
                  const key = label
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^a-z0-9]+/g, '_')
                    .replace(/^_|_$/g, '');
                  if (!key || regRules.fields.some((f) => f.key === key)) return;
                  const opts =
                    newField.type === 'select'
                      ? newField.options
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                      : undefined;
                  setRegRules({
                    ...regRules,
                    fields: [
                      ...regRules.fields,
                      {
                        key,
                        label,
                        type: newField.type,
                        required: newField.required,
                        options: opts,
                      },
                    ],
                  });
                  setNewField({ label: '', type: 'text', options: '', required: true });
                }}
                className="sm:col-span-4 px-3 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-semibold hover:bg-[var(--color-cream)]"
              >
                + Ajouter le champ
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleSaveRegRules()}
            className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
          >
            Enregistrer les exigences KYC & champs
          </button>
        </section>

        {/* Category Restrictions */}
        <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
            Catégories restreintes par badge
          </h2>
          <div className="space-y-3">
            {data.categories.map((cat) => (
              <div
                key={cat.id}
                className="p-3 rounded-[var(--radius-s)] border border-[var(--color-line)] flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <span className="font-semibold text-[var(--color-ink)]">{cat.name}</span>
                <div className="flex items-center gap-2">
                  <select
                    value={cat.isRestricted ? cat.requiredBadgeId || '' : ''}
                    onChange={(e) =>
                      void handleCategoryRestriction(
                        cat.id,
                        Boolean(e.target.value),
                        e.target.value || null
                      )
                    }
                    className="px-2.5 py-1.5 rounded border border-[var(--color-line)] bg-[var(--color-surface)]"
                  >
                    <option value="">Ouverte à tous les vendeurs validés</option>
                    {data.badges.map((b) => (
                      <option key={b.id} value={b.id}>
                        Exige : {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Create Badge */}
        <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
            Créer un badge de certification
          </h2>
          <form onSubmit={handleCreateBadge} className="space-y-3">
            <input
              required
              placeholder="Nom du badge (ex. Bois Éco-Certifié Guinée)"
              value={newBadge.name}
              onChange={(e) => setNewBadge({ ...newBadge, name: e.target.value })}
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
            />
            <textarea
              required
              rows={2}
              placeholder="Critères d’attribution..."
              value={newBadge.criteriaDescription}
              onChange={(e) =>
                setNewBadge({ ...newBadge, criteriaDescription: e.target.value })
              }
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs"
            />
            <button
              type="submit"
              className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] text-xs font-semibold"
            >
              Créer ce sceau
            </button>
          </form>
        </section>
      </div>
  );
};
