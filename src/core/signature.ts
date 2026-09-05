import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** `HMAC_SHA256(stringToSign, key)` as lowercase hex. Used by the v2 Payment API. */
export function hmacSha256(stringToSign: string, key: string): string {
  return createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex');
}

/** Plain `SHA256(input)` as lowercase hex. Used by Duitku Pop and Disbursement. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Legacy `MD5(input)`. Retired in April 2026 — exposed only for diagnosing old accounts. */
export function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

/** Constant-time comparison that never throws on length mismatch. */
export function secureEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
