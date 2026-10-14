/**
 * The one place the app talks to the API.
 *
 * Everything here is server-side: the bearer token lives in an httpOnly cookie
 * that JavaScript cannot read, so a client component can only reach the API
 * through a server action that calls this module. That is the reason there is no
 * `fetch` anywhere else in `apps/web`.
 */

import { problemSchema, type Problem } from '@tradeflow/shared';

export const API_ORIGIN = (process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

/** Every route in `docs/api-routes.md` sits under this prefix. */
const API_PREFIX = '/api';

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Overrides the client's token. `null` means "explicitly unauthenticated". */
  token?: string | null;
  signal?: AbortSignal;
}

/**
 * A non-2xx response, already parsed into the shared `Problem` shape.
 *
 * Callers switch on `.code`, never on the message: `STALE_WRITE` and
 * `SCHEDULE_CONFLICT` need different UI from a generic failure, and a reworded
 * message must not change behaviour.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(problem.message);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.problem.code;
  }

  get fields(): Record<string, string> | undefined {
    return this.problem.fields;
  }

  /** The record moved on while the user was editing it. */
  get isStaleWrite(): boolean {
    return this.problem.code === 'STALE_WRITE';
  }

  /** The API could not be reached at all — distinct from a refusal. */
  get isTransportFailure(): boolean {
    return this.problem.code === 'NETWORK_ERROR';
  }
}

function networkProblem(error: unknown): Problem {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    statusCode: 0,
    code: 'NETWORK_ERROR',
    message: `Could not reach the API at ${API_ORIGIN}. Is it running? (${detail})`,
  };
}

/** Never trust an error body to be the shape the contract promises. */
async function readProblem(response: Response): Promise<Problem> {
  const fallback: Problem = {
    statusCode: response.status,
    code: `HTTP_${response.status}`,
    message: response.statusText || 'The request failed.',
  };

  const raw = await response.text().catch(() => '');
  if (!raw) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A proxy or a stack trace where the contract promised JSON.
    return { ...fallback, message: raw.slice(0, 300) };
  }

  const result = problemSchema.safeParse(parsed);
  return result.success ? result.data : fallback;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, query?: Record<string, QueryValue>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  /** For `application/pdf`, which is not JSON and must not be parsed as such. */
  raw(path: string, options?: RequestOptions): Promise<Response>;
}

export function createApiClient(token?: string | null): ApiClient {
  const effectiveToken = token ?? undefined;

  async function raw(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = new URL(`${API_ORIGIN}${API_PREFIX}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === null || value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (effectiveToken) headers.authorization = `Bearer ${effectiveToken}`;

    try {
      return await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        // This is an operator's live book of work. A cached quote total is a
        // wrong quote total.
        cache: 'no-store',
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      throw new ApiError(0, networkProblem(error));
    }
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await raw(path, options);
    if (!response.ok) throw new ApiError(response.status, await readProblem(response));
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    request,
    raw,
    get: <T>(path: string, query?: Record<string, QueryValue>) =>
      request<T>(path, { method: 'GET', ...(query ? { query } : {}) }),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body }) }),
    patch: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'PATCH', ...(body === undefined ? {} : { body }) }),
  };
}

/**
 * The API is unauthenticated here by definition, so no token is attached even if
 * one exists on the request.
 */
export const publicApi = createApiClient(null);

/* ------------------------------------------------------------------ */
/* Defensive read helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * `docs/api-routes.md` pins the paginated endpoints (`/customers`, `/quotes`) to
 * `{ items, nextCursor, total }` but shows no paging parameters on `/jobs`,
 * `/invoices` or `/price-book`, which leaves it open whether those reply with a
 * bare array or the envelope. Accepting both here costs three lines and means a
 * mismatch between the two is not the thing that breaks the demo; the report to
 * the Lead names this as a shape to reconcile.
 */
export function asList<T>(payload: unknown): {
  items: T[];
  nextCursor: string | null;
  total: number;
} {
  if (Array.isArray(payload)) {
    return { items: payload as T[], nextCursor: null, total: payload.length };
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const items = Array.isArray(record.items) ? (record.items as T[]) : [];
    const nextCursor = typeof record.nextCursor === 'string' ? record.nextCursor : null;
    const total = typeof record.total === 'number' ? record.total : items.length;
    return { items, nextCursor, total };
  }
  return { items: [], nextCursor: null, total: 0 };
}
