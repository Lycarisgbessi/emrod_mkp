import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { CartItem, DeliveryZoneRule, ProductItem } from '../shared/types';
import { calculateDeliveryFee } from '../shared/domain';

const CART_STORAGE_KEY = 'emrod_guest_cart_v1';
const ZONE_STORAGE_KEY = 'emrod_guest_zone_v1';
const RECENT_PRODUCTS_KEY = 'emrod_recent_products_v1';

export interface FlyParticle {
  id: string;
  imageUrl: string;
  startX: number;
  startY: number;
}

interface CartContextValue {
  items: CartItem[];
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  selectedZoneId: string;
  setSelectedZoneId: (zoneId: string) => void;
  zones: DeliveryZoneRule[];
  setZones: (zones: DeliveryZoneRule[]) => void;
  addToCart: (product: ProductItem, quantity?: number, originRect?: DOMRect) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  totalItems: number;
  subtotalGnf: number;
  deliverySummary: { fee: number; pickupOnly: boolean; label: string };
  totalGnf: number;
  cartIconBounceKey: number;
  flyParticles: FlyParticle[];
  recentProducts: ProductItem[];
  rememberProduct: (product: ProductItem) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as CartItem[]) : [];
    } catch {
      return [];
    }
  });

  const [selectedZoneId, setSelectedZoneId] = useState<string>(() => {
    try {
      return localStorage.getItem(ZONE_STORAGE_KEY) || 'ratoma-sonfonia';
    } catch {
      return 'ratoma-sonfonia';
    }
  });

  const [recentProducts, setRecentProducts] = useState<ProductItem[]>(() => {
    try {
      const saved = localStorage.getItem(RECENT_PRODUCTS_KEY);
      return saved ? (JSON.parse(saved) as ProductItem[]) : [];
    } catch {
      return [];
    }
  });

  const [zones, setZones] = useState<DeliveryZoneRule[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [cartIconBounceKey, setCartIconBounceKey] = useState(0);
  const [flyParticles, setFlyParticles] = useState<FlyParticle[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Ignore storage quota issues
    }
  }, [items]);

  useEffect(() => {
    try {
      localStorage.setItem(ZONE_STORAGE_KEY, selectedZoneId);
    } catch {
      // Ignore
    }
  }, [selectedZoneId]);

  useEffect(() => {
    fetch('/api/zones')
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d.zones)) return;
        setZones(d.zones);
        // Resync: if the remembered zone was deactivated by admin, fall back to
        // the first active one so the UI and the checkout payload stay coherent.
        if (d.zones.length > 0 && !d.zones.some((z: { id: string }) => z.id === selectedZoneId)) {
          setSelectedZoneId(d.zones[0].id);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rememberProduct = useCallback((product: ProductItem) => {
    setRecentProducts((prev) => {
      const next = [product, ...prev.filter((p) => p.id !== product.id)].slice(0, 6);
      try {
        localStorage.setItem(RECENT_PRODUCTS_KEY, JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  const addToCart = useCallback(
    (product: ProductItem, quantity = 1, originRect?: DOMRect) => {
      const imageUrl =
        product.media.find((m) => m.type === 'image')?.url ||
        '/assets/seed/product_bibliotheque_noyer_1795278978216.jpg';

      setItems((prev) => {
        const existing = prev.find((i) => i.productId === product.id);
        if (existing) {
          return prev.map((i) =>
            i.productId === product.id
              ? { ...i, quantity: Math.min(i.maxQty, i.quantity + quantity) }
              : i
          );
        }
        return [
          ...prev,
          {
            productId: product.id,
            slug: product.slug,
            name: product.name,
            vendorId: product.vendorId,
            vendorName: product.vendor.shopName,
            priceGnf: product.priceGnf,
            weightKg: product.weightKg,
            imageUrl,
            quantity: Math.min(product.stockQty || 1, quantity),
            maxQty: Math.max(product.stockQty || 1, 1),
            deliveryConfig: product.deliveryConfig,
            bankTransferAvailable: Boolean(product.vendor.bankTransferAvailable),
          },
        ];
      });

      setCartIconBounceKey((k) => k + 1);

      // Funnel analytics: cart_add event (fire-and-forget, never blocks UX)
      void fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'cart_add', productId: product.id }),
        keepalive: true,
      }).catch(() => {});

      if (originRect) {
        const pid = `fly_${Date.now()}`;
        setFlyParticles((prev) => [
          ...prev,
          {
            id: pid,
            imageUrl,
            startX: originRect.left + originRect.width / 2,
            startY: originRect.top + originRect.height / 2,
          },
        ]);
        setTimeout(() => {
          setFlyParticles((prev) => prev.filter((p) => p.id !== pid));
        }, 650);
      }
    },
    []
  );

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((i) => i.productId !== productId));
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        i.productId === productId ? { ...i, quantity: Math.min(i.maxQty, quantity) } : i
      )
    );
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotalGnf = items.reduce((sum, i) => sum + i.priceGnf * i.quantity, 0);

  const activeZone =
    selectedZoneId === 'pickup' ? null : zones.find((z) => z.id === selectedZoneId) || zones[0] || null;
  const deliverySummary = calculateDeliveryFee(activeZone, items);
  const totalGnf = subtotalGnf + deliverySummary.fee;

  return (
    <CartContext.Provider
      value={{
        items,
        isOpen,
        openCart: () => setIsOpen(true),
        closeCart: () => setIsOpen(false),
        selectedZoneId,
        setSelectedZoneId,
        zones,
        setZones,
        addToCart,
        updateQuantity,
        removeItem,
        clearCart,
        totalItems,
        subtotalGnf,
        deliverySummary,
        totalGnf,
        cartIconBounceKey,
        flyParticles,
        recentProducts,
        rememberProduct,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
