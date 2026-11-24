import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white transition-colors whitespace-nowrap shrink-0 ${className}`}
      >
        <Download className="w-4 h-4" strokeWidth={1.5} />
        <span>Installer l’application EMROD</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-[var(--radius-s)] border border-[var(--color-line)] text-[var(--color-ink)] hover:border-[var(--color-gold-deep)] transition-colors whitespace-nowrap shrink-0 ${className}`}
      >
        <Smartphone className="w-4 h-4 text-[var(--color-wood)]" strokeWidth={1.5} />
        <span>{isIOS ? 'Installer sur iPhone' : 'Application mobile (PWA)'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1A1A]/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
        >
          <div className="w-full max-w-md rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] p-6 shadow-[var(--shadow-modal)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="pwa-guide-title" className="text-xl font-semibold text-[var(--color-ink)]">
                  Installer EMROD sur votre téléphone
                </h3>
                <p className="text-xs text-[var(--color-wood)] mt-1">
                  Accès rapide, mode hors ligne et alertes nouveaux produits
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Fermer le guide d’installation"
                className="p-1.5 text-[var(--color-wood)] hover:text-[var(--color-ink)]"
              >
                <X className="w-5 h-5" strokeWidth={1.5} />
              </button>
            </div>

            <div className="mt-5 space-y-4 text-sm text-[var(--color-body)]">
              <div className="p-3.5 rounded-[var(--radius-s)] bg-[var(--color-cream)]">
                <p className="font-semibold text-[var(--color-ink)]">Sur iPhone / iPad (Safari)</p>
                <ol className="mt-1.5 list-decimal list-inside space-y-1 text-xs leading-relaxed">
                  <li>Touchez l’icône <strong>Partager</strong> en bas de l’écran Safari.</li>
                  <li>Faites défiler et choisissez <strong>Sur l’écran d’accueil</strong>.</li>
                  <li>Confirmez en touchant <strong>Ajouter</strong>.</li>
                </ol>
              </div>

              <div className="p-3.5 rounded-[var(--radius-s)] bg-[var(--color-cream)]">
                <p className="font-semibold text-[var(--color-ink)]">Sur Android (Chrome / Edge)</p>
                <ol className="mt-1.5 list-decimal list-inside space-y-1 text-xs leading-relaxed">
                  <li>Ouvrez le menu du navigateur (trois points en haut à droite).</li>
                  <li>Sélectionnez <strong>Installer l’application</strong> ou <strong>Ajouter à l’écran d’accueil</strong>.</li>
                </ol>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-6 w-full py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-[var(--color-surface)] text-sm font-medium hover:bg-[var(--color-wood)] transition-colors"
            >
              Compris
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-[var(--color-gold)] px-3.5 py-2 text-xs font-medium shadow-[var(--shadow-modal)] border border-[var(--color-gold)]/40 no-print"
    >
      <WifiOff className="w-4 h-4 shrink-0" strokeWidth={1.5} />
      <span>Mode hors ligne — Votre panier et les dernières fiches restent accessibles.</span>
    </div>
  );
};
