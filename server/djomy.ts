import crypto from 'node:crypto';

export type DjomyGatewayPaymentMethod = 'OM' | 'MOMO' | 'SOUTRA_MONEY' | 'PAYCARD' | 'CARD';
export type DjomyDirectPaymentMethod = 'OM' | 'MOMO' | 'KULU' | 'SOUTRA_MONEY' | 'PAYCARD' | 'YMO';

export interface DjomyPaymentRequest {
  orderNumber: string;
  amountGnf: number;
  currency: 'GNF';
  method: 'mobile_money' | 'card' | 'qr' | 'link';
  operator?: string;
  mode: 'redirect' | 'direct';
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  returnUrl: string;
  cancelUrl?: string;
  description?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface DjomyPaymentResponse {
  djomyReference: string;
  merchantPaymentReference: string;
  status: 'pending' | 'authorized' | 'succeeded' | 'failed';
  rawStatus?: string;
  paymentUrl: string | null;
  otpRequired: boolean;
  sandbox: boolean;
}

export interface DjomyStatusVerificationResult {
  status: 'pending' | 'authorized' | 'succeeded' | 'failed' | 'refunded';
  rawStatus?: string;
  transactionId?: string;
  paidAmount?: number;
  receivedAmount?: number;
  fees?: number;
  currency?: string;
  merchantPaymentReference?: string;
  providerReference?: string;
  paymentMethod?: string;
  sandbox: boolean;
}

export interface DjomyPaymentLinkStatus {
  paymentLinkReference: string;
  status: 'ACTIVE' | 'REVOKED' | 'PAID';
  paid: boolean;
  numberOfUsage: number;
  amountToPay?: number;
  merchantReference?: string;
  latestTransactionId?: string;
  sandbox: boolean;
}

export interface DjomyRefundResponse {
  refundReference: string;
  status: 'refunded' | 'pending' | 'failed';
  sandbox: boolean;
}

export interface ParsedDjomyWebhook {
  eventId: string;
  eventType: string;
  transactionId: string;
  rawStatus: string;
  normalizedStatus: 'succeeded' | 'failed' | 'refunded' | 'pending';
  paidAmount?: number;
  receivedAmount?: number;
  fees?: number;
  currency?: string;
  merchantPaymentReference?: string;
  paymentLinkReference?: string;
  providerReference?: string;
  paymentMethod?: string;
}

export interface DjomyIntegrationDiagnostics {
  mode: 'live_api' | 'sandbox_simulator';
  baseUrl: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasWebhookSecretOverride: boolean;
  webhookPath: string;
}

export interface PaymentProvider {
  createPayment(req: DjomyPaymentRequest): Promise<DjomyPaymentResponse>;
  confirmOtp(
    djomyReference: string,
    otpCode: string
  ): Promise<{ status: 'succeeded' | 'pending' | 'failed'; rawStatus?: string; message: string }>;
  getPaymentStatus(djomyReference: string): Promise<DjomyStatusVerificationResult>;
  createPaymentLink(params: {
    title: string;
    description?: string;
    amountGnf: number;
    buyerEmail: string;
    buyerPhone?: string;
    reference: string;
    returnUrl?: string;
    cancelUrl?: string;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<{ url: string; djomyReference: string; sandbox: boolean }>;
  getPaymentLinkStatus(paymentLinkReference: string): Promise<DjomyPaymentLinkStatus>;
  refundPayment(djomyReference: string, amountGnf: number, reason: string): Promise<DjomyRefundResponse>;
  verifyWebhookSignature(rawBody: Buffer | string, signatureHeader: string | undefined): boolean;
  parseWebhookPayload(body: unknown): ParsedDjomyWebhook | null;
  getDiagnostics(): DjomyIntegrationDiagnostics;
}

/**
 * Computes the official Djomy X-API-KEY header value:
 * `{clientId}:{HMAC-SHA256(clientId, clientSecret).hex}`
 */
export function computeDjomyXApiKey(clientId: string, clientSecret: string): string {
  const signature = crypto.createHmac('sha256', clientSecret).update(clientId).digest('hex');
  return `${clientId}:${signature}`;
}

/**
 * Formats phone numbers into Djomy's international `00224...` digit format
 * expected by `payerNumber` and `payerIdentifier` (e.g. `00224623885959`).
 */
export function formatDjomyPhoneNumber(phone: string): string {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) {
    return `00${digits.slice(1).replace(/\D/g, '')}`;
  }
  const onlyDigits = digits.replace(/\D/g, '');
  if (onlyDigits.startsWith('00')) return onlyDigits;
  if (onlyDigits.startsWith('224') && onlyDigits.length >= 11) {
    return `00${onlyDigits}`;
  }
  if (onlyDigits.startsWith('6') && onlyDigits.length === 9) {
    return `00224${onlyDigits}`;
  }
  return `00224${onlyDigits}`;
}

export function normalizeDjomyBaseUrl(rawUrl?: string): string {
  const fallback = 'https://sandbox-api.djomy.africa';
  const cleaned = (rawUrl || fallback).trim().replace(/\/+$/, '');
  return cleaned.replace(/\/v1$/i, '');
}

export function mapOperatorToDjomyGatewayMethods(
  method: DjomyPaymentRequest['method'],
  operator?: string
): DjomyGatewayPaymentMethod[] | undefined {
  if (method === 'card') return ['CARD'];
  if (method === 'qr') return undefined; // Show all available wallet / QR options on Djomy portal
  const op = (operator || '').toUpperCase();
  if (op.includes('ORANGE') || op === 'OM') return ['OM'];
  if (op.includes('MTN') || op.includes('MOMO')) return ['MOMO'];
  if (op.includes('PAYCARD')) return ['PAYCARD'];
  if (op.includes('SOUTRA')) return ['SOUTRA_MONEY'];
  return undefined;
}

export function mapOperatorToDjomyDirectMethod(
  method: DjomyPaymentRequest['method'],
  operator?: string
): DjomyDirectPaymentMethod {
  const op = (operator || '').toUpperCase();
  if (op.includes('MTN') || op.includes('MOMO')) return 'MOMO';
  if (op.includes('KULU')) return 'KULU';
  if (op.includes('SOUTRA')) return 'SOUTRA_MONEY';
  if (op.includes('PAYCARD')) return 'PAYCARD';
  if (op.includes('YMO')) return 'YMO';
  if (method === 'card') return 'PAYCARD';
  return 'OM';
}

function isSafePathSegment(val: string): boolean {
  const trimmed = String(val || '').trim();
  return Boolean(trimmed) && trimmed !== '.' && trimmed !== '..' && !trimmed.includes('/') && !trimmed.includes('\\');
}

function isHttpsUrl(url?: string): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

interface DjomyEnvelope<T> {
  success?: boolean;
  message?: string;
  data?: T;
  error?: {
    code?: number;
    message?: string;
    details?: string;
    fieldsErrors?: string[];
  } | null;
  status?: number;
}

export class DjomyProvider implements PaymentProvider {
  private cachedAccessToken: string | null = null;
  private tokenExpiresAtMs = 0;

