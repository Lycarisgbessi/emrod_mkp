import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  computeDjomyXApiKey,
  DjomyProvider,
  formatDjomyPhoneNumber,
  mapOperatorToDjomyDirectMethod,
  mapOperatorToDjomyGatewayMethods,
  normalizeDjomyBaseUrl,
} from './djomy.ts';

test('computeDjomyXApiKey builds clientId:HMAC-SHA256 hex signature', () => {
  const clientId = 'cli_emrod_test';
  const clientSecret = 'sec_emrod_test';
  const expectedSig = crypto.createHmac('sha256', clientSecret).update(clientId).digest('hex');
  assert.equal(computeDjomyXApiKey(clientId, clientSecret), `${clientId}:${expectedSig}`);
});

test('formatDjomyPhoneNumber normalizes Guinean numbers to 00224...', () => {
  assert.equal(formatDjomyPhoneNumber('+224 623 88 59 59'), '00224623885959');
  assert.equal(formatDjomyPhoneNumber('623885959'), '00224623885959');
  assert.equal(formatDjomyPhoneNumber('224623885959'), '00224623885959');
  assert.equal(formatDjomyPhoneNumber('00224623885959'), '00224623885959');
});

test('normalizeDjomyBaseUrl strips trailing slashes and /v1 suffix', () => {
  assert.equal(normalizeDjomyBaseUrl('https://sandbox-api.djomy.africa/v1/'), 'https://sandbox-api.djomy.africa');
  assert.equal(normalizeDjomyBaseUrl('https://api.djomy.africa/'), 'https://api.djomy.africa');
  assert.equal(normalizeDjomyBaseUrl(''), 'https://sandbox-api.djomy.africa');
});

test('operator mapping helpers map Guinean wallets to official Djomy codes', () => {
  assert.deepEqual(mapOperatorToDjomyGatewayMethods('mobile_money', 'Orange Money'), ['OM']);
  assert.deepEqual(mapOperatorToDjomyGatewayMethods('mobile_money', 'MTN Mobile Money'), ['MOMO']);
  assert.deepEqual(mapOperatorToDjomyGatewayMethods('card', 'Carte'), ['CARD']);
  assert.equal(mapOperatorToDjomyDirectMethod('mobile_money', 'Kulu'), 'KULU');
  assert.equal(mapOperatorToDjomyDirectMethod('mobile_money', 'Soutra Money'), 'SOUTRA_MONEY');
});

test('verifyWebhookSignature validates v1:<hex> HMAC on exact raw body bytes', () => {
  const prevId = process.env.DJOMY_CLIENT_ID;
  const prevSecret = process.env.DJOMY_CLIENT_SECRET;
  const prevWh = process.env.DJOMY_WEBHOOK_SECRET;

  process.env.DJOMY_CLIENT_ID = 'cli_test';
  process.env.DJOMY_CLIENT_SECRET = 'sec_test_secret_123';
  delete process.env.DJOMY_WEBHOOK_SECRET;

  try {
    const provider = new DjomyProvider();
    const rawBody = Buffer.from(
      JSON.stringify({
        eventType: 'payment.success',
        eventId: 'evt_1',
        data: { payment: { transactionId: 'tx_123', status: 'SUCCESS', paidAmount: 500000, currency: 'GNF' } },
      }),
      'utf8'
    );
    const sigHex = crypto.createHmac('sha256', 'sec_test_secret_123').update(rawBody).digest('hex');

    assert.equal(provider.verifyWebhookSignature(rawBody, `v1:${sigHex}`), true);
    assert.equal(provider.verifyWebhookSignature(rawBody, sigHex), false);
    assert.equal(provider.verifyWebhookSignature(Buffer.from('{"tampered":true}'), `v1:${sigHex}`), false);
    assert.equal(provider.verifyWebhookSignature(rawBody, undefined), false);
  } finally {
    if (prevId === undefined) delete process.env.DJOMY_CLIENT_ID;
    else process.env.DJOMY_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env.DJOMY_CLIENT_SECRET;
    else process.env.DJOMY_CLIENT_SECRET = prevSecret;
    if (prevWh === undefined) delete process.env.DJOMY_WEBHOOK_SECRET;
    else process.env.DJOMY_WEBHOOK_SECRET = prevWh;
  }
});

