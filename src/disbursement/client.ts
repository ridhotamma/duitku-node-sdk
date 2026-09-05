import { HOSTS, type Environment } from '../core/env.js';
import { DuitkuApiError, DuitkuConfigError, DuitkuSignatureError } from '../core/errors.js';
import { request, type HttpOptions } from '../core/http.js';
import { secureEqual, sha256 } from '../core/signature.js';
import { DISBURSEMENT_DO_NOT_RETRY } from '../constants/status-codes.js';
import type { BankCodeValue } from '../constants/banks.js';

export interface DisbursementClientOptions extends HttpOptions {
  /** Numeric merchant ID issued when disbursement is activated. */
  userId: string | number;
  /** The email registered with Duitku. It is part of every signature. */
  email: string;
  /** Disbursement secret — *not* the payment gateway `apiKey`. */
  secretKey: string;
  environment?: Environment;
  /** Host for transfer/clearing/balance. */
  baseUrl?: string;
  /** Host for cash out, which lives on a different domain. */
  cashOutBaseUrl?: string;
}

export type ClearingType = 'LLG' | 'RTGS' | 'H2H' | 'BIFAST';

export interface TransferInquiryParams {
  amountTransfer: number;
  bankAccount: string;
  bankCode: BankCodeValue | (string & {});
  /** Included in the signature even when empty. */
  purpose?: string;
  senderId?: string;
  senderName?: string;
}

export interface TransferInquiryResult {
  /** Verify this against what your user expects before transferring. */
  accountName: string;
  custRefNumber: string;
  /** Store it — required for the transfer call and for status lookups. */
  disburseId: string | number;
  responseCode: string;
  responseDesc: string;
}

export interface TransferParams extends TransferInquiryParams {
  accountName: string;
  custRefNumber: string;
  disburseId: string | number;
  /** Mandatory on transfer, unlike inquiry. */
  purpose: string;
}

export interface TransferResult {
  disburseId?: string | number;
  custRefNumber?: string;
  amountTransfer?: string | number;
  responseCode: string;
  responseDesc: string;
}

export interface CashOutParams {
  amountTransfer: number;
  custRefNumber: string;
  /** `2010` Indomaret or `2011` Pos Indonesia. */
  bankCode: '2010' | '2011';
  accountName: string;
  accountAddress: string;
  /** The customer's KTP number. */
  accountIdentity: string;
  phoneNumber: string;
  purpose: string;
  callbackUrl: string;
}

export interface CashOutResult {
  /** SMS'd to the customer, who redeems it at the outlet. */
  token?: string;
  /** Pos Indonesia only. */
  pin?: string;
  disburseId?: string | number;
  responseCode: string;
  responseDesc: string;
}

export interface BalanceResult {
  /** Pre-settlement. */
  balance: string | number;
  /** What is actually usable for disbursement — gate transfers on this. */
  effectiveBalance: string | number;
  responseCode: string;
  responseDesc: string;
}

export interface BankListEntry {
  bankCode: string;
  bankName: string;
  maxAmountTransfer: string | number;
}

/** JSON body Duitku POSTs to your clearing (H2H) callback URL. */
export interface ClearingCallbackPayload {
  disburseId: string | number;
  userId: string | number;
  email: string;
  bankCode: string;
  bankAccount: string;
  amountTransfer: string | number;
  accountName: string;
  custRefNumber: string;
  /** `00` success, `01` failed, `68` pending (do not retry). */
  statusCode: string;
  statusDesc?: string;
  errorMessage?: string;
  signature: string;
}

/** JSON body Duitku POSTs to your cash out callback URL. */
export interface CashOutCallbackPayload {
  disburseId: string | number;
  custRefNumber: string;
  email?: string;
  statusCode?: string;
  signature: string;
}

/**
 * Client for the Duitku Disbursement API — transfer online, clearing and cash out.
 *
 * Every signature is plain `SHA256(concatenated fields + secretKey)`, and the
 * timestamp is Unix milliseconds that expires after 5 minutes (`-960`).
 */
export class DisbursementClient {
  readonly userId: string;
  readonly email: string;
  readonly environment: Environment;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly cashOutBaseUrl: string;
  private readonly http: HttpOptions;
  /** Sandbox endpoints carry a `sandbox` suffix on the path. */
  private readonly suffix: string;

  constructor(options: DisbursementClientOptions) {
    if (!options.userId) throw new DuitkuConfigError('userId is required');
    if (!options.email) throw new DuitkuConfigError('email is required');
    if (!options.secretKey) throw new DuitkuConfigError('secretKey is required');
    this.userId = String(options.userId);
    this.email = options.email;
    this.secretKey = options.secretKey;
    this.environment = options.environment ?? 'sandbox';
    this.baseUrl = options.baseUrl ?? HOSTS.disbursement[this.environment];
    this.cashOutBaseUrl = options.cashOutBaseUrl ?? HOSTS.cashout[this.environment];
    this.http = { timeoutMs: options.timeoutMs, fetch: options.fetch };
    this.suffix = this.environment === 'sandbox' ? 'sandbox' : '';
  }