  private get clientId(): string {
    return process.env.DJOMY_CLIENT_ID?.trim() || '';
  }

  private get clientSecret(): string {
    return process.env.DJOMY_CLIENT_SECRET?.trim() || '';
  }

  private get webhookSecret(): string {
    // Official Djomy docs sign X-Webhook-Signature with DJOMY_CLIENT_SECRET;
    // allow explicit DJOMY_WEBHOOK_SECRET override when provided.
    return process.env.DJOMY_WEBHOOK_SECRET?.trim() || this.clientSecret;
  }

  private get baseOrigin(): string {
    return normalizeDjomyBaseUrl(process.env.DJOMY_API_BASE_URL);
  }

  private get isLiveConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  getDiagnostics(): DjomyIntegrationDiagnostics {
    return {
      mode: this.isLiveConfigured ? 'live_api' : 'sandbox_simulator',
      baseUrl: `${this.baseOrigin}/v1`,
      hasClientId: Boolean(this.clientId),
      hasClientSecret: Boolean(this.clientSecret),
      hasWebhookSecretOverride: Boolean(process.env.DJOMY_WEBHOOK_SECRET?.trim()),
      webhookPath: '/api/payments/djomy/webhook',
    };
  }

  private async getBearerToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cachedAccessToken && Date.now() < this.tokenExpiresAtMs) {
      return this.cachedAccessToken;
    }

