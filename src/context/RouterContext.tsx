import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

interface RouterContextValue {
  pathname: string;
  search: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loc, setLoc] = useState(() => ({
    pathname: typeof window !== 'undefined' ? window.location.pathname : '/',
    search: typeof window !== 'undefined' ? window.location.search : '',
  }));

  useEffect(() => {
    const onPopState = () => {
      setLoc({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    const updateDom = () => {
      if (options?.replace) {
        window.history.replaceState({}, '', url.pathname + url.search);
      } else {
        window.history.pushState({}, '', url.pathname + url.search);
      }
      setLoc({ pathname: url.pathname, search: url.search });
      if (!url.hash) {
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      }
    };

    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    };
    const prefersReduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (doc.startViewTransition && !prefersReduced) {
      doc.startViewTransition(updateDom);
    } else {
      updateDom();
    }
  }, []);

  return (
    <RouterContext.Provider value={{ pathname: loc.pathname, search: loc.search, navigate }}>
      {children}
    </RouterContext.Provider>
  );
};

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used within RouterProvider');
  return ctx;
}
