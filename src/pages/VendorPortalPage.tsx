import React, { useEffect, useState } from 'react';
import {
  
  
  ArrowRight,
  
  
  
  
  
  LogOut,
  
  
  
  
  
  
  Store,
  
  
  
} from 'lucide-react';
import { useRouter } from '../context/RouterContext';
import { useToast } from '../context/ToastContext';
import { apiFetch, setMemoryAuthToken } from '../lib/api';
import {
  
  detectExternalContactAttempt,
  
  getVendorAccountStatusLabel,
  
} from '../shared/domain';
import type {
  
  
  
  
  OrderStatus,
  
  ProductItem,
  RegistrationFieldRule,
  
  
  
} from '../shared/types';
import { CertificationSeal } from '../components/ui/CertificationSeal';

interface VendorPortalPageProps {
  mode: 'register' | 'workspace';
}
import type { VendorDashboardPayload, VendorProductForm, VendorProfileForm } from './vendor/types';
import { SAMPLE_MEDIA_URLS } from './vendor/types';
import { OverviewTab } from './vendor/OverviewTab';
import { ProductsTab } from './vendor/ProductsTab';
import { OrdersTab } from './vendor/OrdersTab';
import { QuotesTab } from './vendor/QuotesTab';
import { MessagesTab } from './vendor/MessagesTab';
import { PayoutsTab } from './vendor/PayoutsTab';

