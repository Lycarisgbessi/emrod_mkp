import React, { useEffect, useState } from 'react';
import {
  Award,
  BarChart3,
  Bell,
  Boxes,
  Contact,
  CreditCard,
  FileText,
  KeyRound,
  Lock,
  LogOut,
  Package,
  Scale,
  Server,
  ShieldCheck,
  Store,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { useRouter } from '../context/RouterContext';
import { useToast } from '../context/ToastContext';
import { apiFetch, getMemoryAuthToken, setMemoryAuthToken } from '../lib/api';
import { calculateDeliveryFee } from '../shared/domain';
import type {
  
  
  CommercialRestrictionsConfig,
  DeliveryZoneRule,
  
  RegistrationFieldRule,
  RequiredDocumentRule,
  VendorAccountStatus,
} from '../shared/types';

import type { AdminOverviewPayload } from './admin/types';
import { AdminOverviewTab } from './admin/AdminOverviewTab';
import { AdminVendorsTab } from './admin/AdminVendorsTab';
import { AdminRulesTab } from './admin/AdminRulesTab';
import { AdminModerationTab } from './admin/AdminModerationTab';
import { AdminDeliveryTab } from './admin/AdminDeliveryTab';
import { AdminPaymentsTab } from './admin/AdminPaymentsTab';
import { AdminAlertsTab } from './admin/AdminAlertsTab';
import { AdminAuditTab } from './admin/AdminAuditTab';
import { AdminFinanceTab } from './admin/AdminFinanceTab';
import { AdminOrdersTab } from './admin/AdminOrdersTab';
import { AdminProductsTab } from './admin/AdminProductsTab';
import { AdminBuyersTab } from './admin/AdminBuyersTab';
import { AdminStatsTab } from './admin/AdminStatsTab';
import { AdminSecurityTab } from './admin/AdminSecurityTab';
import { AdminSystemTab } from './admin/AdminSystemTab';

export const AdminPortalPage: React.FC = () => {
  const { navigate } = useRouter();
  const { addToast } = useToast();

  const [authStatus, setAuthStatus] = useState<{ configured: boolean; mode: string } | null>(null);
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [submittingAuth, setSubmittingAuth] = useState(false);

  const [data, setData] = useState<AdminOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'stats'
    | 'finance'
    | 'orders'
    | 'products'
    | 'buyers'
    | 'vendors'
    | 'rules'
    | 'moderation'
    | 'delivery'
    | 'payments'
    | 'alerts'
    | 'security'
    | 'system'
    | 'audit'
  >('overview');

  // Editable state snapshots
  const [restrictions, setRestrictions] = useState<CommercialRestrictionsConfig | null>(null);
  const [regRules, setRegRules] = useState<{
    fields: RegistrationFieldRule[];
    documents: RequiredDocumentRule[];
  } | null>(null);
  const [zonesDraft, setZonesDraft] = useState<DeliveryZoneRule[]>([]);
  const [simWeightKg, setSimWeightKg] = useState(40);
  const [simZoneId, setSimZoneId] = useState('');
  const [editorialDraft, setEditorialDraft] = useState<Record<string, string>>({});
  const [legalDraft, setLegalDraft] = useState<Record<string, string>>({});

  // New badge creation
  const [newBadge, setNewBadge] = useState({
    name: '',
    criteriaDescription: '',
    publicDescription: '',
    isMandatory: false,
    autoAssign: false,
  });

  // Push Alert Sender
  const [alertForm, setAlertForm] = useState({
    title: '',
    body: '',
    targetCategory: 'all',
    targetRegion: 'all',
    targetUrl: '/catalogue',
  });

  // Audit filter
  const [auditSearch, setAuditSearch] = useState('');

  // Dynamic registration field draft
  const [newField, setNewField] = useState({
    label: '',
    type: 'text' as 'text' | 'textarea' | 'select',
    options: '',
    required: true,
  });

  // Djomy v1 integration diagnostics
  const [djomyDiag, setDjomyDiag] = useState<{
    diagnostics: {
      mode: 'live_api' | 'sandbox_simulator';
      baseUrl: string;
      hasClientId: boolean;
      hasClientSecret: boolean;
      hasWebhookSecretOverride: boolean;
      webhookPath: string;
    };
    recentWebhooks: Array<{
      event_id: string;
      event_type: string;
      djomy_reference: string;
      created_at: string;
    }>;
  } | null>(null);

  const loadAdminOverview = async () => {
    try {
      const [ov, diag] = await Promise.all([
        apiFetch<AdminOverviewPayload>('/api/admin/overview'),
        apiFetch<any>('/api/admin/payments/djomy-diagnostics').catch(() => null),
      ]);
      setData(ov);
      if (diag) setDjomyDiag(diag);
      setRestrictions(ov.restrictions);
      setRegRules(ov.registrationRequirements);
      setZonesDraft(ov.zones);
      if (ov.zones.length > 0 && !simZoneId) setSimZoneId(ov.zones[0].id);
      setEditorialDraft(ov.editorial || {});
      setLegalDraft(ov.legal || {});
    } catch (err: any) {
      setData(null);
      if (typeof err?.message === 'string' && err.message.includes('Session expirée')) {
        addToast({
          type: 'info',
          title: 'Session administrateur expirée',
          description: 'Votre session a expiré (12 h). Merci de saisir à nouveau le mot de passe.',
        });
      }
    }
  };

  const init = async () => {
    setLoading(true);
    try {
      const status = await apiFetch<{ configured: boolean; mode: string }>('/api/auth/admin-status');
      setAuthStatus(status);
      try {
        const me = await apiFetch<{ session: { role: string } | null }>('/api/auth/me');
        if (me.session?.role === 'admin') {
          await loadAdminOverview();
        }
      } catch {
        // Not logged in as admin yet
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = 'Back-office Administrateur — EMROD';
    void init();
  }, []);

  const handleClaimAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode !== confirmPasscode) {
      addToast({ type: 'error', title: 'Les deux mots de passe ne correspondent pas.' });
      return;
    }
    setSubmittingAuth(true);
    try {
      const res = await apiFetch<{ token: string }>('/api/auth/admin-claim', {
        method: 'POST',
        body: JSON.stringify({ passcode }),
      });
      setMemoryAuthToken(res.token);
      setAuthStatus({ configured: true, mode: 'claimed' });
      await loadAdminOverview();
      addToast({
        type: 'success',
        title: 'Accès administrateur initialisé',
        description: 'Bienvenue dans le centre de commandement EMROD.',
      });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur configuration', description: err.message });
    } finally {
      setSubmittingAuth(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingAuth(true);
    try {
      const res = await apiFetch<{ token: string }>('/api/auth/admin-login', {
        method: 'POST',
        body: JSON.stringify({ passcode }),
      });
      setMemoryAuthToken(res.token);
      await loadAdminOverview();
      addToast({ type: 'success', title: 'Connexion administrateur validée' });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Accès refusé', description: err.message });
    } finally {
      setSubmittingAuth(false);
    }
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setMemoryAuthToken(null);
    setData(null);
    setPasscode('');
    addToast({ type: 'info', title: 'Session administrateur fermée' });
  };

  const handleDownloadCsv = async (type: 'orders' | 'vendors' | 'products') => {
    try {
      const token = getMemoryAuthToken();
      const res = await fetch(`/api/admin/export/${type}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Export refusé');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `emrod-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Export impossible', description: err.message });
    }
  };

  const handleVendorStatus = async (vendorId: string, status: VendorAccountStatus, reason: string) => {
    try {
      await apiFetch(`/api/admin/vendors/${vendorId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reason }),
      });
      addToast({ type: 'success', title: `Statut vendeur passé à « ${status} »` });
      await loadAdminOverview();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleDocReview = async (docId: string, status: 'approved' | 'rejected') => {
    const reason = status === 'rejected' ? 'Pièce illisible ou expirée — merci de recharger.' : '';
    try {
      await apiFetch(`/api/admin/documents/${docId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reason }),
      });
      addToast({
        type: 'success',
        title: status === 'approved' ? 'Document KYC approuvé' : 'Document KYC refusé',
      });
      await loadAdminOverview();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleCertToggle = async (vendorId: string, badgeId: string, hasBadge: boolean) => {
    try {
      await apiFetch(`/api/admin/vendors/${vendorId}/certifications`, {
        method: 'POST',
        body: JSON.stringify({
          badgeId,
          action: hasBadge ? 'revoke' : 'grant',
          reason: hasBadge ? 'Révocation manuelle par EMROD' : 'Certification attribuée par EMROD',
        }),
      });
      addToast({
        type: 'success',
        title: hasBadge ? 'Badge révoqué' : 'Badge attribué',
      });
      await loadAdminOverview();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleSaveRestrictions = async () => {
    if (!restrictions) return;
    try {
      await apiFetch('/api/admin/rules/restrictions', {
        method: 'PUT',
        body: JSON.stringify(restrictions),
      });
      addToast({ type: 'success', title: 'Règles commerciales mises à jour' });
      await loadAdminOverview();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleSaveRegRules = async () => {
    if (!regRules) return;
    try {
      await apiFetch('/api/admin/rules/registration', {
        method: 'PUT',
        body: JSON.stringify(regRules),
      });
      addToast({ type: 'success', title: 'Critères d’inscription et KYC enregistrés' });
      await loadAdminOverview();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleCreateBadge = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/badges', {
        method: 'POST',
        body: JSON.stringify(newBadge),
      });
      setNewBadge({
        name: '',
        criteriaDescription: '',
        publicDescription: '',
        isMandatory: false,
        autoAssign: false,
      });
      addToast({ type: 'success', title: 'Nouveau badge de certification créé' });
      await loadAdminOverview();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleCategoryRestriction = async (
    catId: string,
    isRestricted: boolean,
    requiredBadgeId: string | null
  ) => {
    try {
      await apiFetch(`/api/admin/categories/${catId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isRestricted, requiredBadgeId }),
      });
      addToast({ type: 'success', title: 'Restriction de catégorie mise à jour' });
      await loadAdminOverview();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleSaveZones = async () => {
    try {
      await apiFetch('/api/admin/zones', {
        method: 'PUT',
        body: JSON.stringify({ zones: zonesDraft }),
      });
      addToast({ type: 'success', title: 'Zones et tarifs de livraison mis à jour' });
      await loadAdminOverview();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleSaveEditorial = async () => {
    try {
      await apiFetch('/api/admin/editorial', {
        method: 'PUT',
        body: JSON.stringify(editorialDraft),
      });
      addToast({ type: 'success', title: 'Textes éditoriaux de la vitrine mis à jour' });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleSaveLegal = async () => {
    try {
      await apiFetch('/api/admin/legal', {
        method: 'PUT',
        body: JSON.stringify(legalDraft),
      });
      addToast({ type: 'success', title: 'Textes légaux et CGV mis à jour' });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleSendPushAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ sentCount: number; deliveredCount: number }>(
        '/api/admin/notifications/send',
        {
          method: 'POST',
          body: JSON.stringify(alertForm),
        }
      );
      setAlertForm({
        title: '',
        body: '',
        targetCategory: 'all',
        targetRegion: 'all',
        targetUrl: '/catalogue',
      });
      addToast({
        type: 'success',
        title: 'Campagne d’alerte diffusée',
        description: `${res.sentCount} abonné(s) ciblé(s).`,
      });
      await loadAdminOverview();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Envoi impossible', description: err.message });
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 space-y-4">
        <div className="h-10 w-64 rounded emrod-skeleton" />
        <div className="h-56 w-full rounded-[var(--radius-m)] emrod-skeleton" />
      </div>
    );
  }

  // First-Run Setup or Login Gate
  if (!data) {
    const isUnclaimed = authStatus?.mode === 'unclaimed';
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <div className="p-8 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-[var(--color-gold)] flex items-center justify-center">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--color-wood)]">Direction EMROD SARL</p>
              <h1 className="font-display text-2xl font-semibold text-[var(--color-ink)]">
                {isUnclaimed ? 'Initialiser l’accès Administrateur' : 'Accès Back-office EMROD'}
              </h1>
            </div>
          </div>

          <p className="text-xs text-[var(--color-body)] leading-relaxed">
            {isUnclaimed
              ? 'Premier démarrage : définissez le mot de passe maître de la direction EMROD pour déverrouiller le pilotage de la place de marché.'
              : 'Saisissez le mot de passe administrateur pour ouvrir le centre de commandement.'}
          </p>

          <form onSubmit={isUnclaimed ? handleClaimAdmin : handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                Mot de passe administrateur (8 car. min)
              </label>
              <input
                required
                type="password"
                minLength={8}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
              />
            </div>

            {isUnclaimed && (
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Confirmer le mot de passe
                </label>
                <input
                  required
                  type="password"
                  minLength={8}
                  value={confirmPasscode}
                  onChange={(e) => setConfirmPasscode(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submittingAuth}
              className="w-full py-3 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white hover:bg-[var(--color-wood)] font-semibold text-sm transition-colors"
            >
              {submittingAuth
                ? 'Vérification...'
                : isUnclaimed
                  ? 'Activer mon espace Administrateur'
                  : 'Entrer dans le Back-office'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const simZone = zonesDraft.find((z) => z.id === simZoneId) || null;
  const simResult = calculateDeliveryFee(simZone, [{ weightKg: simWeightKg, quantity: 1 }]);

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-10 space-y-8">
      {/* Header with Double-Hat Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-[var(--color-line)]">
        <div>
          <p className="text-xs font-medium text-[var(--color-wood)]">
            Gouvernance & Conformité · emroddf.com
          </p>
          <h1 className="font-display text-3xl font-semibold text-[var(--color-ink)] mt-1">
            Centre de Commandement EMROD
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/vendeur')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white text-xs font-semibold transition-colors"
          >
            <Store className="w-4 h-4" />
            <span>Basculer vers Espace Vendeur EMROD</span>
          </button>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-medium text-[var(--color-wood)] hover:text-[var(--color-danger)]"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Déconnexion</span>
          </button>
        </div>
      </div>

      {/* 15 Admin Command Tabs — rail défilable sans scrollbar sur mobile,
          retour au wrap naturel dès lg (plus de place). */}
      <nav className="flex flex-nowrap overflow-x-auto no-scrollbar lg:flex-wrap lg:overflow-visible items-center gap-2 border-b border-[var(--color-line)] pb-3 -mx-4 px-4 sm:mx-0 sm:px-0">
        {[
          { id: 'overview', label: 'Vue d’ensemble', icon: FileText },
          { id: 'stats', label: 'Statistiques', icon: BarChart3 },
          { id: 'finance', label: 'Finance & Commissions', icon: Wallet },
          { id: 'orders', label: 'Commandes', icon: Package },
          { id: 'products', label: 'Catalogue global', icon: Boxes },
          { id: 'buyers', label: 'Acheteurs (CRM)', icon: Contact },
          { id: 'vendors', label: `Vendeurs & KYC (${data.vendors.length})`, icon: Users },
          { id: 'rules', label: 'Règles & Badges', icon: Award },
          { id: 'moderation', label: `Modération & Litiges (${data.kpis.openDisputes})`, icon: Scale },
          { id: 'delivery', label: 'Livraison & Vitrine', icon: Truck },
          { id: 'payments', label: 'Paiements Djomy', icon: CreditCard },
          { id: 'alerts', label: 'Alertes Push & PWA', icon: Bell },
          { id: 'security', label: 'Sécurité & Sessions', icon: KeyRound },
          { id: 'system', label: 'Système & Maintenance', icon: Server },
          { id: 'audit', label: 'Journaux d’audit', icon: ShieldCheck },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as any)}
              className={`inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 px-3.5 py-2 rounded-[var(--radius-s)] text-xs font-medium transition-colors ${
                activeTab === t.id
                  ? 'bg-[var(--color-ink)] text-white'
                  : 'text-[var(--color-wood)] hover:bg-[var(--color-cream)] hover:text-[var(--color-ink)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* TAB 1: KPI OVERVIEW & EXPORTS (F-ADM-01, F-ADM-11) */}
      {activeTab === 'overview' && (
        <AdminOverviewTab
          data={data}
          handleDownloadCsv={handleDownloadCsv}
        />
      )}

      {/* TAB STATS: analytics consolidés (v2) */}
      {activeTab === 'stats' && <AdminStatsTab />}

      {/* TAB FINANCE: moteur de commissions EMROD (v2) */}
      {activeTab === 'finance' && <AdminFinanceTab data={data} />}

      {/* TAB ORDERS: gestion globale des commandes (v2) */}
      {activeTab === 'orders' && <AdminOrdersTab />}

      {/* TAB PRODUCTS: catalogue global (v2) */}
      {activeTab === 'products' && <AdminProductsTab />}

      {/* TAB BUYERS: CRM acheteurs (v2) */}
      {activeTab === 'buyers' && <AdminBuyersTab />}

      {/* TAB 2: VENDORS & KYC INSPECTION (F-ADM-02, F-VEN-02..05) */}
      {activeTab === 'vendors' && (
        <AdminVendorsTab
          data={data}
          handleVendorStatus={handleVendorStatus}
          handleDocReview={handleDocReview}
          handleCertToggle={handleCertToggle}
        />
      )}

      {/* TAB 3: DYNAMIC RULES, RESTRICTIONS, BADGES & CATEGORIES (F-ADM-03..05, F-CER-01..04) */}
      {activeTab === 'rules' && restrictions && regRules && (
        <AdminRulesTab
          data={data}
          restrictions={restrictions}
          setRestrictions={setRestrictions}
          regRules={regRules}
          setRegRules={setRegRules}
          newBadge={newBadge}
          setNewBadge={setNewBadge}
          newField={newField}
          setNewField={setNewField}
          handleSaveRestrictions={handleSaveRestrictions}
          handleSaveRegRules={handleSaveRegRules}
          handleCreateBadge={handleCreateBadge}
          handleCategoryRestriction={handleCategoryRestriction}
        />
      )}

      {/* TAB 4: MODERATION & DISPUTE ARBITRATION (F-ADM-06, F-ADM-09) */}
      {activeTab === 'moderation' && (
        <AdminModerationTab
          data={data}
          loadAdminOverview={loadAdminOverview}
        />
      )}

      {/* TAB 5: DELIVERY ZONES, SIMULATOR & EDITORIAL / LEGAL TEXTS (F-ADM-08, F-ADM-12, US-A09) */}
      {activeTab === 'delivery' && (
        <AdminDeliveryTab
          zonesDraft={zonesDraft}
          setZonesDraft={setZonesDraft}
          simZoneId={simZoneId}
          setSimZoneId={setSimZoneId}
          simWeightKg={simWeightKg}
          setSimWeightKg={setSimWeightKg}
          simResult={simResult}
          editorialDraft={editorialDraft}
          setEditorialDraft={setEditorialDraft}
          legalDraft={legalDraft}
          setLegalDraft={setLegalDraft}
          handleSaveZones={handleSaveZones}
          handleSaveEditorial={handleSaveEditorial}
          handleSaveLegal={handleSaveLegal}
        />
      )}

      {/* TAB 6: DJOMY PAYMENTS & RECONCILIATION (F-PAY-02..04) */}
      {activeTab === 'payments' && (
        <AdminPaymentsTab
          data={data}
          djomyDiag={djomyDiag}
          loadAdminOverview={loadAdminOverview}
        />
      )}

      {/* TAB 7: PUSH ALERTS & PWA STATS (F-ADM-07, F-PWA-05) */}
      {activeTab === 'alerts' && (
        <AdminAlertsTab
          data={data}
          alertForm={alertForm}
          setAlertForm={setAlertForm}
          handleSendPushAlert={handleSendPushAlert}
        />
      )}

      {/* TAB SECURITY: sessions, mot de passe maître, blacklist (v2) */}
      {activeTab === 'security' && <AdminSecurityTab />}

      {/* TAB SYSTEM: santé, maintenance, intégrations (v2) */}
      {activeTab === 'system' && <AdminSystemTab />}

      {/* TAB 8: AUDIT LOGS (F-ADM-10) */}
      {activeTab === 'audit' && (
        <AdminAuditTab
          data={data}
          auditSearch={auditSearch}
          setAuditSearch={setAuditSearch}
        />
      )}
    </div>
  );
};
