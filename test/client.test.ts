import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DisbursementClient, DuitkuNonRetryableError } from '../src/disbursement/client.js';
import { DuitkuApiError, DuitkuConfigError } from '../src/core/errors.js';
import { V2Client } from '../src/v2/client.js';

interface Captured {
  url: string;
  init: RequestInit;
}

/** Records the outgoing request and replays a canned JSON body. */
function stubFetch(response: unknown, status = 200): { fetch: typeof globalThis.fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const CREDS = { merchantCode: 'DXXXX', apiKey: 'testapikey0000000000000000000000' };

test('createPayment posts a signed body to the sandbox inquiry endpoint', async () => {
  const { fetch, calls } = stubFetch({
    merchantCode: 'DXXXX',
    reference: 'DXXXXCX80TZJ85Q70QCI',
    paymentUrl: 'https://sandbox.duitku.com/topup/x',
    vaNumber: '7007014001444348',
    amount: '40000',
    statusCode: '00',
    statusMessage: 'SUCCESS',
  });
  const client = new V2Client({ ...CREDS, fetch });

  const result = await client.createPayment({
    paymentAmount: 40000,
    merchantOrderId: 'abcde12345',
    paymentMethod: 'BC',
    productDetails: 'Payment for Example Store',
    email: 'customer@example.com',
    customerVaName: 'John Doe',
    callbackUrl: 'https://example.com/callback',
    returnUrl: 'https://example.com/return',
  });

  assert.equal(result.reference, 'DXXXXCX80TZJ85Q70QCI');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry');

  const sent = JSON.parse(String(calls[0]!.init.body));
  assert.equal(sent.merchantCode, 'DXXXX');
  assert.equal(sent.signature, client.signInquiry('abcde12345', 40000));
});

test('createPayment normalizes Duitku\'s AppUrl casing', async () => {
  const { fetch } = stubFetch({ AppUrl: 'https://tokopedia.app.link/x', statusCode: '00', statusMessage: 'SUCCESS' });
  const client = new V2Client({ ...CREDS, fetch });
  const result = await client.createPayment({
    paymentAmount: 40000,
    merchantOrderId: 'o1',
    paymentMethod: 'T1',
    productDetails: 'x',
    email: 'a@b.com',
    customerVaName: 'John Doe',
    callbackUrl: 'https://example.com/c',
    returnUrl: 'https://example.com/r',
  });
  assert.equal(result.appUrl, 'https://tokopedia.app.link/x');
});

test('createPayment rejects itemDetails that do not sum to paymentAmount', async () => {
  const client = new V2Client(CREDS);
  await assert.rejects(
    () =>
      client.createPayment({
        paymentAmount: 40000,
        merchantOrderId: 'o1',
        paymentMethod: 'BC',
        productDetails: 'x',
        email: 'a@b.com',
        customerVaName: 'John Doe',
        callbackUrl: 'https://example.com/c',
        returnUrl: 'https://example.com/r',
        itemDetails: [{ name: 'Item', price: 10000, quantity: 1 }],
      }),
    DuitkuConfigError,
  );
});

test('createPayment accepts itemDetails whose quantity-weighted total matches', async () => {
  const { fetch } = stubFetch({ statusCode: '00', statusMessage: 'SUCCESS', reference: 'r' });
  const client = new V2Client({ ...CREDS, fetch });
  const result = await client.createPayment({
    paymentAmount: 40000,
    merchantOrderId: 'o1',
    paymentMethod: 'BC',
    productDetails: 'x',
    email: 'a@b.com',
    customerVaName: 'John Doe',
    callbackUrl: 'https://example.com/c',
    returnUrl: 'https://example.com/r',
    itemDetails: [
      { name: 'Test Item 1', price: 10000, quantity: 1 },
      { name: 'Test Item 2', price: 10000, quantity: 3 },
    ],
  });
  assert.equal(result.reference, 'r');
});

test('createPayment rejects amounts below the 10,000 IDR floor', async () => {
  const client = new V2Client(CREDS);
  await assert.rejects(
    () =>
      client.createPayment({
        paymentAmount: 5000,
        merchantOrderId: 'o1',
        paymentMethod: 'BC',
        productDetails: 'x',
        email: 'a@b.com',
        callbackUrl: 'https://example.com/c',
        returnUrl: 'https://example.com/r',
      }),
    /at least 10000/,
  );
});

test('paylater channels require customerDetail and itemDetails', async () => {
  const client = new V2Client(CREDS);
  await assert.rejects(
    () =>
      client.createPayment({
        paymentAmount: 40000,
        merchantOrderId: 'o1',
        paymentMethod: 'DN',
        productDetails: 'x',
        email: 'a@b.com',
        callbackUrl: 'https://example.com/c',
        returnUrl: 'https://example.com/r',
      }),
    /paylater/,
  );
});

test('a non-00 statusCode on a 200 response becomes a DuitkuApiError', async () => {
  const { fetch } = stubFetch({ statusCode: '01', statusMessage: 'Wrong signature' });
  const client = new V2Client({ ...CREDS, fetch });
  await assert.rejects(
    () =>
      client.createPayment({
        paymentAmount: 40000,
        merchantOrderId: 'o1',
        paymentMethod: 'BC',
        productDetails: 'x',
        email: 'a@b.com',
        customerVaName: 'John Doe',
        callbackUrl: 'https://example.com/c',
        returnUrl: 'https://example.com/r',
      }),
    (err: unknown) => err instanceof DuitkuApiError && err.code === '01',
  );
});

test('getTransactionStatus returns pending and failed codes instead of throwing', async () => {
  const { fetch } = stubFetch({ merchantOrderId: 'o1', reference: 'r', amount: '40000', fee: '0.00', statusCode: '02', statusMessage: 'CANCELED' });
  const client = new V2Client({ ...CREDS, fetch });
  const status = await client.getTransactionStatus('o1');
  assert.equal(status.statusCode, '02');
});

test('a timed-out request surfaces as a DuitkuApiError with status 0', async () => {
  const fetch = (async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }) as unknown as typeof globalThis.fetch;
  const client = new V2Client({ ...CREDS, fetch, timeoutMs: 5 });
  await assert.rejects(
    () => client.getTransactionStatus('o1'),
    (err: unknown) => err instanceof DuitkuApiError && err.status === 0 && /timed out/.test(err.message),
  );
});