test('parseWebhookPayload handles Djomy V2, V1, payment links, and rejects non-SUCCESS fulfillment', () => {
  const provider = new DjomyProvider();

  const v2 = provider.parseWebhookPayload({
    eventType: 'payment.success',
    eventId: 'evt_v2_1',
    paymentLinkReference: 'LNK-99',
    data: {
      payment: {
        transactionId: 'TX-V2-01',
        status: 'SUCCESS',
        paidAmount: 2500000,
        receivedAmount: 2450000,
        fees: 50000,
        currency: 'GNF',
        merchantPaymentReference: 'EMR-2026-4412',
        providerReference: 'OM-998877',
      },
    },
  });

  assert.ok(v2);
  assert.equal(v2.transactionId, 'TX-V2-01');
  assert.equal(v2.normalizedStatus, 'succeeded');
  assert.equal(v2.paidAmount, 2500000);
  assert.equal(v2.fees, 50000);
  assert.equal(v2.paymentLinkReference, 'LNK-99');
  assert.equal(v2.providerReference, 'OM-998877');

  const v1Pending = provider.parseWebhookPayload({
    eventType: 'payment.pending',
    eventId: 'evt_v1_2',
    data: {
      transactionId: 'TX-V1-02',
      status: 'AUTHORIZED',
    },
  });

  assert.ok(v1Pending);
  assert.equal(v1Pending.normalizedStatus, 'pending');
});

