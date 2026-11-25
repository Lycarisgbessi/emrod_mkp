import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from '../context/RouterContext';

export const LegalPage: React.FC<{ pageKey: string }> = ({ pageKey }) => {
  const { navigate } = useRouter();
  const [legal, setLegal] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/rules/public')
      .then((r) => r.json())
      .then((d) => setLegal(d.legal || {}))
      .catch(() => {});
  }, []);

  const titleMap: Record<string, string> = {
    mentions: 'Mentions légales — EMROD SARL',
    cgv: 'Conditions Générales de Vente & Place de Marché',
    confidentialite: 'Politique de confidentialité & Protection des données',
  };

  const title = titleMap[pageKey] || 'Informations institutionnelles';
  const body =
    legal[pageKey] ||
    'EMROD SARL — T7, Corniche Nord, Virage du lac Sonfonia Centre (Carrefour Canal Plus), Conakry, Guinée. Contact : contact@emroddf.com · +224 623 88 59 59.';

  useEffect(() => {
    document.title = `${title} — EMROD`;
  }, [title]);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-8 py-14 space-y-6">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--color-wood)] hover:text-[var(--color-ink)]"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Retour à l’accueil</span>
      </button>
      <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[var(--color-ink)]">
        {title}
      </h1>
      <div className="p-6 sm:p-8 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] text-sm text-[var(--color-body)] leading-relaxed whitespace-pre-line">
        {body}
      </div>
    </div>
  );
};

export const NotFoundPage: React.FC = () => {
  const { navigate } = useRouter();
  useEffect(() => {
    document.title = 'Page introuvable — EMROD';
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-24 text-center space-y-5">
      <p className="font-mono-num text-sm font-semibold text-[var(--color-gold-deep)]">404</p>
      <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[var(--color-ink)]">
        Cette page est introuvable
      </h1>
      <p className="text-sm text-[var(--color-body)]">
        La pièce ou l’atelier recherché a peut-être été déplacé. Explorez notre collection ou
        recherchez par essence de bois.
      </p>
      <div className="flex flex-wrap justify-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => navigate('/catalogue')}
          className="px-6 py-3 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-sm font-semibold hover:bg-[var(--color-wood)]"
        >
          Parcourir le catalogue
        </button>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="px-6 py-3 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm font-medium text-[var(--color-ink)]"
        >
          Accueil EMROD
        </button>
      </div>
    </div>
  );
};
