import React, { useEffect, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { KpiTile } from './charts';
import type { AdminSystemPayload } from './types';

const TABLE_LABELS: Record<string, string> = {
  users: 'Comptes',
  vendor_profiles: 'Ateliers',
  products: 'Produits',
  product_media: 'Médias',
  orders: 'Commandes',
  order_items: 'Lignes de commande',
  order_events: 'Événements commande',
  payments: 'Paiements',
  payouts: 'Versements',
  commissions: 'Commissions',
  quotes: 'Devis (nouveau schéma)',
  quote_requests: 'Demandes de devis',
  reviews: 'Avis',
  disputes: 'Litiges',
  conversations: 'Conversations',
  messages: 'Messages',
  notifications: 'Notifications',
  push_subscriptions: 'Abonnements push',
  audit_logs: 'Journaux d’audit',
  webhook_events: 'Webhooks Djomy',
  analytics_events: 'Événements analytiques',
  search_queries: 'Recherches',
  email_log: 'Courriels envoyés',
};

/** TAB SYSTÈME — santé infrastructure, mode maintenance, intégrations, flux Djomy & courriels. */
export const AdminSystemTab: React.FC = () => {
  const { addToast } = useToast();
  const [sys, setSys] = useState<AdminSystemPayload | null>(null);
  const [maintMessage, setMaintMessage] = useState('');

  const load = async () => {
    try {
      const res = await apiFetch<AdminSystemPayload>('/api/admin/system');
      setSys(res);
      setMaintMessage(res.maintenance.message);
    } catch (err: any) {
      addToast({ type: 'error', title: 'État système indisponible', description: err.message });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMaintenance = async (enabled: boolean) => {
    try {
      await apiFetch('/api/admin/maintenance', {
        method: 'POST',
        body: JSON.stringify({ enabled, message: maintMessage }),
      });
      addToast({
        type: 'success',
        title: enabled ? 'Mode maintenance activé' : 'Mode maintenance désactivé',
      });
      await load();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Action impossible', description: err.message });
    }
  };

  if (!sys) return <div className="h-64 w-full rounded-[var(--radius-m)] emrod-skeleton" />;

  const h = sys.health;
  const uptimeH = Math.floor(h.uptimeSeconds / 3600);
  const uptimeM = Math.floor((h.uptimeSeconds % 3600) / 60);

  return (
    <div className="space-y-8">
      {/* Santé */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Disponibilité process" value={`${uptimeH} h ${uptimeM} min`} accent="success" />
        <KpiTile label="Base de données" value={`${h.database.sizeMb.toFixed(1)} Mo`} sub={`WAL ${h.database.walSizeMb.toFixed(1)} Mo`} />
        <KpiTile label="Mémoire Node" value={`${h.memoryMb} Mo`} sub={h.nodeVersion} />
        <KpiTile
          label="Courriels"
          value={`${h.emails.sent} envoyés`}
          sub={`${h.emails.errors} erreur(s)`}
          accent={h.emails.errors > 0 ? 'danger' : 'success'}
        />
      </section>

      {/* Mode maintenance */}
      <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">Mode maintenance vitrine</h2>
          <span
            className={`text-xs font-semibold ${sys.maintenance.enabled ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'}`}
          >
            {sys.maintenance.enabled ? '● ACTIF — catalogue fermé' : '● Inactif — plateforme ouverte'}
          </span>
        </div>
        <textarea
          rows={2}
          value={maintMessage}
          onChange={(e) => setMaintMessage(e.target.value)}
          placeholder="Message affiché aux visiteurs pendant la maintenance…"
          className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void setMaintenance(true)}
            className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
          >
            Activer la maintenance
          </button>
          <button
            type="button"
            onClick={() => void setMaintenance(false)}
            className="px-5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-semibold hover:bg-[var(--color-surface)]"
          >
            Désactiver
          </button>
        </div>
      </section>

      {/* Intégrations */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3">
          <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">Intégrations</h2>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-wood)]">Passerelle Djomy</span>
              <span className={`font-semibold ${sys.integration.djomy === 'live_api' ? 'text-[var(--color-success)]' : 'text-[var(--color-gold-deep)]'}`}>
                {sys.integration.djomy === 'live_api' ? 'API live connectée' : 'Simulateur sandbox'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-wood)]">SMTP (courriels transactionnels)</span>
              <span className={`font-semibold ${sys.integration.smtpConfigured ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                {sys.integration.smtpConfigured ? 'Configuré' : 'Non configuré'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-wood)]">Notifications push (VAPID)</span>
              <span className={`font-semibold ${sys.integration.vapidConfigured ? 'text-[var(--color-success)]' : 'text-[var(--color-gold-deep)]'}`}>
                {sys.integration.vapidConfigured ? 'Clés actives' : 'Générées au premier envoi'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-wood)]">URL publique</span>
              <span className="font-mono-num break-all max-w-[55%] text-right">{sys.integration.appUrl}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-wood)]">Environnement</span>
              <span className="font-mono-num">{h.integrations.nodeEnv || 'production'}</span>
            </div>
          </div>
        </div>

        {/* Compteurs tables */}
        <div className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3">
          <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">Inventaire des données</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] max-h-64 overflow-y-auto">
            {Object.entries(sys.counts).map(([table, count]) => (
              <div key={table} className="p-2 rounded-[var(--radius-s)] bg-[var(--color-cream)]">
                <p className="text-[var(--color-wood)] truncate">{TABLE_LABELS[table] || table}</p>
                <p className="font-mono-num font-semibold text-[var(--color-ink)]">{count.toLocaleString('fr-FR')}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Webhooks */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">
          Derniers webhooks Djomy ({sys.webhooks.length})
        </h2>
        {sys.webhooks.length === 0 ? (
          <p className="text-xs text-[var(--color-wood)]">Aucun webhook reçu.</p>
        ) : (
          <div className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-m)] max-h-60 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] sticky top-0">
                <tr>
                  <th className="p-2.5 font-medium">Événement</th>
                  <th className="p-2.5 font-medium">Référence</th>
                  <th className="p-2.5 font-medium">Reçu le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)] bg-[var(--color-surface)]">
                {sys.webhooks.map((w) => (
                  <tr key={w.event_id}>
                    <td className="p-2.5 font-semibold">{w.event_type}</td>
                    <td className="p-2.5 font-mono-num">{w.djomy_reference}</td>
                    <td className="p-2.5 font-mono-num">{new Date(w.created_at).toLocaleString('fr-FR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Emails */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">
          Derniers courriels transactionnels ({sys.emails.length})
        </h2>
        {sys.emails.length === 0 ? (
          <p className="text-xs text-[var(--color-wood)]">Aucun courriel envoyé.</p>
        ) : (
          <div className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-m)] max-h-60 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] sticky top-0">
                <tr>
                  <th className="p-2.5 font-medium">Destinataire</th>
                  <th className="p-2.5 font-medium">Objet</th>
                  <th className="p-2.5 font-medium">Statut</th>
                  <th className="p-2.5 font-medium">Envoyé le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)] bg-[var(--color-surface)]">
                {sys.emails.map((e, i) => (
                  <tr key={i}>
                    <td className="p-2.5">{e.to_email}</td>
                    <td className="p-2.5 max-w-[280px] truncate">{e.subject}</td>
                    <td className={`p-2.5 font-semibold ${e.status === 'sent' ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                      {e.status}
                      {e.error ? ` — ${e.error}` : ''}
                    </td>
                    <td className="p-2.5 font-mono-num">{new Date(e.created_at).toLocaleString('fr-FR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
