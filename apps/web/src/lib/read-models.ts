/**
 * Read models.
 *
 * `docs/api-routes.md` fixes the *inputs* (they are Zod schemas in
 * `packages/shared`) and names the server-computed fields on each output, but the
 * exact nesting of the output objects is not in a schema anywhere. These types
 * are the client's reading of that document plus `apps/api/prisma/schema.prisma`,
 * and the normalisers below are what keep a small mismatch from becoming a blank
 * screen.
 *
 * Two rules hold throughout:
 *
 *   1. Money is `{ amount, currency }` in integer minor units. Nothing here turns
 *      a bare number into pounds — a bare number is read as minor units too,
 *      because that is what the column type says it is.
 *   2. Totals are computed with `computeTotals` from `@tradeflow/shared` — the
 *      same function the API calls — so a document can never render a total that
 *      disagrees with the API's own arithmetic by a penny.
 */

import {
  computeTotals,
  type CurrencyCode,
  type DocumentLineInput,
  type Money,
  type QuoteStatus,
  type JobStatus,
  type InvoiceStatus,
  type PriceUnit,
  type UserRole,
} from '@tradeflow/shared';

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/** What a money field can look like on the wire before normalisation. */
export type Moneyish = unknown;

/**
 * Coerce a money field into the contract shape.
 *
 * The API joins the stored integer to the parent's currency with `asMoney`, so
 * the object form is what we expect. A bare number is accepted as a fallback
 * because the fallback is unambiguous — the column is an integer count of minor
 * units — and is *not* treated as a major-unit decimal. A non-integer is rounded
 * half away from zero, matching `money.ts`, rather than silently rendering a
 * fraction of a penny as a whole one.
 */
export function money(value: Moneyish, currency: CurrencyCode): Money {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { amount?: unknown }).amount === 'number'
  ) {
    const record = value as { amount: number; currency?: unknown };
    const amount = Number.isInteger(record.amount)
      ? record.amount
      : Math.sign(record.amount) * Math.round(Math.abs(record.amount));
    const code =
      typeof record.currency === 'string' && record.currency.length === 3
        ? (record.currency as CurrencyCode)
        : currency;
    return { amount, currency: code };
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const amount = Number.isInteger(value)
      ? value
      : Math.sign(value) * Math.round(Math.abs(value));
    return { amount, currency };
  }

  return { amount: 0, currency };
}

/* ------------------------------------------------------------------ */
/* Shared references                                                   */
/* ------------------------------------------------------------------ */

export interface PartyRef {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}

export interface SiteAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  postcode?: string | null;
  country?: string | null;
}

export interface SiteRef extends SiteAddress {
  id: string;
  label: string;
  accessNotes?: string | null;
  /** Some serialisers nest the flattened columns back under `address`. */
  address?: SiteAddress | null;
}

export interface UserRef {
  id: string;
  name: string;
  email?: string | null;
  role?: UserRole | null;
}

/**
 * The site's address as printable lines.
 *
 * Reads the nested `address` object first and falls back to the flat columns,
 * because both are defensible serialisations of the same Prisma row and only one
 * of them will be what the API ships.
 */
export function siteAddressLines(site: SiteRef | null | undefined): string[] {
  if (!site) return [];
  const nested = site.address ?? undefined;
  const pick = (key: keyof SiteAddress): string => {
    const fromNested = nested?.[key];
    const fromFlat = site[key];
    const value = (typeof fromNested === 'string' && fromNested) || (typeof fromFlat === 'string' && fromFlat) || '';
    return value;
  };
  return [pick('line1'), pick('line2'), pick('city'), pick('postcode')].filter(Boolean);
}