test('disbursement uses the sandbox path suffix and drops it in production', async () => {
  const { fetch, calls } = stubFetch({ accountName: 'John Doe', custRefNumber: 'R1', disburseId: 1, responseCode: '00', responseDesc: 'SUCCESS' });
  const sandbox = new DisbursementClient({ userId: '3551', email: 'demo@duitku.com', secretKey: 's', fetch });
  await sandbox.inquiry({ amountTransfer: 10000, bankAccount: '8760673566', bankCode: '014' });
  assert.equal(calls[0]!.url, 'https://sandbox.duitku.com/webapi/api/disbursement/inquirysandbox');

  const prod = new DisbursementClient({ userId: '3551', email: 'demo@duitku.com', secretKey: 's', environment: 'production', fetch });
  await prod.inquiry({ amountTransfer: 10000, bankAccount: '8760673566', bankCode: '014' });
  assert.equal(calls[1]!.url, 'https://passport.duitku.com/webapi/api/disbursement/inquiry');
});

test('a do-not-retry transfer code raises DuitkuNonRetryableError', async () => {
  const { fetch } = stubFetch({ responseCode: 'TO', responseDesc: 'Timeout' });
  const client = new DisbursementClient({ userId: '3551', email: 'demo@duitku.com', secretKey: 's', fetch });
  await assert.rejects(
    () =>
      client.transfer({
        amountTransfer: 10000,
        bankAccount: '8760673561',
        bankCode: '014',
        accountName: 'John Doe',
        custRefNumber: 'R1',
        disburseId: 1,
        purpose: 'payout',
      }),
    (err: unknown) => err instanceof DuitkuNonRetryableError && err.code === 'TO',
  );
});

test('cash out posts to the separate disbursement host', async () => {
  const { fetch, calls } = stubFetch({ token: '123456', responseCode: '00', responseDesc: 'SUCCESS' });
  const client = new DisbursementClient({ userId: '3551', email: 'demo@duitku.com', secretKey: 's', fetch });
  const res = await client.cashOut({
    amountTransfer: 100000,
    custRefNumber: 'R1',
    bankCode: '2010',
    accountName: 'John Doe',
    accountAddress: 'Jakarta',
    accountIdentity: '3171000000000000',
    phoneNumber: '08123456789',
    purpose: 'withdrawal',
    callbackUrl: 'https://example.com/cb',
  });
  assert.equal(res.token, '123456');
  assert.equal(calls[0]!.url, 'https://disbursement-sandbox.duitku.com/api/cashout/inquiry');
});
