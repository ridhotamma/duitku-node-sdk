import { createHash, createHmac, createSign, createVerify } from 'node:crypto';

/** ISO-8601 with offset, e.g. `2022-09-16T13:00:00+07:00`. SNAP rejects stale timestamps. */
export function snapTimestamp(now = new Date(), timeZone = 'Asia/Jakarta'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZoneName: 'longOffset',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const hour = get('hour') === '24' ? '00' : get('hour');
  // "GMT+07:00" → "+07:00"; UTC renders as bare "GMT".
  const offset = get('timeZoneName').replace('GMT', '') || '+00:00';
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}${offset}`;
}

/** `Base64(SHA256withRSA(clientKey + "|" + timestamp, privateKey))` — the access token signature. */
export function asymmetricAuthSignature(clientKey: string, timestamp: string, privateKeyPem: string): string {
  return createSign('RSA-SHA256').update(`${clientKey}|${timestamp}`).sign(privateKeyPem, 'base64');
}

/**
 * `Base64(HMAC_SHA512(method:endpoint:token:sha256hex(body):timestamp, clientSecret))`.
 *
 * `body` must be the exact string transmitted — hash the same bytes you send or
 * the signature will not match.
 */
export function symmetricSignature(args: {
  method: string;
  endpoint: string;
  accessToken: string;
  body: string;
  timestamp: string;
  clientSecret: string;
}): string {
  const bodyHash = createHash('sha256').update(args.body, 'utf8').digest('hex').toLowerCase();
  const stringToSign = `${args.method}:${args.endpoint}:${args.accessToken}:${bodyHash}:${args.timestamp}`;
  return createHmac('sha512', args.clientSecret).update(stringToSign, 'utf8').digest('base64');
}

/**
 * Verifies a Duitku→merchant notification signed with Duitku's private key.
 *
 * `rawBody` must be the exact bytes received — re-serializing a parsed object
 * changes the hash. Capture the raw body in your framework's middleware.
 */
export function verifyAsymmetricSignature(args: {
  method: string;
  endpoint: string;
  rawBody: string;
  timestamp: string;
  signature: string;
  duitkuPublicKeyPem: string;
}): boolean {
  const bodyHash = createHash('sha256').update(args.rawBody, 'utf8').digest('hex').toLowerCase();
  const stringToSign = `${args.method}:${args.endpoint}:${bodyHash}:${args.timestamp}`;
  try {
    return createVerify('RSA-SHA256')
      .update(stringToSign)
      .verify(args.duitkuPublicKeyPem, Buffer.from(args.signature, 'base64'));
  } catch {
    return false;
  }
}
