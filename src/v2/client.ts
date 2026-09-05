import { HOSTS, type Environment } from '../core/env.js';
import { DuitkuConfigError, DuitkuSignatureError } from '../core/errors.js';
import { request, type HttpOptions } from '../core/http.js';
import { hmacSha256, md5, secureEqual, sha256 } from '../core/signature.js';
import { MIN_PAYMENT_AMOUNT, PAYLATER_METHODS } from '../constants/payment-methods.js';
import { CallbackResult } from '../constants/status-codes.js';
import type {
  CallbackPayload,
  CreatePaymentParams,
  CreatePaymentResult,
  PaymentMethodFee,
  TransactionStatusResult,
} from './types.js';

export interface V2ClientOptions extends HttpOptions {
  /** Project code from passport.duitku.com, e.g. `DXXXX`. */
  merchantCode: string;
  /** 32-char project secret. Some older SDKs call this `merchantKey`. */
  apiKey: string;
  environment?: Environment;
  /** Override the host, e.g. to point at a local mock. */
  baseUrl?: string;
}

/** `yyyy-MM-dd HH:mm:ss` in Asia/Jakarta, the format `getPaymentMethod` expects. */
function jakartaDateTime(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  // Intl renders midnight as "24" in some ICU versions.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

/**
 * Client for the v2 Redirect API — you pick the channel and render your own
 * VA / QR page.
 *
 * All signatures here are HMAC-SHA256 over `apiKey`, per the April 2026 migration.
 */
export class V2Client {
  readonly merchantCode: string;
  readonly environment: Environment;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly http: HttpOptions;

  constructor(options: V2ClientOptions) {
    if (!options.merchantCode) throw new DuitkuConfigError('merchantCode is required');
    if (!options.apiKey) throw new DuitkuConfigError('apiKey is required');
    this.merchantCode = options.merchantCode;
    this.apiKey = options.apiKey;
    this.environment = options.environment ?? 'sandbox';
    this.baseUrl = options.baseUrl ?? HOSTS.v2[this.environment];
    this.http = { timeoutMs: options.timeoutMs, fetch: options.fetch };
  }

  /** `HMAC_SHA256(merchantCode + merchantOrderId + paymentAmount, apiKey)`. */
  signInquiry(merchantOrderId: string, paymentAmount: number): string {
    return hmacSha256(`${this.merchantCode}${merchantOrderId}${paymentAmount}`, this.apiKey);
  }

  /**
   * `HMAC_SHA256(merchantCode + amount + merchantOrderId, apiKey)`.
   *
   * Note the field order differs from the inquiry signature — mixing the two up
   * is the most common cause of HTTP 401 "Wrong signature".
   */
  signCallback(amount: string | number, merchantOrderId: string): string {
    return hmacSha256(`${this.merchantCode}${amount}${merchantOrderId}`, this.apiKey);
  }

  /** `HMAC_SHA256(merchantCode + merchantOrderId, apiKey)`. */
  signStatus(merchantOrderId: string): string {
    return hmacSha256(`${this.merchantCode}${merchantOrderId}`, this.apiKey);
  }

  /** Channels enabled on this project for a given amount, with fees and logos. */
  async getPaymentMethods(amount: number, at?: Date): Promise<PaymentMethodFee[]> {
    const datetime = jakartaDateTime(at);
    const body = {
      // Lowercase `c` here — unlike every other endpoint.
      merchantcode: this.merchantCode,
      amount,
      datetime,
      signature: hmacSha256(`${this.merchantCode}${amount}${datetime}`, this.apiKey),
    };
    const res = (await request(
      {
        baseUrl: this.baseUrl,
        path: '/webapi/api/merchant/paymentmethod/getpaymentmethod',
        body: JSON.stringify(body),
        timeoutMs: this.http.timeoutMs,
        fetchImpl: this.http.fetch,
      },
      ['00'],
    )) as { paymentFee?: PaymentMethodFee[] };
    return res.paymentFee ?? [];
  }

  /**
   * Request a transaction. Returns the reference plus the channel-specific
   * fields (`vaNumber`, `qrString`, `appUrl`).
   */
  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    this.validate(params);
    const body = {
      merchantCode: this.merchantCode,
      ...params,
      signature: this.signInquiry(params.merchantOrderId, params.paymentAmount),
    };
    const res = (await request(
      {
        baseUrl: this.baseUrl,
        path: '/webapi/api/merchant/v2/inquiry',
        body: JSON.stringify(body),
        timeoutMs: this.http.timeoutMs,
        fetchImpl: this.http.fetch,
      },
      ['00'],
    )) as Record<string, unknown>;

    // Duitku returns `AppUrl` on some channels and `appUrl` on others.
    const appUrl = (res['appUrl'] ?? res['AppUrl']) as string | undefined;
    return { ...(res as unknown as CreatePaymentResult), ...(appUrl ? { appUrl } : {}) };
  }

  /**
   * Authoritative status re-check.
   *
   * Do not poll this on a cron — Duitku rate-limits it and will block you for
   * about an hour. Call it on callback receipt and on user-initiated refresh.
   */
  async getTransactionStatus(merchantOrderId: string): Promise<TransactionStatusResult> {
    const body = {
      merchantCode: this.merchantCode,
      merchantOrderId,
      signature: this.signStatus(merchantOrderId),
    };
    return (await request(
      {
        baseUrl: this.baseUrl,
        path: '/webapi/api/merchant/transactionStatus',
        body: JSON.stringify(body),
        timeoutMs: this.http.timeoutMs,
        fetchImpl: this.http.fetch,
      },
      // `01` and `02` are legitimate answers here, not failures.
      null,
    )) as TransactionStatusResult;
  }

  /**
   * Verifies a callback signature in constant time. Returns a boolean; use
   * {@link parseCallback} when you want the payload typed and validated in one step.
   */
  verifyCallback(payload: Pick<CallbackPayload, 'merchantCode' | 'amount' | 'merchantOrderId' | 'signature'>): boolean {
    if (!payload?.signature || !payload.merchantOrderId || payload.amount === undefined) return false;
    if (payload.merchantCode !== this.merchantCode) return false;
    return secureEqual(this.signCallback(payload.amount, payload.merchantOrderId), payload.signature);
  }

  /**
   * Verifies and returns the callback payload.
   *
   * Accepts the parsed form body from any framework — Express `req.body`,
   * `Object.fromEntries(await req.formData())`, etc.
   *
   * @throws {DuitkuSignatureError} when the signature does not match.
   */
  parseCallback(raw: Record<string, unknown>): CallbackPayload & { isPaid: boolean } {
    const payload = raw as unknown as CallbackPayload;
    if (!this.verifyCallback(payload)) throw new DuitkuSignatureError('Bad Signature');
    return { ...payload, isPaid: payload.resultCode === CallbackResult.SUCCESS };
  }

  /**
   * Diagnostic aid for accounts that may not have been migrated to HMAC-SHA256.
   * Returns which candidate scheme the received signature matches — log it, then
   * fix the account. Never branch payment logic on this.
   */
  diagnoseCallbackSignature(
    payload: Pick<CallbackPayload, 'amount' | 'merchantOrderId' | 'signature'>,
  ): { matched: 'hmac-sha256' | 'md5' | 'sha256' | null; candidates: Record<string, string> } {
    const base = `${this.merchantCode}${payload.amount}${payload.merchantOrderId}`;
    const candidates = {
      'hmac-sha256': hmacSha256(base, this.apiKey),
      md5: md5(`${base}${this.apiKey}`),
      sha256: sha256(`${base}${this.apiKey}`),
    };
    const matched = (Object.keys(candidates) as Array<keyof typeof candidates>).find((k) =>
      secureEqual(candidates[k], payload.signature),
    );
    return { matched: matched ?? null, candidates };
  }

  private validate(p: CreatePaymentParams): void {
    if (!Number.isInteger(p.paymentAmount)) {
      throw new DuitkuConfigError('paymentAmount must be an integer — Duitku rejects decimals');
    }
    if (p.paymentAmount < MIN_PAYMENT_AMOUNT) {
      throw new DuitkuConfigError(`paymentAmount must be at least ${MIN_PAYMENT_AMOUNT} IDR`);
    }
    if (p.merchantOrderId.length > 50) {
      throw new DuitkuConfigError('merchantOrderId must be at most 50 characters');
    }
    if (p.customerVaName && p.customerVaName.length > 20) {
      throw new DuitkuConfigError('customerVaName must be at most 20 characters');
    }
    if (p.itemDetails?.length) {
      // Duitku sums the raw `price` fields and ignores `quantity`, so each
      // `price` must already be that line's total.
      const total = p.itemDetails.reduce((sum, i) => sum + i.price, 0);
      if (total !== p.paymentAmount) {
        throw new DuitkuConfigError(
          `itemDetails price total (${total}) must equal paymentAmount (${p.paymentAmount}). ` +
            'Duitku sums `price` and ignores `quantity`, so each `price` must be the line total ' +
            '(unit price x quantity). Otherwise the inquiry returns HTTP 409.',
        );
      }
    }
    if (PAYLATER_METHODS.includes(p.paymentMethod) && (!p.customerDetail || !p.itemDetails?.length)) {
      throw new DuitkuConfigError(`paymentMethod ${p.paymentMethod} (paylater) requires customerDetail and itemDetails`);
    }
  }
}

export { jakartaDateTime };