    const res = await fetch(`${this.baseOrigin}/v1/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': computeDjomyXApiKey(this.clientId, this.clientSecret),
      },
    });

    if (!res.ok) {
      throw new Error(`Authentification Djomy échouée (HTTP ${res.status}).`);
    }

    const json = (await res.json()) as DjomyEnvelope<{ accessToken?: string }> & {
      accessToken?: string;
      access_token?: string;
    };
    const token = json.data?.accessToken || json.accessToken || json.access_token || '';
    if (!token || json.success === false) {
      throw new Error(json.error?.message || json.message || 'Jeton Djomy non retourné.');
    }

    this.cachedAccessToken = token;
    // Djomy tokens expire in 3600s; refresh safely after 50 minutes
    this.tokenExpiresAtMs = Date.now() + 50 * 60 * 1000;
    return token;
  }

  private async djomyFetch<T>(
    path: string,
    init: {
      method: 'GET' | 'POST';
      body?: Record<string, unknown>;
      requireBearer?: boolean;
    }
  ): Promise<DjomyEnvelope<T>> {
    const useBearer = init.requireBearer !== false;
    const attempt = async (forceRefresh: boolean): Promise<Response> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-KEY': computeDjomyXApiKey(this.clientId, this.clientSecret),
      };
      if (useBearer) {
        headers.Authorization = `Bearer ${await this.getBearerToken(forceRefresh)}`;
      }
      return fetch(`${this.baseOrigin}${path}`, {
        method: init.method,
        headers,
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
    };

    let res = await attempt(false);
    if (res.status === 401 && useBearer) {
      res = await attempt(true);
    }

    const json = (await res.json().catch(() => ({}))) as DjomyEnvelope<T>;
    if (!res.ok || json.success === false) {
      const errDetail =
        json.error?.fieldsErrors?.join(' · ') ||
        json.error?.details ||
        json.error?.message ||
        json.message ||
        `Erreur API Djomy (${res.status})`;
      throw new Error(errDetail);
    }
    return json;
  }

  async createPayment(req: DjomyPaymentRequest): Promise<DjomyPaymentResponse> {
    const sandboxRef = `DJM-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    if (this.isLiveConfigured) {
      const payerPhone = formatDjomyPhoneNumber(req.buyerPhone);
      const httpsReturn = isHttpsUrl(req.returnUrl) ? req.returnUrl : undefined;
      const httpsCancel = isHttpsUrl(req.cancelUrl) ? req.cancelUrl : httpsReturn;

      if (req.mode === 'redirect') {
        const allowedPaymentMethods = mapOperatorToDjomyGatewayMethods(req.method, req.operator);
        const envelope = await this.djomyFetch<{
          transactionId?: string;
          status?: string;
          redirectUrl?: string;
          paymentUrl?: string;
          merchantPaymentReference?: string;
        }>('/v1/payments/gateway', {
          method: 'POST',
          body: {
            amount: Math.round(req.amountGnf),
            countryCode: 'GN',
            payerNumber: payerPhone,
            ...(allowedPaymentMethods ? { allowedPaymentMethods } : {}),
            description: req.description || `Commande EMROD ${req.orderNumber}`,
            merchantPaymentReference: req.orderNumber,
            ...(httpsReturn ? { returnUrl: httpsReturn } : {}),
            ...(httpsCancel ? { cancelUrl: httpsCancel } : {}),
            metadata: {
              orderNumber: req.orderNumber,
              ...(req.metadata || {}),
            },
          },
        });

        const data = envelope.data || {};
        return {
          djomyReference: data.transactionId || sandboxRef,
          merchantPaymentReference: data.merchantPaymentReference || req.orderNumber,
          status: 'pending',
          rawStatus: data.status || 'CREATED',
          paymentUrl: data.redirectUrl || data.paymentUrl || null,
          otpRequired: false, // Gateway handles OTP natively on Djomy portal
          sandbox: false,
        };
      }

      // Direct mode: POST /v1/payments
      const directMethod = mapOperatorToDjomyDirectMethod(req.method, req.operator);
      const envelope = await this.djomyFetch<{
        transactionId?: string;
        status?: string;
        redirectUrl?: string;
        paymentUrl?: string;
        merchantPaymentReference?: string;
      }>('/v1/payments', {
        method: 'POST',
        body: {
          paymentMethod: directMethod,
          payerIdentifier: payerPhone,
          amount: Math.round(req.amountGnf),
          countryCode: 'GN',
          description: req.description || `Commande EMROD ${req.orderNumber}`,
          merchantPaymentReference: req.orderNumber,
          ...(httpsReturn ? { returnUrl: httpsReturn } : {}),
          ...(httpsCancel ? { cancelUrl: httpsCancel } : {}),
          metadata: {
            orderNumber: req.orderNumber,
            ...(req.metadata || {}),
          },
        },
      });

      const data = envelope.data || {};
      const rawStatus = String(data.status || 'PENDING').toUpperCase();
      return {
        djomyReference: data.transactionId || sandboxRef,
        merchantPaymentReference: data.merchantPaymentReference || req.orderNumber,
        status: rawStatus === 'SUCCESS' ? 'succeeded' : rawStatus === 'FAILED' ? 'failed' : 'pending',
        rawStatus,
        paymentUrl: data.redirectUrl || data.paymentUrl || null,
        otpRequired: true,
        sandbox: false,
      };
    }

    // Local sandbox simulator fallback when DJOMY_CLIENT_ID/SECRET are unset
    return {
      djomyReference: sandboxRef,
      merchantPaymentReference: req.orderNumber,
      status: 'pending',
      rawStatus: 'PENDING',
      paymentUrl: req.mode === 'redirect' ? `/djomy-portail/${sandboxRef}` : null,
      otpRequired: req.mode === 'direct',
      sandbox: true,
    };
  }

