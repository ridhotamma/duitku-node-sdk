import assert from 'node:assert/strict';
import { createHash, createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { Duitku } from '../src/duitku.js';
import { V2Client } from '../src/v2/client.js';
import { PopClient } from '../src/pop/client.js';
import { DisbursementClient } from '../src/disbursement/client.js';
import { SnapClient } from '../src/snap/client.js';
import { asymmetricAuthSignature, snapTimestamp, symmetricSignature, verifyAsymmetricSignature } from '../src/snap/signature.js';
import { DuitkuSignatureError } from '../src/core/errors.js';

const MERCHANT = 'DXXXX';
const API_KEY = 'testapikey0000000000000000000000';

const v2 = new V2Client({ merchantCode: MERCHANT, apiKey: API_KEY });

test('v2 inquiry signature matches the documented HMAC-SHA256 formula', () => {
  const expected = createHmac('sha256', API_KEY).update(`${MERCHANT}abcde1234540000`).digest('hex');
  assert.equal(v2.signInquiry('abcde12345', 40000), expected);
});

test('v2 callback signature uses the reversed field order', () => {
  const expected = createHmac('sha256', API_KEY).update(`${MERCHANT}40000abcde12345`).digest('hex');
  assert.equal(v2.signCallback(40000, 'abcde12345'), expected);
  assert.notEqual(v2.signCallback(40000, 'abcde12345'), v2.signInquiry('abcde12345', 40000));
});

test('v2 status signature omits the amount', () => {
  const expected = createHmac('sha256', API_KEY).update(`${MERCHANT}abcde12345`).digest('hex');
  assert.equal(v2.signStatus('abcde12345'), expected);
});

test('parseCallback accepts a valid payload and flags payment', () => {
  const payload = {
    merchantCode: MERCHANT,
    amount: '40000',
    merchantOrderId: 'abcde12345',
    reference: 'DXXXXCX80TZJ85Q70QCI',
    resultCode: '00',
    signature: v2.signCallback('40000', 'abcde12345'),
  };
  const parsed = v2.parseCallback(payload);
  assert.equal(parsed.isPaid, true);
  assert.equal(parsed.reference, 'DXXXXCX80TZJ85Q70QCI');
});

test('parseCallback rejects a tampered amount', () => {
  const payload = {
    merchantCode: MERCHANT,
    amount: '1',
    merchantOrderId: 'abcde12345',
    resultCode: '00',
    reference: 'r',
    signature: v2.signCallback('40000', 'abcde12345'),
  };
  assert.throws(() => v2.parseCallback(payload), DuitkuSignatureError);
});

test('verifyCallback rejects a payload for another merchant', () => {
  assert.equal(
    v2.verifyCallback({
      merchantCode: 'DOTHER',
      amount: '40000',
      merchantOrderId: 'abcde12345',
      signature: v2.signCallback('40000', 'abcde12345'),
    }),
    false,
  );
});

test('diagnoseCallbackSignature identifies a legacy MD5 account', () => {
  const legacy = createHash('md5').update(`${MERCHANT}40000abcde12345${API_KEY}`).digest('hex');
  const result = v2.diagnoseCallbackSignature({ amount: '40000', merchantOrderId: 'abcde12345', signature: legacy });
  assert.equal(result.matched, 'md5');
});

test('pop auth header signature is plain SHA256 over the same timestamp it sends', () => {
  const pop = new PopClient({ merchantCode: MERCHANT, apiKey: API_KEY });
  const headers = pop.buildAuthHeaders(1700000000000);
  const expected = createHash('sha256').update(`${MERCHANT}1700000000000${API_KEY}`).digest('hex');
  assert.equal(headers['x-duitku-signature'], expected);
  assert.equal(headers['x-duitku-timestamp'], '1700000000000');
});

test('pop checkoutUrl points at the environment checkout host', () => {
  const pop = new PopClient({ merchantCode: MERCHANT, apiKey: API_KEY, environment: 'production' });
  const url = pop.checkoutUrl('DXXXXS875LXXXX32IJZ7', { lang: 'en' });
  assert.match(url, /^https:\/\/app-prod\.duitku\.com\/redirect_checkout\?/);
  assert.match(url, /reference=DXXXXS875LXXXX32IJZ7/);
  assert.match(url, /lang=en/);
});

const disb = new DisbursementClient({
  userId: '3551',
  email: 'demo@duitku.com',
  secretKey: 'de56f832487bc1ce1de5ff2cfacf8d9486c61da69df6fd61d5537b6b7d6d354d',
});

test('disbursement signature is plain SHA256 with secretKey appended', () => {
  const expected = createHash('sha256')
    .update('demo@duitku.com1700000000000014876067356610000purposede56f832487bc1ce1de5ff2cfacf8d9486c61da69df6fd61d5537b6b7d6d354d')
    .digest('hex');
  assert.equal(disb.sign('demo@duitku.com', 1700000000000, '014', '8760673566', 10000, 'purpose'), expected);
});

test('clearing callback verification round-trips', () => {
  const payload = {
    disburseId: 123,
    userId: 3551,
    email: 'demo@duitku.com',
    bankCode: '014',
    bankAccount: '8760673566',
    amountTransfer: 10000,
    accountName: 'John Doe',
    custRefNumber: 'REF1',
    statusCode: '00',
    signature: '',
  };
  payload.signature = disb.sign('demo@duitku.com', '014', '8760673566', 'John Doe', 'REF1', 10000, 123);
  assert.equal(disb.verifyClearingCallback(payload), true);
  assert.equal(disb.parseClearingCallback(payload as unknown as Record<string, unknown>).isSuccess, true);

  payload.amountTransfer = 999;
  assert.equal(disb.verifyClearingCallback(payload), false);
});

test('cash out callback verification round-trips', () => {
  const payload = { disburseId: 77, custRefNumber: 'REF9', email: 'demo@duitku.com', signature: '' };
  payload.signature = disb.sign('demo@duitku.com', 77, 'REF9');
  assert.equal(disb.verifyCashOutCallback(payload), true);
});

test('snap symmetric signature matches the documented stringToSign', () => {
  const body = JSON.stringify({ grantType: 'client_credentials' });
  const timestamp = '2022-09-16T13:00:00+07:00';
  const bodyHash = createHash('sha256').update(body).digest('hex').toLowerCase();
  const expected = createHmac('sha512', API_KEY)
    .update(`POST:/merchant/va/v1.0/transfer-va/create-va:token123:${bodyHash}:${timestamp}`)
    .digest('base64');
  assert.equal(
    symmetricSignature({
      method: 'POST',
      endpoint: '/merchant/va/v1.0/transfer-va/create-va',
      accessToken: 'token123',
      body,
      timestamp,
      clientSecret: API_KEY,
    }),
    expected,
  );
});

test('snap timestamp is ISO-8601 with a Jakarta offset', () => {
  assert.match(snapTimestamp(new Date('2022-09-16T06:00:00Z')), /^2022-09-16T13:00:00\+07:00$/);
});

test('snap notification signature verifies against the signing key and fails when tampered', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const rawBody = JSON.stringify({ trxId: 'Transaction-0001' });
  const timestamp = '2022-09-16T13:00:00+07:00';
  const bodyHash = createHash('sha256').update(rawBody).digest('hex').toLowerCase();
  const signature = createSign('RSA-SHA256')
    .update(`POST:/v1.0/transfer-va/payment:${bodyHash}:${timestamp}`)
    .sign(privPem, 'base64');

  const snap = new SnapClient({
    clientKey: MERCHANT,
    clientSecret: API_KEY,
    privateKey: privPem,
    duitkuPublicKey: pubPem,
  });

  assert.equal(
    snap.verifyNotification({ endpoint: '/v1.0/transfer-va/payment', rawBody, timestamp, signature }),
    true,
  );
  assert.equal(
    snap.verifyNotification({
      endpoint: '/v1.0/transfer-va/payment',
      rawBody: JSON.stringify({ trxId: 'tampered' }),
      timestamp,
      signature,
    }),
    false,
  );

  // The access-token signature uses a different stringToSign.
  const authSig = asymmetricAuthSignature(MERCHANT, timestamp, privPem);
  assert.equal(
    verifyAsymmetricSignature({
      method: 'POST',
      endpoint: '/v1.0/transfer-va/payment',
      rawBody,
      timestamp,
      signature: authSig,
      duitkuPublicKeyPem: pubPem,
    }),
    false,
  );
});

test('Duitku facade throws a helpful error when disbursement credentials are missing', () => {
  const duitku = new Duitku({ merchantCode: MERCHANT, apiKey: API_KEY });
  assert.throws(() => duitku.disbursement, /Disbursement credentials were not provided/);
});

test('Duitku facade propagates the environment to each client', () => {
  const duitku = new Duitku({
    merchantCode: MERCHANT,
    apiKey: API_KEY,
    environment: 'production',
    disbursement: { userId: '1', email: 'a@b.com', secretKey: 's' },
  });
  assert.equal(duitku.v2.environment, 'production');
  assert.equal(duitku.pop.environment, 'production');
  assert.equal(duitku.disbursement.environment, 'production');
});
