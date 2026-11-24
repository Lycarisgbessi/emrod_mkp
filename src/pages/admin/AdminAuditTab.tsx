import React from 'react';
import type { AdminOverviewPayload } from './types';

interface AdminAuditTabProps {
  data: AdminOverviewPayload;
  auditSearch: string;
  setAuditSearch: React.Dispatch<React.SetStateAction<string>>;
}

/** Tab extracted from AdminPortalPage — presentation only, state lives in the parent. */
export const AdminAuditTab: React.FC<AdminAuditTabProps> = ({
    data,
    auditSearch,
    setAuditSearch
}) => {
  return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-display text-2xl font-semibold text-[var(--color-ink)]">
            Journal d’audit immuable
          </h2>
          <input
            type="search"
            placeholder="Filtrer par action ou acteur..."
            value={auditSearch}
            onChange={(e) => setAuditSearch(e.target.value)}
            className="px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs w-64"
          />
        </div>
        <div className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-m)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] border-b border-[var(--color-line)]">
              <tr>
                <th className="p-3 font-medium">Horodatage</th>
                <th className="p-3 font-medium">Acteur</th>
                <th className="p-3 font-medium">Action</th>
                <th className="p-3 font-medium">Cible</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)] bg-[var(--color-surface)]">
              {data.auditLogs
                .filter(
                  (l) =>
                    !auditSearch.trim() ||
                    `${l.action} ${l.actor_name} ${l.target_type}`
                      .toLowerCase()
                      .includes(auditSearch.toLowerCase())
                )
                .map((l) => (
                  <tr key={l.id}>
                    <td className="p-3 font-mono-num">
                      {new Date(l.created_at).toLocaleString('fr-FR')}
                    </td>
                    <td className="p-3">{l.actor_name}</td>
                    <td className="p-3 font-semibold">{l.action}</td>
                    <td className="p-3 font-mono-num">
                      {l.target_type} ({l.target_id})
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
  );
};
