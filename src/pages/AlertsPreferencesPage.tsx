import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2, Lock } from 'lucide-react';
import { useRouter } from '../context/RouterContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import type { CategoryItem } from '../shared/types';
import { PWAInstallButton } from '../components/ui/PWAInstallButton';

interface FeedNotification {
  id: string;
  title: string;
  body: string;
  target_category: string;
  target_region: string;
  target_url: string;
  created_at: string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const AlertsPreferencesPage: React.FC = () => {
  const { navigate } = useRouter();
  const { addToast } = useToast();

  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [region, setRegion] = useState('Conakry');
  const [frequency, setFrequency] = useState<'instant' | 'weekly_digest' | 'disabled'>('instant');
  const [emailFallback, setEmailFallback] = useState('');
  const [subscribing, setSubscribing] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [feed, setFeed] = useState<FeedNotification[]>([]);

  // US-T03 Privacy / Data Request
  const [privacyForm, setPrivacyForm] = useState({
    email: '',
    phone: '',
    requestType: 'access' as 'access' | 'deletion',
  });
  const [privacySubmitting, setPrivacySubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Alertes nouveautés & Confidentialité — EMROD';
    fetch('/api/homepage')
      .then((r) => r.json())
      .then((d) => setCategories(d.categories || []))
      .catch(() => {});
    fetch('/api/notifications/feed')
      .then((r) => r.json())
      .then((d) => setFeed(d.notifications || []))
      .catch(() => {});
  }, []);

