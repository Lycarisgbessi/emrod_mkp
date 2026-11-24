import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { useRouter } from '../../context/RouterContext';
import { formatGNF } from '../../shared/domain';

export const CartDrawer: React.FC = () => {
  const {
    items,
    isOpen,
    closeCart,
    updateQuantity,
    removeItem,
    selectedZoneId,
    setSelectedZoneId,
    zones,
    subtotalGnf,
    deliverySummary,
    totalGnf,
    flyParticles,
  } = useCart();
  const { navigate } = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) closeCart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeCart]);

  const cartBtnRect =
    typeof document !== 'undefined'
      ? document.getElementById('emrod-header-cart-btn')?.getBoundingClientRect()
      : null;

  return (
    <>
      {/* Fly-to-cart particles (Tableau 9) */}
      <div className="fixed inset-0 pointer-events-none z-50">
        {flyParticles.map((p) => {
          const destX = cartBtnRect ? cartBtnRect.left + cartBtnRect.width / 2 : window.innerWidth - 64;
          const destY = cartBtnRect ? cartBtnRect.top + cartBtnRect.height / 2 : 28;
          return (
            <motion.img
              key={p.id}
              src={p.imageUrl}
              alt=""
              initial={{
                x: p.startX - 24,
                y: p.startY - 24,
                scale: 1,
                opacity: 0.95,
              }}
              animate={{
                x: destX - 16,
                y: destY - 16,
                scale: 0.25,
                opacity: 0.2,
              }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="fixed top-0 left-0 w-12 h-12 rounded-[var(--radius-s)] object-cover border border-[var(--color-gold)] shadow-lg"
            />
          );
        })}
      </div>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Votre panier EMROD">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={closeCart}
              className="fixed inset-0 bg-[#1A1A1A]/55"
            />

            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
              className="relative w-full sm:max-w-md bg-[var(--color-surface)] h-full shadow-[var(--shadow-modal)] flex flex-col justify-between z-10"
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-[var(--color-line)] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <ShoppingBag className="w-5 h-5 text-[var(--color-wood)]" strokeWidth={1.5} />
                  <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
                    Votre sélection
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeCart}
                  aria-label="Fermer le panier"
                  className="p-2 rounded-[var(--radius-s)] text-[var(--color-wood)] hover:text-[var(--color-ink)] min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <X className="w-5 h-5" strokeWidth={1.5} />
                </button>
              </div>

              {/* Items */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {items.length === 0 ? (
                  <div className="py-16 text-center">
                    <ShoppingBag className="w-10 h-10 text-[var(--color-line)] mx-auto mb-3" strokeWidth={1.5} />
                    <p className="font-display text-lg text-[var(--color-ink)]">Votre panier est vide</p>
                    <p className="text-sm text-[var(--color-wood)] mt-1">
                      Parcourez nos pièces en bois nobles, cuirs pleine fleur et métaux texturés.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        closeCart();
                        navigate('/catalogue');
                      }}
                      className="mt-5 px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm font-medium hover:bg-[var(--color-wood)] transition-colors"
                    >
                      Découvrir le catalogue
                    </button>
                  </div>
                ) : (
                  <AnimatePresence initial={false}>
                    {items.map((item) => (
                      <motion.div
                        key={item.productId}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="flex gap-4 pb-5 border-b border-[var(--color-line)]"
                      >
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-20 h-20 rounded-[var(--radius-s)] object-cover bg-[var(--color-cream)] shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[var(--color-wood)] truncate">{item.vendorName}</p>
                          <h3 className="text-sm font-semibold text-[var(--color-ink)] leading-snug mt-0.5">
                            {item.name}
                          </h3>
                          <p className="font-mono-num text-sm font-medium text-[var(--color-ink)] mt-1">
                            {formatGNF(item.priceGnf)}
                          </p>

                          <div className="mt-3 flex items-center justify-between">
                            <div className="inline-flex items-center border border-[var(--color-line)] rounded-[var(--radius-s)]">
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                                aria-label={`Diminuer la quantité de ${item.name}`}
                                className="p-1.5 text-[var(--color-ink)] hover:bg-[var(--color-cream)] min-w-[34px] min-h-[34px] flex items-center justify-center"
                              >
                                <Minus className="w-3.5 h-3.5" strokeWidth={1.5} />
                              </button>
                              <span className="px-2.5 text-xs font-mono-num font-semibold">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                                aria-label={`Augmenter la quantité de ${item.name}`}
                                className="p-1.5 text-[var(--color-ink)] hover:bg-[var(--color-cream)] min-w-[34px] min-h-[34px] flex items-center justify-center"
                              >
                                <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => removeItem(item.productId)}
                              aria-label={`Retirer ${item.name}`}
                              className="p-1.5 text-[var(--color-wood)] hover:text-[var(--color-danger)] transition-colors"
                            >
                              <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>

              {/* Footer Totals & Zone Selector */}
              {items.length > 0 && (
                <div className="p-6 bg-[var(--color-cream)] border-t border-[var(--color-line)] space-y-4">
                  <div>
                    <label htmlFor="cart-zone-select" className="block text-xs font-medium text-[var(--color-wood)] mb-1.5">
                      Estimation livraison par zone
                    </label>
                    <select
                      id="cart-zone-select"
                      value={selectedZoneId}
                      onChange={(e) => setSelectedZoneId(e.target.value)}
                      className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm text-[var(--color-ink)]"
                    >
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name} ({z.estimatedDays})
                        </option>
                      ))}
                      <option value="pickup">Retrait en atelier Sonfonia (Gratuit)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[var(--color-wood)]">Sous-total pièces</span>
                      <span className="font-mono-num text-[var(--color-ink)]">{formatGNF(subtotalGnf)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-wood)]">Livraison estimée</span>
                      <span className="font-mono-num text-[var(--color-ink)]">
                        {deliverySummary.fee === 0 ? 'Gratuit' : formatGNF(deliverySummary.fee)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-[var(--color-line)] font-semibold text-base">
                      <span className="text-[var(--color-ink)]">Total estimé</span>
                      <span className="font-mono-num text-[var(--color-ink)]">{formatGNF(totalGnf)}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      closeCart();
                      navigate('/commander');
                    }}
                    className="w-full py-3 px-4 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors min-h-[44px]"
                  >
                    <span>Commander sans compte</span>
                    <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                  </button>
                  <p className="text-center text-xs text-[var(--color-wood)]">
                    Aucune inscription requise · Paiement Djomy en 1 écran
                  </p>
                </div>
              )}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
