import React from 'react';
import type { AdminOverviewPayload } from './types';

interface AdminAlertsTabProps {
  data: AdminOverviewPayload;
  alertForm: { title: string; body: string; targetCategory: string; targetRegion: string; targetUrl: string };
  setAlertForm: React.Dispatch<React.SetStateAction<{ title: string; body: string; targetCategory: string; targetRegion: string; targetUrl: string }>>;
  handleSendPushAlert: (e: React.FormEvent) => void;
}

/** Tab extracted from AdminPortalPage — presentation only, state lives in the parent. */
export const AdminAlertsTab: React.FC<AdminAlertsTabProps> = ({
    data,
    alertForm,
    setAlertForm,
    handleSendPushAlert
}) => {
  return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <section className="lg:col-span-5 p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
            Diffuser une alerte Web Push
          </h2>
          <form onSubmit={handleSendPushAlert} className="space-y-3">
            <input
              required
              placeholder="Titre de la notification"
              value={alertForm.title}
              onChange={(e) => setAlertForm({ ...alertForm, title: e.target.value })}
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
            />
            <textarea
              required
              rows={3}
              placeholder="Contenu de l’alerte (nouveautés, promotion artisanale...)"
              value={alertForm.body}
              onChange={(e) => setAlertForm({ ...alertForm, body: e.target.value })}
              className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs"
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={alertForm.targetCategory}
                onChange={(e) => setAlertForm({ ...alertForm, targetCategory: e.target.value })}
                className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs"
              >
                <option value="all">Toutes catégories</option>
                {data.categories.map((c) => (
                  <option key={c.id} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                value={alertForm.targetRegion}
                onChange={(e) => setAlertForm({ ...alertForm, targetRegion: e.target.value })}
                placeholder="Région (all ou Conakry)"
                className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-xs"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
            >
              Envoyer aux abonnés ciblés
            </button>
          </form>
        </section>

        <section className="lg:col-span-7 space-y-3">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
            Historique & statistiques d’envoi
          </h2>
          {data.notifications.map((n) => (
            <div
              key={n.id}
              className="p-4 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-1 text-xs"
            >
              <div className="flex justify-between font-semibold text-[var(--color-ink)]">
                <span>{n.title}</span>
                <span>{new Date(n.created_at).toLocaleDateString('fr-FR')}</span>
              </div>
              <p className="text-[var(--color-body)]">{n.body}</p>
              <p className="font-mono-num text-[var(--color-wood)] pt-1">
                Envoyés : {n.sent_count} · Délivrés : {n.delivered_count} · Ouverts :{' '}
                {n.opened_count}
              </p>
            </div>
          ))}
        </section>
      </div>
  );
};
