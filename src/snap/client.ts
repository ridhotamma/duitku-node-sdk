import { randomUUID } from 'node:crypto';
import { HOSTS, type Environment } from '../core/env.js';
import { DuitkuApiError, DuitkuConfigError } from '../core/errors.js';
import { request, type HttpOptions } from '../core/http.js';
import {
  asymmetricAuthSignature,
  snapTimestamp,
  symmetricSignature,
  verifyAsymmetricSignature,
} from './signature.js';
import type {
  ChannelId,
  CreateVaParams,
  DirectDebitPaymentParams,
  QrisGenerateParams,
  QrisGenerateResult,
  VaInquiryStatusParams,
  VaResponse,
} from './types.js';

export interface SnapClientOptions extends HttpOptions {
  /** Project ID (`DXXXX`), sent as X-CLIENT-KEY and X-PARTNER-ID. */
  clientKey: string;
  /** The project API key, used as the HMAC-SHA512 secret. */
  clientSecret: string;
  /** Your RSA private key (PEM), used to sign the access-token request. */
  privateKey: string;
  /** Duitku's public key (PEM). Required only to verify incoming notifications. */
  duitkuPublicKey?: string;
  environment?: Environment;
  baseUrl?: string;
}

interface CachedToken {
  token: string;
  /** Epoch ms after which the token must be refreshed. */
  expiresAt: number;
}

/**
 * Client for Duitku's BI-SNAP surface — Fixed/static VA, direct debit and QRIS MPM.
 *
 * SNAP is not self-service: the merchant must pass the ASPI and Duitku tests and
 * exchange RSA keys with `snap@duitku.com` before any of this works.
 *
 * Access tokens live 900 seconds and are cached and refreshed automatically.
 */
export class SnapClient {
  readonly clientKey: string;
  readonly environment: Environment;
  private readonly clientSecret: string;
  private readonly privateKey: string;
  private readonly duitkuPublicKey: string | undefined;
  private readonly baseUrl: string;
  private readonly http: HttpOptions;
  private cached: CachedToken | undefined;
  private inFlight: Promise<string> | undefined;

  constructor(options: SnapClientOptions) {
    if (!options.clientKey) throw new DuitkuConfigError('clientKey is required');
    if (!options.clientSecret) throw new DuitkuConfigError('clientSecret is required');
    if (!options.privateKey) throw new DuitkuConfigError('privateKey (RSA PEM) is required');
    this.clientKey = options.clientKey;
    this.clientSecret = options.clientSecret;
    this.privateKey = options.privateKey;
    this.duitkuPublicKey = options.duitkuPublicKey;
    this.environment = options.environment ?? 'sandbox';
    this.baseUrl = options.baseUrl ?? HOSTS.snap[this.environment];
    this.http = { timeoutMs: options.timeoutMs, fetch: options.fetch };
  }

