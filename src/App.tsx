/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { Suspense, lazy } from 'react';
import { WifiOff } from 'lucide-react';
import { CartProvider } from './context/CartContext';
import { RouterProvider, useRouter } from './context/RouterContext';
import { ToastProvider } from './context/ToastContext';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { Header } from './components/ui/Header';
import { Footer } from './components/ui/Footer';
import { CartDrawer } from './components/ui/CartDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HomePage } from './pages/HomePage';
import { LegalPage, NotFoundPage } from './pages/LegalPage';

// Route-level code splitting: each page ships in its own chunk instead of one
// monolithic bundle (portals, checkout and tracking are only loaded on demand).
const CatalogPage = lazy(() =>
  import('./pages/CatalogPage').then((m) => ({ default: m.CatalogPage }))
);
const ProductDetailPage = lazy(() =>
  import('./pages/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage }))
);
const VendorPublicPage = lazy(() =>
  import('./pages/VendorPublicPage').then((m) => ({ default: m.VendorPublicPage }))
);
const CheckoutPage = lazy(() =>
  import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage }))
);
const OrderTrackingPage = lazy(() =>
  import('./pages/OrderTrackingPage').then((m) => ({ default: m.OrderTrackingPage }))
);
const QuoteTrackingPage = lazy(() =>
  import('./pages/QuoteTrackingPage').then((m) => ({ default: m.QuoteTrackingPage }))
);
const VendorPortalPage = lazy(() =>
  import('./pages/VendorPortalPage').then((m) => ({ default: m.VendorPortalPage }))
);
const AdminPortalPage = lazy(() =>
  import('./pages/AdminPortalPage').then((m) => ({ default: m.AdminPortalPage }))
);
const AlertsPreferencesPage = lazy(() =>
  import('./pages/AlertsPreferencesPage').then((m) => ({ default: m.AlertsPreferencesPage }))
);
const PaymentLinkPage = lazy(() =>
  import('./pages/PaymentLinkPage').then((m) => ({ default: m.PaymentLinkPage }))
);

const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;
  return (
    <div
      role="status"
      className="bg-[var(--color-ink)] text-[var(--color-gold)] px-4 py-2 text-xs flex items-center justify-center gap-2 border-b border-[var(--color-wood)]/30 no-print"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Mode hors connexion : le catalogue consulté reste accessible en cache local.</span>
    </div>
  );
};

/** Maintenance notice driven by the admin "Système & Maintenance" tab (GET /api/rules/public). */
const MaintenanceBanner: React.FC = () => {
  const [maintenance, setMaintenance] = React.useState<{ enabled: boolean; message: string } | null>(null);
  React.useEffect(() => {
    fetch('/api/rules/public')
      .then((r) => r.json())
      .then((d) => {
        if (d?.maintenance?.enabled) setMaintenance(d.maintenance);
      })
      .catch(() => {});
  }, []);
  if (!maintenance?.enabled) return null;
  return (
    <div
      role="alert"
      className="bg-[var(--color-gold-deep)] text-white px-4 py-2.5 text-xs flex items-center justify-center gap-2 text-center no-print"
    >
      <span className="font-semibold shrink-0">Maintenance en cours</span>
      <span className="opacity-90 truncate">
        {maintenance.message || 'Le catalogue est momentanément fermé — retour imminent.'}
      </span>
    </div>
  );
};

const RouteFallback: React.FC = () => (
  <div className="max-w-7xl mx-auto px-4 py-10 space-y-6">
    <div className="h-10 w-72 rounded-[var(--radius-s)] emrod-skeleton" />
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <div className="h-72 rounded-[var(--radius-m)] emrod-skeleton" />
      <div className="h-72 rounded-[var(--radius-m)] emrod-skeleton" />
      <div className="h-72 rounded-[var(--radius-m)] emrod-skeleton" />
    </div>
  </div>
);

const RouteView: React.FC = () => {
  const { pathname } = useRouter();
  const cleanPath = pathname !== '/' ? pathname.replace(/\/+$/, '') : '/';

  let view: React.ReactNode;
  if (cleanPath === '/') view = <HomePage />;
  else if (cleanPath === '/catalogue') view = <CatalogPage />;
  else if (cleanPath === '/commander') view = <CheckoutPage />;
  else if (cleanPath === '/suivi') view = <OrderTrackingPage />;
  else if (cleanPath === '/devis') view = <QuoteTrackingPage />;
  else if (cleanPath === '/devenir-vendeur') view = <VendorPortalPage mode="register" />;
  else if (cleanPath === '/vendeur') view = <VendorPortalPage mode="workspace" />;
  else if (cleanPath === '/admin') view = <AdminPortalPage />;
  else if (cleanPath === '/alertes') view = <AlertsPreferencesPage />;
  else if (cleanPath.startsWith('/produit/')) {
    const slug = decodeURIComponent(cleanPath.slice('/produit/'.length));
    view = <ProductDetailPage slug={slug} />;
  } else if (cleanPath.startsWith('/artisan/')) {
    const slug = decodeURIComponent(cleanPath.slice('/artisan/'.length));
    view = <VendorPublicPage slug={slug} />;
  } else if (cleanPath.startsWith('/suivi/')) {
    const token = decodeURIComponent(cleanPath.slice('/suivi/'.length));
    view = <OrderTrackingPage token={token} />;
  } else if (cleanPath.startsWith('/devis/')) {
    const token = decodeURIComponent(cleanPath.slice('/devis/'.length));
    view = <QuoteTrackingPage token={token} />;
  } else if (cleanPath.startsWith('/djomy-lien/')) {
    const ref = decodeURIComponent(cleanPath.slice('/djomy-lien/'.length));
    view = <PaymentLinkPage djomyRef={ref} />;
  } else if (cleanPath.startsWith('/mentions/')) {
    const pageKey = decodeURIComponent(cleanPath.slice('/mentions/'.length));
    view = <LegalPage pageKey={pageKey} />;
  } else {
    view = <NotFoundPage />;
  }

  // Keyed by path: resets the error boundary when the user navigates away
  return (
    <ErrorBoundary key={cleanPath}>
      <Suspense fallback={<RouteFallback />}>{view}</Suspense>
    </ErrorBoundary>
  );
};

export default function App() {
  return (
    <RouterProvider>
      <ToastProvider>
        <CartProvider>
          <div className="min-h-screen flex flex-col bg-[var(--color-surface)] text-[var(--color-body)]">
            <OfflineBanner />
            <MaintenanceBanner />
            <Header />
            <main className="flex-1">
              <RouteView />
            </main>
            <Footer />
            <CartDrawer />
          </div>
        </CartProvider>
      </ToastProvider>
    </RouterProvider>
  );
}