export function siteAddressLine(site: SiteRef | null | undefined): string {
  return siteAddressLines(site).join(', ');
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export interface DocumentLine {
  id?: string;
  position?: number;
  priceBookItemId?: string | null;
  description: string;
  quantity: number;
  unitPrice: Money;
  taxRateBp: number;
  net: Money;
  tax: Money;
  gross: Money;
}

export interface DocumentTotals {
  net: Money;
  tax: Money;
  gross: Money;
  effectiveTaxRateBp: number;
}

interface RawLine {
  description?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  taxRateBp?: unknown;
  net?: unknown;
  tax?: unknown;
  gross?: unknown;
  netAmount?: unknown;
  taxAmount?: unknown;
  id?: unknown;
  position?: unknown;
  priceBookItemId?: unknown;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function int(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/**
 * Normalise the lines of a quote or invoice.
 *
 * Invoice lines store `netAmount`/`taxAmount` rather than `net`/`tax` (see the
 * Prisma model), so both namings are read.
 */
export function toDocumentLines(raw: unknown, currency: CurrencyCode): DocumentLine[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawLine[]).map((line, index) => {
    const quantity = int(line.quantity);
    const unitPrice = money(line.unitPrice, currency);
    const taxRateBp = int(line.taxRateBp, 2000);

    // Fall back to the shared arithmetic only when the server did not send its
    // own line totals; when it did, they win, because an issued invoice is a
    // snapshot and must render exactly as stored.
    const computed = computeTotals([{ description: str(line.description), quantity, unitPrice, taxRateBp }], currency).lines[0];

    return {
      id: typeof line.id === 'string' ? line.id : undefined,
      position: typeof line.position === 'number' ? line.position : index,
      priceBookItemId: typeof line.priceBookItemId === 'string' ? line.priceBookItemId : null,
      description: str(line.description),
      quantity,
      unitPrice,
      taxRateBp,
      net: money(line.net ?? line.netAmount ?? computed?.net, currency),
      tax: money(line.tax ?? line.taxAmount ?? computed?.tax, currency),
      gross: line.gross !== undefined ? money(line.gross, currency) : (computed?.gross ?? money(0, currency)),
    };
  });
}

/** Sum the lines with the shared helper. */
export function totalsFromLines(lines: DocumentLine[], currency: CurrencyCode): DocumentTotals {
  const inputs: DocumentLineInput[] = lines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxRateBp: line.taxRateBp,
  }));
  const totals = computeTotals(inputs, currency);
  return {
    net: totals.net,
    tax: totals.tax,
    gross: totals.gross,
    effectiveTaxRateBp: totals.effectiveTaxRateBp,
  };
}

/**
 * The totals to print.
 *
 * Server-supplied totals are preferred — an invoice must show what it was issued
 * with — and the shared calculation fills in when they are absent. The two use
 * the same code path in `documents.ts`, so "prefer" never means "differ".
 */
