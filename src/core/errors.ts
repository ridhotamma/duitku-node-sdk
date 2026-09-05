/** Base class for every error thrown by this SDK. */
export class DuitkuError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown when the SDK is misconfigured or a request is invalid before it is sent. */
export class DuitkuConfigError extends DuitkuError {}

/**
 * Thrown when Duitku responds with a non-2xx status, or a 200 carrying a
 * failure `statusCode` / `responseCode`.
 */
export class DuitkuApiError extends DuitkuError {
  /** HTTP status of the response. */
  readonly status: number;
  /** Duitku's own code: `statusCode`, `responseCode` or SNAP's `responseCode`. */
  readonly code: string | undefined;
  /** Parsed response body, or the raw text when it was not JSON. */
  readonly body: unknown;
  /** Request path that failed, useful in logs. */
  readonly endpoint: string;

  constructor(opts: { message: string; status: number; code?: string; body: unknown; endpoint: string }) {
    super(opts.message);
    this.status = opts.status;
    this.code = opts.code;
    this.body = opts.body;
    this.endpoint = opts.endpoint;
  }
}

/** Thrown by callback/notification verifiers when a signature does not match. */
export class DuitkuSignatureError extends DuitkuError {
  constructor(message = 'Invalid Duitku signature') {
    super(message);
  }
}