  const toggleCategory = (slug: string) => {
    setSelectedCats((prev) =>
      prev.includes(slug) ? prev.filter((c) => c !== slug) : [...prev, slug]
    );
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubscribing(true);
    try {
      let pushEndpoint = '';
      let pushKeys: any = {};

      if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
        try {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            const reg = await navigator.serviceWorker.ready;
            const vapid = await apiFetch<{ publicKey: string }>('/api/push/vapid-key');
            const sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(vapid.publicKey) as any,
            });
            const json = sub.toJSON();
            pushEndpoint = sub.endpoint;
            pushKeys = json.keys || {};
          }
        } catch {
          // Graceful fallback to email/local notification subscription when browser blocks push
        }
      }

      await apiFetch('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: pushEndpoint || undefined,
          keys: pushKeys,
          categories: selectedCats,
          region,
          frequency,
          emailFallback,
        }),
      });
      setSubscribed(true);
      addToast({
        type: 'success',
        title: 'Préférences d’alertes enregistrées',
        description:
          frequency === 'disabled'
            ? 'Les alertes ont été désactivées.'
            : 'Vous recevrez les alertes de nouvelles créations EMROD.',
      });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur d’enregistrement', description: err.message });
    } finally {
      setSubscribing(false);
    }
  };

  const handlePrivacySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPrivacySubmitting(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/privacy/request', {
        method: 'POST',
        body: JSON.stringify(privacyForm),
      });
      addToast({ type: 'success', title: 'Demande enregistrée', description: res.message });
      setPrivacyForm({ email: '', phone: '', requestType: 'access' });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    } finally {
      setPrivacySubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-12 space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[var(--color-line)]">
        <div>
          <p className="text-xs font-medium text-[var(--color-wood)]">
            PWA · Notifications Web Push & Courriel
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] mt-1">
            Alertes nouvelles créations & Préférences
          </h1>
        </div>
        <PWAInstallButton />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Alert subscription form */}
        <section className="lg:col-span-7 p-6 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-5">
          <h2 className="font-display text-xl font-semibold text-[var(--color-ink)] flex items-center gap-2">
            <Bell className="w-5 h-5 text-[var(--color-gold-deep)]" />
            <span>Recevoir les alertes d’ateliers</span>
          </h2>

          <form onSubmit={handleSubscribe} className="space-y-4">
            <div>
              <p className="text-xs font-medium text-[var(--color-wood)] mb-2">
                Catégories suivies (laisser vide pour tout suivre)
              </p>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => {
                  const active = selectedCats.includes(c.slug);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategory(c.slug)}
                      className={`px-3 py-1.5 rounded-[var(--radius-s)] border text-xs font-medium transition-colors ${
                        active
                          ? 'bg-[var(--color-ink)] text-white border-[var(--color-ink)]'
                          : 'bg-[var(--color-surface)] text-[var(--color-ink)] border-[var(--color-line)]'
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Région / Ville
                </label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                >
                  <option value="Conakry">Conakry (Toutes communes)</option>
                  <option value="Kindia">Kindia</option>
                  <option value="Labé">Labé</option>
                  <option value="Kankan">Kankan</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Fréquence d’alerte
                </label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                >
                  <option value="instant">Temps réel (nouveautés)</option>
                  <option value="weekly_digest">Récapitulatif hebdomadaire</option>
                  <option value="disabled">Désactiver les alertes</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                Courriel de secours (recommandé sur iOS / navigation privée)
              </label>
              <input
                type="email"
                value={emailFallback}
                onChange={(e) => setEmailFallback(e.target.value)}
                placeholder="vous@exemple.com"
                className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={subscribing}
              className="px-6 py-3 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white font-semibold text-sm transition-colors"
            >
              {subscribing ? 'Activation...' : 'Enregistrer mes préférences d’alerte'}
            </button>

            {subscribed && (
              <p className="text-xs text-[var(--color-success)] flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                <span>Votre abonnement aux alertes EMROD est actif.</span>
              </p>
            )}
          </form>
        </section>

        {/* Recent Alerts Feed + US-T03 Privacy Access/Deletion */}
        <div className="lg:col-span-5 space-y-6">
          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
            <h2 className="font-display text-lg font-semibold text-[var(--color-ink)]">
              Dernières annonces d’atelier
            </h2>
            {feed.length === 0 ? (
              <p className="text-xs text-[var(--color-wood)]">Aucune annonce publiée.</p>
            ) : (
              <div className="space-y-3">
                {feed.slice(0, 5).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      fetch(`/api/notifications/${encodeURIComponent(n.id)}/open`, {
                        method: 'POST',
                      }).catch(() => {});
                      navigate(n.target_url || '/catalogue');
                    }}
                    className="w-full text-left p-3 rounded-[var(--radius-s)] bg-[var(--color-cream)] border border-[var(--color-line)] hover:border-[var(--color-gold-deep)] transition-colors text-xs"
                  >
                    <p className="font-semibold text-[var(--color-ink)]">{n.title}</p>
                    <p className="text-[var(--color-body)] mt-1">{n.body}</p>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="p-6 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-4">
            <h2 className="font-display text-lg font-semibold text-[var(--color-ink)] flex items-center gap-2">
              <Lock className="w-4 h-4 text-[var(--color-wood)]" />
              <span>Vos droits sur vos données</span>
            </h2>
            <p className="text-xs text-[var(--color-body)]">
              Demandez l’export ou la suppression de vos coordonnées liées à des commandes invitées.
            </p>
            <form onSubmit={handlePrivacySubmit} className="space-y-3 text-xs">
              <input
                required
                type="email"
                value={privacyForm.email}
                onChange={(e) => setPrivacyForm({ ...privacyForm, email: e.target.value })}
                placeholder="Votre adresse courriel"
                className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)]"
              />
              <input
                required
                type="tel"
                value={privacyForm.phone}
                onChange={(e) => setPrivacyForm({ ...privacyForm, phone: e.target.value })}
                placeholder="Votre numéro de téléphone (+224...)"
                className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)]"
              />
              <select
                value={privacyForm.requestType}
                onChange={(e) =>
                  setPrivacyForm({ ...privacyForm, requestType: e.target.value as any })
                }
                className="w-full px-3 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)]"
              >
                <option value="access">Recevoir une copie de mes données</option>
                <option value="deletion">Demander l’effacement de mes données</option>
              </select>
              <button
                type="submit"
                disabled={privacySubmitting}
                className="w-full py-2.5 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white font-semibold"
              >
                {privacySubmitting ? 'Envoi...' : 'Transmettre ma demande'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};