test('DjomyProvider executes official v1 endpoints with compliant auth headers and DTOs', async () => {
  const prevId = process.env.DJOMY_CLIENT_ID;
  const prevSecret = process.env.DJOMY_CLIENT_SECRET;
  const prevBase = process.env.DJOMY_API_BASE_URL;
  const origFetch = globalThis.fetch;

  process.env.DJOMY_CLIENT_ID = 'cli_live_mock';
  process.env.DJOMY_CLIENT_SECRET = 'sec_live_mock';
  process.env.DJOMY_API_BASE_URL = 'https://sandbox-api.djomy.africa';

  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: any }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers || {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method || 'GET', headers, body });

    if (url.endsWith('/v1/auth')) {
      return new Response(JSON.stringify({ success: true, data: { accessToken: 'dj_tok_abc' } }), { status: 200 });
    }
    if (url.endsWith('/v1/payments/gateway')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            transactionId: 'DJM-GW-100',
            status: 'CREATED',
            redirectUrl: 'https://pay.djomy.africa/session/DJM-GW-100',
          },
        }),
        { status: 200 }
      );
    }
    if (url.endsWith('/v1/payments')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: { transactionId: 'DJM-DIR-200', status: 'PENDING' },
        }),
        { status: 200 }
      );
    }
    if (url.endsWith('/v1/payments/DJM-DIR-200/confirmOTP')) {
      return new Response(
        JSON.stringify({ success: true, data: { transactionId: 'DJM-DIR-200', status: 'SUCCESS' } }),
        { status: 200 }
      );
    }
    if (url.endsWith('/v1/payments/DJM-GW-100/status')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            transactionId: 'DJM-GW-100',
            status: 'SUCCESS',
            paidAmount: 1850000,
            currency: 'GNF',
            merchantPaymentReference: 'EMR-2026-8801',
            providerReference: 'OM-MOCK-77',
          },
        }),
        { status: 200 }
      );
    }
    if (url.endsWith('/v1/links')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            paymentLinkReference: 'LNK-777',
            paymentPageUrl: 'https://pay.djomy.africa/link/LNK-777',
          },
        }),
        { status: 200 }
      );
    }
    if (url.endsWith('/v1/links/LNK-777')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            paymentLinkReference: 'LNK-777',
            status: 'REVOKED',
            numberOfUsage: 1,
            payments: [{ transactionId: 'TX-LNK-1', status: 'SUCCESS' }],
          },
        }),
        { status: 200 }
      );
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  try {
    const provider = new DjomyProvider();

    const gw = await provider.createPayment({
      orderNumber: 'EMR-2026-8801',
      amountGnf: 1850000,
      currency: 'GNF',
      method: 'mobile_money',
      operator: 'Orange Money',
      mode: 'redirect',
      buyerName: 'Aissatou Diallo',
      buyerEmail: 'aissatou@example.gn',
      buyerPhone: '+224 623 88 59 59',
      returnUrl: 'https://emrod.example/suivi/tok?djomy_return=1',
    });
    assert.equal(gw.sandbox, false);
    assert.equal(gw.djomyReference, 'DJM-GW-100');
    assert.equal(gw.paymentUrl, 'https://pay.djomy.africa/session/DJM-GW-100');

    const direct = await provider.createPayment({
      orderNumber: 'EMR-2026-8802',
      amountGnf: 900000,
      currency: 'GNF',
      method: 'mobile_money',
      operator: 'Kulu',
      mode: 'direct',
      buyerName: 'Mamadou Bah',
      buyerEmail: 'mamadou@example.gn',
      buyerPhone: '622112233',
      returnUrl: 'http://localhost:3000/suivi/tok',
    });
    assert.equal(direct.otpRequired, true);
    assert.equal(direct.djomyReference, 'DJM-DIR-200');

    const otp = await provider.confirmOtp('DJM-DIR-200', '4829');
    assert.equal(otp.status, 'succeeded');

    const status = await provider.getPaymentStatus('DJM-GW-100');
    assert.equal(status.status, 'succeeded');
    assert.equal(status.paidAmount, 1850000);
    assert.equal(status.providerReference, 'OM-MOCK-77');

    const link = await provider.createPaymentLink({
      title: 'Buffet Sonfonia sur mesure',
      amountGnf: 4500000,
      buyerEmail: 'client@example.gn',
      buyerPhone: '623001122',
      reference: 'qte_99',
      returnUrl: 'https://emrod.example/djomy-lien/qte_99?djomy_return=1',
    });
    assert.equal(link.sandbox, false);
    assert.equal(link.djomyReference, 'LNK-777');

    const linkStatus = await provider.getPaymentLinkStatus('LNK-777');
    assert.equal(linkStatus.paid, true);
    assert.equal(linkStatus.numberOfUsage, 1);

    // Inspect exact call invariants from Djomy OpenAPI docs
    const gwCall = calls.find((c) => c.url.endsWith('/v1/payments/gateway'))!;
    assert.equal(gwCall.body.countryCode, 'GN');
    assert.equal(gwCall.body.payerNumber, '00224623885959');
    assert.deepEqual(gwCall.body.allowedPaymentMethods, ['OM']);
    assert.equal(gwCall.body.returnUrl, 'https://emrod.example/suivi/tok?djomy_return=1');

    const directCall = calls.find((c) => c.url.endsWith('/v1/payments'))!;
    assert.equal(directCall.body.paymentMethod, 'KULU');
    assert.equal(directCall.body.payerIdentifier, '00224622112233');
    assert.equal(directCall.body.returnUrl, undefined); // non-https omitted

    const otpCall = calls.find((c) => c.url.endsWith('/confirmOTP'))!;
    assert.ok(otpCall.headers['X-API-KEY']);
    assert.equal(otpCall.headers.Authorization, undefined); // confirmOTP must NOT send Bearer
    assert.deepEqual(otpCall.body, { oneTimePin: '4829' });
  } finally {
    globalThis.fetch = origFetch;
    if (prevId === undefined) delete process.env.DJOMY_CLIENT_ID;
    else process.env.DJOMY_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env.DJOMY_CLIENT_SECRET;
    else process.env.DJOMY_CLIENT_SECRET = prevSecret;
    if (prevBase === undefined) delete process.env.DJOMY_API_BASE_URL;
    else process.env.DJOMY_API_BASE_URL = prevBase;
  }
});
