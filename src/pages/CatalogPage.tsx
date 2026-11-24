import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Filter,
  MapPin,
  Package,
  Search,
  SlidersHorizontal,
  Star,
  Store,
  X,
} from 'lucide-react';
import type {
  BadgeDefinition,
  CategoryItem,
  DeliveryZoneRule,
  ProductItem,
  VendorPublicSummary,
} from '../shared/types';
import { useRouter } from '../context/RouterContext';
import { ProductCard } from '../components/ui/ProductCard';
import { SkeletonGrid } from '../components/ui/SkeletonGrid';
import { CertificationSeal } from '../components/ui/CertificationSeal';

const POPULAR_PRODUCT_SEARCHES = ['Noyer', 'Chêne', 'Cuir pleine fleur', 'Bibliothèque', 'Sur mesure'];
const POPULAR_VENDOR_SEARCHES = ['EMROD', 'Fouta', 'Sonfonia', 'Dixinn', 'Vérifié'];

export const CatalogPage: React.FC = () => {
  const { search, navigate } = useRouter();
  const params = new URLSearchParams(search);

  const [viewMode, setViewMode] = useState<'products' | 'vendors'>(
    params.get('view') === 'vendors' ? 'vendors' : 'products'
  );

  // Shared Search
  const [q, setQ] = useState(params.get('q') || '');

  // Product Filters
  const [category, setCategory] = useState(params.get('category') || 'all');
  const [material, setMaterial] = useState(params.get('material') || 'all');
  const [badge, setBadge] = useState(params.get('badge') || 'all');
  const [zone, setZone] = useState(params.get('zone') || 'all');
  const [vendorFilter, setVendorFilter] = useState(params.get('vendor') || 'all');
  const [mode, setMode] = useState(params.get('mode') || 'all');
  const [sort, setSort] = useState(params.get('sort') || 'featured');
  const [minPrice, setMinPrice] = useState(params.get('minPrice') || '');
  const [maxPrice, setMaxPrice] = useState(params.get('maxPrice') || '');
  const [minQty, setMinQty] = useState(params.get('minQty') || '');
  const [inStockOnly, setInStockOnly] = useState(params.get('inStockOnly') === '1');
  const [minRating, setMinRating] = useState(params.get('minRating') || '');
  const [limit, setLimit] = useState(12);

  // Vendor Filters
  const [vendorMinSales, setVendorMinSales] = useState(params.get('minSales') || '');
  const [vendorBadge, setVendorBadge] = useState(params.get('vBadge') || 'all');
  const [vendorMinRating, setVendorMinRating] = useState(params.get('vRating') || '');
  const [vendorLocation, setVendorLocation] = useState(params.get('location') || 'all');
  const [vendorBankOnly, setVendorBankOnly] = useState(params.get('bankTransferOnly') === '1');
  const [vendorSort, setVendorSort] = useState(params.get('vSort') || 'featured');

  // Fetched Data
  const [items, setItems] = useState<ProductItem[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [badges, setBadges] = useState<BadgeDefinition[]>([]);
  const [zones, setZones] = useState<DeliveryZoneRule[]>([]);
  const [allVendors, setAllVendors] = useState<VendorPublicSummary[]>([]);

  const [vendorsList, setVendorsList] = useState<VendorPublicSummary[]>([]);
  const [vendorsTotal, setVendorsTotal] = useState(0);
  const [locations, setLocations] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [showFiltersMobile, setShowFiltersMobile] = useState(false);

  // Sync state when URL changes externally (e.g. Header or Home links)
  useEffect(() => {
    const p = new URLSearchParams(search);
    setViewMode(p.get('view') === 'vendors' ? 'vendors' : 'products');
    setQ(p.get('q') || '');
    setCategory(p.get('category') || 'all');
    setMode(p.get('mode') || 'all');
    setMaterial(p.get('material') || 'all');
    setBadge(p.get('badge') || 'all');
    setZone(p.get('zone') || 'all');
    setVendorFilter(p.get('vendor') || 'all');
    setSort(p.get('sort') || 'featured');
    setMinPrice(p.get('minPrice') || '');
    setMaxPrice(p.get('maxPrice') || '');
    setMinQty(p.get('minQty') || '');
    setInStockOnly(p.get('inStockOnly') === '1');
    setMinRating(p.get('minRating') || '');
    setVendorMinSales(p.get('minSales') || '');
    setVendorBadge(p.get('vBadge') || 'all');
    setVendorMinRating(p.get('vRating') || '');
    setVendorLocation(p.get('location') || 'all');
    setVendorBankOnly(p.get('bankTransferOnly') === '1');
    setVendorSort(p.get('vSort') || 'featured');
  }, [search]);

  // Debounced search term: avoids refetching on every keystroke (F-CAT-02)
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(timer);
  }, [q]);

  // Fetch products when in product mode (and metadata once)
  useEffect(() => {
    if (viewMode !== 'products') return;
    document.title = 'Catalogue Mobilier sur Mesure — EMROD Marketplace';
    setLoading(true);

    const qs = new URLSearchParams();
    if (debouncedQ.trim()) qs.set('q', debouncedQ.trim());
    if (category !== 'all') qs.set('category', category);
    if (material !== 'all') qs.set('material', material);
    if (badge !== 'all') qs.set('badge', badge);
    if (zone !== 'all') qs.set('zone', zone);
    if (vendorFilter !== 'all') qs.set('vendor', vendorFilter);
    if (mode !== 'all') qs.set('mode', mode);
    if (sort !== 'featured') qs.set('sort', sort);
    if (minPrice) qs.set('minPrice', minPrice);
    if (maxPrice) qs.set('maxPrice', maxPrice);
    if (minQty) qs.set('minQty', minQty);
    if (inStockOnly) qs.set('inStockOnly', '1');
    if (minRating) qs.set('minRating', minRating);
    qs.set('limit', String(limit));

    // Abort in-flight requests when filters change again (prevents stale responses
    // from overwriting the results of the latest query)
    const controller = new AbortController();
    fetch(`/api/products?${qs.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items || []);
        setTotal(d.total || 0);
        if (d.categories) setCategories(d.categories);
        if (d.badges) setBadges(d.badges);
        if (d.zones) setZones(d.zones);
        if (d.vendors) setAllVendors(d.vendors);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setItems([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    viewMode,
    debouncedQ,
    category,
    material,
    badge,
    zone,
    vendorFilter,
    mode,
    sort,
    minPrice,
    maxPrice,
    minQty,
    inStockOnly,
    minRating,
    limit,
  ]);

  // Fetch vendors when in vendor mode
  useEffect(() => {
    if (viewMode !== 'vendors') return;
    document.title = 'Rechercher un Atelier & Vendeur — EMROD Marketplace';
    setLoading(true);

    const qs = new URLSearchParams();
    if (debouncedQ.trim()) qs.set('q', debouncedQ.trim());
    if (vendorMinSales) qs.set('minSales', vendorMinSales);
    if (vendorBadge !== 'all') qs.set('badge', vendorBadge);
    if (vendorMinRating) qs.set('minRating', vendorMinRating);
    if (vendorLocation !== 'all') qs.set('location', vendorLocation);
    if (vendorBankOnly) qs.set('bankTransferOnly', '1');
    if (vendorSort !== 'featured') qs.set('sort', vendorSort);

    const controller = new AbortController();
    fetch(`/api/vendors?${qs.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        setVendorsList(d.vendors || []);
        setVendorsTotal(d.total || 0);
        if (d.badges) setBadges(d.badges);
        if (d.locations) setLocations(d.locations);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setVendorsList([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [
    viewMode,
    debouncedQ,
    vendorMinSales,
    vendorBadge,
    vendorMinRating,
    vendorLocation,
    vendorBankOnly,
    vendorSort,
  ]);

  const updateUrlParam = (key: string, val: string) => {
    const p = new URLSearchParams(search);
    if (!val || val === 'all' || val === '0') p.delete(key);
    else p.set(key, val);
    const qs = p.toString();
    navigate(`/catalogue${qs ? `?${qs}` : ''}`, { replace: true });
  };

  const switchView = (next: 'products' | 'vendors') => {
    setViewMode(next);
    const p = new URLSearchParams(search);
    if (next === 'vendors') p.set('view', 'vendors');
    else p.delete('view');
    const qs = p.toString();
    navigate(`/catalogue${qs ? `?${qs}` : ''}`, { replace: true });
  };

  const resetAll = () => {
    setQ('');
    if (viewMode === 'products') {
      setCategory('all');
      setMaterial('all');
      setBadge('all');
      setZone('all');
      setVendorFilter('all');
      setMode('all');
      setSort('featured');
      setMinPrice('');
      setMaxPrice('');
      setMinQty('');
      setInStockOnly(false);
      setMinRating('');
      navigate('/catalogue', { replace: true });
    } else {
      setVendorMinSales('');
      setVendorBadge('all');
      setVendorMinRating('');
      setVendorLocation('all');
      setVendorBankOnly(false);
      setVendorSort('featured');
      navigate('/catalogue?view=vendors', { replace: true });
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-10 lg:py-14">
      {/* Page Title, Mode Switcher & Search */}
      <div className="pb-8 border-b border-[var(--color-line)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs font-medium text-[var(--color-wood)]">
            Catalogue vérifié · EMROD & Ateliers certifiés en Guinée
          </p>

          {/* Dual Search Mode Switcher: Products vs Vendors */}
          <div
            role="tablist"
            aria-label="Mode de recherche"
            className="inline-flex rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-cream)] p-1"
          >
            <button
              type="button"
              role="tab"
              id="catalog-mode-products"
              aria-selected={viewMode === 'products'}
              aria-controls="catalog-results"
              onClick={() => switchView('products')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-s)] text-xs sm:text-sm font-semibold transition-colors ${
                viewMode === 'products'
                  ? 'bg-[var(--color-ink)] text-white'
                  : 'text-[var(--color-wood)] hover:text-[var(--color-ink)]'
              }`}
            >
              <Package className="w-4 h-4" strokeWidth={1.5} />
              <span>Rechercher un produit</span>
            </button>
            <button
              type="button"
              role="tab"
              id="catalog-mode-vendors"
              aria-selected={viewMode === 'vendors'}
              aria-controls="catalog-results"
              onClick={() => switchView('vendors')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-s)] text-xs sm:text-sm font-semibold transition-colors ${
                viewMode === 'vendors'
                  ? 'bg-[var(--color-ink)] text-white'
                  : 'text-[var(--color-wood)] hover:text-[var(--color-ink)]'
              }`}
            >
              <Store className="w-4 h-4" strokeWidth={1.5} />
              <span>Rechercher un vendeur</span>
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[var(--color-ink)]">
            {viewMode === 'products'
              ? 'Créations de mobilier & pièces sur mesure'
              : 'Ateliers, artisanes & vendeurs certifiés'}
          </h1>

          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto lg:min-w-[460px]">
            <div className="relative flex-1">
              <label htmlFor="catalog-search" className="sr-only">
                {viewMode === 'products'
                  ? 'Rechercher un produit, une essence ou une dimension'
                  : 'Rechercher un atelier par nom, commune ou spécialité'}
              </label>
              <Search
                className="w-4 h-4 text-[var(--color-wood)] absolute left-3.5 top-1/2 -translate-y-1/2"
                strokeWidth={1.5}
              />
              <input
                id="catalog-search"
                type="search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  updateUrlParam('q', e.target.value);
                }}
                placeholder={
                  viewMode === 'products'
                    ? 'Nom du meuble, essence de bois, style...'
                    : 'Nom de l’atelier, commune, spécialité...'
                }
                className="w-full pl-10 pr-4 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm text-[var(--color-ink)] min-h-[44px]"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowFiltersMobile((v) => !v)}
              className="lg:hidden inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm font-medium text-[var(--color-ink)] min-h-[44px]"
            >
              <SlidersHorizontal className="w-4 h-4" strokeWidth={1.5} />
              <span>Filtres</span>
            </button>
          </div>
        </div>

        {/* Popular searches */}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--color-wood)]">
          <span>Recherches fréquentes :</span>
          {(viewMode === 'products' ? POPULAR_PRODUCT_SEARCHES : POPULAR_VENDOR_SEARCHES).map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => {
                setQ(term);
                updateUrlParam('q', term);
              }}
              className="px-2.5 py-1 rounded-[var(--radius-s)] bg-[var(--color-cream)] hover:bg-[#EAE3D2] text-[var(--color-ink)] transition-colors"
            >
              {term}
            </button>
          ))}
        </div>
      </div>

      {/* Category Tabs (Products View Only) */}
      {viewMode === 'products' && (
        <div className="mt-6 flex items-center gap-2 overflow-x-auto pb-2">
          <button
            type="button"
            onClick={() => {
              setCategory('all');
              updateUrlParam('category', 'all');
            }}
            className={`px-4 py-2 rounded-[var(--radius-s)] text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors min-h-[40px] ${
              category === 'all'
                ? 'bg-[var(--color-ink)] text-white'
                : 'bg-[var(--color-cream)] text-[var(--color-ink)] hover:bg-[#EAE3D2]'
            }`}
          >
            Toutes les catégories
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                setCategory(cat.slug);
                updateUrlParam('category', cat.slug);
              }}
              className={`px-4 py-2 rounded-[var(--radius-s)] text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors min-h-[40px] ${
                category === cat.slug
                  ? 'bg-[var(--color-ink)] text-white'
                  : 'bg-[var(--color-cream)] text-[var(--color-ink)] hover:bg-[#EAE3D2]'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Main Layout: Sidebar Filters + Results Grid */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <aside
          className={`lg:col-span-3 space-y-6 ${showFiltersMobile ? 'block' : 'hidden lg:block'}`}
          aria-label={viewMode === 'products' ? 'Filtres produits' : 'Filtres vendeurs'}
        >
          <div className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
                <Filter className="w-4 h-4 text-[var(--color-wood)]" strokeWidth={1.5} />
                <span>
                  {viewMode === 'products' ? 'Filtres produits' : 'Critères vendeurs'}
                </span>
              </span>
              <button
                type="button"
                onClick={resetAll}
                className="text-xs text-[var(--color-wood)] hover:text-[var(--color-ink)] underline"
              >
                Réinitialiser
              </button>
            </div>

            {viewMode === 'products' ? (
              <>
                <div>
                  <label htmlFor="filter-vendor" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Atelier / Vendeur
                  </label>
                  <select
                    id="filter-vendor"
                    value={vendorFilter}
                    onChange={(e) => {
                      setVendorFilter(e.target.value);
                      updateUrlParam('vendor', e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  >
                    <option value="all">Tous les ateliers</option>
                    {allVendors.map((v) => (
                      <option key={v.userId} value={v.slug}>
                        {v.shopName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="filter-mode" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Type d’achat
                  </label>
                  <select
                    id="filter-mode"
                    value={mode}
                    onChange={(e) => {
                      setMode(e.target.value);
                      updateUrlParam('mode', e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  >
                    <option value="all">Tout (Direct & Sur devis)</option>
                    <option value="direct">Achat direct (Tel quel)</option>
                    <option value="sur_devis">Sur mesure / Sur devis</option>
                  </select>
                </div>

                <div className="pt-2 border-t border-[var(--color-line)] space-y-2">
                  <span className="block text-xs font-medium text-[var(--color-wood)]">
                    Fourchette de prix (GNF)
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min={0}
                      step={500000}
                      value={minPrice}
                      onChange={(e) => {
                        setMinPrice(e.target.value);
                        updateUrlParam('minPrice', e.target.value);
                      }}
                      placeholder="Min GNF"
                      aria-label="Prix minimum GNF"
                      className="w-full px-2.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs font-mono-num"
                    />
                    <input
                      type="number"
                      min={0}
                      step={500000}
                      value={maxPrice}
                      onChange={(e) => {
                        setMaxPrice(e.target.value);
                        updateUrlParam('maxPrice', e.target.value);
                      }}
                      placeholder="Max GNF"
                      aria-label="Prix maximum GNF"
                      className="w-full px-2.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs font-mono-num"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-[var(--color-line)] space-y-2">
                  <label htmlFor="filter-min-qty" className="block text-xs font-medium text-[var(--color-wood)]">
                    Quantité disponible minimum
                  </label>
                  <select
                    id="filter-min-qty"
                    value={minQty}
                    onChange={(e) => {
                      setMinQty(e.target.value);
                      updateUrlParam('minQty', e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  >
                    <option value="">Toutes quantités</option>
                    <option value="1">Au moins 1 en stock</option>
                    <option value="2">Au moins 2 unités</option>
                    <option value="3">Au moins 3 unités</option>
                    <option value="5">Lots (5+ unités)</option>
                  </select>
                  <label className="flex items-center gap-2 text-xs text-[var(--color-ink)] pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inStockOnly}
                      onChange={(e) => {
                        setInStockOnly(e.target.checked);
                        updateUrlParam('inStockOnly', e.target.checked ? '1' : '');
                      }}
                    />
                    <span>Uniquement pièces disponibles de suite</span>
                  </label>
                </div>

                <div>
                  <label htmlFor="filter-material" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Matériau principal
                  </label>
                  <select
                    id="filter-material"
                    value={material}
                    onChange={(e) => {
                      setMaterial(e.target.value);
                      updateUrlParam('material', e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  >
                    <option value="all">Tous les matériaux</option>
                    <option value="noyer">Noyer de Guinée</option>
                    <option value="chene">Chêne massif</option>
                    <option value="iroko">Bois d’iroko</option>
                    <option value="cuir">Cuir pleine fleur</option>
                    <option value="laiton">Laiton & Bronze</option>
                    <option value="acier">Acier forgé</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="filter-badge" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Certification atelier
                  </label>
                  <select
                    id="filter-badge"
                    value={badge}
                    onChange={(e) => {
                      setBadge(e.target.value);
                      updateUrlParam('badge', e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  >
                    <option value="all">Toutes certifications</option>
                    {badges.map((b) => (
                      <option key={b.id} value={b.slug}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="filter-rating" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Note client minimum
                  </label>
                  <select
                    id="filter-rating"
                    value={minRating}
                    onChange={(e) => {
                      setMinRating(e.target.value);
                      updateUrlParam('minRating', e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  >
                    <option value="">Toutes notes</option>
                    <option value="4.5">4,5 / 5 et plus</option>
                    <option value="4">4,0 / 5 et plus</option>
                    <option value="3">3,0 / 5 et plus</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="filter-zone" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Zone de livraison
                  </label>
                  <select
                    id="filter-zone"
                    value={zone}
                    onChange={(e) => {
                      setZone(e.target.value);
                      updateUrlParam('zone', e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  >
                    <option value="all">Toutes zones</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="v-filter-sales" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Nombre de ventes effectuées
                  </label>
                  <select
                    id="v-filter-sales"
                    value={vendorMinSales}
                    onChange={(e) => {
                      setVendorMinSales(e.target.value);
                      updateUrlParam('minSales', e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  >
                    <option value="">Tous les ateliers</option>
                    <option value="1">Au moins 1 vente validée</option>
                    <option value="3">3 ventes et plus</option>
                    <option value="5">5 ventes et plus</option>
                    <option value="10">10 ventes et plus</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="v-filter-badge" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Certifications & sceaux
                  </label>
                  <select
                    id="v-filter-badge"
                    value={vendorBadge}
                    onChange={(e) => {
                      setVendorBadge(e.target.value);
                      updateUrlParam('vBadge', e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  >
                    <option value="all">Toutes certifications</option>
                    {badges.map((b) => (
                      <option key={b.id} value={b.slug}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="v-filter-rating" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Satisfaction client minimum
                  </label>
                  <select
                    id="v-filter-rating"
                    value={vendorMinRating}
                    onChange={(e) => {
                      setVendorMinRating(e.target.value);
                      updateUrlParam('vRating', e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  >
                    <option value="">Toutes notes</option>
                    <option value="4.5">4,5 / 5 et plus</option>
                    <option value="4">4,0 / 5 et plus</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="v-filter-location" className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Localisation / Commune
                  </label>
                  <select
                    id="v-filter-location"
                    value={vendorLocation}
                    onChange={(e) => {
                      setVendorLocation(e.target.value);
                      updateUrlParam('location', e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  >
                    <option value="all">Toutes localisations</option>
                    {locations.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center gap-2 text-xs text-[var(--color-ink)] pt-2 border-t border-[var(--color-line)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={vendorBankOnly}
                    onChange={(e) => {
                      setVendorBankOnly(e.target.checked);
                      updateUrlParam('bankTransferOnly', e.target.checked ? '1' : '');
                    }}
                  />
                  <span>Accepte le virement bancaire direct (grandes commandes)</span>
                </label>
              </>
            )}
          </div>
        </aside>

        {/* Results Panel */}
        <div className="lg:col-span-9">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            {viewMode === 'products' ? (
              <p className="text-sm text-[var(--color-wood)]">
                <span className="font-mono-num font-semibold text-[var(--color-ink)]">{total}</span>{' '}
                création{total > 1 ? 's' : ''} trouvée{total > 1 ? 's' : ''}
              </p>
            ) : (
              <p className="text-sm text-[var(--color-wood)]">
                <span className="font-mono-num font-semibold text-[var(--color-ink)]">
                  {vendorsTotal}
                </span>{' '}
                atelier{vendorsTotal > 1 ? 's' : ''} & vendeur{vendorsTotal > 1 ? 's' : ''} validé
                {vendorsTotal > 1 ? 's' : ''}
              </p>
            )}

            <div className="flex items-center gap-2">
              <label htmlFor="sort-select" className="text-xs text-[var(--color-wood)]">
                Trier par :
              </label>
              {viewMode === 'products' ? (
                <select
                  id="sort-select"
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    updateUrlParam('sort', e.target.value);
                  }}
                  className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                >
                  <option value="featured">Pertinence & Certifications</option>
                  <option value="price_asc">Prix croissant</option>
                  <option value="price_desc">Prix décroissant</option>
                  <option value="sales_desc">Meilleures ventes</option>
                  <option value="rating">Meilleures notes</option>
                  <option value="newest">Nouveautés</option>
                </select>
              ) : (
                <select
                  id="sort-select"
                  value={vendorSort}
                  onChange={(e) => {
                    setVendorSort(e.target.value);
                    updateUrlParam('vSort', e.target.value);
                  }}
                  className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                >
                  <option value="featured">Pertinence & Certifications</option>
                  <option value="sales_desc">Ventes effectuées (décroissant)</option>
                  <option value="rating">Meilleures notes clients</option>
                  <option value="products_desc">Catalogue le plus fourni</option>
                </select>
              )}
            </div>
          </div>

          <div
            id="catalog-results"
            role="tabpanel"
            aria-label="Résultats de recherche"
            className="mt-6"
          >
          {loading ? (
            <SkeletonGrid count={6} />
          ) : viewMode === 'products' ? (
            items.length === 0 ? (
              <div className="py-16 px-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] text-center">
                <X className="w-8 h-8 text-[var(--color-wood)] mx-auto mb-3" strokeWidth={1.5} />
                <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
                  Aucune création ne correspond à ces critères
                </h2>
                <p className="text-sm text-[var(--color-wood)] mt-1">
                  Élargissez vos filtres ou parcourez la liste de nos ateliers certifiés pour une réalisation sur mesure.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={resetAll}
                    className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm font-medium"
                  >
                    Réinitialiser les filtres
                  </button>
                  <button
                    type="button"
                    onClick={() => switchView('vendors')}
                    className="px-5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-medium text-[var(--color-ink)]"
                  >
                    Explorer les ateliers
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                  {items.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
                {items.length < total && (
                  <div className="mt-10 text-center">
                    <button
                      type="button"
                      onClick={() => setLimit((l) => l + 6)}
                      className="px-6 py-3 rounded-[var(--radius-s)] border border-[var(--color-ink)] text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-ink)] hover:text-white transition-colors"
                    >
                      Charger plus de pièces ({total - items.length} restantes)
                    </button>
                  </div>
                )}
              </>
            )
          ) : vendorsList.length === 0 ? (
            <div className="py-16 px-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] text-center">
              <X className="w-8 h-8 text-[var(--color-wood)] mx-auto mb-3" strokeWidth={1.5} />
              <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
                Aucun atelier ne correspond à ces critères
              </h2>
              <p className="text-sm text-[var(--color-wood)] mt-1">
                Modifiez les filtres de ventes, localisation ou certifications pour afficher davantage d’artisans.
              </p>
              <button
                type="button"
                onClick={resetAll}
                className="mt-5 px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm font-medium"
              >
                Réinitialiser les critères vendeurs
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {vendorsList.map((v) => (
                <article
                  key={v.userId}
                  className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] flex flex-col justify-between gap-5"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-[var(--color-wood)] flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                          <span className="truncate">{v.location}</span>
                          <span aria-hidden="true">·</span>
                          <span>{v.responseTimeLabel}</span>
                        </p>
                        <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)] mt-1">
                          {v.shopName}
                        </h2>
                      </div>
                      {v.isEmrodOfficial && (
                        <span className="text-[11px] font-semibold text-[var(--color-gold-deep)] shrink-0">
                          Atelier fondateur
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-[var(--color-body)] leading-relaxed line-clamp-2">
                      {v.description}
                    </p>

                    {/* Unboxed inline metadata metrics */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-wood)] pt-1">
                      <span className="font-mono-num font-semibold text-[var(--color-ink)]">
                        {v.completedSalesCount} vente{v.completedSalesCount > 1 ? 's' : ''} effectuée
                        {v.completedSalesCount > 1 ? 's' : ''}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">
                        {v.publishedProductsCount} création{v.publishedProductsCount > 1 ? 's' : ''}
                      </span>
                      {v.reviewCount > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 font-medium text-[var(--color-ink)]">
                            <Star
                              className="w-3.5 h-3.5 fill-[var(--color-gold)] text-[var(--color-gold)]"
                              strokeWidth={1.5}
                            />
                            <span className="tabular-nums">{v.averageRating.toFixed(1)}</span>
                            <span className="text-[var(--color-wood)]">({v.reviewCount})</span>
                          </span>
                        </>
                      )}
                      {v.bankTransferAvailable && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-[var(--color-ink)] font-medium">
                            <Building2 className="w-3.5 h-3.5 text-[var(--color-gold-deep)]" strokeWidth={1.5} />
                            <span>Virement bancaire</span>
                          </span>
                        </>
                      )}
                    </div>

                    {v.badges.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 pt-2">
                        {v.badges.map((b) => (
                          <CertificationSeal
                            key={b.id}
                            name={b.name}
                            icon={b.icon}
                            criteriaDescription={b.criteriaDescription}
                            publicDescription={b.publicDescription}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-[var(--color-line)] flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => navigate(`/artisan/${v.slug}`)}
                      className="flex-1 py-2.5 px-4 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold hover:bg-[var(--color-wood)] transition-colors inline-flex items-center justify-center gap-1.5"
                    >
                      <span>Voir la vitrine</span>
                      <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVendorFilter(v.slug);
                        setViewMode('products');
                        navigate(`/catalogue?vendor=${encodeURIComponent(v.slug)}`, {
                          replace: true,
                        });
                      }}
                      className="py-2.5 px-4 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-semibold text-[var(--color-ink)] hover:border-[var(--color-gold-deep)] hover:bg-[var(--color-cream)] transition-colors"
                    >
                      Ses créations ({v.publishedProductsCount})
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};