export function toTotals(
  raw: { net?: unknown; tax?: unknown; gross?: unknown; effectiveTaxRateBp?: unknown },
  lines: DocumentLine[],
  currency: CurrencyCode,
): DocumentTotals {
  const derived = totalsFromLines(lines, currency);
  const hasServerTotals = raw.net !== undefined && raw.tax !== undefined && raw.gross !== undefined;
  const net = hasServerTotals ? money(raw.net, currency) : derived.net;
  const tax = hasServerTotals ? money(raw.tax, currency) : derived.tax;
  const gross = hasServerTotals ? money(raw.gross, currency) : derived.gross;
  return {
    net,
    tax,
    gross,
    effectiveTaxRateBp: int(
      raw.effectiveTaxRateBp,
      net.amount === 0 ? 0 : Math.round((tax.amount / net.amount) * 10_000),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Quotes                                                              */
/* ------------------------------------------------------------------ */

export interface Quote {
  id: string;
  number: string;
  status: QuoteStatus;
  version: number;
  currency: CurrencyCode;
  customer: PartyRef;
  site: SiteRef | null;
  lines: DocumentLine[];
  totals: DocumentTotals;
  notes: string | null;
  validUntil: string;
  issuedAt: string | null;
  decidedAt: string | null;
  publicUrl: string | null;
  createdAt: string | null;
  /**
   * Whether a job already exists for this quote.
   *
   * `docs/api-routes.md` does not put jobs on the Quote read model and there is
   * no `GET /quotes?hasJob=` filter, so "accepted but not yet scheduled" has to
   * be inferred. `null` means "the API did not say", which the dashboard treats
   * as "check the job feed" rather than as "no job".
   */
  hasJob: boolean | null;
}

function asParty(value: unknown, fallbackName: string): PartyRef {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    id: str(record.id),
    name: str(record.name, fallbackName),
    email: typeof record.email === 'string' ? record.email : null,
    phone: typeof record.phone === 'string' ? record.phone : null,
  };
}

export function asSite(value: unknown): SiteRef | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const address = (record.address ?? null) as SiteAddress | null;
  return {
    id: str(record.id),
    label: str(record.label, 'Site'),
    line1: typeof record.line1 === 'string' ? record.line1 : null,
    line2: typeof record.line2 === 'string' ? record.line2 : null,
    city: typeof record.city === 'string' ? record.city : null,
    postcode: typeof record.postcode === 'string' ? record.postcode : null,
    country: typeof record.country === 'string' ? record.country : null,
    accessNotes: typeof record.accessNotes === 'string' ? record.accessNotes : null,
    address,
  };
}

export function asQuote(payload: unknown): Quote {
  const record = (payload ?? {}) as Record<string, unknown>;
  const currency = (str(record.currency, 'GBP') as CurrencyCode) ?? 'GBP';
  const lines = toDocumentLines(record.lines, currency);

  const jobsField = record.jobs ?? record.jobCount;
  const hasJob =
    typeof record.jobCount === 'number'
      ? record.jobCount > 0
      : Array.isArray(record.jobs)
        ? record.jobs.length > 0
        : jobsField === undefined
          ? null
          : null;

  return {
    id: str(record.id),
    number: str(record.number, '—'),
    status: (str(record.status, 'DRAFT') as QuoteStatus) ?? 'DRAFT',
    version: int(record.version, 1),
    currency,
    customer: asParty(record.customer, 'Customer'),
    site: asSite(record.site),
    lines,
    totals: toTotals(record, lines, currency),
    notes: typeof record.notes === 'string' ? record.notes : null,
    validUntil: str(record.validUntil),
    issuedAt: typeof record.issuedAt === 'string' ? record.issuedAt : null,
    decidedAt: typeof record.decidedAt === 'string' ? record.decidedAt : null,
    publicUrl: typeof record.publicUrl === 'string' ? record.publicUrl : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    hasJob,
  };
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export interface JobStatusEvent {
  id: string;
  fromStatus: JobStatus | null;
  toStatus: JobStatus;
  note: string | null;
  actor: UserRef | null;
  createdAt: string;
}

export interface Job {
  id: string;
  number: string;
  status: JobStatus;
  version: number;
  scheduledStart: string;
  scheduledEnd: string;
  assignee: UserRef | null;
  customer: PartyRef;
  site: SiteRef | null;
  quote: { id: string; number: string; status: QuoteStatus } | null;
  completionSummary: string | null;
  notes: string | null;
  statusEvents: JobStatusEvent[];
  createdAt: string | null;
}

export function asJob(payload: unknown): Job {
  const record = (payload ?? {}) as Record<string, unknown>;
  const quoteRaw = (record.quote ?? null) as Record<string, unknown> | null;
  const assigneeRaw = (record.assignee ?? null) as Record<string, unknown> | null;

  return {
    id: str(record.id),
    number: str(record.number, '—'),
    status: (str(record.status, 'SCHEDULED') as JobStatus) ?? 'SCHEDULED',
    version: int(record.version, 1),
    scheduledStart: str(record.scheduledStart),
    scheduledEnd: str(record.scheduledEnd),
    assignee: assigneeRaw
      ? { id: str(assigneeRaw.id), name: str(assigneeRaw.name, 'Engineer'), email: null }
      : null,
    customer: asParty(record.customer, 'Customer'),
    site: asSite(record.site),
    quote: quoteRaw
      ? {
          id: str(quoteRaw.id),
          number: str(quoteRaw.number, '—'),
          status: (str(quoteRaw.status, 'ACCEPTED') as QuoteStatus) ?? 'ACCEPTED',
        }
      : null,
    completionSummary:
      typeof record.completionSummary === 'string' ? record.completionSummary : null,
    notes: typeof record.notes === 'string' ? record.notes : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    statusEvents: Array.isArray(record.statusEvents)
      ? (record.statusEvents as Record<string, unknown>[]).map((event) => ({
          id: str(event.id),
          fromStatus: typeof event.fromStatus === 'string' ? (event.fromStatus as JobStatus) : null,
          toStatus: (str(event.toStatus, 'SCHEDULED') as JobStatus) ?? 'SCHEDULED',
          note: typeof event.note === 'string' ? event.note : null,
          actor: event.actor
            ? {
                id: str((event.actor as Record<string, unknown>).id),
                name: str((event.actor as Record<string, unknown>).name, 'User'),
              }
            : null,
          createdAt: str(event.createdAt),
        }))
      : [],
  };
}

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  currency: CurrencyCode;
  customer: PartyRef;
  job: { id: string; number: string } | null;
  lines: DocumentLine[];
  totals: DocumentTotals;
  depositAmount: Money;
  amountDue: Money;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  notes: string | null;
}

export function asInvoice(payload: unknown): Invoice {
  const record = (payload ?? {}) as Record<string, unknown>;
  const currency = (str(record.currency, 'GBP') as CurrencyCode) ?? 'GBP';
  const lines = toDocumentLines(record.lines, currency);
  const totals = toTotals(record, lines, currency);

  const deposit = money(record.depositAmount, currency);
  const serverDue = typeof record.amountDue === 'number' || typeof record.amountDue === 'object';
  const amountDue = serverDue
    ? money(record.amountDue, currency)
    : { amount: Math.max(0, totals.gross.amount - deposit.amount), currency };

  const jobRaw = (record.job ?? null) as Record<string, unknown> | null;

  return {
    id: str(record.id),
    number: str(record.number, '—'),
    status: (str(record.status, 'DRAFT') as InvoiceStatus) ?? 'DRAFT',
    currency,
    customer: asParty(record.customer, 'Customer'),
    job: jobRaw ? { id: str(jobRaw.id), number: str(jobRaw.number, '—') } : null,
    lines,
    totals,
    depositAmount: deposit,
    amountDue,
    issuedAt: typeof record.issuedAt === 'string' ? record.issuedAt : null,
    dueAt: typeof record.dueAt === 'string' ? record.dueAt : null,
    paidAt: typeof record.paidAt === 'string' ? record.paidAt : null,
    paymentReference:
      typeof record.paymentReference === 'string' ? record.paymentReference : null,
    notes: typeof record.notes === 'string' ? record.notes : null,
  };
}

/* ------------------------------------------------------------------ */
/* Customers and price book                                            */
/* ------------------------------------------------------------------ */

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  billingAddress: SiteAddress;
  sites: SiteRef[];
  archivedAt: string | null;
  createdAt: string | null;
}

