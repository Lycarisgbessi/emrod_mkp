import React, { useEffect, useRef, useState } from 'react';
import { animate, motion, stagger, useScroll, useTransform } from 'motion/react';
import { ArrowRight, Search, ShieldCheck, X } from 'lucide-react';
import type { CategoryItem, ProductItem, VendorPublicSummary } from '../shared/types';
import { useRouter } from '../context/RouterContext';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { ProductCard } from '../components/ui/ProductCard';
import { SkeletonGrid } from '../components/ui/SkeletonGrid';
import { Reveal } from '../components/motion/Reveal';
import { CertificationSeal } from '../components/ui/CertificationSeal';
import heroShowroomImage from '../assets/images/hero_emrod_showroom_1795278978763.jpg';

interface HomePayload {
  editorial: {
    announcementText: string;
    heroTitle: string;
    heroSubtitle: string;
    heroCtaLabel: string;
    featuredTitle: string;
    featuredSubtitle: string;
  };
  categories: CategoryItem[];
  featured: ProductItem[];
  emrodVendor: VendorPublicSummary | null;
  vendors?: VendorPublicSummary[];
}

export const HomePage: React.FC = () => {
  const { navigate } = useRouter();
  const reduced = useReducedMotion();
  const [data, setData] = useState<HomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Instant search with 3-char suggestions (Products & Vendors)
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<ProductItem[]>([]);
  const [vendorSuggestions, setVendorSuggestions] = useState<VendorPublicSummary[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const heroSectionRef = useRef<HTMLElement | null>(null);
  const heroTextRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.title = 'EMROD — Marketplace Mobilier sur Mesure & Artisanat d’Exception';
    fetch('/api/homepage')
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Hero cascade reveal (motion stagger) + subtle scroll parallax (Tableau 9)
  const { scrollYProgress } = useScroll({
    target: heroSectionRef,
    offset: ['start start', 'end start'],
  });
  const heroImageY = useTransform(scrollYProgress, [0, 1], ['0%', reduced ? '0%' : '6%']);

  useEffect(() => {
    if (reduced || !data || !heroTextRef.current) return;
    const children = Array.from(
      heroTextRef.current.querySelectorAll<HTMLElement>('.hero-stagger')
    );
    children.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
    });
    const controls = animate(
      children,
      { opacity: 1, y: 0 },
      { duration: 0.4, delay: stagger(0.08), ease: [0.22, 1, 0.36, 1] }
    );
    return () => controls.stop();
  }, [data, reduced]);

  // Live search suggestions after 3 chars (Products + Ateliers)
  useEffect(() => {
    const q = searchTerm.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setVendorSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      Promise.all([
        fetch(`/api/products?q=${encodeURIComponent(q)}&limit=4`).then((r) => r.json()),
        fetch(`/api/vendors?q=${encodeURIComponent(q)}`).then((r) => r.json()),
      ])
        .then(([prodRes, vendRes]) => {
          setSuggestions(prodRes.items || []);
          setVendorSuggestions((vendRes.vendors || []).slice(0, 3));
        })
        .catch(() => {});
    }, 160);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    navigate(`/catalogue${searchTerm.trim() ? `?q=${encodeURIComponent(searchTerm.trim())}` : ''}`);
  };

  const editorial = data?.editorial || {
    announcementText: 'Livraison et montage assurés à Conakry · Paiement sécurisé Djomy',
    heroTitle: 'Des meubles uniques, sur mesure, créés par des femmes pour votre intérieur.',
    heroSubtitle:
      'Bois nobles de Guinée, cuirs pleine fleur et métaux texturés façonnés à la main dans notre atelier de Sonfonia et chez nos artisans certifiés.',
    heroCtaLabel: 'Explorer la collection',
    featuredTitle: 'Pièces signatures & éditions d’atelier',
    featuredSubtitle:
      'Chaque création allie justesse architecturale, durabilité absolue et finitions appliquées à la main.',
  };

  return (
    <div>
      {/* Slim dismissible top banner (<= 40px per 1_ecommerce_retail.md) */}
      {!bannerDismissed && editorial.announcementText && (
        <div className="bg-[var(--color-ink)] text-[var(--color-cream)] px-4 py-2 text-xs flex items-center justify-center relative min-h-[36px]">
          <p className="text-center pr-8 truncate">{editorial.announcementText}</p>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Masquer l’annonce"
            className="absolute right-3 p-1 text-[#C7BFA9] hover:text-white"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Section 1: Storefront Hero */}
      <section ref={heroSectionRef} className="bg-[var(--color-cream)] border-b border-[var(--color-line)] overflow-hidden">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-10 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
            <div ref={heroTextRef} className="lg:col-span-6 flex flex-col justify-center">
              <p className="hero-stagger text-xs sm:text-sm font-medium text-[var(--color-wood)]">
                EMROD SARL · Conakry, République de Guinée
              </p>

              <h1 className="hero-stagger mt-3 font-display text-4xl sm:text-5xl font-semibold text-[var(--color-ink)] leading-[1.12] tracking-tight">
                {editorial.heroTitle}
              </h1>

              <p className="hero-stagger mt-5 text-base sm:text-lg text-[var(--color-body)] leading-relaxed max-w-xl">
                {editorial.heroSubtitle}
              </p>

              {/* Immediate Search Bar + Primary CTA */}
              <form onSubmit={handleSearchSubmit} className="hero-stagger mt-7 relative max-w-xl">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <label htmlFor="home-search-input" className="sr-only">
                      Rechercher un meuble, une essence ou un atelier
                    </label>
                    <Search
                      className="w-4 h-4 text-[var(--color-wood)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      strokeWidth={1.5}
                    />
                    <input
                      id="home-search-input"
                      type="search"
                      value={searchTerm}
                      onFocus={() => setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 180)}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setShowSuggestions(true);
                      }}
                      placeholder="Rechercher noyer, bibliothèque, cuir..."
                      className="w-full pl-10 pr-4 py-3 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] text-sm text-[var(--color-ink)] placeholder:text-[var(--color-wood)]/70 min-h-[46px]"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-6 py-3 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 min-h-[46px]"
                  >
                    <span>{editorial.heroCtaLabel}</span>
                    <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                  </button>
                </div>

                {/* Live suggestions dropdown after 3 characters (Products & Ateliers) */}
                {showSuggestions && (suggestions.length > 0 || vendorSuggestions.length > 0) && (
                  <div className="absolute left-0 right-0 top-full mt-2 bg-[var(--color-surface)] border border-[var(--color-line)] rounded-[var(--radius-m)] shadow-[var(--shadow-modal)] z-30 overflow-hidden">
                    {suggestions.length > 0 && (
                      <div>
                        <p className="px-4 py-1.5 bg-[var(--color-cream)] text-[11px] font-semibold text-[var(--color-wood)] border-b border-[var(--color-line)]">
                          Créations & produits
                        </p>
                        {suggestions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onMouseDown={() => navigate(`/produit/${s.slug}`)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-cream)] transition-colors border-b border-[var(--color-line)]/50"
                          >
                            <img
                              src={s.media[0]?.url}
                              alt={s.name}
                              className="w-10 h-10 rounded object-cover shrink-0 bg-[var(--color-cream)]"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-[var(--color-ink)] truncate">{s.name}</p>
                              <p className="text-xs text-[var(--color-wood)] truncate">
                                {s.categoryName} · {s.vendor.shopName}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {vendorSuggestions.length > 0 && (
                      <div>
                        <p className="px-4 py-1.5 bg-[var(--color-cream)] text-[11px] font-semibold text-[var(--color-wood)] border-b border-[var(--color-line)]">
                          Vendeurs & ateliers certifiés
                        </p>
                        {vendorSuggestions.map((v) => (
                          <button
                            key={v.userId}
                            type="button"
                            onMouseDown={() => navigate(`/artisan/${v.slug}`)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-cream)] transition-colors border-b last:border-b-0 border-[var(--color-line)]/50"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-[var(--color-ink)] truncate">
                                {v.shopName}
                              </p>
                              <p className="text-xs text-[var(--color-wood)] truncate">
                                {v.location} · {v.completedSalesCount} vente{v.completedSalesCount > 1 ? 's' : ''} · {v.badges.length} sceau(x)
                              </p>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-[var(--color-wood)] shrink-0" strokeWidth={1.5} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </form>

              {/* Category Quick Links */}
              {data?.categories && (
                <div className="hero-stagger mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs sm:text-sm text-[var(--color-wood)]">
                  {data.categories.slice(0, 5).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => navigate(`/catalogue?category=${encodeURIComponent(cat.slug)}`)}
                      className="hover:text-[var(--color-ink)] underline underline-offset-4 decoration-[var(--color-line)] hover:decoration-[var(--color-gold-deep)] transition-colors whitespace-nowrap"
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-72 sm:h-96 lg:h-full min-h-[340px] rounded-[var(--radius-m)] overflow-hidden bg-[#EAE3D2] shadow-[var(--shadow-elevated)]">
                <motion.img
                  src={heroShowroomImage}
                  alt="Showroom EMROD SARL — mobilier sur mesure en bois nobles et cuir pleine fleur"
                  style={{ y: heroImageY }}
                  className="w-full h-full object-cover scale-[1.03]"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Featured Collection Grid */}
      <section className="max-w-[1440px] mx-auto px-4 sm:px-8 py-14 lg:py-20">
        <Reveal>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-8 border-b border-[var(--color-line)]">
            <div>
              <h2 className="font-display text-3xl sm:text-4xl font-semibold text-[var(--color-ink)]">
                {editorial.featuredTitle}
              </h2>
              <p className="mt-2 text-sm sm:text-base text-[var(--color-wood)] max-w-2xl">
                {editorial.featuredSubtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/catalogue')}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)] hover:text-[var(--color-wood)] transition-colors whitespace-nowrap shrink-0"
            >
              <span>Voir tout le catalogue</span>
              <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </Reveal>

        <div className="mt-8">
          {loading ? (
            <SkeletonGrid count={6} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
              {(data?.featured || []).map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Section 3: Craftsmanship Story & Certified Women Artisans */}
      <section className="bg-[var(--color-cream)] border-y border-[var(--color-line)]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-14 lg:py-20">
          <Reveal>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
              <div className="lg:col-span-6">
                <div className="h-72 sm:h-96 lg:h-full rounded-[var(--radius-m)] overflow-hidden bg-[#EAE3D2] shadow-[var(--shadow-rest)]">
                  <img
                    src="/assets/seed/atelier_femmes_artisanes_1795278979185.jpg"
                    alt="Équipe de femmes artisanes EMROD façonnant un meuble en noyer à Conakry"
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>

              <div className="lg:col-span-6 flex flex-col justify-center">
                <p className="text-xs sm:text-sm font-medium text-[var(--color-wood)]">
                  Savoir-faire féminin · Atelier Sonfonia, Conakry
                </p>
                <h2 className="mt-2 font-display text-3xl sm:text-4xl font-semibold text-[var(--color-ink)]">
                  Le processus sur mesure en quatre temps
                </h2>
                <p className="mt-4 text-sm sm:text-base text-[var(--color-body)] leading-relaxed">
                  De la sélection des bois nobles guinéens jusqu’au montage chez vous, chaque pièce
                  répond à une exigence de finition appliquée à la main et de transparence totale.
                </p>

                <ol className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <li className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)]">
                    <span className="font-mono-num text-xs font-semibold text-[var(--color-gold-deep)]">
                      01. Matériaux nobles
                    </span>
                    <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
                      Choix du bois & du cuir
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-body)]">
                      Chêne, noyer, cuirs pleine fleur et métaux texturés de fournisseurs éthiques.
                    </p>
                  </li>
                  <li className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)]">
                    <span className="font-mono-num text-xs font-semibold text-[var(--color-gold-deep)]">
                      02. Plans & Croquis
                    </span>
                    <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
                      Validation du design
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-body)]">
                      Dimensions sur mesure et validation des croquis détaillés avant fabrication.
                    </p>
                  </li>
                  <li className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)]">
                    <span className="font-mono-num text-xs font-semibold text-[var(--color-gold-deep)]">
                      03. Atelier Sonfonia
                    </span>
                    <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
                      Façonnage à la main
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-body)]">
                      Assemblages durables et finitions cire et huile par nos femmes artisanes.
                    </p>
                  </li>
                  <li className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)]">
                    <span className="font-mono-num text-xs font-semibold text-[var(--color-gold-deep)]">
                      04. Suivi sans compte
                    </span>
                    <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
                      Livraison & Montage
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-body)]">
                      Suivi horodaté via votre lien personnel et installation soignée à domicile.
                    </p>
                  </li>
                </ol>

                {data?.emrodVendor && (
                  <div className="mt-7 pt-6 border-t border-[var(--color-line)] flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {data.emrodVendor.badges.map((b) => (
                        <CertificationSeal
                          key={b.id}
                          name={b.name}
                          icon={b.icon}
                          criteriaDescription={b.criteriaDescription}
                          publicDescription={b.publicDescription}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/devenir-vendeur')}
                      className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)] hover:text-[var(--color-wood)]"
                    >
                      <ShieldCheck className="w-4 h-4 text-[var(--color-gold-deep)]" strokeWidth={1.5} />
                      <span>Rejoindre les ateliers certifiés</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {data?.vendors && data.vendors.length > 0 && (
              <div className="mt-10 pt-8 border-t border-[var(--color-line)] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-xl font-semibold text-[var(--color-ink)]">
                    Ateliers & artisans validés ({data.vendors.length})
                  </h3>
                  <div className="flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      onClick={() => navigate('/catalogue?view=vendors')}
                      className="text-xs font-semibold text-[var(--color-ink)] hover:text-[var(--color-wood)] underline underline-offset-4"
                    >
                      Rechercher un atelier par ventes & certifications
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/devenir-vendeur')}
                      className="text-xs font-semibold text-[var(--color-wood)] hover:text-[var(--color-ink)] underline underline-offset-4"
                    >
                      Proposer votre atelier
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {data.vendors.map((v) => (
                    <button
                      key={v.userId}
                      type="button"
                      onClick={() => navigate(`/artisan/${v.slug}`)}
                      className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-gold-deep)] text-left transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-display text-base font-semibold text-[var(--color-ink)] truncate">
                          {v.shopName}
                        </p>
                        <p className="text-xs text-[var(--color-wood)] truncate mt-0.5">
                          {v.location} · {v.badges.length} sceau(x)
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-[var(--color-wood)] shrink-0" strokeWidth={1.5} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Reveal>
        </div>
      </section>
    </div>
  );
};
