import React, { useState } from 'react';
import { ShieldCheck, ShoppingBag, Star, Wrench } from 'lucide-react';
import type { ProductItem } from '../../shared/types';
import { formatGNF } from '../../shared/domain';
import { useCart } from '../../context/CartContext';
import { useRouter } from '../../context/RouterContext';
import { useToast } from '../../context/ToastContext';

interface ProductCardProps {
  product: ProductItem;
  dense?: boolean;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, dense = false }) => {
  const { navigate } = useRouter();
  const { addToCart } = useCart();
  const { addToast } = useToast();
  const [imgError, setImgError] = useState(false);

  const primaryMedia = product.media.find((m) => m.type === 'image') || product.media[0];
  const primaryBadge = product.vendor.badges[0];

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(`/produit/${product.slug}`);
  };

  const handleAdd = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    addToCart(product, 1, rect);
    addToast({
      type: 'success',
      title: 'Ajouté au panier',
      description: product.name,
    });
  };

  return (
    <article className="emrod-product-card group rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] overflow-hidden flex flex-col justify-between">
      <div>
        <a
          href={`/produit/${product.slug}`}
          onClick={handleOpen}
          className="block relative aspect-[4/3] bg-[var(--color-cream)] overflow-hidden"
        >
          {primaryMedia && !imgError ? (
            <img
              src={primaryMedia.url}
              alt={primaryMedia.altText || product.name}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="emrod-product-img w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-[var(--color-cream)] to-[#EAE3D2]">
              <Wrench className="w-8 h-8 text-[var(--color-wood)] mb-2" strokeWidth={1.5} />
              <span className="font-display text-sm text-[var(--color-ink)]">{product.name}</span>
            </div>
          )}
        </a>

        <div className={dense ? 'p-4' : 'p-5'}>
          {/* Unboxed metadata with typographic separator */}
          <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-wood)]">
            <span className="truncate">
              {product.categoryName} · {product.vendor.shopName}
            </span>
            {product.reviewCount > 0 && (
              <span className="inline-flex items-center gap-1 shrink-0 font-medium text-[var(--color-ink)]">
                <Star className="w-3.5 h-3.5 fill-[var(--color-gold)] text-[var(--color-gold)]" strokeWidth={1.5} />
                <span className="tabular-nums">{product.averageRating.toFixed(1)}</span>
              </span>
            )}
          </div>

          <h3 className="mt-2 font-display text-lg font-semibold text-[var(--color-ink)] leading-snug line-clamp-2">
            <a href={`/produit/${product.slug}`} onClick={handleOpen} className="hover:text-[var(--color-wood)] transition-colors">
              {product.name}
            </a>
          </h3>

          <p className="mt-1.5 text-xs text-[var(--color-body)]/80 line-clamp-1">
            {product.materials}
          </p>

          {primaryBadge && (
            <div className="mt-2.5 flex items-center gap-1.5 text-xs text-[var(--color-wood)]">
              <ShieldCheck className="w-3.5 h-3.5 text-[var(--color-gold-deep)] shrink-0" strokeWidth={1.5} />
              <span>{primaryBadge.name}</span>
              {product.isUniquePiece && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Pièce unique</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={`${dense ? 'px-4 pb-4' : 'px-5 pb-5'} pt-2 flex items-center justify-between gap-3 border-t border-[var(--color-line)]/60`}>
        <div>
          {product.mode === 'sur_devis' ? (
            <span className="text-sm font-semibold text-[var(--color-wood)]">
              Sur devis · 4 étapes
            </span>
          ) : (
            <div className="flex flex-col">
              <span className="font-mono-num text-sm sm:text-base font-semibold text-[var(--color-ink)]">
                {formatGNF(product.priceGnf)}
              </span>
              {product.compareAtPriceGnf && product.compareAtPriceGnf > product.priceGnf && (
                <span className="font-mono-num text-xs text-[var(--color-wood)] line-through">
                  {formatGNF(product.compareAtPriceGnf)}
                </span>
              )}
            </div>
          )}
        </div>

        {product.mode === 'sur_devis' ? (
          <button
            type="button"
            onClick={handleOpen}
            className="px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-ink)] text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-ink)] hover:text-white transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            Démarrer un projet
          </button>
        ) : (
          <button
            type="button"
            onClick={handleAdd}
            disabled={product.stockQty <= 0}
            aria-label={`Ajouter ${product.name} au panier`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white disabled:opacity-40 transition-colors text-xs font-semibold whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <ShoppingBag className="w-3.5 h-3.5" strokeWidth={1.5} />
            <span>{product.stockQty > 0 ? 'Ajouter' : 'Épuisé'}</span>
          </button>
        )}
      </div>
    </article>
  );
};