export function asCustomer(payload: unknown): Customer {
  const record = (payload ?? {}) as Record<string, unknown>;
  const address = (record.billingAddress ?? record.address ?? {}) as SiteAddress;
  const flat: SiteAddress = {
    line1: typeof record.billingLine1 === 'string' ? record.billingLine1 : address.line1,
    line2: typeof record.billingLine2 === 'string' ? record.billingLine2 : address.line2,
    city: typeof record.billingCity === 'string' ? record.billingCity : address.city,
    postcode: typeof record.billingPostcode === 'string' ? record.billingPostcode : address.postcode,
    country: typeof record.billingCountry === 'string' ? record.billingCountry : address.country,
  };

  return {
    id: str(record.id),
    name: str(record.name, 'Customer'),
    email: typeof record.email === 'string' ? record.email : null,
    phone: typeof record.phone === 'string' ? record.phone : null,
    notes: typeof record.notes === 'string' ? record.notes : null,
    billingAddress: flat,
    sites: Array.isArray(record.sites)
      ? (record.sites as unknown[]).map(asSite).filter((site): site is SiteRef => site !== null)
      : [],
    archivedAt: typeof record.archivedAt === 'string' ? record.archivedAt : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
  };
}

export function addressLines(address: SiteAddress | null | undefined): string[] {
  if (!address) return [];
  return [address.line1, address.line2, address.city, address.postcode].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

export interface PriceBookItem {
  id: string;
  code: string;
  description: string;
  unit: PriceUnit;
  unitPrice: Money;
  taxRateBp: number;
  active: boolean;
}

export function asPriceBookItem(payload: unknown, currency: CurrencyCode = 'GBP'): PriceBookItem {
  const record = (payload ?? {}) as Record<string, unknown>;
  return {
    id: str(record.id),
    code: str(record.code),
    description: str(record.description),
    unit: (str(record.unit, 'EACH') as PriceUnit) ?? 'EACH',
    // A price book row stores a bare integer; it has no currency of its own, so
    // the caller's document currency is the only correct label for it.
    unitPrice: money(record.unitPrice, currency),
    taxRateBp: int(record.taxRateBp, 2000),
    active: record.active === undefined ? true : Boolean(record.active),
  };
}

/* ------------------------------------------------------------------ */
/* Public quote                                                        */
/* ------------------------------------------------------------------ */

/**
 * The public page does have a schema — `publicQuoteSchema` in the shared
 * contracts — so this type is the schema's inference rather than a guess, and
 * the normaliser only exists to keep the page from throwing on a malformed body.
 */
export type { PublicQuote } from '@tradeflow/shared';
