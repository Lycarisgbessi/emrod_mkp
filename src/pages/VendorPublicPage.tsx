import React, { useEffect, useState } from 'react';
import { Clock, MapPin, Star } from 'lucide-react';
import type { ProductItem, VendorPublicSummary } from '../shared/types';
import { ProductCard } from '../components/ui/ProductCard';
import { CertificationSeal } from '../components/ui/CertificationSeal';
import { SkeletonGrid } from '../components/ui/SkeletonGrid';

interface VendorPayload {
  vendor: VendorPublicSummary;
  products: ProductItem[];
  reviews: Array<{
    id: string;
    buyerName: string;
    rating: number;
    comment: string;
    vendorReply: string;
    productName: string;
    createdAt: string;
  }>;
}

export const VendorPublicPage: React.FC<{ slug: string }> = ({ slug }) => {
  const [data, setData] = useState<VendorPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/vendors/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d);
        if (d?.vendor) document.title = `${d.vendor.shopName} — Atelier EMROD`;
      })
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-12">
        <SkeletonGrid count={3} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="font-display text-3xl text-[var(--color-ink)]">Atelier introuvable</h1>
      </div>
    );
  }

  const { vendor, products, reviews } = data;

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-10 lg:py-14 space-y-12">
      {/* Atelier Header */}
      <section className="p-6 sm:p-10 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-4">
          <div className="aspect-[16/10] rounded-[var(--radius-s)] overflow-hidden bg-[#EAE3D2]">
            <img src={vendor.logoUrl} alt={vendor.shopName} className="w-full h-full object-cover" />
          </div>
        </div>
        <div className="lg:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-wood)]">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" strokeWidth={1.5} />
              <span>{vendor.location}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" strokeWidth={1.5} />
              <span>{vendor.responseTimeLabel}</span>
            </span>
            {vendor.reviewCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-ink)]">
                  <Star className="w-3.5 h-3.5 fill-[var(--color-gold)] text-[var(--color-gold)]" strokeWidth={1.5} />
                  <span className="tabular-nums">{vendor.averageRating}/5 ({vendor.reviewCount} avis)</span>
                </span>
              </>
            )}
          </div>

          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[var(--color-ink)]">
            {vendor.shopName}
          </h1>
          <p className="text-sm sm:text-base text-[var(--color-body)] leading-relaxed">
            {vendor.story || vendor.description}
          </p>

          <div className="flex flex-wrap gap-2 pt-2">
            {vendor.badges.map((b) => (
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
      </section>

      {/* Catalog */}
      <section>
        <h2 className="font-display text-2xl sm:text-3xl font-semibold text-[var(--color-ink)] mb-6">
          Créations de l’atelier ({products.length})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      {/* Verified Reviews */}
      {reviews.length > 0 && (
        <section className="pt-8 border-t border-[var(--color-line)]">
          <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)] mb-6">
            Avis clients vérifiés
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {reviews.map((r) => (
              <div key={r.id} className="p-5 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)]">
                <div className="flex items-center justify-between text-xs text-[var(--color-wood)]">
                  <span className="font-semibold text-[var(--color-ink)]">{r.buyerName} · {r.productName}</span>
                  <span className="tabular-nums font-semibold text-[var(--color-ink)]">★ {r.rating}/5</span>
                </div>
                <p className="mt-2 text-sm text-[var(--color-body)]">{r.comment}</p>
                {r.vendorReply && (
                  <p className="mt-2 text-xs text-[var(--color-wood)]">
                    <strong>Réponse :</strong> {r.vendorReply}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
