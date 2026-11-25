import React, { useEffect, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../lib/api';
import { KpiTile } from './charts';
import type { AdminSecurityPayload, BlacklistEntry } from './types';

/** TAB SÉCURITÉ — mot de passe maître, sessions actives, blocages acheteurs, journaux. */
export const AdminSecurityTab: React.FC = () => {
  const { addToast } = useToast();
  const [sec, setSec] = useState<AdminSecurityPayload | null>(null);
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [blValue, setBlValue] = useState('');
  const [blReason, setBlReason] = useState('');

  const load = async () => {
    try {
      const [s, bl] = await Promise.all([
        apiFetch<AdminSecurityPayload>('/api/admin/security'),
        apiFetch<{ entries: BlacklistEntry[] }>('/api/admin/blacklist').catch(() => ({ entries: [] as BlacklistEntry[] })),
      ]);
      setSec(s);
      const entries = Array.isArray(bl) ? (bl as unknown as BlacklistEntry[]) : bl.entries;
      setBlacklist(entries || []);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Chargement impossible', description: err.message });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changePasscode = async () => {
    if (next.length < 8) {
      addToast({ type: 'error', title: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });
      return;
    }
    if (next !== confirm) {
      addToast({ type: 'error', title: 'La confirmation ne correspond pas.' });
      return;
    }
    try {
      const res = await apiFetch<{ ok: boolean; sessionsInvalidated: number }>('/api/admin/security/passcode', {
        method: 'POST',
        body: JSON.stringify({ current, next }),
      });
      addToast({
        type: 'success',
        title: 'Mot de passe maître mis à jour',
        description: `${res.sessionsInvalidated} session(s) révoquée(s) — reconnexion requise partout.`,
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      await load();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Changement refusé', description: err.message });
    }
  };

  const revokeSession = async (jti: string) => {
    try {
      await apiFetch('/api/admin/security/revoke', { method: 'POST', body: JSON.stringify({ jti }) });
      addToast({ type: 'success', title: 'Session révoquée' });
      await load();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Révocation impossible', description: err.message });
    }
  };

  const addToBlacklist = async () => {
    if (blValue.trim().length < 3) return;
    try {
      await apiFetch('/api/admin/blacklist', {
        method: 'POST',
        body: JSON.stringify({ value: blValue.trim(), reason: blReason.trim() || undefined }),
      });
      addToast({ type: 'success', title: 'Identité bloquée' });
      setBlValue('');
      setBlReason('');
      await load();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Blocage impossible', description: err.message });
    }
  };

  const removeFromBlacklist = async (id: string) => {
    try {
      await apiFetch(`/api/admin/blacklist/${id}`, { method: 'DELETE' });
      addToast({ type: 'success', title: 'Blocage levé' });
      await load();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Action impossible', description: err.message });
    }
  };

  if (!sec) return <div className="h-64 w-full rounded-[var(--radius-m)] emrod-skeleton" />;

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Sessions actives" value={String(sec.activeSessions.length)} accent="gold" />
        <KpiTile label="Sessions révoquées" value={String(sec.revokedCount)} />
        <KpiTile
          label="Échecs de connexion récents"
          value={String(sec.failedAttempts.length)}
          accent={sec.failedAttempts.length > 0 ? 'danger' : 'success'}
        />
        <KpiTile label="Identités bloquées" value={String(blacklist.length)} />
      </section>

      {/* Mot de passe maître */}
      <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-4">
        <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">Mot de passe maître direction</h2>
        <p className="text-[11px] text-[var(--color-wood)]">
          Le changement révoque immédiatement toutes les sessions administrateur actives (déconnexion forcée sur tous
          les appareils).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="password"
            placeholder="Mot de passe actuel"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
          />
          <input
            type="password"
            placeholder="Nouveau (8 car. min)"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
          />
          <input
            type="password"
            placeholder="Confirmer"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => void changePasscode()}
          className="px-5 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
        >
          Changer le mot de passe maître
        </button>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sessions actives */}
        <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3">
          <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">
            Sessions actives ({sec.activeSessions.length})
          </h2>
          {sec.activeSessions.length === 0 ? (
            <p className="text-xs text-[var(--color-wood)]">Aucune session active.</p>
          ) : (
            <div className="rounded-[var(--radius-s)] border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
              {sec.activeSessions.map((s) => (
                <div key={s.jti} className="p-2.5 flex items-center justify-between gap-2 text-[11px]">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--color-ink)]">
                      {s.email} <span className="text-[var(--color-wood)] font-normal">({s.role})</span>
                    </p>
                    <p className="font-mono-num text-[var(--color-wood)] truncate">
                      {s.jti} · ouverte {new Date(s.created_at).toLocaleString('fr-FR')} · expire{' '}
                      {new Date(s.exp * 1000).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void revokeSession(s.jti)}
                    className="px-2.5 py-1 rounded border border-[var(--color-danger)]/40 text-[var(--color-danger)] shrink-0"
                  >
                    Révoquer
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Échecs */}
          <div className="pt-3 space-y-2">
            <p className="text-xs font-semibold text-[var(--color-wood)]">
              Tentatives échouées récentes ({sec.failedAttempts.length})
            </p>
            {sec.failedAttempts.length === 0 ? (
              <p className="text-[11px] text-[var(--color-wood)]">Aucun échec enregistré.</p>
            ) : (
              <div className="rounded-[var(--radius-s)] border border-[var(--color-line)] divide-y divide-[var(--color-line)] max-h-40 overflow-y-auto">
                {sec.failedAttempts.map((f, i) => (
                  <div key={i} className="p-2 flex items-center justify-between text-[11px]">
                    <span className="font-mono-num">{f.ip}</span>
                    <span className="font-mono-num text-[var(--color-wood)]">
                      {new Date(f.created_at).toLocaleString('fr-FR')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Blacklist */}
        <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-3">
          <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">
            Acheteurs bloqués ({blacklist.length})
          </h2>
          <p className="text-[11px] text-[var(--color-wood)]">
            Courriel ou téléphone interdit de commande (anti-fraude / litiges répétés). Vérifié à chaque création de
            commande.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={blValue}
              onChange={(e) => setBlValue(e.target.value)}
              placeholder="courriel ou +224…"
              className="flex-1 min-w-[160px] px-2.5 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
            />
            <input
              value={blReason}
              onChange={(e) => setBlReason(e.target.value)}
              placeholder="Motif (optionnel)"
              className="flex-1 min-w-[160px] px-2.5 py-1.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs"
            />
            <button
              type="button"
              onClick={() => void addToBlacklist()}
              className="px-4 py-1.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white text-xs font-semibold"
            >
              Bloquer
            </button>
          </div>
          <div className="rounded-[var(--radius-s)] border border-[var(--color-line)] divide-y divide-[var(--color-line)] max-h-60 overflow-y-auto">
            {blacklist.length === 0 ? (
              <p className="p-2.5 text-[11px] text-[var(--color-wood)]">Aucune identité bloquée.</p>
            ) : (
              blacklist.map((b) => (
                <div key={b.id} className="p-2.5 flex items-center justify-between gap-2 text-[11px]">
                  <div className="min-w-0">
                    <span className="font-mono-num block truncate">{b.value}</span>
                    <span className="text-[var(--color-wood)]">
                      {b.kind}
                      {b.reason ? ` · ${b.reason}` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeFromBlacklist(b.id)}
                    className="text-[var(--color-danger)] shrink-0 px-1"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Journaux sécurité */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">
          Journal sécurité & administrateur ({sec.securityLogs.length})
        </h2>
        <div className="overflow-x-auto border border-[var(--color-line)] rounded-[var(--radius-m)] max-h-80 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-cream)] text-[var(--color-wood)] sticky top-0">
              <tr>
                <th className="p-2.5 font-medium">Date</th>
                <th className="p-2.5 font-medium">Acteur</th>
                <th className="p-2.5 font-medium">Action</th>
                <th className="p-2.5 font-medium">Cible</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)] bg-[var(--color-surface)]">
              {sec.securityLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-[var(--color-wood)]">
                    Aucun événement de sécurité journalisé.
                  </td>
                </tr>
              ) : (
                sec.securityLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="p-2.5 font-mono-num">{new Date(l.created_at).toLocaleString('fr-FR')}</td>
                    <td className="p-2.5">{l.actor_name}</td>
                    <td className="p-2.5 font-semibold">{l.action}</td>
                    <td className="p-2.5 font-mono-num text-[var(--color-wood)]">
                      {l.target_type}/{l.target_id}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