  async confirmOtp(
    djomyReference: string,
    otpCode: string
  ): Promise<{ status: 'succeeded' | 'pending' | 'failed'; rawStatus?: string; message: string }> {
    const cleanRef = String(djomyReference || '').trim();
    const cleanPin = String(otpCode || '').trim();
    if (!isSafePathSegment(cleanRef)) {
      return { status: 'failed', message: 'Référence transaction Djomy invalide.' };
    }
    if (!/^\d{4,6}$/.test(cleanPin)) {
      return { status: 'failed', message: 'Code OTP invalide (saisissez 4 à 6 chiffres).' };
    }

    if (this.isLiveConfigured) {
      // Official Djomy endpoint: POST /v1/payments/{transactionReference}/confirmOTP
      // Uses X-API-KEY header only (no Bearer token per docs) and { oneTimePin }.
      const envelope = await this.djomyFetch<{ status?: string; transactionId?: string }>(
        `/v1/payments/${encodeURIComponent(cleanRef)}/confirmOTP`,
        {
          method: 'POST',
          requireBearer: false,
          body: { oneTimePin: cleanPin },
        }
      );
      const rawStatus = String(envelope.data?.status || '').toUpperCase();
      if (rawStatus === 'SUCCESS') {
        return { status: 'succeeded', rawStatus, message: 'Paiement confirmé par Djomy.' };
      }
      if (rawStatus === 'FAILED' || rawStatus === 'CANCELLED') {
        return { status: 'failed', rawStatus, message: 'Transaction refusée par Djomy.' };
      }
      return {
        status: 'pending',
        rawStatus: rawStatus || 'PENDING',
        message: 'Code OTP transmis. En attente de validation finale de l’opérateur.',
      };
    }

    return {
      status: 'succeeded',
      rawStatus: 'SUCCESS',
      message: 'Code OTP vérifié avec succès sur le simulateur sandbox Djomy.',
    };
  }

  async getPaymentStatus(djomyReference: string): Promise<DjomyStatusVerificationResult> {
    const cleanRef = String(djomyReference || '').trim();
    if (!isSafePathSegment(cleanRef)) {
      return { status: 'failed', sandbox: !this.isLiveConfigured };
    }

    if (this.isLiveConfigured) {
      const envelope = await this.djomyFetch<{
        transactionId?: string;
        status?: string;
        paidAmount?: number;
        receivedAmount?: number;
        fees?: number;
        currency?: string;
        merchantPaymentReference?: string;
        providerReference?: string;
        paymentMethod?: string;
      }>(`/v1/payments/${encodeURIComponent(cleanRef)}/status`, {
        method: 'GET',
      });

      const data = envelope.data || {};
      const rawStatus = String(data.status || '').toUpperCase();
      // Per Djomy docs: ONLY 'SUCCESS' fulfills an order; CREATED/PENDING/REDIRECTED/AUTHORIZED/CAPTURED are non-final
      let status: DjomyStatusVerificationResult['status'] = 'pending';
      if (rawStatus === 'SUCCESS') status = 'succeeded';
      else if (rawStatus === 'FAILED' || rawStatus === 'CANCELLED') status = 'failed';
      else if (rawStatus === 'REFUNDED') status = 'refunded';

      return {
        status,
        rawStatus,
        transactionId: data.transactionId,
        paidAmount: typeof data.paidAmount === 'number' ? data.paidAmount : undefined,
        receivedAmount: typeof data.receivedAmount === 'number' ? data.receivedAmount : undefined,
        fees: typeof data.fees === 'number' ? data.fees : undefined,
        currency: data.currency,
        merchantPaymentReference: data.merchantPaymentReference,
        providerReference: data.providerReference,
        paymentMethod: data.paymentMethod,
        sandbox: false,
      };
    }

    return { status: 'succeeded', rawStatus: 'SUCCESS', sandbox: true };
  }

