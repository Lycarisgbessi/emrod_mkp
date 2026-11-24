import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flag,
  Lock,
  Maximize2,
  MessageSquare,
  Minus,
  Play,
  Plus,
  Ruler,
  ShieldCheck,
  ShoppingBag,
  Star,
  Truck,
  X,
} from 'lucide-react';
import type { CommercialRestrictionsConfig, DeliveryZoneRule, ProductItem } from '../shared/types';
import {
  calculateDeliveryFee,
  detectExternalContactAttempt,
  formatGNF,
} from '../shared/domain';
import { useCart } from '../context/CartContext';
import { useRouter } from '../context/RouterContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import { CertificationSeal } from '../components/ui/CertificationSeal';

interface ProductDetailPayload {
  product: ProductItem;
  reviews: Array<{
    id: string;
    buyerName: string;
    rating: number;
    comment: string;
    photos: string[];
    vendorReply: string;
    createdAt: string;
  }>;
  questions: Array<{
    id: string;
    senderRole: string;
    senderName: string;
    content: string;
    createdAt: string;
  }>;
  zones: DeliveryZoneRule[];
  restrictions?: CommercialRestrictionsConfig;
}

export const ProductDetailPage: React.FC<{ slug: string }> = ({ slug }) => {
  const { navigate } = useRouter();
  const { addToCart, selectedZoneId, setSelectedZoneId, rememberProduct, openCart, totalItems } =
    useCart();
  const { addToast } = useToast();

  const [payload, setPayload] = useState<ProductDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeMediaIdx, setActiveMediaIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50, active: false });

  // Dual Ordering Option: "standard" (tel quel) vs "custom" (dimensions & spécificités -> devis)
  const [orderOption, setOrderOption] = useState<'standard' | 'custom'>('standard');
  const [quantity, setQuantity] = useState(1);

  // Bespoke / Custom Quote Form state
  const [quoteForm, setQuoteForm] = useState({
    buyerName: '',
    buyerEmail: '',
    buyerPhone: '',
    preferredMaterial: 'Noyer massif de Guinée & Laiton',
    dimensionsNotes: '',
    projectNotes: '',
    quantity: 1,
    desiredZoneId: 'ratoma-sonfonia',
  });
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteSubmittedResult, setQuoteSubmittedResult] = useState<{
    id: string;
    trackingToken: string;
    message: string;
  } | null>(null);

  // Public Q&A state
  const [questionName, setQuestionName] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [questionSubmitting, setQuestionSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');
    setActiveMediaIdx(0);
    setQuantity(1);
    setQuoteSubmittedResult(null);

    fetch(`/api/products/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('Création introuvable.');
        return r.json();
      })
      .then((d: ProductDetailPayload) => {
        setPayload(d);
        setOrderOption(d.product.mode === 'sur_devis' ? 'custom' : 'standard');
        setQuoteForm((prev) => ({
          ...prev,
          preferredMaterial: d.product.materials || prev.preferredMaterial,
          desiredZoneId: selectedZoneId || 'ratoma-sonfonia',
        }));
        rememberProduct(d.product);
        document.title = `${d.product.name} — EMROD Marketplace`;
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug, rememberProduct]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loading) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-12 grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-7 aspect-[4/3] rounded-[var(--radius-m)] emrod-skeleton" />
        <div className="lg:col-span-5 space-y-4">
          <div className="h-5 w-1/3 rounded emrod-skeleton" />
          <div className="h-10 w-4/5 rounded emrod-skeleton" />
          <div className="h-24 w-full rounded emrod-skeleton" />
          <div className="h-12 w-full rounded emrod-skeleton" />
        </div>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <h1 className="font-display text-3xl text-[var(--color-ink)]">Pièce introuvable</h1>
        <p className="mt-2 text-sm text-[var(--color-wood)]">
          Cette création a peut-être été archivée ou déplacée.
        </p>
        <button
          type="button"
          onClick={() => navigate('/catalogue')}
          className="mt-6 px-6 py-3 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm font-medium"
        >
          Retour au catalogue
        </button>
      </div>
    );
  }

  const { product, reviews, questions, zones, restrictions } = payload;
  const allowExternalContacts = restrictions?.allowExternalContactsInMessages ?? false;
  const activeMedia = product.media[activeMediaIdx] || product.media[0];
  const maxStock = Math.max(1, product.stockQty);
  const clampedQty = Math.min(maxStock, Math.max(1, quantity));

  const activeZone =
    selectedZoneId === 'pickup' ? null : zones.find((z) => z.id === selectedZoneId) || zones[0] || null;
  const deliveryEstimate = calculateDeliveryFee(activeZone, [
    { weightKg: product.weightKg, quantity: clampedQty, deliveryConfig: product.deliveryConfig },
  ]);
  const subtotalGnf = product.priceGnf * clampedQty;
  const estimatedTotalGnf = subtotalGnf + deliveryEstimate.fee;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.media.filter((m) => m.type === 'image').map((m) => m.url),
    brand: { '@type': 'Brand', name: product.vendor.shopName },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'GNF',
      price: product.priceGnf,
      availability: product.stockQty > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
    ...(product.reviewCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.averageRating,
            reviewCount: product.reviewCount,
          },
        }
      : {}),
  };

  const handleAdd = (e: React.MouseEvent<HTMLButtonElement>, goCheckout = false) => {
    const rect = e.currentTarget.getBoundingClientRect();
    addToCart(product, clampedQty, goCheckout ? undefined : rect);
    if (goCheckout) {
      navigate('/commander');
    } else {
      addToast({
        type: 'success',
        title: `${clampedQty} pièce${clampedQty > 1 ? 's' : ''} ajoutée${clampedQty > 1 ? 's' : ''} au panier`,
        description: product.name,
      });
    }
  };

  const handleQuestionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!questionText.trim()) return;
    if (!allowExternalContacts) {
      const check = detectExternalContactAttempt(questionText);
      if (check.blocked) {
        addToast({
          type: 'error',
          title: 'Échange hors plateforme bloqué',
          description: check.reason,
        });
        return;
      }
    }
    setQuestionSubmitting(true);
    try {
      const created = await apiFetch<any>(`/api/products/${product.id}/questions`, {
        method: 'POST',
        body: JSON.stringify({
          senderName: questionName.trim() || 'Visiteur',
          content: questionText.trim(),
        }),
      });
      setPayload((prev) => (prev ? { ...prev, questions: [...prev.questions, created] } : prev));
      setQuestionText('');
      addToast({
        type: 'success',
        title: 'Question publiée',
        description: 'L’atelier vous répondra directement sur la plateforme.',
      });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Envoi impossible', description: err.message });
    } finally {
      setQuestionSubmitting(false);
    }
  };

  const handleFlagMessage = async (msgId: string) => {
    try {
      await apiFetch(`/api/messages/${msgId}/flag`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Signalé depuis la fiche produit' }),
      });
      addToast({
        type: 'info',
        title: 'Message signalé',
        description: 'L’équipe de modération EMROD va l’examiner.',
      });
    } catch {
      // Ignore
    }
  };

  const handleQuoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allowExternalContacts) {
      const check = detectExternalContactAttempt(
        `${quoteForm.preferredMaterial} ${quoteForm.dimensionsNotes} ${quoteForm.projectNotes}`
      );
      if (check.blocked) {
        addToast({
          type: 'error',
          title: 'Échange hors plateforme bloqué',
          description: check.reason,
        });
        return;
      }
    }
    setQuoteSubmitting(true);
    try {
      const res = await apiFetch<{
        id: string;
        trackingToken: string;
        message: string;
      }>('/api/quotes', {
        method: 'POST',
        body: JSON.stringify({ ...quoteForm, productId: product.id }),
      });
      setQuoteSubmittedResult(res);
      addToast({
        type: 'success',
        title: 'Demande de devis transmise',
        description: 'Suivez et échangez avec l’atelier directement sur EMROD.',
      });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Vérifiez votre demande', description: err.message });
    } finally {
      setQuoteSubmitting(false);
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8 lg:py-12">
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>

      {/* Breadcrumb */}
      <nav
        aria-label="Fil d’Ariane"
        className="text-xs text-[var(--color-wood)] mb-6 flex items-center gap-2 flex-wrap"
      >
        <button type="button" onClick={() => navigate('/')} className="hover:text-[var(--color-ink)]">
          Accueil
        </button>
        <span aria-hidden="true">/</span>
        <button
          type="button"
          onClick={() => navigate(`/catalogue?category=${encodeURIComponent(product.categorySlug)}`)}
          className="hover:text-[var(--color-ink)]"
        >
          {product.categoryName}
        </button>
        <span aria-hidden="true">/</span>
        <span className="text-[var(--color-ink)] font-medium truncate">{product.name}</span>
      </nav>

      {/* Gallery Left + Dual-Mode Purchase Module Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
        {/* Left Gallery */}
        <div className="lg:col-span-7 lg:sticky lg:top-24 space-y-4">
          <div
            className="relative aspect-[4/3] rounded-[var(--radius-m)] overflow-hidden bg-[var(--color-cream)] border border-[var(--color-line)] group cursor-zoom-in"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setZoomOrigin({
                x: ((e.clientX - rect.left) / rect.width) * 100,
                y: ((e.clientY - rect.top) / rect.height) * 100,
                active: true,
              });
            }}
            onMouseLeave={() => setZoomOrigin((z) => ({ ...z, active: false }))}
            onClick={() => setLightboxOpen(true)}
          >
            {activeMedia?.type === 'video' ? (
              <video
                src={activeMedia.url}
                poster={activeMedia.posterUrl || undefined}
                controls
                className="w-full h-full object-cover"
              />
            ) : (
              <img
                src={activeMedia?.url}
                alt={activeMedia?.altText || product.name}
                style={
                  zoomOrigin.active
                    ? { transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`, transform: 'scale(1.35)' }
                    : undefined
                }
                className="w-full h-full object-cover transition-transform duration-200"
              />
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxOpen(true);
              }}
              aria-label="Agrandir l’image en plein écran"
              className="absolute bottom-4 right-4 p-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)]/85 text-white hover:bg-[var(--color-ink)] transition-colors"
            >
              <Maximize2 className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>

          {product.media.length > 1 && (
            <div className="flex items-center gap-3 overflow-x-auto pb-1">
              {product.media.map((m, idx) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setActiveMediaIdx(idx)}
                  aria-label={`Afficher média ${idx + 1}`}
                  className={`relative w-24 aspect-[4/3] rounded-[var(--radius-s)] overflow-hidden border-2 shrink-0 transition-all ${
                    idx === activeMediaIdx
                      ? 'border-[var(--color-gold-deep)]'
                      : 'border-transparent opacity-75 hover:opacity-100'
                  }`}
                >
                  {m.type === 'video' ? (
                    <div className="w-full h-full bg-[var(--color-ink)] flex items-center justify-center text-white">
                      <Play className="w-5 h-5" strokeWidth={1.5} />
                    </div>
                  ) : (
                    <img src={m.url} alt={m.altText} className="w-full h-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Description & Detailed Technical Specifications */}
          <div className="pt-4 space-y-4">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              Description & caractéristiques techniques
            </h2>
            <p className="text-sm sm:text-base text-[var(--color-body)] leading-relaxed">
              {product.description}
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-line)] text-xs">
              <div>
                <dt className="text-[var(--color-wood)]">Matériaux & essences</dt>
                <dd className="font-medium text-[var(--color-ink)] mt-0.5">{product.materials}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-wood)]">Dimensions standard</dt>
                <dd className="font-medium text-[var(--color-ink)] mt-0.5">{product.dimensions}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-wood)]">Poids estimé</dt>
                <dd className="font-mono-num font-medium text-[var(--color-ink)] mt-0.5">
                  {product.weightKg} kg
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-wood)]">Délai de mise à disposition</dt>
                <dd className="font-medium text-[var(--color-ink)] mt-0.5">
                  {product.deliveryConfig.estimatedDelay}
                </dd>
              </div>
              {product.vendor.bankTransferAvailable && (
                <div className="sm:col-span-2 pt-2 border-t border-[var(--color-line)]">
                  <dt className="text-[var(--color-wood)]">Règlement grandes commandes</dt>
                  <dd className="font-medium text-[var(--color-ink)] mt-0.5">
                    Cet atelier accepte le paiement intégral, l’acompte Djomy ainsi que le virement bancaire direct sur les commandes importantes.
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {/* Right Purchase & Customization Module */}
        <div className="lg:col-span-5 space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-wood)]">
              <span>{product.categoryName}</span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => navigate(`/artisan/${product.vendor.slug}`)}
                className="font-semibold text-[var(--color-ink)] underline underline-offset-4 decoration-[var(--color-line)] hover:decoration-[var(--color-gold-deep)]"
              >
                {product.vendor.shopName}
              </button>
              <span aria-hidden="true">·</span>
              <span>{product.vendor.completedSalesCount} vente(s)</span>
            </div>

            <h1 className="mt-2 font-display text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] leading-tight">
              {product.name}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {product.reviewCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink)]">
                  <Star
                    className="w-4 h-4 fill-[var(--color-gold)] text-[var(--color-gold)]"
                    strokeWidth={1.5}
                  />
                  <span className="tabular-nums">{product.averageRating.toFixed(1)}</span>
                  <span className="text-xs text-[var(--color-wood)]">
                    ({product.reviewCount} avis vérifiés)
                  </span>
                </span>
              )}
              {product.vendor.badges.map((b) => (
                <CertificationSeal
                  key={b.id}
                  name={b.name}
                  icon={b.icon}
                  criteriaDescription={b.criteriaDescription}
                  publicDescription={b.publicDescription}
                />
              ))}
            </div>
          </div>

          {/* Pricing Banner */}
          <div className="py-4 border-y border-[var(--color-line)]">
            {product.mode === 'sur_devis' ? (
              <div>
                <p className="font-display text-2xl font-semibold text-[var(--color-ink)]">
                  Création sur devis personnalisé
                </p>
                <p className="text-xs text-[var(--color-wood)] mt-1">
                  Tarif ajusté selon vos dimensions et finitions · Délai :{' '}
                  {product.deliveryConfig.estimatedDelay}
                </p>
              </div>
            ) : (
              <div>
                <div className="flex items-baseline gap-3">
                  <span className="font-mono-num text-3xl font-semibold text-[var(--color-ink)]">
                    {formatGNF(product.priceGnf)}
                  </span>
                  {product.compareAtPriceGnf && product.compareAtPriceGnf > product.priceGnf && (
                    <span className="font-mono-num text-base text-[var(--color-wood)] line-through">
                      {formatGNF(product.compareAtPriceGnf)}
                    </span>
                  )}
                  <span className="text-xs text-[var(--color-wood)]">/ pièce standard</span>
                </div>
                <p className="mt-1.5 text-xs text-[var(--color-wood)]">
                  {product.isUniquePiece && product.stockQty <= 1
                    ? `Pièce unique · ${product.stockQty > 0 ? 'Disponible immédiatement' : 'Vendue'}`
                    : product.stockQty > 0
                      ? `Stock disponible : ${product.stockQty} en atelier`
                      : 'Actuellement épuisé'}
                </p>
              </div>
            )}
          </div>

          {/* DUAL OPTION SELECTOR: Standard ("Tel quel") vs Custom ("Dimensions & spécificités") */}
          <div className="space-y-4">
            <p className="text-xs font-semibold text-[var(--color-wood)] uppercase tracking-wider">
              Choisissez votre formule de commande
            </p>
            <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Formule de commande">
              {product.mode === 'direct' ? (
                <button
                  type="button"
                  role="radio"
                  aria-checked={orderOption === 'standard'}
                  onClick={() => setOrderOption('standard')}
                  className={`p-3 rounded-[var(--radius-s)] border text-left transition-colors ${
                    orderOption === 'standard'
                      ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white'
                      : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-cream)]'
                  }`}
                >
                  <span className="block text-xs font-semibold">1. Commander tel quel</span>
                  <span
                    className={`block text-[11px] mt-0.5 ${
                      orderOption === 'standard' ? 'text-[#EAE3D2]' : 'text-[var(--color-wood)]'
                    }`}
                  >
                    Dimensions d’origine · Achat immédiat
                  </span>
                </button>
              ) : (
                <div className="p-3 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-cream)]/60 text-left opacity-70">
                  <span className="block text-xs font-semibold text-[var(--color-ink)]">
                    Pièce sur mesure
                  </span>
                  <span className="block text-[11px] text-[var(--color-wood)] mt-0.5">
                    Réalisée uniquement sur devis
                  </span>
                </div>
              )}

              <button
                type="button"
                role="radio"
                aria-checked={orderOption === 'custom'}
                onClick={() => setOrderOption('custom')}
                className={`p-3 rounded-[var(--radius-s)] border text-left transition-colors ${
                  orderOption === 'custom'
                    ? 'border-[var(--color-gold-deep)] bg-[var(--color-cream)] text-[var(--color-ink)] ring-1 ring-[var(--color-gold-deep)]'
                    : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-cream)]'
                }`}
              >
                <span className="block text-xs font-semibold">
                  {product.mode === 'direct' ? '2. Sur mesure / Spécificités' : 'Configurer mon devis'}
                </span>
                <span className="block text-[11px] text-[var(--color-wood)] mt-0.5">
                  Dimensions précises · Devis sans paiement
                </span>
              </button>
            </div>

            {/* OPTION 1: ORDER AS-IS ("Tel quel") with Quantity, Zone & Live Price Breakdown */}
            {orderOption === 'standard' && product.mode === 'direct' && (
              <div className="p-5 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-5">
                {/* Quantity + Zone */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
                  <div className="sm:col-span-5">
                    <label className="block text-xs font-medium text-[var(--color-wood)] mb-1.5">
                      Quantité souhaitée
                    </label>
                    <div className="inline-flex items-center border border-[var(--color-line)] rounded-[var(--radius-s)] bg-[var(--color-cream)] w-full justify-between">
                      <button
                        type="button"
                        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                        disabled={clampedQty <= 1}
                        aria-label="Diminuer la quantité"
                        className="p-2.5 text-[var(--color-ink)] disabled:opacity-30"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="font-mono-num text-sm font-semibold text-[var(--color-ink)] px-2">
                        {clampedQty}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuantity((q) => Math.min(maxStock, q + 1))}
                        disabled={clampedQty >= maxStock}
                        aria-label="Augmenter la quantité"
                        className="p-2.5 text-[var(--color-ink)] disabled:opacity-30"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="sm:col-span-7">
                    <label
                      htmlFor="pdp-zone"
                      className="block text-xs font-medium text-[var(--color-wood)] mb-1.5"
                    >
                      Option & zone de livraison
                    </label>
                    <select
                      id="pdp-zone"
                      value={selectedZoneId}
                      onChange={(e) => setSelectedZoneId(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-cream)] text-xs sm:text-sm"
                    >
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name} ({z.estimatedDays})
                        </option>
                      ))}
                      <option value="pickup">Retrait gratuit en atelier</option>
                    </select>
                  </div>
                </div>

                {/* Live Price Calculation with Quantity & Delivery Included */}
                <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-2 text-xs sm:text-sm">
                  <div className="flex justify-between text-[var(--color-body)]">
                    <span>
                      {clampedQty} × {formatGNF(product.priceGnf)}
                    </span>
                    <span className="font-mono-num font-medium text-[var(--color-ink)]">
                      {formatGNF(subtotalGnf)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[var(--color-body)]">
                    <span className="inline-flex items-center gap-1.5">
                      <Truck className="w-3.5 h-3.5 text-[var(--color-wood)]" strokeWidth={1.5} />
                      <span>{deliveryEstimate.label}</span>
                    </span>
                    <span className="font-mono-num font-medium text-[var(--color-ink)]">
                      {deliveryEstimate.fee === 0 ? 'Gratuit' : formatGNF(deliveryEstimate.fee)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-[var(--color-line)] text-base font-semibold text-[var(--color-ink)]">
                    <span>Total livraison incluse</span>
                    <span className="font-mono-num">{formatGNF(estimatedTotalGnf)}</span>
                  </div>
                  <p className="text-[11px] text-[var(--color-wood)] pt-1">
                    À la caisse : paiement intégral, acompte avec solde à la livraison, ou virement bancaire direct (commandes importantes).
                  </p>
                </div>

                {/* CTAs */}
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={(e) => handleAdd(e, false)}
                    disabled={product.stockQty <= 0}
                    className="w-full py-3.5 px-6 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white disabled:opacity-40 font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-colors min-h-[48px]"
                  >
                    <ShoppingBag className="w-5 h-5" strokeWidth={1.5} />
                    <span>
                      {product.stockQty > 0
                        ? `Ajouter au panier (${clampedQty})`
                        : 'Actuellement épuisé'}
                    </span>
                  </button>
                  <div
                    className={`grid grid-cols-1 ${totalItems > 0 ? 'sm:grid-cols-2' : ''} gap-2.5`}
                  >
                    <button
                      type="button"
                      onClick={(e) => handleAdd(e, true)}
                      disabled={product.stockQty <= 0}
                      className="py-2.5 px-4 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white hover:bg-[var(--color-wood)] disabled:opacity-40 text-xs font-semibold transition-colors"
                    >
                      Commander maintenant
                    </button>
                    {totalItems > 0 && (
                      <button
                        type="button"
                        onClick={openCart}
                        className="py-2.5 px-4 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-cream)] text-[var(--color-ink)] hover:border-[var(--color-gold-deep)] text-xs font-semibold transition-colors"
                      >
                        Voir le panier ({totalItems})
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* OPTION 2: CUSTOMIZED SPECIFICATIONS (Only route allowing quote order without immediate payment) */}
            {orderOption === 'custom' && (
              <div className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-gold-deep)]/40 space-y-4">
                <div className="flex items-start gap-2.5 text-xs text-[var(--color-body)] pb-3 border-b border-[var(--color-line)]">
                  <Ruler className="w-4 h-4 text-[var(--color-gold-deep)] shrink-0 mt-0.5" strokeWidth={1.5} />
                  <div>
                    <p className="font-semibold text-[var(--color-ink)]">
                      Offre personnalisée — Devis sans paiement immédiat
                    </p>
                    <p className="mt-0.5">
                      Seules les demandes personnalisées peuvent être transmises sans règlement upfront. L’atelier analysera vos cotes et vous enverra son devis et lien Djomy dans votre messagerie sécurisée EMROD.
                    </p>
                  </div>
                </div>

                {quoteSubmittedResult ? (
                  <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-success)]/40 space-y-3">
                    <div className="flex items-start gap-2.5 text-[var(--color-success)]">
                      <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.5} />
                      <div className="text-xs">
                        <p className="font-semibold text-sm text-[var(--color-ink)]">
                          Demande de devis enregistrée
                        </p>
                        <p className="text-[var(--color-body)] mt-1">{quoteSubmittedResult.message}</p>
                      </div>
                    </div>
                    <div className="p-3 rounded bg-[var(--color-cream)] border border-[var(--color-line)] text-xs">
                      <span className="text-[var(--color-wood)]">Jeton de suivi de votre devis :</span>
                      <p className="font-mono-num font-semibold text-[var(--color-ink)] break-all mt-0.5">
                        {quoteSubmittedResult.trackingToken}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/devis/${encodeURIComponent(quoteSubmittedResult.trackingToken)}`)
                      }
                      className="w-full py-3 px-4 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold hover:bg-[var(--color-wood)] inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      <span>Suivre mon devis & discuter avec l’atelier</span>
                      <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleQuoteSubmit} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                          Quantité souhaitée *
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          required
                          value={quoteForm.quantity}
                          onChange={(e) =>
                            setQuoteForm({ ...quoteForm, quantity: Math.max(1, Number(e.target.value)) })
                          }
                          className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-mono-num"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                          Zone de livraison prévue *
                        </label>
                        <select
                          value={quoteForm.desiredZoneId}
                          onChange={(e) => setQuoteForm({ ...quoteForm, desiredZoneId: e.target.value })}
                          className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs sm:text-sm"
                        >
                          {zones.map((z) => (
                            <option key={z.id} value={z.id}>
                              {z.name}
                            </option>
                          ))}
                          <option value="pickup">Retrait en atelier</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                        Dimensions précises souhaitées (L × P × H) *
                      </label>
                      <input
                        required
                        value={quoteForm.dimensionsNotes}
                        onChange={(e) => setQuoteForm({ ...quoteForm, dimensionsNotes: e.target.value })}
                        placeholder={`Standard : ${product.dimensions} — indiquez vos cotes`}
                        className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                        Essence de bois, cuir ou finitions *
                      </label>
                      <input
                        required
                        value={quoteForm.preferredMaterial}
                        onChange={(e) => setQuoteForm({ ...quoteForm, preferredMaterial: e.target.value })}
                        className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                        Spécificités & aménagement (usage, accès, teinte...) *
                      </label>
                      <textarea
                        rows={3}
                        required
                        value={quoteForm.projectNotes}
                        onChange={(e) => setQuoteForm({ ...quoteForm, projectNotes: e.target.value })}
                        placeholder="Précisez vos particularités sans inclure de contact externe..."
                        className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                      />
                    </div>

                    <div className="pt-2 border-t border-[var(--color-line)] space-y-3">
                      <p className="text-[11px] font-medium text-[var(--color-wood)]">
                        Vos coordonnées pour recevoir votre lien de suivi de devis EMROD :
                      </p>
                      <input
                        required
                        value={quoteForm.buyerName}
                        onChange={(e) => setQuoteForm({ ...quoteForm, buyerName: e.target.value })}
                        placeholder="Nom complet (ex. Mariama Camara)"
                        className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <input
                          type="email"
                          required
                          value={quoteForm.buyerEmail}
                          onChange={(e) => setQuoteForm({ ...quoteForm, buyerEmail: e.target.value })}
                          placeholder="Courriel *"
                          className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                        />
                        <input
                          required
                          value={quoteForm.buyerPhone}
                          onChange={(e) => setQuoteForm({ ...quoteForm, buyerPhone: e.target.value })}
                          placeholder="Téléphone *"
                          className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                        />
                      </div>
                    </div>

                    {!allowExternalContacts && (
                      <p className="text-[11px] text-[var(--color-wood)] flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                        <span>
                          Échanges obligatoires sur EMROD : les champs texte bloquent numéros, courriels et liens externes.
                        </span>
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={quoteSubmitting}
                      className="w-full py-3.5 px-5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] font-semibold text-sm hover:bg-[var(--color-gold-deep)] hover:text-white transition-colors min-h-[48px]"
                    >
                      {quoteSubmitting
                        ? 'Envoi de la demande...'
                        : 'Envoyer ma demande sur mesure (Devis gratuit)'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reviews & Public Q&A */}
      <div className="mt-16 pt-12 border-t border-[var(--color-line)] grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Verified Reviews */}
        <section className="lg:col-span-6 space-y-6">
          <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)]">
            Avis clients vérifiés ({reviews.length})
          </h2>
          {reviews.length === 0 ? (
            <p className="text-sm text-[var(--color-wood)] p-5 rounded-[var(--radius-s)] bg-[var(--color-cream)]">
              Aucun avis déposé pour le moment. Seuls les acheteurs ayant reçu leur commande peuvent publier un avis vérifié.
            </p>
          ) : (
            <div className="space-y-4">
              {reviews.map((rev) => (
                <article
                  key={rev.id}
                  className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-ink)]">{rev.buyerName}</p>
                      <p className="text-xs text-[var(--color-wood)]">
                        Achat vérifié · {new Date(rev.createdAt).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: rev.rating }).map((_, i) => (
                        <Star
                          key={i}
                          className="w-4 h-4 fill-[var(--color-gold)] text-[var(--color-gold)]"
                          strokeWidth={1.5}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-[var(--color-body)] leading-relaxed">{rev.comment}</p>
                  {rev.vendorReply && (
                    <div className="mt-3 p-3 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] text-xs">
                      <p className="font-semibold text-[var(--color-wood)]">Réponse de l’atelier :</p>
                      <p className="mt-1 text-[var(--color-body)]">{rev.vendorReply}</p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Public Product Questions & Answers */}
        <section className="lg:col-span-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)]">
              Questions publiques à l’atelier ({questions.length})
            </h2>
            <span className="text-xs text-[var(--color-wood)]">{product.vendor.responseTimeLabel}</span>
          </div>

          <div className="space-y-3">
            {questions.map((q) => (
              <div
                key={q.id}
                className={`p-4 rounded-[var(--radius-s)] border ${
                  q.senderRole === 'vendor'
                    ? 'bg-[var(--color-cream)] border-[var(--color-gold)]/40 ml-6'
                    : 'bg-[var(--color-surface)] border-[var(--color-line)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[var(--color-ink)]">
                    {q.senderName} {q.senderRole === 'vendor' ? '(Atelier)' : ''}
                  </span>
                  <div className="flex items-center gap-3 text-[var(--color-wood)]">
                    <span>{new Date(q.createdAt).toLocaleDateString('fr-FR')}</span>
                    <button
                      type="button"
                      onClick={() => void handleFlagMessage(q.id)}
                      aria-label="Signaler ce message"
                      className="hover:text-[var(--color-danger)]"
                    >
                      <Flag className="w-3.5 h-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
                <p className="mt-1.5 text-sm text-[var(--color-body)]">{q.content}</p>
              </div>
            ))}
          </div>

          <form
            onSubmit={handleQuestionSubmit}
            className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-3"
          >
            <p className="text-sm font-semibold text-[var(--color-ink)] flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[var(--color-wood)]" strokeWidth={1.5} />
              <span>Poser une question sur les matériaux ou dimensions</span>
            </p>
            {!allowExternalContacts && (
              <p className="text-[11px] text-[var(--color-wood)] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--color-gold-deep)] shrink-0" strokeWidth={1.5} />
                <span>
                  Messagerie 100 % intégrée : pour protéger votre garantie EMROD, les numéros de téléphone, courriels et liens externes sont automatiquement bloqués.
                </span>
              </p>
            )}
            <input
              type="text"
              value={questionName}
              onChange={(e) => setQuestionName(e.target.value)}
              placeholder="Votre prénom ou nom"
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
            />
            <textarea
              rows={3}
              required
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              placeholder="Ex. Ce modèle peut-il être adapté en 180 cm de large ?"
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
            />
            <button
              type="submit"
              disabled={questionSubmitting}
              className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm font-medium hover:bg-[var(--color-wood)] transition-colors disabled:opacity-50"
            >
              {questionSubmitting ? 'Envoi...' : 'Publier la question'}
            </button>
          </form>
        </section>
      </div>

      {/* Fullscreen Lightbox Modal */}
      <AnimatePresence>
        {lightboxOpen && activeMedia && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#1A1A1A]/90 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Vue plein écran"
            onClick={() => setLightboxOpen(false)}
          >
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              aria-label="Fermer la galerie"
              className="absolute top-4 right-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <X className="w-6 h-6" strokeWidth={1.5} />
            </button>
            {product.media.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMediaIdx((i) => (i - 1 + product.media.length) % product.media.length);
                  }}
                  aria-label="Image précédente"
                  className="absolute left-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20"
                >
                  <ChevronLeft className="w-6 h-6" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMediaIdx((i) => (i + 1) % product.media.length);
                  }}
                  aria-label="Image suivante"
                  className="absolute right-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20"
                >
                  <ChevronRight className="w-6 h-6" strokeWidth={1.5} />
                </button>
              </>
            )}
            <motion.img
              key={activeMedia.url}
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              src={activeMedia.url}
              alt={activeMedia.altText}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[85vh] max-w-[90vw] object-contain rounded-[var(--radius-m)]"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