  /** `SHA256(...fields + secretKey)`. Exposed for tests and manual debugging. */
  sign(...fields: Array<string | number | undefined>): string {
    return sha256(fields.map((f) => (f === undefined ? '' : String(f))).join('') + this.secretKey);
  }

  /** Validates the destination account and returns the `disburseId` to transfer with. */
  async inquiry(params: TransferInquiryParams, timestamp = Date.now()): Promise<TransferInquiryResult> {
    const purpose = params.purpose ?? '';
    const body = {
      userId: this.userId,
      amountTransfer: params.amountTransfer,
      bankAccount: params.bankAccount,
      bankCode: params.bankCode,
      email: this.email,
      purpose,
      timestamp,
      ...(params.senderId ? { senderId: params.senderId } : {}),
      ...(params.senderName ? { senderName: params.senderName } : {}),
      signature: this.sign(
        this.email, timestamp, params.bankCode, params.bankAccount, params.amountTransfer, purpose,
      ),
    };
    return (await this.post(`/webapi/api/disbursement/inquiry${this.suffix}`, body)) as TransferInquiryResult;
  }

  /**
   * Executes a transfer against a prior inquiry.
   *
   * If the result code is `TO`, `68` or `-100` the transfer may still have gone
   * through — this method throws {@link DuitkuNonRetryableError} rather than
   * letting you loop on it. Reconcile with {@link inquiryStatus}.
   */
  async transfer(params: TransferParams, timestamp = Date.now()): Promise<TransferResult> {
    const body = {
      userId: this.userId,
      amountTransfer: params.amountTransfer,
      bankAccount: params.bankAccount,
      bankCode: params.bankCode,
      accountName: params.accountName,
      custRefNumber: params.custRefNumber,
      disburseId: params.disburseId,
      email: this.email,
      purpose: params.purpose,
      timestamp,
      ...(params.senderId ? { senderId: params.senderId } : {}),
      ...(params.senderName ? { senderName: params.senderName } : {}),
      signature: this.sign(
        this.email, timestamp, params.bankCode, params.bankAccount, params.accountName,
        params.custRefNumber, params.amountTransfer, params.purpose, params.disburseId,
      ),
    };
    const res = (await this.post(`/webapi/api/disbursement/transfer${this.suffix}`, body, { successCodes: null })) as TransferResult;
    assertRetryable(res.responseCode, res.responseDesc);
    assertSuccess(res.responseCode, res.responseDesc, `/webapi/api/disbursement/transfer${this.suffix}`);
    return res;
  }

  /** Clearing inquiry — LLG, RTGS, H2H or BI-FAST. */
  async inquiryClearing(
    params: TransferInquiryParams & { type: ClearingType },
    timestamp = Date.now(),
  ): Promise<TransferInquiryResult> {
    const purpose = params.purpose ?? '';
    const body = {
      userId: this.userId,
      amountTransfer: params.amountTransfer,
      bankAccount: params.bankAccount,
      bankCode: params.bankCode,
      type: params.type,
      email: this.email,
      purpose,
      timestamp,
      signature: this.sign(
        this.email, timestamp, params.bankCode, params.type, params.bankAccount, params.amountTransfer, purpose,
      ),
    };
    return (await this.post(`/webapi/api/disbursement/inquiryclearing${this.suffix}`, body)) as TransferInquiryResult;
  }

  /** Clearing transfer. H2H results arrive on your callback URL, not in this response. */
  async transferClearing(
    params: TransferParams & { type: ClearingType; callbackUrl?: string },
    timestamp = Date.now(),
  ): Promise<TransferResult> {
    const body = {
      userId: this.userId,
      amountTransfer: params.amountTransfer,
      bankAccount: params.bankAccount,
      bankCode: params.bankCode,
      type: params.type,
      accountName: params.accountName,
      custRefNumber: params.custRefNumber,
      disburseId: params.disburseId,
      email: this.email,
      purpose: params.purpose,
      timestamp,
      ...(params.callbackUrl ? { callbackUrl: params.callbackUrl } : {}),
      signature: this.sign(
        this.email, timestamp, params.bankCode, params.type, params.bankAccount, params.accountName,
        params.custRefNumber, params.amountTransfer, params.purpose, params.disburseId,
      ),
    };
    const res = (await this.post(`/webapi/api/disbursement/transferclearing${this.suffix}`, body, { successCodes: null })) as TransferResult;
    assertRetryable(res.responseCode, res.responseDesc);
    assertSuccess(res.responseCode, res.responseDesc, `/webapi/api/disbursement/transferclearing${this.suffix}`);
    return res;
  }

  /** Cash out at Indomaret (`2010`) or Pos Indonesia (`2011`). Lives on a separate host. */
  async cashOut(params: CashOutParams, timestamp = Date.now()): Promise<CashOutResult> {
    const body = {
      userId: this.userId,
      amountTransfer: params.amountTransfer,
      custRefNumber: params.custRefNumber,
      bankCode: params.bankCode,
      accountName: params.accountName,
      accountAddress: params.accountAddress,
      accountIdentity: params.accountIdentity,
      email: this.email,
      phoneNumber: params.phoneNumber,
      purpose: params.purpose,
      timestamp,
      callbackUrl: params.callbackUrl,
      signature: this.sign(this.email, timestamp, params.amountTransfer, params.purpose),
    };
    return (await this.post('/api/cashout/inquiry', body, { baseUrl: this.cashOutBaseUrl })) as CashOutResult;
  }