  /**
   * Returns a valid bearer token, fetching one only when the cache is empty or
   * near expiry. Concurrent callers share a single in-flight request.
   */
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cached && Date.now() < this.cached.expiresAt) return this.cached.token;
    this.inFlight ??= this.fetchAccessToken().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async fetchAccessToken(): Promise<string> {
    const timestamp = snapTimestamp();
    const body = JSON.stringify({ grantType: 'client_credentials' });
    const res = (await request(
      {
        baseUrl: this.baseUrl,
        path: '/auth/v1.0/access-token/b2b',
        body,
        headers: {
          'X-TIMESTAMP': timestamp,
          'X-CLIENT-KEY': this.clientKey,
          'X-SIGNATURE': asymmetricAuthSignature(this.clientKey, timestamp, this.privateKey),
        },
        timeoutMs: this.http.timeoutMs,
        fetchImpl: this.http.fetch,
      },
      ['2007300'],
    )) as { accessToken?: string; expiresIn?: string | number };

    if (!res.accessToken) {
      throw new DuitkuApiError({
        message: 'SNAP access-token response contained no accessToken',
        status: 200,
        body: res,
        endpoint: '/auth/v1.0/access-token/b2b',
      });
    }
    const ttl = Number(res.expiresIn ?? 900);
    // Refresh 60s early so a request never races the expiry.
    this.cached = { token: res.accessToken, expiresAt: Date.now() + Math.max(ttl - 60, 30) * 1000 };
    return res.accessToken;
  }

  /**
   * Signed SNAP call. Use it directly for endpoints this SDK does not wrap yet.
   *
   * @param externalId Unique per request — reuse returns HTTP 409. Defaults to a UUID.
   */
  async call<T = unknown>(opts: {
    method: 'POST' | 'PUT' | 'DELETE' | 'GET';
    endpoint: string;
    channelId: ChannelId;
    body?: unknown;
    externalId?: string;
    successCodes?: readonly string[] | null;
  }): Promise<T> {
    const accessToken = await this.getAccessToken();
    const timestamp = snapTimestamp();
    // Sign exactly the bytes we transmit.
    const serialized = JSON.stringify(opts.body ?? {});
    const signature = symmetricSignature({
      method: opts.method,
      endpoint: opts.endpoint,
      accessToken,
      body: serialized,
      timestamp,
      clientSecret: this.clientSecret,
    });

    return (await request(
      {
        baseUrl: this.baseUrl,
        path: opts.endpoint,
        method: opts.method,
        body: serialized,
        headers: {
          'X-TIMESTAMP': timestamp,
          'X-SIGNATURE': signature,
          'X-PARTNER-ID': this.clientKey,
          'X-EXTERNAL-ID': opts.externalId ?? randomUUID().replace(/-/g, ''),
          'CHANNEL-ID': opts.channelId,
          Authorization: `Bearer ${accessToken}`,
        },
        timeoutMs: this.http.timeoutMs,
        fetchImpl: this.http.fetch,
      },
      opts.successCodes === undefined ? null : opts.successCodes,
    )) as T;
  }

  // --- Virtual Account -----------------------------------------------------

  /** Create a VA. Amount limits: 10,000 minimum, 50,000,000 maximum. */
  createVa(params: CreateVaParams, externalId?: string): Promise<VaResponse> {
    return this.call({
      method: 'POST',
      endpoint: '/merchant/va/v1.0/transfer-va/create-va',
      channelId: 'DUITKU',
      body: params,
      externalId,
      successCodes: ['2002700'],
    });
  }

  /** Update an existing VA. Same `virtualAccountNo` + `trxId` pair as creation. */
  updateVa(params: CreateVaParams, externalId?: string): Promise<VaResponse> {
    return this.call({
      method: 'PUT',
      endpoint: '/merchant/va/v1.0/transfer-va/update-va',
      channelId: 'DUITKU',
      body: params,
      externalId,
    });
  }

  inquiryVa(params: Record<string, unknown>, externalId?: string): Promise<VaResponse> {
    return this.call({
      method: 'POST',
      endpoint: '/merchant/va/v1.0/transfer-va/inquiry-va',
      channelId: 'DUITKU',
      body: params,
      externalId,
    });
  }

  deleteVa(
    params: { partnerServiceId: string; customerNo: string; virtualAccountNo: string; trxId: string },
    externalId?: string,
  ): Promise<VaResponse> {
    return this.call({
      method: 'DELETE',
      endpoint: '/merchant/va/v1.0/transfer-va/delete-va',
      channelId: 'DUITKU',
      body: params,
      externalId,
    });
  }

  /** Response carries `paymentFlagStatus`: `00` success, `01` process, `02` expired. */
  inquiryVaStatus(params: VaInquiryStatusParams, externalId?: string): Promise<VaResponse> {
    return this.call({
      method: 'POST',
      endpoint: '/merchant/va/v1.0/transfer-va/status',
      channelId: 'DUITKU',
      body: params,
      externalId,
    });
  }

  // --- Direct Debit --------------------------------------------------------

  /** Bind a customer's account (OVO `OL`, ShopeePay `SL`) before charging it. */
  accountBinding(params: Record<string, unknown>, channelId: ChannelId, externalId?: string): Promise<unknown> {
    return this.call({
      method: 'POST',
      endpoint: '/merchant/registration/v1.0/registration-account-binding',
      channelId,
      body: params,
      externalId,
    });
  }

  accountInquiry(params: Record<string, unknown>, channelId: ChannelId, externalId?: string): Promise<unknown> {
    return this.call({
      method: 'POST',
      endpoint: '/merchant/registration/v1.0/registration-account-inquiry',
      channelId,
      body: params,
      externalId,
    });
  }

  accountUnbinding(params: Record<string, unknown>, channelId: ChannelId, externalId?: string): Promise<unknown> {
    return this.call({
      method: 'POST',
      endpoint: '/merchant/registration/v1.0/registration-account-unbinding',
      channelId,
      body: params,
      externalId,
    });
  }

  /**
   * Charge a direct debit account.
   *
   * Linking channels (`OL`, `SL`) pass `bankCardToken` plus
   * `additionalInfo.transactionType` (`M` manual PIN, `A` auto debit);
   * redirect channels (`DA`, `SA`) pass `chargeToken` and `validUpTo`, then you
   * send the customer to `webRedirectUrl`.
   */
  debitPayment(params: DirectDebitPaymentParams, channelId: ChannelId, externalId?: string): Promise<unknown> {
    return this.call({
      method: 'POST',
      endpoint: '/merchant/debit/v1.0/debit/payment-host-to-host',
      channelId,
      body: params,
      externalId,
    });
  }

  /** `latestTransactionStatus`: `00` success, `03` pending, `04` refunded, `06` failed, `07` not found. */
  debitStatus(params: Record<string, unknown>, channelId: ChannelId, externalId?: string): Promise<unknown> {
    return this.call({
      method: 'POST',
      endpoint: '/merchant/debit/v1.0/debit/status',
      channelId,
      body: params,
      externalId,
    });
  }

  debitRefund(params: Record<string, unknown>, channelId: ChannelId, externalId?: string): Promise<unknown> {
    return this.call({
      method: 'POST',
      endpoint: '/merchant/debit/v1.0/debit/refund',
      channelId,
      body: params,
      externalId,
    });
  }

  // --- QRIS MPM ------------------------------------------------------------

  /** Generate a QRIS payload. `validityPeriod` must be at least 30 minutes. */
  qrisGenerate(params: QrisGenerateParams, channelId: ChannelId, externalId?: string): Promise<QrisGenerateResult> {
    return this.call({
      method: 'POST',
      endpoint: '/merchant/qris/v1.0/qr/qr-mpm-generate',
      channelId,
      body: params,
      externalId,
    });
  }

  qrisQuery(params: Record<string, unknown>, channelId: ChannelId, externalId?: string): Promise<unknown> {
    return this.call({
      method: 'POST',
      endpoint: '/merchant/qris/v1.0/qr/qr-mpm-query',
      channelId,
      body: params,
      externalId,
    });
  }

  qrisRefund(params: Record<string, unknown>, channelId: ChannelId, externalId?: string): Promise<unknown> {
    return this.call({
      method: 'POST',
      endpoint: '/merchant/qris/v1.0/qr/qr-mpm-refund',
      channelId,
      body: params,
      externalId,
    });
  }

  // --- Notifications -------------------------------------------------------

  /**
   * Verifies a Duitku→merchant notification (VA payment, debit notify, QRIS notify).
   *
   * `rawBody` must be the exact bytes received — a re-serialized parsed object
   * produces a different hash. Capture the raw body in middleware.
   */
  verifyNotification(args: {
    method?: string;
    /** Path only, e.g. `/v1.0/transfer-va/payment`. */
    endpoint: string;
    rawBody: string;
    /** The `X-TIMESTAMP` header as received. */
    timestamp: string;
    /** The `X-SIGNATURE` header as received. */
    signature: string;
  }): boolean {
    if (!this.duitkuPublicKey) {
      throw new DuitkuConfigError('duitkuPublicKey is required to verify SNAP notifications');
    }
    return verifyAsymmetricSignature({
      method: args.method ?? 'POST',
      endpoint: args.endpoint,
      rawBody: args.rawBody,
      timestamp: args.timestamp,
      signature: args.signature,
      duitkuPublicKeyPem: this.duitkuPublicKey,
    });
  }
}
