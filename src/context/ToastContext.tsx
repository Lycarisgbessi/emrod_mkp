import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}

interface ToastContextValue {
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Clear any pending dismissal timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = `tst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      const timer = setTimeout(() => {
        timersRef.current.delete(timer);
        removeToast(id);
      }, 4500);
      timersRef.current.add(timer);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0 no-print"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
              className="pointer-events-auto flex items-start gap-3 rounded-[var(--radius-m)] bg-[var(--color-ink)] text-[var(--color-surface)] p-4 shadow-[var(--shadow-modal)] border border-[var(--color-wood)]/30"
            >
              {t.type === 'success' && (
                <CheckCircle2 className="w-5 h-5 shrink-0 text-[var(--color-gold)] mt-0.5" strokeWidth={1.5} />
              )}
              {t.type === 'error' && (
                <AlertCircle className="w-5 h-5 shrink-0 text-[#E67E73] mt-0.5" strokeWidth={1.5} />
              )}
              {t.type === 'info' && (
                <Info className="w-5 h-5 shrink-0 text-[var(--color-gold)] mt-0.5" strokeWidth={1.5} />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--color-surface)]">{t.title}</p>
                {t.description && (
                  <p className="text-xs text-[#E5DFD2] mt-0.5 leading-relaxed">{t.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                aria-label="Fermer la notification"
                className="text-[#C7BFA9] hover:text-white p-1 shrink-0"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
