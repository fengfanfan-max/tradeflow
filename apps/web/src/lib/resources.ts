/**
 * Every API call the app makes, in one readable list.
 *
 * Pages and actions call these rather than reaching for the client, so the
 * endpoint paths and the normalisation of each response live next to each other
 * and next to `docs/api-routes.md`.
 */

import {
  draftQuoteResponseSchema,
  type DraftQuoteRequest,
  type DraftQuoteResponse,
  type InvoiceCreate,
  type InvoiceMarkPaid,
  type JobCreate,
  type JobSchedule,
  type JobStatus,
  type JobStatusChange,
  type PriceBookItemCreate,
  type PriceBookItemUpdate,
  type QuoteCreate,
  type QuoteDecision,
  type QuoteStatus,
} from '@tradeflow/shared';
import { ApiError, asList, createApiClient, type ApiClient, type QueryValue } from './api';
import {
  asCustomer,
  asInvoice,
  asJob,
  asPriceBookItem,
  asQuote,
  asSite,
  type Customer,
  type Invoice,
  type Job,
  type PriceBookItem,
  type Quote,
  type SiteRef,
  type UserRef,
} from './read-models';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

type Client = ApiClient;

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export interface LoginResult {
  token: string;
  session: unknown;
}

export function login(client: Client, body: { email: string; password: string }): Promise<LoginResult> {
  return client.post<LoginResult>('/auth/login', body);
}

/* ------------------------------------------------------------------ */
/* Customers and sites                                                 */
/* ------------------------------------------------------------------ */

export async function listCustomers(
  client: Client,
  query: { q?: string; limit?: number; cursor?: string } = {},
): Promise<Page<Customer>> {
  const payload = await client.get<unknown>('/customers', {
    q: query.q,
    limit: query.limit,
    cursor: query.cursor,
  });
  const page = asList<unknown>(payload);
  return { ...page, items: page.items.map(asCustomer) };
}

export async function getCustomer(client: Client, id: string): Promise<Customer> {
  return asCustomer(await client.get<unknown>(`/customers/${id}`));
}

export async function createCustomer(
  client: Client,
  body: Record<string, unknown>,
): Promise<Customer> {
  return asCustomer(await client.post<unknown>('/customers', body));
}

export async function updateCustomer(
  client: Client,
  id: string,
  body: Record<string, unknown>,
): Promise<Customer> {
  return asCustomer(await client.patch<unknown>(`/customers/${id}`, body));
}

export async function archiveCustomer(client: Client, id: string): Promise<void> {
  await client.post(`/customers/${id}/archive`);
}

export async function listSites(client: Client, customerId: string): Promise<SiteRef[]> {
  const payload = await client.get<unknown>(`/customers/${customerId}/sites`);
  return asList<unknown>(payload)
    .items.map(asSite)
    .filter((site): site is SiteRef => site !== null);
}

export async function createSite(client: Client, body: Record<string, unknown>): Promise<SiteRef | null> {
  return asSite(await client.post<unknown>('/sites', body));
}

/* ------------------------------------------------------------------ */
/* Price book                                                          */
/* ------------------------------------------------------------------ */

export async function listPriceBook(
  client: Client,
  query: { q?: string; active?: boolean } = {},
): Promise<PriceBookItem[]> {
  const payload = await client.get<unknown>('/price-book', {
    q: query.q,
    active: query.active === undefined ? undefined : String(query.active),
  });
  return asList<unknown>(payload).items.map((item) => asPriceBookItem(item));
}

export async function createPriceBookItem(
  client: Client,
  body: PriceBookItemCreate,
): Promise<PriceBookItem> {
  return asPriceBookItem(await client.post<unknown>('/price-book', body));
}

export async function updatePriceBookItem(
  client: Client,
  id: string,
  body: PriceBookItemUpdate,
): Promise<PriceBookItem> {
  return asPriceBookItem(await client.patch<unknown>(`/price-book/${id}`, body));
}

/* ------------------------------------------------------------------ */
/* Quotes                                                              */
/* ------------------------------------------------------------------ */

export async function listQuotes(
  client: Client,
  query: {
    status?: QuoteStatus;
    customerId?: string;
    q?: string;
    limit?: number;
    cursor?: string;
  } = {},
): Promise<Page<Quote>> {
  const payload = await client.get<unknown>('/quotes', {
    status: query.status,
    customerId: query.customerId,
    q: query.q,
    limit: query.limit,
    cursor: query.cursor,
  });
  const page = asList<unknown>(payload);
  return { ...page, items: page.items.map(asQuote) };
}

export async function getQuote(client: Client, id: string): Promise<Quote> {
  return asQuote(await client.get<unknown>(`/quotes/${id}`));
}

export async function createQuote(client: Client, body: QuoteCreate): Promise<Quote> {
  return asQuote(await client.post<unknown>('/quotes', body));
}

export async function updateQuote(
  client: Client,
  id: string,
  body: Record<string, unknown>,
): Promise<Quote> {
  return asQuote(await client.patch<unknown>(`/quotes/${id}`, body));
}

/**
 * The accept link the customer will receive.
 *
 * `POST /quotes/:id/send` "returns `publicUrl`", and `GET /quotes/:id` also
 * carries it. Both readings are accepted here — a nested quote, a bare field —
 * and a response that carries neither falls back to re-reading the quote, so the
 * send button cannot end up with nothing to show.
 */
export async function sendQuote(client: Client, id: string): Promise<string | null> {
  const payload = (await client.post<unknown>(`/quotes/${id}/send`)) as Record<string, unknown> | null;
  const direct = payload?.publicUrl;
  if (typeof direct === 'string' && direct) return direct;

  const nested = (payload?.quote ?? null) as Record<string, unknown> | null;
  if (typeof nested?.publicUrl === 'string' && nested.publicUrl) return nested.publicUrl;

  const reread = await getQuote(client, id);
  return reread.publicUrl;
}

