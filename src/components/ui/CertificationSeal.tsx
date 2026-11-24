import React, { useState } from 'react';
import { Award, ShieldCheck, Sparkles } from 'lucide-react';

interface CertificationSealProps {
  name: string;
  icon?: string;
  criteriaDescription: string;
  publicDescription?: string;
  variant?: 'subtle' | 'dark';
}

export const CertificationSeal: React.FC<CertificationSealProps> = ({
  name,
  icon = 'award',
  criteriaDescription,
  publicDescription,
  variant = 'subtle',
}) => {
  const [showTip, setShowTip] = useState(false);

  const IconComp =
    icon === 'shield-check' || icon === 'shield'
      ? ShieldCheck
      : icon === 'sparkles'
        ? Sparkles
        : Award;

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <button
        type="button"
        onClick={() => setShowTip((v) => !v)}
        onFocus={() => setShowTip(true)}
        onBlur={() => setShowTip(false)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-[var(--radius-s)] border transition-colors whitespace-nowrap shrink-0 ${
          variant === 'dark'
            ? 'bg-[var(--color-ink)] text-[var(--color-gold)] border-[var(--color-gold)]/40'
            : 'bg-[var(--color-cream)] text-[var(--color-wood)] border-[var(--color-line)] hover:border-[var(--color-gold-deep)]'
        }`}
        aria-label={`Certification ${name} : ${criteriaDescription}`}
      >
        <IconComp className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
        <span>{name}</span>
      </button>

      {showTip && (
        <span
          role="tooltip"
          className="absolute bottom-full left-0 mb-2 w-64 p-3 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-[var(--color-surface)] text-xs leading-relaxed shadow-[var(--shadow-modal)] z-30 pointer-events-none"
        >
          <span className="block font-semibold text-[var(--color-gold)] mb-1">{name}</span>
          <span className="block text-[#EFEBE0]">{publicDescription || criteriaDescription}</span>
        </span>
      )}
    </span>
  );
};
