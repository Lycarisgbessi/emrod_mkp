import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  ShieldCheck,
  Upload,
  
} from 'lucide-react';
import {
  formatGNF,
} from '../../shared/domain';
import type { VendorDashboardPayload, VendorProfileForm } from './types';
import { AnimatedCounter } from '../../components/motion/Reveal';

interface OverviewTabProps {
  compliance: VendorDashboardPayload['compliance'];
  documents: VendorDashboardPayload['documents'];
  registrationRequirements: VendorDashboardPayload['registrationRequirements'];
  restrictions: VendorDashboardPayload['restrictions'];
  stats: VendorDashboardPayload['stats'];
  kycDocType: string;
  setKycDocType: React.Dispatch<React.SetStateAction<string>>;
  kycFileName: string;
  handleKycFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleUploadKyc: (e: React.FormEvent) => void;
  uploadingDoc: boolean;
  profileForm: VendorProfileForm;
  setProfileForm: React.Dispatch<React.SetStateAction<VendorProfileForm>>;
  savingProfile: boolean;
  handleSaveProfile: (e: React.FormEvent) => void;
}

/** Tab extracted from VendorPortalPage — presentation only, state lives in the parent. */
export const OverviewTab: React.FC<OverviewTabProps> = ({
    compliance,
    documents,
    registrationRequirements,
    restrictions,
    stats,
    kycDocType,
    setKycDocType,
    kycFileName,
    handleKycFileSelect,
    handleUploadKyc,
    uploadingDoc,
    profileForm,
    setProfileForm,
    savingProfile,
    handleSaveProfile
}) => {
  return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)]">
            <p className="text-xs text-[var(--color-wood)]">Chiffre d’affaires cumulé</p>
            <p className="font-mono-num text-2xl font-semibold text-[var(--color-ink)] mt-2">
              <AnimatedCounter value={stats.totalRevenueGnf} formatter={formatGNF} />
            </p>
          </div>
          <div className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)]">
            <p className="text-xs text-[var(--color-wood)]">Commandes reçues</p>
            <p className="font-mono-num text-2xl font-semibold text-[var(--color-ink)] mt-2">
              <AnimatedCounter value={stats.ordersCount} />
            </p>
          </div>
          <div className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)]">
            <p className="text-xs text-[var(--color-wood)]">Créations en ligne</p>
            <p className="font-mono-num text-2xl font-semibold text-[var(--color-ink)] mt-2">
              <AnimatedCounter value={stats.publishedProductsCount} />
            </p>
          </div>
          <div className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)]">
            <p className="text-xs text-[var(--color-wood)]">Commandes actives</p>
            <p className="font-mono-num text-2xl font-semibold text-[var(--color-ink)] mt-2">
              <AnimatedCounter value={stats.pendingOrdersCount} />
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Real-time Compliance Checklist (F-VEN-06) */}
          <section className="lg:col-span-6 p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-[var(--color-ink)] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[var(--color-gold-deep)]" />
                <span>Conformité & Certification</span>
              </h2>
              <span className="text-xs font-semibold text-[var(--color-wood)]">
                {compliance.isValidated && compliance.isCertified
                  ? 'Atelier certifié'
                  : `${compliance.missingItems.length} point(s) requis`}
              </span>
            </div>

            {compliance.missingItems.length === 0 ? (
              <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-success)]/30 text-sm text-[var(--color-ink)] flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[var(--color-success)] shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Dossier conforme à 100 %</p>
                  <p className="text-xs text-[var(--color-body)] mt-1">
                    Vous pouvez publier dans toutes les catégories, y compris celles réservées aux
                    ateliers certifiés.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="space-y-3">
                {compliance.missingItems.map((m) => (
                  <li
                    key={`${m.type}_${m.code}`}
                    className="p-3.5 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-line)] flex items-start gap-3 text-sm"
                  >
                    <AlertCircle className="w-4 h-4 text-[var(--color-gold-deep)] shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-[var(--color-ink)]">{m.label}</p>
                      <p className="text-xs text-[var(--color-body)] mt-0.5">{m.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {!compliance.isCertified && (
              <p className="text-xs text-[var(--color-wood)]">
                Plafond actuel sans certification : maximum {restrictions.maxProductsUncertified}{' '}
                produit(s) publié(s).
              </p>
            )}
          </section>

          {/* KYC Document Upload & History (F-VEN-02) */}
          <section className="lg:col-span-6 p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-5">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)] flex items-center gap-2">
              <FileText className="w-5 h-5 text-[var(--color-wood)]" />
              <span>Pièces justificatives KYC</span>
            </h2>

            <form onSubmit={handleUploadKyc} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Type de pièce à déposer
                </label>
                <select
                  value={kycDocType}
                  onChange={(e) => setKycDocType(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                >
                  {registrationRequirements.documents.map((doc) => (
                    <option key={doc.type} value={doc.type}>
                      {doc.label} {doc.required ? '(Obligatoire)' : '(Optionnel)'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Fichier (PDF, PNG ou JPG — max 2 Mo)
                </label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleKycFileSelect}
                  className="block w-full text-xs text-[var(--color-wood)] file:mr-3 file:py-2 file:px-3 file:rounded-[var(--radius-s)] file:border file:border-[var(--color-line)] file:bg-[var(--color-surface)] file:text-xs file:font-medium"
                />
                {kycFileName && (
                  <p className="text-xs text-[var(--color-ink)] mt-1">
                    Fichier sélectionné : {kycFileName}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={uploadingDoc}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold hover:bg-[var(--color-wood)] transition-colors"
              >
                <Upload className="w-4 h-4" />
                <span>{uploadingDoc ? 'Envoi...' : 'Déposer le justificatif'}</span>
              </button>
            </form>

            <div className="pt-3 border-t border-[var(--color-line)] space-y-2">
              <p className="text-xs font-semibold text-[var(--color-wood)]">Pièces déposées</p>
              {documents.length === 0 ? (
                <p className="text-xs text-[var(--color-wood)]">Aucun document soumis pour le moment.</p>
              ) : (
                documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-3 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--color-ink)] truncate">
                        {doc.doc_label}
                      </p>
                      <p className="text-[var(--color-wood)] truncate">{doc.file_name}</p>
                      {doc.rejection_reason && (
                        <p className="text-[var(--color-danger)] mt-0.5">{doc.rejection_reason}</p>
                      )}
                    </div>
                    <span
                      className={`font-semibold shrink-0 ${
                        doc.status === 'approved'
                          ? 'text-[var(--color-success)]'
                          : doc.status === 'rejected'
                            ? 'text-[var(--color-danger)]'
                            : 'text-[var(--color-gold-deep)]'
                      }`}
                    >
                      {doc.status === 'approved'
                        ? 'Approuvé'
                        : doc.status === 'rejected'
                          ? 'Refusé'
                          : 'En examen'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Vendor Profile & Dynamic Compliance Fields Editor */}
        <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-5">
          <div>
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              Profil & champs requis de l’atelier
            </h2>
            <p className="text-xs text-[var(--color-wood)] mt-1">
              Complétez ces informations pour votre vitrine publique et les critères administratifs de conformité.
            </p>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Nom de l’atelier *
                </label>
                <input
                  required
                  value={profileForm.shopName}
                  onChange={(e) => setProfileForm({ ...profileForm, shopName: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Commune / Ville *
                </label>
                <input
                  required
                  value={profileForm.location}
                  onChange={(e) => setProfileForm({ ...profileForm, location: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Délai de réponse affiché
                </label>
                <input
                  value={profileForm.responseTimeLabel}
                  onChange={(e) =>
                    setProfileForm({ ...profileForm, responseTimeLabel: e.target.value })
                  }
                  className="w-full px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Présentation courte (20 car. min) *
                </label>
                <textarea
                  required
                  minLength={20}
                  rows={3}
                  value={profileForm.description}
                  onChange={(e) =>
                    setProfileForm({ ...profileForm, description: e.target.value })
                  }
                  className="w-full px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Histoire de la maison / savoir-faire
                </label>
                <textarea
                  rows={3}
                  value={profileForm.story}
                  onChange={(e) => setProfileForm({ ...profileForm, story: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                />
              </div>
            </div>

            {registrationRequirements.fields.filter(
              (f) => !['shopName', 'location', 'description'].includes(f.key)
            ).length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[var(--color-line)]">
                {registrationRequirements.fields
                  .filter((f) => !['shopName', 'location', 'description'].includes(f.key))
                  .map((f) => (
                    <div key={f.key}>
                      <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                        {f.label} {f.required ? '(Requis conformité)' : ''}
                      </label>
                      {f.type === 'select' && f.options?.length ? (
                        <select
                          value={profileForm.customFields[f.key] || ''}
                          onChange={(e) =>
                            setProfileForm({
                              ...profileForm,
                              customFields: { ...profileForm.customFields, [f.key]: e.target.value },
                            })
                          }
                          className="w-full px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                        >
                          <option value="">Sélectionner...</option>
                          {f.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={profileForm.customFields[f.key] || ''}
                          onChange={(e) =>
                            setProfileForm({
                              ...profileForm,
                              customFields: { ...profileForm.customFields, [f.key]: e.target.value },
                            })
                          }
                          className="w-full px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                        />
                      )}
                    </div>
                  ))}
              </div>
            )}

            <div className="pt-4 border-t border-[var(--color-line)] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                    Coordonnées bancaires (Virement direct grandes commandes)
                  </h3>
                  <p className="text-xs text-[var(--color-wood)]">
                    Affichées aux acheteurs éligibles uniquement lorsqu’ils choisissent le virement bancaire au-delà du seuil plateforme.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--color-ink)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profileForm.bankTransferEnabled}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, bankTransferEnabled: e.target.checked })
                    }
                  />
                  <span>Accepter les virements bancaires</span>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Établissement bancaire
                  </label>
                  <input
                    value={profileForm.bankName}
                    onChange={(e) => setProfileForm({ ...profileForm, bankName: e.target.value })}
                    placeholder="Ex. BICIGUI Conakry"
                    className="w-full px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Titulaire du compte
                  </label>
                  <input
                    value={profileForm.bankAccountHolder}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, bankAccountHolder: e.target.value })
                    }
                    placeholder="Ex. EMROD SARL"
                    className="w-full px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    IBAN / RIB complet
                  </label>
                  <input
                    value={profileForm.bankIbanRib}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, bankIbanRib: e.target.value })
                    }
                    placeholder="GN00 0000 ..."
                    className="w-full px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Code SWIFT / BIC
                  </label>
                  <input
                    value={profileForm.bankSwiftBic}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, bankSwiftBic: e.target.value })
                    }
                    placeholder="BICIGNCX"
                    className="w-full px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm font-mono-num"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Instructions complémentaires pour le virement
                  </label>
                  <input
                    value={profileForm.bankInstructions}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, bankInstructions: e.target.value })
                    }
                    placeholder="Ex. Précisez votre numéro de commande EMR-... en motif."
                    className="w-full px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold hover:bg-[var(--color-wood)] transition-colors"
            >
              {savingProfile ? 'Enregistrement...' : 'Enregistrer le profil atelier'}
            </button>
          </form>
        </section>
      </div>
  );
};
