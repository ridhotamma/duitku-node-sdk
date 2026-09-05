import { DuitkuApiError } from './errors.js';

export interface HttpOptions {
  /** Request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

export interface RequestSpec {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  /** Serialized body. Pass the exact string that was signed, when a signature covers it. */
  body?: string;
  timeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}

/**
 * Reads Duitku's own status field. Different product lines use different
 * names for the same idea.
 */
function extractCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const b = body as Record<string, unknown>;
  for (const key of ['statusCode', 'responseCode', 'Status', 'status']) {
    const v = b[key];
    if (typeof v === 'string' || typeof v === 'number') return String(v);
  }
  return undefined;
}

function extractMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const b = body as Record<string, unknown>;
  for (const key of ['statusMessage', 'responseMessage', 'responseDesc', 'Message', 'message']) {
    const v = b[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * POSTs JSON and returns the parsed body, throwing {@link DuitkuApiError} on
 * transport failures, non-2xx statuses, or a 2xx carrying a failure code.
 *
 * `successCodes` lists the Duitku codes treated as success. Pass `null` to skip
 * the body-level check entirely (used where a code is informational, e.g. the
 * disbursement status lookup).
 */
export async function request(spec: RequestSpec, successCodes: readonly string[] | null): Promise<unknown> {
  const url = `${spec.baseUrl}${spec.path}`;
  const doFetch = spec.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), spec.timeoutMs ?? 30_000);

  let res: Response;
  try {
    res = await doFetch(url, {
      method: spec.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...spec.headers },
      body: spec.body,
      signal: controller.signal,
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    throw new DuitkuApiError({
      message: aborted ? `Request to ${spec.path} timed out` : `Request to ${spec.path} failed: ${String(cause)}`,
      status: 0,
      body: undefined,
      endpoint: spec.path,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    /* keep raw text — some error responses are plain strings */
  }

  const code = extractCode(body);
  const message = extractMessage(body) ?? (typeof body === 'string' ? body : res.statusText);

  if (!res.ok) {
    throw new DuitkuApiError({
      message: `Duitku ${spec.path} returned HTTP ${res.status}: ${message}`,
      status: res.status,
      code,
      body,
      endpoint: spec.path,
    });
  }

  if (successCodes && code !== undefined && !successCodes.includes(code)) {
    throw new DuitkuApiError({
      message: `Duitku ${spec.path} returned code ${code}: ${message}`,
      status: res.status,
      code,
      body,
      endpoint: spec.path,
    });
  }

  return body;
}