  /** Authoritative status for a disbursement. Use this instead of retrying an ambiguous transfer. */
  async inquiryStatus(disburseId: string | number, timestamp = Date.now()): Promise<TransferResult> {
    const body = {
      disburseId,
      userId: this.userId,
      email: this.email,
      timestamp,
      signature: this.sign(this.email, timestamp, disburseId),
    };
    return (await this.post('/webapi/api/disbursement/inquirystatus', body, { successCodes: null })) as TransferResult;
  }

  /** Gate transfers on `effectiveBalance`, not `balance`. */
  async checkBalance(timestamp = Date.now()): Promise<BalanceResult> {
    const body = {
      userId: this.userId,
      email: this.email,
      timestamp,
      signature: this.sign(this.email, timestamp),
    };
    return (await this.post('/webapi/api/disbursement/checkbalance', body)) as BalanceResult;
  }

  /** Banks with their per-bank transfer ceilings. Prefer this over a hardcoded list. */
  async listBank(timestamp = Date.now()): Promise<BankListEntry[]> {
    const body = {
      userId: this.userId,
      email: this.email,
      timestamp,
      signature: this.sign(this.email, timestamp),
    };
    const res = (await this.post('/webapi/api/disbursement/listBank', body)) as { Banks?: BankListEntry[]; banks?: BankListEntry[] };
    return res.Banks ?? res.banks ?? [];
  }

  /**
   * Verifies a clearing (H2H) callback:
   * `SHA256(email + bankCode + bankAccount + accountName + custRefNumber + amountTransfer + disburseId + secretKey)`.
   *
   * Respond to Duitku with the literal string `SUCCESS`.
   */
  verifyClearingCallback(p: ClearingCallbackPayload): boolean {
    if (!p?.signature) return false;
    const expected = this.sign(
      p.email, p.bankCode, p.bankAccount, p.accountName, p.custRefNumber, p.amountTransfer, p.disburseId,
    );
    return secureEqual(expected, p.signature);
  }

  /** @throws {DuitkuSignatureError} when the signature does not match. */
  parseClearingCallback(raw: Record<string, unknown>): ClearingCallbackPayload & { isSuccess: boolean } {
    const p = raw as unknown as ClearingCallbackPayload;
    if (!this.verifyClearingCallback(p)) throw new DuitkuSignatureError('Bad Signature');
    return { ...p, isSuccess: p.statusCode === '00' };
  }

  /** Verifies a cash out callback: `SHA256(email + disburseId + custRefNumber + secretKey)`. */
  verifyCashOutCallback(p: CashOutCallbackPayload): boolean {
    if (!p?.signature) return false;
    return secureEqual(this.sign(p.email ?? this.email, p.disburseId, p.custRefNumber), p.signature);
  }

  /** @throws {DuitkuSignatureError} when the signature does not match. */
  parseCashOutCallback(raw: Record<string, unknown>): CashOutCallbackPayload {
    const p = raw as unknown as CashOutCallbackPayload;
    if (!this.verifyCashOutCallback(p)) throw new DuitkuSignatureError('Bad Signature');
    return p;
  }

  private post(
    path: string,
    body: unknown,
    opts: { baseUrl?: string; successCodes?: readonly string[] | null } = {},
  ): Promise<unknown> {
    return request(
      {
        baseUrl: opts.baseUrl ?? this.baseUrl,
        path,
        body: JSON.stringify(body),
        timeoutMs: this.http.timeoutMs,
        fetchImpl: this.http.fetch,
      },
      opts.successCodes === undefined ? ['00', '80'] : opts.successCodes,
    );
  }
}

/** Thrown for disbursement results that must never be retried. */
export class DuitkuNonRetryableError extends Error {
  readonly code: string;
  constructor(code: string, desc?: string) {
    super(
      `Disbursement returned ${code}${desc ? ` (${desc})` : ''} — the transfer may have gone through. ` +
        'Do not retry; reconcile with inquiryStatus().',
    );
    this.name = 'DuitkuNonRetryableError';
    this.code = code;
  }
}

function assertSuccess(code: string | undefined, desc: string | undefined, endpoint: string): void {
  if (code !== undefined && code !== '00' && code !== '80') {
    throw new DuitkuApiError({
      message: `Duitku ${endpoint} returned code ${code}${desc ? `: ${desc}` : ''}`,
      status: 200,
      code,
      body: { responseCode: code, responseDesc: desc },
      endpoint,
    });
  }
}

function assertRetryable(code: string | undefined, desc?: string): void {
  if (code && DISBURSEMENT_DO_NOT_RETRY.includes(code)) throw new DuitkuNonRetryableError(code, desc);
}