export async function decideQuote(
  client: Client,
  id: string,
  body: QuoteDecision,
): Promise<Quote> {
  return asQuote(await client.post<unknown>(`/quotes/${id}/decision`, body));
}

/* ------------------------------------------------------------------ */
/* Public quote (no auth)                                              */
/* ------------------------------------------------------------------ */

export async function getPublicQuote(token: string): Promise<unknown> {
  const client = createApiClient(null);
  return client.get<unknown>(`/public/quotes/${encodeURIComponent(token)}`);
}

export async function decidePublicQuote(
  token: string,
  body: QuoteDecision,
): Promise<void> {
  const client = createApiClient(null);
  await client.post(`/public/quotes/${encodeURIComponent(token)}/decision`, body);
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export async function listJobs(
  client: Client,
  query: {
    from?: string;
    to?: string;
    assigneeId?: string;
    status?: JobStatus;
    /** `jobListQuerySchema` caps this at 500 and defaults to 200. */
    limit?: number;
  } = {},
): Promise<Job[]> {
  const payload = await client.get<unknown>('/jobs', {
    from: query.from,
    to: query.to,
    assigneeId: query.assigneeId,
    status: query.status,
    limit: query.limit,
  });
  return asList<unknown>(payload).items.map(asJob);
}

export async function getJob(client: Client, id: string): Promise<Job> {
  return asJob(await client.get<unknown>(`/jobs/${id}`));
}

export async function createJob(client: Client, body: JobCreate): Promise<Job> {
  return asJob(await client.post<unknown>('/jobs', body));
}

export async function scheduleJob(
  client: Client,
  id: string,
  body: JobSchedule,
): Promise<Job> {
  return asJob(await client.patch<unknown>(`/jobs/${id}/schedule`, body));
}

export async function changeJobStatus(
  client: Client,
  id: string,
  body: JobStatusChange,
): Promise<Job> {
  return asJob(await client.post<unknown>(`/jobs/${id}/status`, body));
}

export interface Availability {
  available: boolean;
  conflicts: { id: string; number: string; scheduledStart: string; scheduledEnd: string }[];
}

export async function checkAvailability(
  client: Client,
  id: string,
  query: { assigneeId?: string; start?: string; end?: string },
): Promise<Availability> {
  const payload = (await client.get<unknown>(`/jobs/${id}/availability`, query)) as Record<string, unknown>;
  return {
    available: Boolean(payload?.available),
    conflicts: Array.isArray(payload?.conflicts)
      ? (payload.conflicts as Record<string, unknown>[]).map((conflict) => ({
          id: String(conflict.id ?? ''),
          number: String(conflict.number ?? ''),
          scheduledStart: String(conflict.scheduledStart ?? ''),
          scheduledEnd: String(conflict.scheduledEnd ?? ''),
        }))
      : [],
  };
}

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

export async function listInvoices(
  client: Client,
  query: { status?: string; customerId?: string } = {},
): Promise<Invoice[]> {
  const payload = await client.get<unknown>('/invoices', {
    status: query.status,
    customerId: query.customerId,
  });
  return asList<unknown>(payload).items.map(asInvoice);
}

export async function getInvoice(client: Client, id: string): Promise<Invoice> {
  return asInvoice(await client.get<unknown>(`/invoices/${id}`));
}

export async function createInvoice(client: Client, body: InvoiceCreate): Promise<Invoice> {
  return asInvoice(await client.post<unknown>('/invoices', body));
}

export async function sendInvoice(client: Client, id: string): Promise<Invoice> {
  return asInvoice(await client.post<unknown>(`/invoices/${id}/send`));
}

export async function markInvoicePaid(
  client: Client,
  id: string,
  body: InvoiceMarkPaid,
): Promise<Invoice> {
  return asInvoice(await client.post<unknown>(`/invoices/${id}/paid`, body));
}

export async function voidInvoice(client: Client, id: string): Promise<Invoice> {
  return asInvoice(await client.post<unknown>(`/invoices/${id}/void`));
}

/* ------------------------------------------------------------------ */
/* AI-assisted quoting                                                 */
/* ------------------------------------------------------------------ */

export async function draftQuote(
  client: Client,
  body: DraftQuoteRequest,
): Promise<DraftQuoteResponse> {
  const payload = await client.post<unknown>('/ai/draft-quote', body);
  const parsed = draftQuoteResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(500, {
      statusCode: 500,
      code: 'RESPONSE_INVALID',
      message: 'The drafting service returned something the app could not read.',
    });
  }
  return parsed.data;
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

/**
 * The roster, for the "assign an engineer" picker.
 *
 * `docs/api-routes.md` lists no users endpoint, but a job's assignee is a
 * `userId` and the picker needs names to offer. `/users` is the guess. When it
 * is absent the caller falls back to the assignees already visible on the job
 * feed, so the demo still schedules to a real person — see
 * `assignableEngineers` in `src/lib/roster.ts`.
 */
export async function listUsers(client: Client, role?: string): Promise<UserRef[]> {
  const payload = await client.get<unknown>('/users', { role } as Record<string, QueryValue>);
  return asList<unknown>(payload)
    .items.map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return {
        id: String(record.id ?? ''),
        name: String(record.name ?? 'Engineer'),
        email: typeof record.email === 'string' ? record.email : null,
        role: typeof record.role === 'string' ? (record.role as UserRef['role']) : null,
      };
    })
    .filter((user) => user.id.length > 0);
}
