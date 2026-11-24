import React from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Copy,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  
} from 'lucide-react';
import {
  formatGNF,
  getVendorAccountStatusLabel,
} from '../../shared/domain';
import type { VendorDashboardPayload, VendorProductForm } from './types';
import { SAMPLE_MEDIA_URLS } from './types';

interface ProductsTabProps {
  mode: 'register' | 'workspace';
  user: VendorDashboardPayload['user'];
  categories: VendorDashboardPayload['categories'];
  zones: VendorDashboardPayload['zones'];
  compliance: VendorDashboardPayload['compliance'];
  products: VendorDashboardPayload['products'];
  editorOpen: boolean;
  setEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  editingId: string | null;
  prodError: string;
  prodForm: VendorProductForm;
  setProdForm: React.Dispatch<React.SetStateAction<VendorProductForm>>;
  savingProd: boolean;
  extractingKw: boolean;
  openNewProductEditor: () => void;
  handleExtractKeywords: () => void;
  handleProductImageFiles: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSaveProduct: (e: React.FormEvent) => void;
  handleDuplicateProduct: (id: string) => void;
  openEditProduct: (p: import('../../shared/types').ProductItem) => void;
  moveMedia: (idx: number, dir: -1 | 1) => void;
}

/** Tab extracted from VendorPortalPage — presentation only, state lives in the parent. */
export const ProductsTab: React.FC<ProductsTabProps> = ({
    mode,
    user,
    categories,
    zones,
    compliance,
    products,
    editorOpen,
    setEditorOpen,
    editingId,
    prodError,
    prodForm,
    setProdForm,
    savingProd,
    extractingKw,
    openNewProductEditor,
    handleExtractKeywords,
    handleProductImageFiles,
    handleSaveProduct,
    handleDuplicateProduct,
    openEditProduct,
    moveMedia
}) => {
  return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)]">
              Catalogue de l’atelier
            </h2>
            <p className="text-xs text-[var(--color-wood)] mt-1">
              Achat direct en GNF ou pièces uniques sur devis avec accompagnement en 4 étapes.
            </p>
          </div>
          <button
            type="button"
            onClick={openNewProductEditor}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Ajouter une création</span>
          </button>
        </div>

        {!compliance.isValidated && (
          <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-gold-deep)]/40 text-xs text-[var(--color-body)] flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-[var(--color-gold-deep)] shrink-0 mt-0.5" />
            <span>
              Votre boutique est actuellement <strong>{getVendorAccountStatusLabel(user.status).toLowerCase()}</strong>. Vous pouvez préparer vos fiches en <strong>Brouillon</strong> dès maintenant ; leur mise en vitrine publique sera activée dès la validation de vos justificatifs par EMROD.
            </span>
          </div>
        )}

        {editorOpen && (
          <form
            onSubmit={handleSaveProduct}
            className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-6"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-line)] pb-3">
              <h3 className="font-display text-xl font-semibold text-[var(--color-ink)]">
                {editingId ? 'Modifier la fiche produit' : 'Nouvelle fiche création'}
              </h3>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="text-xs text-[var(--color-wood)] hover:text-[var(--color-ink)]"
              >
                Fermer l’éditeur
              </button>
            </div>

            {prodError && (
              <div className="p-4 rounded-[var(--radius-s)] bg-[#A63B2E]/10 border border-[var(--color-danger)]/40 text-xs text-[var(--color-danger)] font-medium">
                {prodError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Nom de la pièce *
                </label>
                <input
                  required
                  value={prodForm.name}
                  onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })}
                  placeholder="Ex. Console Ratoma en iroko & laiton"
                  className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Catégorie *
                </label>
                <select
                  value={prodForm.categoryId}
                  onChange={(e) => setProdForm({ ...prodForm, categoryId: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                >
                  {categories.map((c) => {
                    const locked =
                      c.isRestricted &&
                      c.requiredBadgeId &&
                      !compliance.earnedBadgeIds.includes(c.requiredBadgeId);
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name} {locked ? '(Certification requise)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Mode de commercialisation
                </label>
                <select
                  value={prodForm.mode}
                  onChange={(e) =>
                    setProdForm({ ...prodForm, mode: e.target.value as 'direct' | 'sur_devis' })
                  }
                  className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                >
                  <option value="direct">Achat direct (prix fixe en GNF)</option>
                  <option value="sur_devis">Sur devis (projet 4 étapes)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {prodForm.mode === 'direct' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                      Prix (GNF) *
                    </label>
                    <input
                      type="number"
                      required
                      min={1000}
                      value={prodForm.priceGnf}
                      onChange={(e) => setProdForm({ ...prodForm, priceGnf: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                      Prix barré GNF (optionnel)
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder="Ex. 7500000"
                      value={prodForm.compareAtPriceGnf}
                      onChange={(e) =>
                        setProdForm({ ...prodForm, compareAtPriceGnf: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
                    />
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Poids estimé (kg)
                </label>
                <input
                  type="number"
                  min={1}
                  value={prodForm.weightKg}
                  onChange={(e) => setProdForm({ ...prodForm, weightKg: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Stock disponible
                </label>
                <input
                  type="number"
                  min={0}
                  value={prodForm.stockQty}
                  onChange={(e) => {
                    const nextQty = Number(e.target.value);
                    setProdForm({
                      ...prodForm,
                      stockQty: nextQty,
                      isUniquePiece: nextQty <= 1 ? prodForm.isUniquePiece : false,
                    });
                  }}
                  className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
                />
                {prodForm.stockQty <= 1 && (
                  <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--color-body)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prodForm.isUniquePiece}
                      onChange={(e) => setProdForm({ ...prodForm, isUniquePiece: e.target.checked })}
                    />
                    <span>Pièce unique artisanale</span>
                  </label>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Statut de publication
                </label>
                <select
                  value={prodForm.status}
                  onChange={(e) => setProdForm({ ...prodForm, status: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                >
                  <option value="published" disabled={!compliance.isValidated}>
                    Publié en vitrine {!compliance.isValidated ? '(après validation EMROD)' : ''}
                  </option>
                  <option value="draft">Brouillon</option>
                  <option value="archived">Archivé</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Matériaux & finitions
                </label>
                <input
                  value={prodForm.materials}
                  onChange={(e) => setProdForm({ ...prodForm, materials: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Dimensions
                </label>
                <input
                  value={prodForm.dimensions}
                  onChange={(e) => setProdForm({ ...prodForm, dimensions: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-[var(--color-wood)]">
                  Description détaillée (80 car. min — {prodForm.description.trim().length}/80) *
                </label>
                <button
                  type="button"
                  onClick={() => void handleExtractKeywords()}
                  disabled={extractingKw}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)] hover:text-[var(--color-gold-deep)]"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[var(--color-gold-deep)]" />
                  <span>
                    {extractingKw ? 'Analyse...' : 'Extraire les mots-clés (1 clic)'}
                  </span>
                </button>
              </div>
              <textarea
                required
                minLength={80}
                rows={3}
                value={prodForm.description}
                onChange={(e) => setProdForm({ ...prodForm, description: e.target.value })}
                className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
              />
              {prodForm.keywords.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 items-center">
                  {prodForm.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] text-xs"
                    >
                      <span>{kw}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setProdForm({
                            ...prodForm,
                            keywords: prodForm.keywords.filter((k) => k !== kw),
                          })
                        }
                        aria-label={`Retirer ${kw}`}
                        className="text-[var(--color-wood)] hover:text-[var(--color-danger)]"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Media manager up to 10 reorderable images + video (F-PRD-02) */}
            <div className="space-y-3 pt-2 border-t border-[var(--color-line)]">
              <p className="text-xs font-semibold text-[var(--color-ink)]">
                Galerie photos (jusqu’à 10 images réordonnables)
              </p>
              <div className="space-y-2">
                {prodForm.media.map((m, idx) => (
                  <div
                    key={`${m.url}_${idx}`}
                    className="flex items-center gap-3 p-2 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)]"
                  >
                    <img src={m.url} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                    <input
                      value={m.altText}
                      onChange={(e) => {
                        const arr = [...prodForm.media];
                        arr[idx] = { ...arr[idx], altText: e.target.value };
                        setProdForm({ ...prodForm, media: arr });
                      }}
                      placeholder="Texte alternatif SEO"
                      className="flex-1 px-2 py-1 text-xs border border-[var(--color-line)] rounded"
                    />
                    <button
                      type="button"
                      onClick={() => moveMedia(idx, -1)}
                      disabled={idx === 0}
                      aria-label="Monter l’image"
                      className="p-1.5 text-[var(--color-wood)] disabled:opacity-30"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveMedia(idx, 1)}
                      disabled={idx === prodForm.media.length - 1}
                      aria-label="Descendre l’image"
                      className="p-1.5 text-[var(--color-wood)] disabled:opacity-30"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    {prodForm.media.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setProdForm({
                            ...prodForm,
                            media: prodForm.media.filter((_, i) => i !== idx),
                          })
                        }
                        aria-label="Supprimer l’image"
                        className="p-1.5 text-[var(--color-danger)]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {prodForm.media.length < 10 && (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold hover:bg-[var(--color-wood)] cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Importer depuis votre appareil (JPG/PNG)</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        onChange={(e) => void handleProductImageFiles(e)}
                        className="sr-only"
                      />
                    </label>
                    <input
                      value={prodForm.newMediaUrl}
                      onChange={(e) => setProdForm({ ...prodForm, newMediaUrl: e.target.value })}
                      placeholder="Ou coller une URL d’image (https://... ou /src/assets/...)"
                      className="flex-1 min-w-[200px] px-3 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!prodForm.newMediaUrl.trim()) return;
                        setProdForm({
                          ...prodForm,
                          media: [
                            ...prodForm.media,
                            {
                              type: 'image',
                              url: prodForm.newMediaUrl.trim(),
                              altText: prodForm.name || 'Création EMROD',
                            },
                          ],
                          newMediaUrl: '',
                        });
                      }}
                      className="px-3 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs font-medium"
                    >
                      Ajouter URL
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-[var(--color-wood)] mr-1">Photos d’atelier EMROD :</span>
                    {SAMPLE_MEDIA_URLS.map((u, i) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() =>
                          setProdForm({
                            ...prodForm,
                            media: [
                              ...prodForm.media,
                              { type: 'image', url: u, altText: prodForm.name || 'Meuble' },
                            ],
                          })
                        }
                        className="px-2.5 py-1 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] text-xs"
                      >
                        + Photo {i + 1}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="pt-2">
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Vidéo de présentation de la pièce (optionnel, URL MP4/WebM)
                </label>
                <input
                  value={prodForm.videoUrl}
                  onChange={(e) => setProdForm({ ...prodForm, videoUrl: e.target.value })}
                  placeholder="https://... ou /assets/..."
                  className="w-full px-3 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs"
                />
              </div>
            </div>

            {/* Per-product delivery zone overrides (F-PRD-05) */}
            <div className="space-y-3 pt-2 border-t border-[var(--color-line)]">
              <p className="text-xs font-semibold text-[var(--color-ink)]">
                Livraison & frais spécifiques (optionnel — surcharge les tarifs de zone)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {zones
                  .filter((z) => z.active)
                  .map((z) => (
                    <div key={z.id}>
                      <label className="block text-[11px] text-[var(--color-wood)] mb-1">
                        {z.name} (GNF)
                      </label>
                      <input
                        type="number"
                        placeholder={`Défaut (${z.fixedFeeGnf})`}
                        value={prodForm.zoneFees[z.id] || ''}
                        onChange={(e) =>
                          setProdForm({
                            ...prodForm,
                            zoneFees: { ...prodForm.zoneFees, [z.id]: e.target.value },
                          })
                        }
                        className="w-full px-3 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs font-mono-num"
                      />
                    </div>
                  ))}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="px-4 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-medium"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={savingProd}
                className="px-6 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold hover:bg-[var(--color-wood)]"
              >
                {savingProd ? 'Enregistrement...' : 'Enregistrer la fiche'}
              </button>
            </div>
          </form>
        )}

        {/* Product list */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((p) => (
            <div
              key={p.id}
              className="p-4 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] flex flex-col justify-between gap-4"
            >
              <div className="flex gap-3">
                <img
                  src={p.media[0]?.url}
                  alt={p.name}
                  className="w-20 h-20 rounded-[var(--radius-s)] object-cover bg-[var(--color-cream)] shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-[var(--color-wood)]">
                    {p.categoryName} ·{' '}
                    <strong>
                      {p.status === 'published'
                        ? 'Publié'
                        : p.status === 'in_review'
                          ? 'En pré-modération'
                          : p.status === 'draft'
                            ? 'Brouillon'
                            : p.status === 'removed'
                              ? 'Retiré'
                              : 'Archivé'}
                    </strong>
                  </p>
                  <h3 className="font-display text-base font-semibold text-[var(--color-ink)] truncate mt-0.5">
                    {p.name}
                  </h3>
                  <p className="font-mono-num text-sm font-semibold text-[var(--color-ink)] mt-1">
                    {p.mode === 'sur_devis' ? 'Sur devis' : formatGNF(p.priceGnf)}
                  </p>
                  <p className="text-xs text-[var(--color-wood)]">Stock : {p.stockQty}</p>
                </div>
              </div>

              {p.removalReason && (
                <p className="text-xs text-[var(--color-danger)] bg-[#A63B2E]/10 p-2 rounded">
                  Modération : {p.removalReason}
                </p>
              )}

              <div className="flex items-center gap-2 pt-3 border-t border-[var(--color-line)]">
                <button
                  type="button"
                  onClick={() => openEditProduct(p)}
                  className="flex-1 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-medium hover:bg-[var(--color-cream)]"
                >
                  Modifier
                </button>
                <button
                  type="button"
                  onClick={() => void handleDuplicateProduct(p.id)}
                  className="px-3 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-medium hover:bg-[var(--color-cream)] inline-flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>Dupliquer</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
  );
};