  async createPaymentLink(params: {
    title: string;
    description?: string;
    amountGnf: number;
    buyerEmail: string;
    buyerPhone?: string;
    reference: string;
    returnUrl?: string;
    cancelUrl?: string;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<{ url: string; djomyReference: string; sandbox: boolean }> {
    const sandboxRef = `DJM-LINK-${Date.now().toString(36).toUpperCase()}`;

    if (this.isLiveConfigured) {
      const httpsReturn = isHttpsUrl(params.returnUrl) ? params.returnUrl : undefined;
      const httpsCancel = isHttpsUrl(params.cancelUrl) ? params.cancelUrl : httpsReturn;
      const formattedPhone = params.buyerPhone ? formatDjomyPhoneNumber(params.buyerPhone) : undefined;

      const envelope = await this.djomyFetch<{
        paymentLinkReference?: string;
        reference?: string;
        paymentPageUrl?: string;
        url?: string;
      }>('/v1/links', {
        method: 'POST',
        body: {
          countryCode: 'GN',
          amountToPay: Math.round(params.amountGnf),
          linkName: params.title.slice(0, 120),
          description: params.description || params.title,
          usageType: 'UNIQUE',
          merchantReference: params.reference,
          ...(formattedPhone ? { phoneNumber: formattedPhone, sendSms: false } : {}),
          ...(httpsReturn ? { returnUrl: httpsReturn } : {}),
          ...(httpsCancel ? { cancelUrl: httpsCancel } : {}),
          metadata: {
            merchantReference: params.reference,
            buyerEmail: params.buyerEmail,
            ...(params.metadata || {}),
          },
        },
      });

      const data = envelope.data || {};
      const linkRef = data.paymentLinkReference || data.reference || sandboxRef;
      const pageUrl = data.paymentPageUrl || data.url;
      if (pageUrl) {
        return {
          url: pageUrl,
          djomyReference: linkRef,
          sandbox: false,
        };
      }
    }

    return {
      url: `/djomy-lien/${sandboxRef}`,
      djomyReference: sandboxRef,
      sandbox: true,
    };
  }

  async getPaymentLinkStatus(paymentLinkReference: string): Promise<DjomyPaymentLinkStatus> {
    const cleanRef = String(paymentLinkReference || '').trim();
    if (!isSafePathSegment(cleanRef) || !this.isLiveConfigured) {
      return {
        paymentLinkReference: cleanRef,
        status: 'ACTIVE',
        paid: false,
        numberOfUsage: 0,
        sandbox: !this.isLiveConfigured,
      };
    }

    const envelope = await this.djomyFetch<{
      paymentLinkReference?: string;
      status?: 'ACTIVE' | 'REVOKED' | 'PAID';
      numberOfUsage?: number;
      amountToPay?: number;
      merchantReference?: string;
      payments?: Array<{ transactionId?: string; status?: string }>;
    }>(`/v1/links/${encodeURIComponent(cleanRef)}`, {
      method: 'GET',
    });

    const data = envelope.data || {};
    const usages = Number(data.numberOfUsage || 0);
    const payments = Array.isArray(data.payments) ? data.payments : [];
    const succeededPay = payments.find((p) => String(p.status || '').toUpperCase() === 'SUCCESS');
    const paid = usages > 0 || data.status === 'PAID' || Boolean(succeededPay);

    return {
      paymentLinkReference: data.paymentLinkReference || cleanRef,
      status: data.status || 'ACTIVE',
      paid,
      numberOfUsage: usages,
      amountToPay: data.amountToPay,
      merchantReference: data.merchantReference,
      latestTransactionId: succeededPay?.transactionId || payments[0]?.transactionId,
      sandbox: false,
    };
  }

  async refundPayment(
    djomyReference: string,
    amountGnf: number,
    reason: string
  ): Promise<DjomyRefundResponse> {
    const refundRef = `DJM-REF-${Date.now().toString(36).toUpperCase()}`;
    if (!this.isLiveConfigured) {
      // Local sandbox simulator: refunds always succeed instantly
      return { refundReference: refundRef, status: 'refunded', sandbox: true };
    }
    if (!isSafePathSegment(djomyReference)) {
      return { refundReference: refundRef, status: 'failed', sandbox: false };
    }
    try {
      await this.djomyFetch(`/v1/payments/${encodeURIComponent(djomyReference)}/refund`, {
        method: 'POST',
        body: { amount: Math.round(amountGnf), reason },
      });
      return { refundReference: refundRef, status: 'refunded', sandbox: false };
    } catch {
      // Live refund rejected (merchant contract may require a manual dashboard refund).
      // Report the failure honestly so callers never mark an order as refunded without a real refund.
      return { refundReference: refundRef, status: 'failed', sandbox: false };
    }
  }

  verifyWebhookSignature(rawBody: Buffer | string, signatureHeader: string | undefined): boolean {
    if (!this.webhookSecret) {
      // Only permit unsigned calls when running in local sandbox mode without credentials
      return !this.isLiveConfigured;
    }
    if (!signatureHeader) return false;

    const trimmed = signatureHeader.trim();
    // Official Djomy header format: "v1:<hex_signature>"
    if (!trimmed.startsWith('v1:')) return false;
    const providedHex = trimmed.slice(3).trim();
    if (!/^(?:[0-9a-f]{2})+$/i.test(providedHex)) return false;

    const payloadBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    const expectedHex = crypto.createHmac('sha256', this.webhookSecret).update(payloadBuffer).digest('hex');
    const a = Buffer.from(providedHex.toLowerCase(), 'utf8');
    const b = Buffer.from(expectedHex.toLowerCase(), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhookPayload(body: unknown): ParsedDjomyWebhook | null {
    if (!body || typeof body !== 'object') return null;
    const raw = body as Record<string, unknown>;

    // Support both Djomy official V2 (`data.payment`), V1 (`data`), and internal sandbox payload
    const eventType = String(raw.eventType || raw.event || '').trim();
    const eventId = String(raw.eventId || raw.id || `evt_${Date.now()}`).trim();
    const dataObj = (raw.data && typeof raw.data === 'object' ? raw.data : {}) as Record<string, unknown>;
    const paymentObj = (
      dataObj.payment && typeof dataObj.payment === 'object' ? dataObj.payment : dataObj
    ) as Record<string, unknown>;

    const transactionId = String(
      paymentObj.transactionId || raw.djomyReference || raw.transactionId || ''
    ).trim();
    const rawStatus = String(paymentObj.status || raw.status || '').toUpperCase();
    const paymentLinkReference = raw.paymentLinkReference
      ? String(raw.paymentLinkReference)
      : paymentObj.paymentLinkReference
        ? String(paymentObj.paymentLinkReference)
        : undefined;

    if (!transactionId && !paymentLinkReference) return null;

    let normalizedStatus: ParsedDjomyWebhook['normalizedStatus'] = 'pending';
    if (
      (eventType === 'payment.success' && rawStatus === 'SUCCESS') ||
      (!eventType && (rawStatus === 'SUCCESS' || rawStatus === 'SUCCEEDED'))
    ) {
      normalizedStatus = 'succeeded';
    } else if (
      eventType === 'payment.refunded' ||
      rawStatus === 'REFUNDED'
    ) {
      normalizedStatus = 'refunded';
    } else if (
      eventType === 'payment.failed' ||
      eventType === 'payment.cancelled' ||
      eventType === 'payment.timeout' ||
      rawStatus === 'FAILED' ||
      rawStatus === 'CANCELLED'
    ) {
      normalizedStatus = 'failed';
    }

    return {
      eventId,
      eventType: eventType || 'sandbox.callback',
      transactionId,
      rawStatus,
      normalizedStatus,
      paidAmount: typeof paymentObj.paidAmount === 'number' ? paymentObj.paidAmount : undefined,
      receivedAmount:
        typeof paymentObj.receivedAmount === 'number' ? paymentObj.receivedAmount : undefined,
      fees: typeof paymentObj.fees === 'number' ? paymentObj.fees : undefined,
      currency: paymentObj.currency ? String(paymentObj.currency) : undefined,
      merchantPaymentReference: paymentObj.merchantPaymentReference
        ? String(paymentObj.merchantPaymentReference)
        : undefined,
      paymentLinkReference,
      providerReference: paymentObj.providerReference
        ? String(paymentObj.providerReference)
        : undefined,
      paymentMethod: paymentObj.paymentMethod ? String(paymentObj.paymentMethod) : undefined,
    };
  }
}

export const paymentProvider: PaymentProvider = new DjomyProvider();
