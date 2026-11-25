import React from 'react';

/* ─────────────────────────────────────────────────────────────────────────
 * Pure-SVG chart primitives for the admin v2 dashboards — no dependencies.
 * ──────────────────────────────────────────────────────────────────────── */

export const formatCompactGnf = (v: number): string => {
  const n = Math.round(v);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')} M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)} k`;
  return String(n);
};

/** KPI tile used across stats & finance dashboards. */
export const KpiTile: React.FC<{
  label: string;
  value: string;
  sub?: string;
  accent?: 'gold' | 'danger' | 'success' | 'neutral';
}> = ({ label, value, sub, accent = 'neutral' }) => {
  const accentClass =
    accent === 'gold'
      ? 'text-[var(--color-gold-deep)]'
      : accent === 'danger'
        ? 'text-[var(--color-danger)]'
        : accent === 'success'
          ? 'text-[var(--color-success)]'
          : 'text-[var(--color-ink)]';
  return (
    <div className="p-4 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)]">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-wood)]">{label}</p>
      {/* text-lg + break-words : les montants GNF (ex. « 20 050 000 GNF ») ne
          débordent plus des tuiles 2-colonnes sur petits écrans. */}
      <p className={`font-display font-mono-num text-lg sm:text-xl font-semibold mt-1 break-words ${accentClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--color-wood)] mt-1">{sub}</p>}
    </div>
  );
};

/** Dual-series area+line chart (GMV vs commissions) rendered as inline SVG. */
export const SalesSeriesChart: React.FC<{
  points: Array<{ day: string; gmvGnf: number; commissionGnf: number; ordersCount: number }>;
  height?: number;
}> = ({ points, height = 180 }) => {
  if (points.length === 0) {
    return <p className="text-xs text-[var(--color-wood)]">Aucune donnée sur la période.</p>;
  }
  const width = 760;
  const padL = 52;
  const padB = 26;
  const padT = 12;
  const innerW = width - padL - 12;
  const innerH = height - padB - padT;
  const max = Math.max(...points.map((p) => p.gmvGnf), 1);
  const x = (i: number) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.gmvGnf).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  const commLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.commissionGnf).toFixed(1)}`).join(' ');

  const gridVals = [0, 0.5, 1].map((f) => max * f);
  const labelStep = Math.ceil(points.length / 8);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Évolution des ventes">
      {gridVals.map((gv, gi) => (
        <g key={gi}>
          <line x1={padL} x2={width - 12} y1={y(gv)} y2={y(gv)} stroke="var(--color-line)" strokeWidth={1} />
          <text x={padL - 6} y={y(gv) + 3} textAnchor="end" fontSize={9} fill="var(--color-wood)" className="font-mono-num">
            {formatCompactGnf(gv)}
          </text>
        </g>
      ))}
      <path d={areaPath} fill="var(--color-gold)" opacity={0.16} />
      <path d={linePath} fill="none" stroke="var(--color-gold-deep)" strokeWidth={2} />
      <path d={commLine} fill="none" stroke="var(--color-wood)" strokeWidth={1.5} strokeDasharray="4 3" />
      {points.map((p, i) =>
        i % labelStep === 0 ? (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={9} fill="var(--color-wood)" className="font-mono-num">
            {p.day.slice(5)}
          </text>
        ) : null
      )}
      <g transform={`translate(${padL}, ${padT - 2})`} fontSize={9} fill="var(--color-wood)">
        <rect x={0} y={0} width={10} height={3} fill="var(--color-gold-deep)" />
        <text x={14} y={4}>GMV</text>
        <rect x={52} y={0} width={10} height={3} fill="var(--color-wood)" />
        <text x={66} y={4}>Commissions</text>
      </g>
    </svg>
  );
};

/** Horizontal bar ranking (categories, operators, vendors, zones…). */
export const HBarChart: React.FC<{
  rows: Array<{ label: string; value: number; sub?: string }>;
  formatValue?: (v: number) => string;
}> = ({ rows, formatValue }) => {
  if (rows.length === 0) {
    return <p className="text-xs text-[var(--color-wood)]">Aucune donnée sur la période.</p>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--color-ink)] font-medium truncate max-w-[55%]">{r.label}</span>
            <span className="font-mono-num text-[var(--color-wood)]">
              {formatValue ? formatValue(r.value) : formatCompactGnf(r.value)}
              {r.sub ? ` · ${r.sub}` : ''}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--color-cream)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--color-gold)]"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

/** Conversion funnel rendered as tapering stacked bars. */
export const FunnelChart: React.FC<{
  steps: Array<{ label: string; value: number }>;
}> = ({ steps }) => {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const stepRate = prev && prev > 0 ? Math.round((s.value / prev) * 1000) / 10 : null;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-40 shrink-0 text-[11px] text-[var(--color-wood)]">{s.label}</div>
            <div className="flex-1 h-7 rounded-[var(--radius-s)] bg-[var(--color-cream)] overflow-hidden">
              <div
                className="h-full rounded-[var(--radius-s)] flex items-center px-2 bg-[var(--color-ink)]"
                style={{ width: `${Math.max(6, (s.value / max) * 100)}%`, opacity: 1 - i * 0.12 }}
              >
                <span className="font-mono-num text-[10px] text-white whitespace-nowrap">{s.value.toLocaleString('fr-FR')}</span>
              </div>
            </div>
            <span className="w-14 text-right font-mono-num text-[10px] text-[var(--color-wood)] shrink-0">
              {stepRate != null ? `${stepRate} %` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/** Seasonality grid: weekday × moment-of-day order counts. */
export const SeasonalityGrid: React.FC<{
  rows: Array<{ weekday: number; morning: number; afternoon: number; evening: number }>;
}> = ({ rows }) => {
  const names = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const cells = rows.map((r) => [r.morning, r.afternoon, r.evening]);
  const max = Math.max(1, ...cells.flat());
  if (rows.length === 0) {
    return <p className="text-xs text-[var(--color-wood)]">Aucune commande sur la période.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] text-center">
      <thead>
        <tr className="text-[var(--color-wood)]">
          <th className="text-left font-medium p-1.5">Jour</th>
          <th className="font-medium p-1.5">Matin</th>
          <th className="font-medium p-1.5">Après-midi</th>
          <th className="font-medium p-1.5">Soir</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.weekday} className="border-t border-[var(--color-line)]">
            <td className="text-left p-1.5 text-[var(--color-ink)]">{names[r.weekday] || `J${r.weekday}`}</td>
            {[r.morning, r.afternoon, r.evening].map((v, i) => (
              <td key={i} className="p-1">
                <div
                  className="mx-auto w-full max-w-[110px] rounded-[var(--radius-s)] py-1 font-mono-num"
                  style={{
                    background: v === 0 ? 'var(--color-cream)' : 'var(--color-gold)',
                    opacity: v === 0 ? 1 : 0.35 + (v / max) * 0.65,
                    color: v === 0 ? 'var(--color-wood)' : 'var(--color-ink)',
                  }}
                >
                  {v}
                </div>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      </table>
    </div>
  );
};