export const VendorPortalPage: React.FC<VendorPortalPageProps> = ({ mode }) => {
  const { navigate } = useRouter();
  const { addToast } = useToast();

  // Session & View State
  const [sessionRole, setSessionRole] = useState<'admin' | 'vendor' | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [dash, setDash] = useState<VendorDashboardPayload | null>(null);
  const [loadingDash, setLoadingDash] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'products' | 'orders' | 'quotes' | 'messages' | 'payouts'
  >('overview');

  // Public Rules for Registration
  const [regFields, setRegFields] = useState<RegistrationFieldRule[]>([]);
  const [regEnabled, setRegEnabled] = useState(true);

  // Registration Form State
  const [regData, setRegData] = useState({
    email: '',
    phone: '',
    password: '',
    entityType: 'individual' as 'individual' | 'company',
    shopName: '',
    location: 'Conakry, Ratoma',
    description: '',
    story: '',
    customFields: {} as Record<string, string>,
  });
  const [regSubmitting, setRegSubmitting] = useState(false);

  // Login Form State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  // KYC Upload State
  const [kycDocType, setKycDocType] = useState('id_card');
  const [kycFileName, setKycFileName] = useState('');
  const [kycDataUrl, setKycDataUrl] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Product Editor State
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [prodError, setProdError] = useState('');
  const [savingProd, setSavingProd] = useState(false);
  const [extractingKw, setExtractingKw] = useState(false);
  const [prodForm, setProdForm] = useState<VendorProductForm>({
    name: '',
    categoryId: '',
    description: '',
    materials: 'Bois de noyer, finitions à la cire d’abeille',
    dimensions: '120 x 45 x 80 cm',
    weightKg: 35,
    priceGnf: 6500000,
    compareAtPriceGnf: '',
    mode: 'direct' as 'direct' | 'sur_devis',
    status: 'published' as 'draft' | 'published' | 'archived',
    stockQty: 2,
    isUniquePiece: true,
    keywords: [] as string[],
    keywordInput: '',
    media: [
      {
        type: 'image' as 'image' | 'video',
        url: SAMPLE_MEDIA_URLS[0],
        altText: 'Création artisanale EMROD',
      },
    ],
    newMediaUrl: '',
    videoUrl: '',
    pickupAvailable: true,
    pickupAddress: '',
    estimatedDelay: '5 à 10 jours ouvrés',
    zoneFees: {} as Record<string, string>,
  });

  // Vendor profile, bank transfer settings & dynamic compliance fields editor
  const [profileForm, setProfileForm] = useState<VendorProfileForm>({
    shopName: '',
    location: '',
    description: '',
    story: '',
    responseTimeLabel: 'Répond sous 2h',
    customFields: {} as Record<string, string>,
    bankTransferEnabled: false,
    bankName: '',
    bankAccountHolder: '',
    bankIbanRib: '',
    bankSwiftBic: '',
    bankInstructions: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);

  // Quote link input state
  const [quoteAmounts, setQuoteAmounts] = useState<Record<string, string>>({});
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
  const [threadInputs, setThreadInputs] = useState<Record<string, string>>({});

  const loadRules = async () => {
    try {
      const r = await apiFetch<any>('/api/rules/public');
      const fields: RegistrationFieldRule[] = r.registrationRequirements?.fields || [];
      setRegFields(fields);
      setRegEnabled(r.restrictions?.vendorRegistrationEnabled ?? true);
      setRegData((prev) => {
        const nextCustom = { ...prev.customFields };
        for (const f of fields) {
          if (f.type === 'select' && f.options?.length && !nextCustom[f.key]) {
            nextCustom[f.key] = f.options[0];
          }
        }
        return { ...prev, customFields: nextCustom };
      });
    } catch {
      // ignore
    }
  };

  const loadDashboard = async () => {
    setLoadingDash(true);
    try {
      const d = await apiFetch<VendorDashboardPayload>('/api/vendor/dashboard');
      setDash(d);
      let parsedCustom: Record<string, string> = {};
      try {
        parsedCustom = JSON.parse(d.profile.custom_fields_json || '{}');
      } catch {
        parsedCustom = {};
      }
      setProfileForm({
        shopName: d.profile.shop_name || '',
        location: d.profile.location || '',
        description: d.profile.description || '',
        story: d.profile.story || '',
        responseTimeLabel: d.profile.response_time_label || 'Répond sous 2h',
        customFields: parsedCustom,
        bankTransferEnabled: Boolean(d.bankDetails?.bankTransferEnabled),
        bankName: d.bankDetails?.bankName || '',
        bankAccountHolder: d.bankDetails?.bankAccountHolder || '',
        bankIbanRib: d.bankDetails?.bankIbanRib || '',
        bankSwiftBic: d.bankDetails?.bankSwiftBic || '',
        bankInstructions: d.bankDetails?.bankInstructions || '',
      });
      if (d.categories.length > 0 && !prodForm.categoryId) {
        setProdForm((prev) => ({
          ...prev,
          categoryId: d.categories.find((c) => !c.isRestricted)?.id || d.categories[0].id,
        }));
      }
      if (d.registrationRequirements?.documents?.length > 0) {
        setKycDocType(d.registrationRequirements.documents[0].type);
      }
    } catch (err: any) {
      setDash(null);
      if (typeof err?.message === 'string' && err.message.includes('Session expirée')) {
        addToast({
          type: 'info',
          title: 'Session expirée',
          description: 'Votre session a expiré (12 h). Merci de vous reconnecter pour continuer.',
        });
      }
    } finally {
      setLoadingDash(false);
    }
  };

  const checkAuth = async () => {
    try {
      const me = await apiFetch<{
        session: { sub: string; role: 'admin' | 'vendor'; email: string } | null;
      }>('/api/auth/me');
      if (me.session) {
        setSessionRole(me.session.role);
        await loadDashboard();
      } else {
        setSessionRole(null);
        setDash(null);
      }
    } catch {
      setSessionRole(null);
      setDash(null);
    } finally {
      setAuthChecked(true);
    }
  };

  useEffect(() => {
    document.title =
      mode === 'register'
        ? 'Devenir vendeur partenaire — EMROD'
        : 'Espace Vendeur & Atelier — EMROD';
    void loadRules();
    void checkAuth();
  }, [mode]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegSubmitting(true);
    try {
      const res = await apiFetch<{ token: string; role: 'vendor'; shopName: string }>(
        '/api/auth/vendor-register',
        {
          method: 'POST',
          body: JSON.stringify(regData),
        }
      );
      setMemoryAuthToken(res.token);
      setSessionRole('vendor');
      addToast({
        type: 'success',
        title: `Bienvenue ${res.shopName}`,
        description: 'Votre dossier est ouvert. Déposez vos justificatifs KYC pour validation.',
      });
      await loadDashboard();
      navigate('/vendeur');
    } catch (err: any) {
      addToast({ type: 'error', title: 'Inscription refusée', description: err.message });
    } finally {
      setRegSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginSubmitting(true);
    try {
      const res = await apiFetch<{ token: string; role: 'admin' | 'vendor' }>('/api/auth/vendor-login', {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      setMemoryAuthToken(res.token);
      setSessionRole(res.role);
      await loadDashboard();
      addToast({ type: 'success', title: 'Connexion atelier réussie' });
      if (mode === 'register') navigate('/vendeur');
    } catch (err: any) {
      addToast({ type: 'error', title: 'Échec de connexion', description: err.message });
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setMemoryAuthToken(null);
    setSessionRole(null);
    setDash(null);
    addToast({ type: 'info', title: 'Session atelier fermée' });
  };

  const handleKycFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setKycFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setKycDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUploadKyc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kycDataUrl) {
      addToast({
        type: 'error',
        title: 'Fichier justificatif requis',
        description: 'Sélectionnez une pièce (image PNG/JPEG/WebP ou PDF) avant de transmettre votre dossier.',
      });
      return;
    }
    const docRule = dash?.registrationRequirements.documents.find((d) => d.type === kycDocType);
    const finalName = kycFileName || `${kycDocType}_justificatif.pdf`;

    setUploadingDoc(true);
    try {
      await apiFetch('/api/vendor/documents', {
        method: 'POST',
        body: JSON.stringify({
          docType: kycDocType,
          docLabel: docRule?.label || kycDocType,
          fileName: finalName,
          fileDataUrl: kycDataUrl,
        }),
      });
      setKycFileName('');
      setKycDataUrl('');
      addToast({
        type: 'success',
        title: 'Pièce justificative transmise',
        description: 'Votre dossier est maintenant en cours d’examen par EMROD.',
      });
      await loadDashboard();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Envoi refusé', description: err.message });
    } finally {
      setUploadingDoc(false);
    }
  };

  const openNewProductEditor = () => {
    if (!dash) return;
    setEditingId(null);
    setProdError('');
    setProdForm({
      name: '',
      categoryId: dash.categories.find((c) => !c.isRestricted)?.id || dash.categories[0]?.id || '',
      description: '',
      materials: 'Bois de noyer de Guinée, finitions cire naturelle',
      dimensions: '140 x 45 x 82 cm',
      weightKg: 38,
      priceGnf: 7200000,
      compareAtPriceGnf: '',
      mode: 'direct',
      status: dash.compliance.isValidated ? 'published' : 'draft',
      stockQty: 1,
      isUniquePiece: true,
      keywords: [],
      keywordInput: '',
      media: [
        {
          type: 'image',
          url: SAMPLE_MEDIA_URLS[0],
          altText: 'Création artisanale',
        },
      ],
      newMediaUrl: '',
      videoUrl: '',
      pickupAvailable: true,
      pickupAddress: dash.profile.location,
      estimatedDelay: '5 à 10 jours ouvrés',
      zoneFees: {},
    });
    setEditorOpen(true);
  };

  const openEditProduct = (p: ProductItem) => {
    setEditingId(p.id);
    setProdError('');
    const zoneFeeStrings: Record<string, string> = {};
    Object.entries(p.deliveryConfig.zoneFees || {}).forEach(([k, v]) => {
      zoneFeeStrings[k] = String(v);
    });
    const vid = p.media.find((m) => m.type === 'video');
    const imgs = p.media
      .filter((m) => m.type === 'image')
      .map((m) => ({ type: 'image' as const, url: m.url, altText: m.altText }));

    setProdForm({
      name: p.name,
      categoryId: p.categoryId,
      description: p.description,
      materials: p.materials,
      dimensions: p.dimensions,
      weightKg: p.weightKg,
      priceGnf: p.priceGnf,
      compareAtPriceGnf: p.compareAtPriceGnf ? String(p.compareAtPriceGnf) : '',
      mode: p.mode,
      status: p.status === 'removed' || p.status === 'in_review' ? 'draft' : p.status,
      stockQty: p.stockQty,
      isUniquePiece: p.isUniquePiece,
      keywords: p.keywords || [],
      keywordInput: '',
      media: imgs.length > 0 ? imgs : [{ type: 'image', url: SAMPLE_MEDIA_URLS[0], altText: p.name }],
      newMediaUrl: '',
      videoUrl: vid?.url || '',
      pickupAvailable: p.deliveryConfig.pickupAvailable,
      pickupAddress: p.deliveryConfig.pickupAddress,
      estimatedDelay: p.deliveryConfig.estimatedDelay,
      zoneFees: zoneFeeStrings,
    });
    setEditorOpen(true);
  };

  const handleExtractKeywords = async () => {
    if (!dash) return;
    setExtractingKw(true);
    try {
      const cat = dash.categories.find((c) => c.id === prodForm.categoryId)?.name || '';
      const res = await apiFetch<{ keywords: string[] }>('/api/vendor/keywords/extract', {
        method: 'POST',
        body: JSON.stringify({
          name: prodForm.name,
          description: prodForm.description,
          category: cat,
          materials: prodForm.materials,
        }),
      });
      setProdForm((prev) => ({
        ...prev,
        keywords: Array.from(new Set([...prev.keywords, ...res.keywords])).slice(0, 12),
      }));
      addToast({ type: 'success', title: 'Mots-clés extraits automatiquement' });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur extraction', description: err.message });
    } finally {
      setExtractingKw(false);
    }
  };

  const moveMedia = (idx: number, dir: -1 | 1) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= prodForm.media.length) return;
    const arr = [...prodForm.media];
    const [item] = arr.splice(idx, 1);
    arr.splice(nextIdx, 0, item);
    setProdForm({ ...prodForm, media: arr });
  };

  const handleProductImageFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const remainingSlots = Math.max(0, 10 - prodForm.media.length);
    if (remainingSlots === 0) {
      addToast({ type: 'error', title: 'Galerie complète (10 images maximum)' });
      return;
    }

    const resizeImageToDataUrl = (file: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
        reader.onload = () => {
          const src = typeof reader.result === 'string' ? reader.result : '';
          const img = new Image();
          img.onerror = () => resolve(src);
          img.onload = () => {
            const maxDim = 1280;
            const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(src);
              return;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.84));
          };
          img.src = src;
        };
        reader.readAsDataURL(file);
      });

    try {
      const selected = files.slice(0, remainingSlots);
      const uploaded = await Promise.all(
        selected.map(async (f) => ({
          type: 'image' as const,
          url: await resizeImageToDataUrl(f),
          altText: prodForm.name.trim() || f.name.replace(/\.[^.]+$/, '') || 'Création EMROD',
        }))
      );
      setProdForm((prev) => ({
        ...prev,
        media: [...prev.media, ...uploaded].slice(0, 10),
      }));
      addToast({
        type: 'success',
        title: `${uploaded.length} photo${uploaded.length > 1 ? 's' : ''} importée${uploaded.length > 1 ? 's' : ''}`,
      });
    } catch {
      addToast({ type: 'error', title: 'Impossible de charger une image' });
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setProdError('');
    setSavingProd(true);

    const parsedZoneFees: Record<string, number> = {};
    Object.entries(prodForm.zoneFees).forEach(([zId, val]) => {
      const num = Number(val);
      if (val.trim() !== '' && Number.isFinite(num) && num >= 0) {
        parsedZoneFees[zId] = Math.round(num);
      }
    });

    const baseName = prodForm.name.trim() || 'Création EMROD';
    const mediaPayload = [
      ...prodForm.media.slice(0, 10).map((m) => ({
        type: m.type,
        url: m.url,
        altText: m.altText.trim().length >= 2 ? m.altText.trim() : baseName,
      })),
      ...(prodForm.videoUrl.trim()
        ? [{ type: 'video' as const, url: prodForm.videoUrl.trim(), altText: baseName }]
        : []),
    ].map((m, idx) => ({ ...m, sortOrder: idx }));

    const payload = {
      name: prodForm.name,
      categoryId: prodForm.categoryId,
      description: prodForm.description,
      materials: prodForm.materials,
      dimensions: prodForm.dimensions,
      weightKg: Number(prodForm.weightKg),
      priceGnf: prodForm.mode === 'sur_devis' ? 0 : Number(prodForm.priceGnf),
      compareAtPriceGnf: prodForm.compareAtPriceGnf ? Number(prodForm.compareAtPriceGnf) : null,
      mode: prodForm.mode,
      status: prodForm.status,
      stockQty: Number(prodForm.stockQty),
      isUniquePiece: prodForm.isUniquePiece,
      keywords: prodForm.keywords,
      media: mediaPayload,
      deliveryConfig: {
        pickupAvailable: prodForm.pickupAvailable,
        pickupAddress: prodForm.pickupAddress || dash?.profile.location || 'Conakry',
        estimatedDelay: prodForm.estimatedDelay,
        zoneFees: parsedZoneFees,
      },
    };

    try {
      if (editingId) {
        const res = await apiFetch<{ status?: string }>(`/api/vendor/products/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        addToast({
          type: 'success',
          title:
            res.status === 'in_review'
              ? 'Fiche soumise à la pré-modération EMROD'
              : 'Fiche produit mise à jour',
        });
      } else {
        const res = await apiFetch<{ status: string }>('/api/vendor/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        addToast({
          type: 'success',
          title:
            res.status === 'in_review'
              ? 'Produit soumis à la pré-modération EMROD'
              : 'Création enregistrée',
        });
      }
      setEditorOpen(false);
      await loadDashboard();
    } catch (err: any) {
      setProdError(err.message);
      addToast({ type: 'error', title: 'Publication bloquée', description: err.message });
    } finally {
      setSavingProd(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await apiFetch('/api/vendor/profile', {
        method: 'PATCH',
        body: JSON.stringify(profileForm),
      });
      addToast({ type: 'success', title: 'Profil atelier mis à jour' });
      await loadDashboard();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Mise à jour refusée', description: err.message });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDuplicateProduct = async (id: string) => {
    try {
      await apiFetch(`/api/vendor/products/${id}/duplicate`, { method: 'POST' });
      addToast({ type: 'success', title: 'Produit dupliqué en brouillon' });
      await loadDashboard();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleAdvanceOrder = async (orderId: string, nextStatus: OrderStatus) => {
    try {
      const res = await apiFetch<{ status?: string }>(`/api/vendor/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      addToast({ type: 'success', title: `Statut mis à jour : ${res.status || nextStatus}` });
      await loadDashboard();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Transition refusée', description: err.message });
    }
  };

  const handleConfirmBankTransfer = async (orderId: string) => {
    try {
      const res = await apiFetch<{ status: string }>(
        `/api/vendor/orders/${orderId}/confirm-bank-transfer`,
        { method: 'PATCH' }
      );
      addToast({
        type: 'success',
        title: 'Virement bancaire confirmé',
        description: `La commande est passée en statut « ${res.status} ».`,
      });
      await loadDashboard();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur confirmation', description: err.message });
    }
  };

  const handleUpdateQuoteStep = async (quoteId: string, stepStatus: string) => {
    try {
      await apiFetch(`/api/vendor/quotes/${quoteId}/step`, {
        method: 'PATCH',
        body: JSON.stringify({ stepStatus }),
      });
      addToast({ type: 'success', title: 'Étape du projet sur mesure mise à jour' });
      await loadDashboard();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Mise à jour refusée', description: err.message });
    }
  };

  const handleSendQuoteLink = async (quoteId: string) => {
    const amt = Number(quoteAmounts[quoteId] || 0);
    if (amt <= 0) {
      addToast({ type: 'error', title: 'Indiquez le montant du devis en GNF' });
      return;
    }
    try {
      const res = await apiFetch<{ paymentLinkUrl: string; djomyReference: string }>(
        `/api/vendor/quotes/${quoteId}/send-link`,
        {
          method: 'POST',
          body: JSON.stringify({ amountGnf: amt }),
        }
      );
      addToast({
        type: 'success',
        title: 'Lien de paiement Djomy généré',
        description: `Référence : ${res.djomyReference}`,
      });
      await loadDashboard();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleReplyReview = async (reviewId: string) => {
    const reply = (replyTexts[reviewId] || '').trim();
    if (!reply) return;
    try {
      await apiFetch(`/api/vendor/reviews/${reviewId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ reply }),
      });
      addToast({ type: 'success', title: 'Réponse publiée' });
      await loadDashboard();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  const handleSendThreadMessage = async (convId: string) => {
    const content = (threadInputs[convId] || '').trim();
    if (!content) return;
    if (!(dash?.restrictions?.allowExternalContactsInMessages ?? false)) {
      const check = detectExternalContactAttempt(content);
      if (check.blocked) {
        addToast({
          type: 'error',
          title: 'Échange hors plateforme bloqué',
          description: check.reason,
        });
        return;
      }
    }
    try {
      await apiFetch(`/api/vendor/conversations/${convId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      setThreadInputs((prev) => ({ ...prev, [convId]: '' }));
      addToast({ type: 'success', title: 'Réponse envoyée' });
      await loadDashboard();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Erreur', description: err.message });
    }
  };

  if (!authChecked || loadingDash) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-14 space-y-4">
        <div className="h-10 w-72 rounded emrod-skeleton" />
        <div className="h-56 w-full rounded-[var(--radius-m)] emrod-skeleton" />
      </div>
    );
  }

  // Unauthenticated view: Onboarding / Registration or Login
  if (!dash) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-12 space-y-10">
        <div className="max-w-3xl">
          <p className="text-xs font-medium text-[var(--color-wood)]">
            Ateliers & Artisans Partenaires · République de Guinée
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] mt-2">
            {mode === 'register'
              ? 'Rejoindre la place de marché EMROD'
              : 'Espace Vendeur & Gestion d’Atelier'}
          </h1>
          <p className="mt-3 text-sm sm:text-base text-[var(--color-body)] leading-relaxed">
            Exposez vos pièces d’artisanat auprès d’une clientèle exigeante, suivez votre
            conformité en temps réel et encaissez en GNF via Djomy.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Registration Form (F-VEN-01 driven dynamically by Admin rules) */}
          <section className="lg:col-span-7 p-6 sm:p-8 rounded-[var(--radius-m)] bg-[var(--color-cream)] border border-[var(--color-line)] space-y-5">
            <div className="flex items-center justify-between gap-4 pb-4 border-b border-[var(--color-line)]">
              <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
                Ouvrir un compte atelier
              </h2>
              <span className="text-xs text-[var(--color-wood)] font-medium">
                Validation KYC requise
              </span>
            </div>

            {!regEnabled ? (
              <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-surface)] border border-[var(--color-line)] text-sm text-[var(--color-body)]">
                Les nouvelles inscriptions d’ateliers tiers sont temporairement suspendues par la
                direction EMROD.
              </div>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                      Statut juridique *
                    </label>
                    <select
                      value={regData.entityType}
                      onChange={(e) =>
                        setRegData({
                          ...regData,
                          entityType: e.target.value as 'individual' | 'company',
                        })
                      }
                      className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                    >
                      <option value="individual">Artisane / Artisan indépendant</option>
                      <option value="company">Entreprise / Atelier immatriculé (RCCM)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                      Nom commercial / Atelier *
                    </label>
                    <input
                      required
                      value={regData.shopName}
                      onChange={(e) => setRegData({ ...regData, shopName: e.target.value })}
                      placeholder="Ex. Atelier Bois du Fouta"
                      className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                      Courriel professionnel *
                    </label>
                    <input
                      required
                      type="email"
                      value={regData.email}
                      onChange={(e) => setRegData({ ...regData, email: e.target.value })}
                      placeholder="atelier@exemple.gn"
                      className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                      Téléphone (Guinée) *
                    </label>
                    <input
                      required
                      type="tel"
                      value={regData.phone}
                      onChange={(e) => setRegData({ ...regData, phone: e.target.value })}
                      placeholder="+224 622 00 00 00"
                      className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                      Ville / Commune d’atelier *
                    </label>
                    <input
                      required
                      value={regData.location}
                      onChange={(e) => setRegData({ ...regData, location: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                      Mot de passe (8 car. min) *
                    </label>
                    <input
                      required
                      type="password"
                      minLength={8}
                      value={regData.password}
                      onChange={(e) => setRegData({ ...regData, password: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                    Présentation & savoir-faire (20 car. min) *
                  </label>
                  <textarea
                    required
                    minLength={20}
                    rows={3}
                    value={regData.description}
                    onChange={(e) => setRegData({ ...regData, description: e.target.value })}
                    placeholder="Décrivez vos essences de bois, spécialités de menuiserie ou tapisserie..."
                    className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                  />
                </div>

                {/* Dynamic Admin-configured fields beyond base fields */}
                {regFields
                  .filter((f) => !['shopName', 'location', 'description'].includes(f.key))
                  .map((f) => (
                    <div key={f.key}>
                      <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                        {f.label} {f.required ? '*' : ''}
                      </label>
                      {f.type === 'select' && f.options?.length ? (
                        <select
                          required={f.required}
                          value={regData.customFields[f.key] || f.options[0]}
                          onChange={(e) =>
                            setRegData({
                              ...regData,
                              customFields: { ...regData.customFields, [f.key]: e.target.value },
                            })
                          }
                          className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                        >
                          {f.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : f.type === 'textarea' ? (
                        <textarea
                          required={f.required}
                          rows={2}
                          value={regData.customFields[f.key] || ''}
                          onChange={(e) =>
                            setRegData({
                              ...regData,
                              customFields: { ...regData.customFields, [f.key]: e.target.value },
                            })
                          }
                          className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                        />
                      ) : (
                        <input
                          required={f.required}
                          value={regData.customFields[f.key] || ''}
                          onChange={(e) =>
                            setRegData({
                              ...regData,
                              customFields: { ...regData.customFields, [f.key]: e.target.value },
                            })
                          }
                          className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm"
                        />
                      )}
                    </div>
                  ))}

                <button
                  type="submit"
                  disabled={regSubmitting}
                  className="w-full py-3 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] hover:bg-[var(--color-gold-deep)] hover:text-white font-semibold text-sm transition-colors"
                >
                  {regSubmitting ? 'Création du dossier...' : 'Créer mon compte vendeur'}
                </button>
              </form>
            )}
          </section>

          {/* Right: Login for Existing Vendor / EMROD Admin */}
          <section className="lg:col-span-5 p-6 sm:p-8 rounded-[var(--radius-m)] bg-[var(--color-surface)] border border-[var(--color-line)] space-y-5">
            <h2 className="font-display text-xl font-semibold text-[var(--color-ink)]">
              Connexion vendeur existant
            </h2>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Courriel atelier
                </label>
                <input
                  required
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="atelier@exemple.gn"
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-wood)] mb-1">
                  Mot de passe
                </label>
                <input
                  required
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-s)] border border-[var(--color-line)] text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={loginSubmitting}
                className="w-full py-3 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-white hover:bg-[var(--color-wood)] font-semibold text-sm transition-colors"
              >
                {loginSubmitting ? 'Connexion...' : 'Accéder à mon atelier'}
              </button>
            </form>

            <div className="pt-4 border-t border-[var(--color-line)] space-y-2 text-xs text-[var(--color-wood)]">
              <p className="font-semibold text-[var(--color-ink)]">
                Vous gérez la boutique fondatrice EMROD SARL ?
              </p>
              <p>
                Connectez-vous via le portail d’administration pour accéder en un clic à votre
                espace vendeur EMROD.
              </p>
              <button
                type="button"
                onClick={() => navigate('/admin')}
                className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-ink)] underline"
              >
                <span>Ouvrir le Back-office Administrateur</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // Authenticated Vendor Workspace (also supports Admin double-hat!)
  const {
    user,
    profile,
    compliance,
    documents,
    registrationRequirements,
    restrictions,
    categories,
    badges,
    zones,
    products,
    orders,
    quotes,
    reviews,
    threads,
    payouts,
    stats,
  } = dash;

  const earnedBadges = badges.filter((b) => compliance.earnedBadgeIds.includes(b.id));

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-10 space-y-8">
      {/* Double-hat Banner when Admin operates EMROD Official Store */}
      {sessionRole === 'admin' && (
        <div className="p-4 rounded-[var(--radius-s)] bg-[var(--color-ink)] text-[var(--color-cream)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs sm:text-sm">
            <span className="font-semibold text-[var(--color-gold)]">Mode Vendeur Officiel EMROD</span>
            <span className="mx-2 opacity-50">·</span>
            <span>
              Vous pilotez ici la boutique EMROD SARL comme tout vendeur, sans règles d’administration.
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="px-4 py-2 rounded-[var(--radius-s)] bg-[var(--color-gold)] text-[var(--color-ink)] text-xs font-semibold hover:bg-[var(--color-gold-deep)] hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Revenir au Back-office Admin
          </button>
        </div>
      )}

      {/* Vendor Workspace Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-[var(--color-line)]">
        <div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-wood)]">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Store className="w-3.5 h-3.5" />
              <span>Atelier · {profile.location}</span>
            </span>
            <span>·</span>
            <span className="font-semibold text-[var(--color-ink)]">
              Statut : {getVendorAccountStatusLabel(user.status)}
            </span>
          </div>
          <h1 className="font-display text-3xl font-semibold text-[var(--color-ink)] mt-1">
            {profile.shop_name}
          </h1>
          {user.status_reason && (
            <p className="text-xs text-[var(--color-wood)] mt-1">{user.status_reason}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {earnedBadges.map((b) => (
            <CertificationSeal
              key={b.id}
              name={b.name}
              icon={b.icon}
              criteriaDescription={b.criteriaDescription}
              publicDescription={b.publicDescription}
            />
          ))}
          <button
            type="button"
            onClick={() => navigate(`/artisan/${profile.slug}`)}
            className="px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-cream)]"
          >
            Voir ma boutique publique
          </button>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--radius-s)] border border-[var(--color-line)] text-xs font-medium text-[var(--color-wood)] hover:text-[var(--color-danger)]"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Déconnexion</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] pb-3">
        {[
          { id: 'overview', label: 'Tableau de bord & Conformité' },
          { id: 'products', label: `Mes Produits (${products.length})` },
          { id: 'orders', label: `Commandes (${orders.length})` },
          { id: 'quotes', label: `Devis sur mesure (${quotes.length})` },
          { id: 'messages', label: `Messages & Avis (${threads.length + reviews.length})` },
          { id: 'payouts', label: `Versements (${payouts.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 rounded-[var(--radius-s)] text-xs sm:text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-[var(--color-ink)] text-white'
                : 'text-[var(--color-wood)] hover:bg-[var(--color-cream)] hover:text-[var(--color-ink)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* TAB 1: OVERVIEW & COMPLIANCE CHECKLIST (F-VEN-06) */}
      {activeTab === 'overview' && (
        <OverviewTab
          compliance={compliance}
          documents={documents}
          registrationRequirements={registrationRequirements}
          restrictions={restrictions}
          stats={stats}
          kycDocType={kycDocType}
          setKycDocType={setKycDocType}
          kycFileName={kycFileName}
          handleKycFileSelect={handleKycFileSelect}
          handleUploadKyc={handleUploadKyc}
          uploadingDoc={uploadingDoc}
          profileForm={profileForm}
          setProfileForm={setProfileForm}
          savingProfile={savingProfile}
          handleSaveProfile={handleSaveProfile}
        />
      )}

      {/* TAB 2: PRODUCTS CRUD, 10 MEDIA, KEYWORD EXTRACTION & ZONE OVERRIDES (F-PRD-01..06) */}
      {activeTab === 'products' && (
        <ProductsTab
          mode={mode}
          user={user}
          categories={categories}
          zones={zones}
          compliance={compliance}
          products={products}
          editorOpen={editorOpen}
          setEditorOpen={setEditorOpen}
          editingId={editingId}
          prodError={prodError}
          prodForm={prodForm}
          setProdForm={setProdForm}
          savingProd={savingProd}
          extractingKw={extractingKw}
          openNewProductEditor={openNewProductEditor}
          handleExtractKeywords={handleExtractKeywords}
          handleProductImageFiles={handleProductImageFiles}
          handleSaveProduct={handleSaveProduct}
          handleDuplicateProduct={handleDuplicateProduct}
          openEditProduct={openEditProduct}
          moveMedia={moveMedia}
        />
      )}

      {/* TAB 3: VENDOR ORDERS */}
      {activeTab === 'orders' && (
        <OrdersTab
          orders={orders}
          handleAdvanceOrder={handleAdvanceOrder}
          handleConfirmBankTransfer={handleConfirmBankTransfer}
        />
      )}

      {/* TAB 4: BESPOKE QUOTES & DJOMY PAYMENT LINKS (F-PAY-05) */}
      {activeTab === 'quotes' && (
        <QuotesTab
          navigate={navigate}
          zones={zones}
          quotes={quotes}
          quoteAmounts={quoteAmounts}
          setQuoteAmounts={setQuoteAmounts}
          handleUpdateQuoteStep={handleUpdateQuoteStep}
          handleSendQuoteLink={handleSendQuoteLink}
        />
      )}

      {/* TAB 5: MESSAGES & REVIEWS */}
      {activeTab === 'messages' && (
        <MessagesTab
          restrictions={restrictions}
          threads={threads}
          reviews={reviews}
          threadInputs={threadInputs}
          setThreadInputs={setThreadInputs}
          replyTexts={replyTexts}
          setReplyTexts={setReplyTexts}
          handleSendThreadMessage={handleSendThreadMessage}
          handleReplyReview={handleReplyReview}
        />
      )}

      {/* TAB 6: VENDOR PAYOUTS (F-PAY-06) */}
      {activeTab === 'payouts' && (
        <PayoutsTab restrictions={restrictions} payouts={payouts} />
      )}
    </div>
  );
};
