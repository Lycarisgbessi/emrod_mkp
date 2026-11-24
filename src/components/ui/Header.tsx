import React, { useEffect, useState } from 'react';
import { Menu, ShoppingBag, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCart } from '../../context/CartContext';
import { useRouter } from '../../context/RouterContext';

export const Header: React.FC = () => {
  const { pathname, navigate } = useRouter();
  const { totalItems, openCart, cartIconBounceKey } = useCart();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navItems = [
    { label: 'Catalogue', href: '/catalogue', match: (p: string) => p.startsWith('/catalogue') || p.startsWith('/produit') },
    { label: 'Sur mesure', href: '/catalogue?mode=sur_devis', match: () => false },
    { label: 'Artisans', href: '/artisan/emrod-sarl', match: (p: string) => p.startsWith('/artisan') || p.startsWith('/devenir-vendeur') },
    { label: 'Suivi', href: '/suivi', match: (p: string) => p.startsWith('/suivi') },
    { label: 'Espace Pro', href: '/vendeur', match: (p: string) => p.startsWith('/vendeur') || p.startsWith('/admin') },
  ];

  const handleNav = (e: React.MouseEvent, href: string) => {
    e.preventDefault();
    setMobileOpen(false);
    navigate(href);
  };

  return (
    <>
      <header
        className={`sticky top-0 z-40 w-full bg-[var(--color-surface)]/95 backdrop-blur-md border-b border-[var(--color-line)] transition-all duration-200 ${
          scrolled ? 'py-2.5 shadow-[var(--shadow-rest)]' : 'py-4'
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="/"
            onClick={(e) => handleNav(e, '/')}
            className="font-display text-2xl font-bold tracking-tight text-[var(--color-ink)] whitespace-nowrap shrink-0"
          >
            EMROD
          </a>

          {/* Zone 2: 5 concise single-line text navigation links */}
          <nav aria-label="Navigation principale" className="hidden lg:flex items-center gap-7">
            {navItems.map((item) => {
              const active = item.match(pathname);
              return (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={(e) => handleNav(e, item.href)}
                  data-active={active ? 'true' : 'false'}
                  className="emrod-nav-link text-sm font-medium text-[var(--color-body)] hover:text-[var(--color-ink)] transition-colors whitespace-nowrap shrink-0 py-1"
                >
                  {item.label}
                </a>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action (Cart) + mobile drawer trigger */}
          <div className="flex items-center gap-3 shrink-0">
            <motion.button
              key={cartIconBounceKey}
              initial={cartIconBounceKey > 0 ? { scale: 1.14 } : false}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 20 }}
              id="emrod-header-cart-btn"
              type="button"
              onClick={openCart}
              aria-label={`Ouvrir le panier (${totalItems} article${totalItems > 1 ? 's' : ''})`}
              className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-[var(--color-surface)] hover:bg-[var(--color-wood)] transition-colors text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <ShoppingBag className="w-4 h-4 text-[var(--color-gold)]" strokeWidth={1.5} />
              <span>Panier</span>
              <span className="font-mono-num text-xs px-1.5 py-0.5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] font-semibold">
                {totalItems}
              </span>
            </motion.button>

            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Ouvrir le menu"
              aria-expanded={mobileOpen}
              className="lg:hidden p-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-[var(--color-ink)] min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <Menu className="w-5 h-5" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu mobile">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-[#1A1A1A]/50"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: '100%', scale: 0.98 }}
              animate={{ x: 0, scale: 1 }}
              exit={{ x: '100%', scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-xs bg-[var(--color-surface)] p-6 shadow-[var(--shadow-modal)] flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-[var(--color-line)]">
                  <span className="font-display text-xl font-bold text-[var(--color-ink)]">EMROD</span>
                  <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Fermer le menu"
                    className="p-2 text-[var(--color-wood)] hover:text-[var(--color-ink)] min-w-[44px] min-h-[44px] flex items-center justify-center"
                  >
                    <X className="w-5 h-5" strokeWidth={1.5} />
                  </button>
                </div>

                <nav className="mt-6 flex flex-col gap-2">
                  {navItems.map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      onClick={(e) => handleNav(e, item.href)}
                      className="px-3 py-3 rounded-[var(--radius-s)] text-base font-medium text-[var(--color-ink)] hover:bg-[var(--color-cream)] transition-colors"
                    >
                      {item.label}
                    </a>
                  ))}
                  <div className="my-2 border-t border-[var(--color-line)]" />
                  <a
                    href="/devenir-vendeur"
                    onClick={(e) => handleNav(e, '/devenir-vendeur')}
                    className="px-3 py-3 rounded-[var(--radius-s)] text-sm font-medium text-[var(--color-wood)] hover:bg-[var(--color-cream)]"
                  >
                    Devenir vendeur partenaire
                  </a>
                  <a
                    href="/alertes"
                    onClick={(e) => handleNav(e, '/alertes')}
                    className="px-3 py-3 rounded-[var(--radius-s)] text-sm font-medium text-[var(--color-wood)] hover:bg-[var(--color-cream)]"
                  >
                    Alertes nouveautés & PWA
                  </a>
                  <a
                    href="/admin"
                    onClick={(e) => handleNav(e, '/admin')}
                    className="px-3 py-3 rounded-[var(--radius-s)] text-sm font-medium text-[var(--color-wood)] hover:bg-[var(--color-cream)]"
                  >
                    Administration EMROD
                  </a>
                </nav>
              </div>

              <div className="pt-4 border-t border-[var(--color-line)] text-xs text-[var(--color-wood)]">
                <p>T7, Corniche Nord, Sonfonia Centre</p>
                <p className="mt-1">Conakry, Guinée · +224 623 88 59 59</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
