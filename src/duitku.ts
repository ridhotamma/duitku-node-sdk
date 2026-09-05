import type { Environment } from './core/env.js';
import { DuitkuConfigError } from './core/errors.js';
import type { HttpOptions } from './core/http.js';
import { DisbursementClient, type DisbursementClientOptions } from './disbursement/client.js';
import { PopClient } from './pop/client.js';
import { SnapClient, type SnapClientOptions } from './snap/client.js';
import { V2Client } from './v2/client.js';

export interface DuitkuOptions extends HttpOptions {
  /** Project code from passport.duitku.com, e.g. `DXXXX`. */
  merchantCode: string;
  /** 32-char project secret. Some older SDKs call this `merchantKey`. */
  apiKey: string;
  /** Defaults to `sandbox` — opt in to production explicitly. */
  environment?: Environment;
  /** Disbursement uses its own credentials, issued when the feature is activated. */
  disbursement?: Omit<DisbursementClientOptions, 'environment' | keyof HttpOptions>;
  /** SNAP needs RSA keys and ASPI onboarding. `clientKey` defaults to `merchantCode`. */
  snap?: Omit<SnapClientOptions, 'environment' | 'clientKey' | 'clientSecret' | keyof HttpOptions> &
    Partial<Pick<SnapClientOptions, 'clientKey' | 'clientSecret'>>;
}

/**
 * One entry point for every Duitku product line.
 *
 * ```ts
 * const duitku = new Duitku({
 *   merchantCode: process.env.DUITKU_MERCHANT_CODE!,
 *   apiKey: process.env.DUITKU_API_KEY!,
 *   environment: 'sandbox',
 * });
 *
 * const payment = await duitku.v2.createPayment({ ... });
 * ```
 *
 * `disbursement` and `snap` are lazy: they are only constructed on first access,
 * and throw if their credentials were not supplied.
 */
export class Duitku {
  readonly environment: Environment;
  /** v2 Redirect API — you pick the channel. */
  readonly v2: V2Client;
  /** Duitku Pop — Duitku's hosted checkout. */
  readonly pop: PopClient;

  private readonly options: DuitkuOptions;
  private disbursementClient: DisbursementClient | undefined;
  private snapClient: SnapClient | undefined;

  constructor(options: DuitkuOptions) {
    this.options = options;
    this.environment = options.environment ?? 'sandbox';
    const shared = { timeoutMs: options.timeoutMs, fetch: options.fetch, environment: this.environment };
    this.v2 = new V2Client({ merchantCode: options.merchantCode, apiKey: options.apiKey, ...shared });
    this.pop = new PopClient({ merchantCode: options.merchantCode, apiKey: options.apiKey, ...shared });
  }

  /** Paying money out. Requires `disbursement` credentials at construction. */
  get disbursement(): DisbursementClient {
    if (!this.disbursementClient) {
      const cfg = this.options.disbursement;
      if (!cfg) {
        throw new DuitkuConfigError(
          'Disbursement credentials were not provided. Pass `disbursement: { userId, email, secretKey }` to the Duitku constructor.',
        );
      }
      this.disbursementClient = new DisbursementClient({
        ...cfg,
        environment: this.environment,
        timeoutMs: this.options.timeoutMs,
        fetch: this.options.fetch,
      });
    }
    return this.disbursementClient;
  }

  /** BI-SNAP surface. Requires `snap: { privateKey }` at construction. */
  get snap(): SnapClient {
    if (!this.snapClient) {
      const cfg = this.options.snap;
      if (!cfg) {
        throw new DuitkuConfigError(
          'SNAP credentials were not provided. Pass `snap: { privateKey, duitkuPublicKey }` to the Duitku constructor.',
        );
      }
      this.snapClient = new SnapClient({
        ...cfg,
        clientKey: cfg.clientKey ?? this.options.merchantCode,
        clientSecret: cfg.clientSecret ?? this.options.apiKey,
        environment: this.environment,
        timeoutMs: this.options.timeoutMs,
        fetch: this.options.fetch,
      });
    }
    return this.snapClient;
  }

  /**
   * Builds a client from `DUITKU_*` environment variables:
   * `DUITKU_MERCHANT_CODE`, `DUITKU_API_KEY`, `DUITKU_ENV`, and optionally
   * `DUITKU_DISBURSEMENT_USER_ID`, `DUITKU_DISBURSEMENT_EMAIL`,
   * `DUITKU_DISBURSEMENT_SECRET_KEY`, `DUITKU_SNAP_PRIVATE_KEY`,
   * `DUITKU_SNAP_PUBLIC_KEY`.
   */
  static fromEnv(env: Record<string, string | undefined> = process.env): Duitku {
    const merchantCode = env['DUITKU_MERCHANT_CODE'];
    const apiKey = env['DUITKU_API_KEY'];
    if (!merchantCode || !apiKey) {
      throw new DuitkuConfigError('DUITKU_MERCHANT_CODE and DUITKU_API_KEY must be set');
    }
    const environment: Environment = env['DUITKU_ENV'] === 'production' ? 'production' : 'sandbox';

    const dUserId = env['DUITKU_DISBURSEMENT_USER_ID'];
    const dEmail = env['DUITKU_DISBURSEMENT_EMAIL'];
    const dSecret = env['DUITKU_DISBURSEMENT_SECRET_KEY'];
    const snapPrivateKey = env['DUITKU_SNAP_PRIVATE_KEY'];

    return new Duitku({
      merchantCode,
      apiKey,
      environment,
      ...(dUserId && dEmail && dSecret
        ? { disbursement: { userId: dUserId, email: dEmail, secretKey: dSecret } }
        : {}),
      ...(snapPrivateKey
        ? { snap: { privateKey: snapPrivateKey, duitkuPublicKey: env['DUITKU_SNAP_PUBLIC_KEY'] } }
        : {}),
    });
  }
}
