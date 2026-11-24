import React from 'react';
import { Bell, Mail, MapPin, Phone } from 'lucide-react';
import { useRouter } from '../../context/RouterContext';
import { PWAInstallButton } from './PWAInstallButton';

export const Footer: React.FC = () => {
  const { navigate } = useRouter();

  const go = (e: React.MouseEvent, to: string) => {
    e.preventDefault();
    navigate(to);
  };

  return (
    <footer className="bg-[var(--color-cream)] border-t border-[var(--color-line)] text-[var(--color-body)] mt-16 no-print">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand & Conakry Identity */}
          <div>
            <p className="font-display text-2xl font-bold text-[var(--color-ink)]">EMROD SARL</p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-body)]">
              Des meubles uniques, sur mesure, créés par des femmes pour votre intérieur. Bois nobles
              de Guinée, cuirs pleine fleur et métaux texturés.
            </p>
            <div className="mt-5">
              <PWAInstallButton />
            </div>
          </div>

          {/* Marketplace Links */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-ink)] mb-4">Place de marché</h3>
            <ul className="space-y-2.5 text-sm">
              <li>
                <a href="/catalogue" onClick={(e) => go(e, '/catalogue')} className="hover:text-[var(--color-wood)]">
                  Catalogue & Créations
                </a>
              </li>
              <li>
                <a
                  href="/catalogue?mode=sur_devis"
                  onClick={(e) => go(e, '/catalogue?mode=sur_devis')}
                  className="hover:text-[var(--color-wood)]"
                >
                  Projets sur mesure (4 étapes)
                </a>
              </li>
              <li>
                <a href="/suivi" onClick={(e) => go(e, '/suivi')} className="hover:text-[var(--color-wood)]">
                  Suivre ma commande sans compte
                </a>
              </li>
              <li>
                <a href="/alertes" onClick={(e) => go(e, '/alertes')} className="inline-flex items-center gap-1.5 hover:text-[var(--color-wood)]">
                  <Bell className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <span>Alertes nouveaux produits</span>
                </a>
              </li>
            </ul>
          </div>

          {/* Artisans & Governance */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-ink)] mb-4">Artisans & Pilotage</h3>
            <ul className="space-y-2.5 text-sm">
              <li>
                <a href="/devenir-vendeur" onClick={(e) => go(e, '/devenir-vendeur')} className="hover:text-[var(--color-wood)]">
                  Devenir vendeur partenaire
                </a>
              </li>
              <li>
                <a href="/vendeur" onClick={(e) => go(e, '/vendeur')} className="hover:text-[var(--color-wood)]">
                  Espace vendeur
                </a>
              </li>
              <li>
                <a href="/admin" onClick={(e) => go(e, '/admin')} className="hover:text-[var(--color-wood)]">
                  Back-office Administrateur
                </a>
              </li>
              <li>
                <a href="/artisan/emrod-sarl" onClick={(e) => go(e, '/artisan/emrod-sarl')} className="hover:text-[var(--color-wood)]">
                  Atelier fondateur EMROD
                </a>
              </li>
            </ul>
          </div>

          {/* Coordonnées Conakry — Annexe C */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-ink)] mb-4">Atelier & Showroom Conakry</h3>
            <ul className="space-y-2.5 text-sm text-[var(--color-body)]">
              <li className="flex items-start gap-2">
                <MapPin className="w-4 h-4 shrink-0 text-[var(--color-wood)] mt-0.5" strokeWidth={1.5} />
                <span>T7, Corniche Nord, Virage du lac Sonfonia Centre (Carrefour Canal Plus), Conakry</span>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="w-4 h-4 shrink-0 text-[var(--color-wood)]" strokeWidth={1.5} />
                <span className="tabular-nums">+224 623 88 59 59 · +224 621 08 41 46</span>
              </li>
              <li className="flex items-center gap-2">
                <Mail className="w-4 h-4 shrink-0 text-[var(--color-wood)]" strokeWidth={1.5} />
                <span>contact@emroddf.com</span>
              </li>
              <li className="text-xs text-[var(--color-wood)] pt-1">
                Ouvert du lundi au samedi, de 8 h à 18 h
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-[var(--color-line)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[var(--color-wood)]">
          <p>© {new Date().getFullYear()} EMROD SARL — Mobilier sur mesure & artisanat d’exception, Conakry.</p>
          <div className="flex flex-wrap items-center gap-5">
            <a href="/mentions/mentions" onClick={(e) => go(e, '/mentions/mentions')} className="hover:text-[var(--color-ink)]">
              Mentions légales
            </a>
            <a href="/mentions/cgv" onClick={(e) => go(e, '/mentions/cgv')} className="hover:text-[var(--color-ink)]">
              Conditions de vente
            </a>
            <a href="/mentions/confidentialite" onClick={(e) => go(e, '/mentions/confidentialite')} className="hover:text-[var(--color-ink)]">
              Confidentialité & Données
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
