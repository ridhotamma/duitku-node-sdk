import { HOSTS, type Environment } from '../core/env.js';
import { DuitkuConfigError, DuitkuSignatureError } from '../core/errors.js';
import { request, type HttpOptions } from '../core/http.js';
import { hmacSha256, md5, secureEqual, sha256 } from '../core/signature.js';
import { MIN_PAYMENT_AMOUNT } from '../constants/payment-methods.js';
import { CallbackResult } from '../constants/status-codes.js';
import type {
  CallbackPayload,
  CreditCardDetail,
  CustomerDetail,
  ItemDetail,
} from '../v2/types.js';
import type { PaymentMethodCode } from '../constants/payment-methods.js';

export interface PopClientOptions extends HttpOptions {
  merchantCode: string;
  apiKey: string;
  environment?: Environment;
  baseUrl?: string;
}

export interface CreateInvoiceParams {
  /** Integer IDR, no decimals. */
  paymentAmount: number;
  merchantOrderId: string;
  productDetails: string;
  email: string;
  returnUrl: string;
  callbackUrl: string;
  /** Max 20 chars, shown on the bank confirmation screen. */
  customerVaName?: string;
  phoneNumber?: string;
  additionalParam?: string;
  merchantUserInfo?: string;
  itemDetails?: ItemDetail[];
  customerDetail?: CustomerDetail;
  creditCardDetail?: CreditCardDetail;
  /** Minutes. */
  expiryPeriod?: number;
  /** Set it to skip Duitku's channel picker and go straight to one channel. */
  paymentMethod?: PaymentMethodCode | (string & {});
}

export interface CreateInvoiceResult {
  merchantCode: string;
  reference: string;
  /** Send the browser here, or pass `reference` to `checkout.process()` in duitku.js. */
  paymentUrl: string;
  statusCode: string;
  statusMessage: string;
}

/**
 * Client for Duitku Pop — Duitku's hosted checkout, as a JS popup over your
 * page or a full-page redirect.
 *
 * Auth lives entirely in headers: plain `SHA256(merchantCode + timestamp + apiKey)`,
 * not HMAC.
 */
export class PopClient {
  readonly merchantCode: string;
  readonly environment: Environment;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly http: HttpOptions;

  constructor(options: PopClientOptions) {
    if (!options.merchantCode) throw new DuitkuConfigError('merchantCode is required');
    if (!options.apiKey) throw new DuitkuConfigError('apiKey is required');
    this.merchantCode = options.merchantCode;
    this.apiKey = options.apiKey;
    this.environment = options.environment ?? 'sandbox';
    this.baseUrl = options.baseUrl ?? HOSTS.pop[this.environment];
    this.http = { timeoutMs: options.timeoutMs, fetch: options.fetch };
  }

  /**
   * Auth headers for `createInvoice`. The timestamp is computed once and reused
   * in both the signature and the header — computing it twice is a known bug in
   * Duitku's own samples.
   */
  buildAuthHeaders(timestamp: number = Date.now()): Record<string, string> {
    return {
      'x-duitku-merchantcode': this.merchantCode,
      'x-duitku-timestamp': String(timestamp),
      'x-duitku-signature': sha256Header(this.merchantCode, timestamp, this.apiKey),
    };
  }

  /** Create a hosted-checkout invoice. Note: no merchantCode or signature in the body. */
  async createInvoice(params: CreateInvoiceParams): Promise<CreateInvoiceResult> {
    if (!Number.isInteger(params.paymentAmount) || params.paymentAmount < MIN_PAYMENT_AMOUNT) {
      throw new DuitkuConfigError(`paymentAmount must be an integer of at least ${MIN_PAYMENT_AMOUNT} IDR`);
    }
    if (params.itemDetails?.length) {
      const total = params.itemDetails.reduce((sum, i) => sum + i.price * (i.quantity ?? 1), 0);
      if (total !== params.paymentAmount) {
        throw new DuitkuConfigError(`itemDetails total (${total}) must equal paymentAmount (${params.paymentAmount})`);
      }
    }
    return (await request(
      {
        baseUrl: this.baseUrl,
        path: '/api/merchant/createInvoice',
        headers: this.buildAuthHeaders(),
        body: JSON.stringify(params),
        timeoutMs: this.http.timeoutMs,
        fetchImpl: this.http.fetch,
      },
      ['00'],
    )) as CreateInvoiceResult;
  }

  /** URL of the hosted checkout page for a reference, for the redirect flow. */
  checkoutUrl(reference: string, opts?: { lang?: 'id' | 'en'; currency?: 'USD' | 'EUR' }): string {
    const url = new URL('/redirect_checkout', HOSTS.popCheckout[this.environment]);
    url.searchParams.set('reference', reference);
    if (opts?.lang) url.searchParams.set('lang', opts.lang);
    // Display only — the charge is still IDR.
    if (opts?.currency) url.searchParams.set('currency', opts.currency);
    return url.toString();
  }

  /** `<script src>` for duitku.js, matching this client's environment. */
  get checkoutScriptUrl(): string {
    return `${HOSTS.popCheckout[this.environment]}/lib/js/duitku.js`;
  }

  /**
   * Pop callbacks come from the same subsystem as the v2 API, so they use
   * `HMAC_SHA256(merchantCode + amount + merchantOrderId, apiKey)`.
   */
  verifyCallback(payload: Pick<CallbackPayload, 'merchantCode' | 'amount' | 'merchantOrderId' | 'signature'>): boolean {
    if (!payload?.signature || !payload.merchantOrderId || payload.amount === undefined) return false;
    if (payload.merchantCode !== this.merchantCode) return false;
    const expected = hmacSha256(`${this.merchantCode}${payload.amount}${payload.merchantOrderId}`, this.apiKey);
    return secureEqual(expected, payload.signature);
  }

  /** @throws {DuitkuSignatureError} when the signature does not match. */
  parseCallback(raw: Record<string, unknown>): CallbackPayload & { isPaid: boolean } {
    const payload = raw as unknown as CallbackPayload;
    if (!this.verifyCallback(payload)) throw new DuitkuSignatureError('Bad Signature');
    return { ...payload, isPaid: payload.resultCode === CallbackResult.SUCCESS };
  }

  /**
   * Some Pop-era accounts still emit the legacy
   * `MD5(merchantCode + amount + merchantOrderId + apiKey)` callback signature.
   * Log this next to the received signature to identify the scheme — do not
   * accept "whichever one matches".
   */
  diagnoseCallbackSignature(payload: Pick<CallbackPayload, 'amount' | 'merchantOrderId' | 'signature'>): {
    matched: 'hmac-sha256' | 'md5' | null;
    candidates: Record<string, string>;
  } {
    const base = `${this.merchantCode}${payload.amount}${payload.merchantOrderId}`;
    const candidates = { 'hmac-sha256': hmacSha256(base, this.apiKey), md5: md5(`${base}${this.apiKey}`) };
    const matched = (Object.keys(candidates) as Array<keyof typeof candidates>).find((k) =>
      secureEqual(candidates[k], payload.signature),
    );
    return { matched: matched ?? null, candidates };
  }
}

/** Plain SHA256, not HMAC — Pop is the odd one out. */
function sha256Header(merchantCode: string, timestamp: number, apiKey: string): string {
  return sha256(`${merchantCode}${timestamp}${apiKey}`);
}
