/**
 * The wire contract.
 *
 * These schemas are the single definition of every request and response shape.
 * The API validates with them, the browser forms validate with them, and the
 * TypeScript types on both sides are inferred from them — so a field cannot be
 * added to the API and forgotten in the client.
 *
 * Timestamps are UTC ISO 8601 strings. Dates are `YYYY-MM-DD`. Amounts are
 * integers in the currency's minor unit; see `money.ts` for why.
 */

import { z } from 'zod';
import { CURRENCIES } from './money';

export const currencySchema = z.enum(CURRENCIES);

export const moneySchema = z.object({
  /** Integer minor units — pence, cents. Never a float. */
  amount: z.number().int(),
  currency: currencySchema,
});

export const isoDateTime = z.iso.datetime();
export const isoDate = z.iso.date();

/* ------------------------------------------------------------------ */
/* Identity and tenancy                                                */
/* ------------------------------------------------------------------ */

export const userRoleSchema = z.enum(['OWNER', 'OFFICE', 'ENGINEER']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionSchema = z.object({
  user: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.email(),
    role: userRoleSchema,
  }),
  tenant: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    /// The tenant's default currency. The quote builder would otherwise assume
    /// GBP, and a tenant billing in EUR would get the wrong symbol with no error.
    currency: currencySchema,
  }),
});
export type Session = z.infer<typeof sessionSchema>;

/* ------------------------------------------------------------------ */
/* Customers and sites                                                 */
/* ------------------------------------------------------------------ */

export const addressSchema = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  postcode: z.string().min(1).max(20),
  country: z.string().length(2).default('GB'),
});
export type Address = z.infer<typeof addressSchema>;

export const customerCreateSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.email().optional(),
  phone: z.string().max(40).optional(),
  billingAddress: addressSchema.optional(),
  notes: z.string().max(2000).optional(),
});
export type CustomerCreate = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = customerCreateSchema.partial();
export type CustomerUpdate = z.infer<typeof customerUpdateSchema>;

/**
 * A site is where the work happens, which is usually not the billing address.
 * Trades businesses serve landlords and letting agents who own several
 * properties under one account, so this is a separate entity rather than a
 * second address on the customer.
 */
export const siteCreateSchema = z.object({
  customerId: z.uuid(),
  label: z.string().min(1).max(120),
  address: addressSchema,
  accessNotes: z.string().max(1000).optional(),
});
export type SiteCreate = z.infer<typeof siteCreateSchema>;

export const siteUpdateSchema = siteCreateSchema.partial().omit({ customerId: true });
export type SiteUpdate = z.infer<typeof siteUpdateSchema>;

/* ------------------------------------------------------------------ */
/* Price book                                                          */
/* ------------------------------------------------------------------ */

export const priceUnitSchema = z.enum(['HOUR', 'DAY', 'EACH', 'SQUARE_METRE', 'METRE']);
export type PriceUnit = z.infer<typeof priceUnitSchema>;

export const priceBookItemCreateSchema = z.object({
  code: z.string().min(1).max(40),
  description: z.string().min(1).max(300),
  unit: priceUnitSchema,
  unitPrice: moneySchema,
  taxRateBp: z.number().int().min(0).max(10_000),
});
export type PriceBookItemCreate = z.infer<typeof priceBookItemCreateSchema>;

export const priceBookItemUpdateSchema = priceBookItemCreateSchema.partial().extend({
  active: z.boolean().optional(),
});
export type PriceBookItemUpdate = z.infer<typeof priceBookItemUpdateSchema>;

/* ------------------------------------------------------------------ */
/* Quotes                                                              */
/* ------------------------------------------------------------------ */

export const quoteStatusSchema = z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED']);
export type QuoteStatus = z.infer<typeof quoteStatusSchema>;

export const quoteLineInputSchema = z.object({
  priceBookItemId: z.uuid().optional(),
  description: z.string().min(1).max(300),
  quantity: z.number().int().min(0).max(100_000),
  unitPrice: moneySchema,
  taxRateBp: z.number().int().min(0).max(10_000),
});
export type QuoteLineInput = z.infer<typeof quoteLineInputSchema>;

export const quoteCreateSchema = z.object({
  customerId: z.uuid(),
  siteId: z.uuid(),
  currency: currencySchema.default('GBP'),
  /** Business days from issue that the price holds for. */
  validForDays: z.number().int().min(1).max(365).default(30),
  notes: z.string().max(2000).optional(),
  lines: z.array(quoteLineInputSchema).min(1).max(200),
});
export type QuoteCreate = z.infer<typeof quoteCreateSchema>;

/**
 * Editing a quote requires the version the client last saw.
 *
 * Two people editing the same quote is normal in a small office — the owner
 * prices a job while the office manager adds a line. Without a version check the
 * second save silently discards the first, and the quote that reaches the
 * customer is not the one either of them wrote.
 */
export const quoteUpdateSchema = quoteCreateSchema.partial().extend({
  expectedVersion: z.number().int().min(1),
});
export type QuoteUpdate = z.infer<typeof quoteUpdateSchema>;

/**
 * The only two things a customer can decide. Mirrors `QuoteDecisionOutcome` in
 * the Prisma schema — a separate type there rather than a reuse of QuoteStatus,
 * because DRAFT and EXPIRED are not decisions.
 */
export const quoteDecisionOutcomeSchema = z.enum(['ACCEPTED', 'DECLINED']);
export type QuoteDecisionOutcome = z.infer<typeof quoteDecisionOutcomeSchema>;

export const quoteDecisionSchema = z.object({
  decision: quoteDecisionOutcomeSchema,
  /** Free text from the customer, stored against the decision. */
  note: z.string().max(1000).optional(),
});
export type QuoteDecision = z.infer<typeof quoteDecisionSchema>;

/** The response to a public accept link. Deliberately minimal: no ids, no tenant. */
export const publicQuoteSchema = z.object({
  quoteNumber: z.string(),
  businessName: z.string(),
  /// A UK quote must show the supplier's VAT number when registered.
  businessVatNumber: z.string().nullable(),
  customerName: z.string(),
  siteLabel: z.string(),
  siteAddress: z.string(),
  currency: currencySchema,
  status: quoteStatusSchema,
  validUntil: isoDate,
  issuedAt: isoDateTime.nullable(),
  notes: z.string().nullable(),
  lines: z.array(
    z.object({
      description: z.string(),
      quantity: z.number().int(),
      unitPrice: moneySchema,
      taxRateBp: z.number().int(),
      net: moneySchema,
      tax: moneySchema,
      gross: moneySchema,
    }),
  ),
  net: moneySchema,
  tax: moneySchema,
  gross: moneySchema,
});
export type PublicQuote = z.infer<typeof publicQuoteSchema>;

/* ------------------------------------------------------------------ */
/* Jobs and scheduling                                                 */
/* ------------------------------------------------------------------ */

export const jobStatusSchema = z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobCreateSchema = z.object({
  quoteId: z.uuid(),
  assigneeId: z.uuid().optional(),
  scheduledStart: isoDateTime,
  scheduledEnd: isoDateTime,
  notes: z.string().max(2000).optional(),
});
export type JobCreate = z.infer<typeof jobCreateSchema>;

export const jobScheduleSchema = z.object({
  assigneeId: z.uuid().nullable(),
  scheduledStart: isoDateTime,
  scheduledEnd: isoDateTime,
  expectedVersion: z.number().int().min(1),
});
export type JobSchedule = z.infer<typeof jobScheduleSchema>;

export const jobStatusChangeSchema = z.object({
  status: jobStatusSchema,
  note: z.string().max(1000).optional(),
  /** Required when moving to COMPLETED so the invoice can be raised from it. */
  completionSummary: z.string().max(2000).optional(),
});
export type JobStatusChange = z.infer<typeof jobStatusChangeSchema>;

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

export const invoiceStatusSchema = z.enum(['DRAFT', 'SENT', 'PAID', 'VOID']);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const invoiceCreateSchema = z.object({
  jobId: z.uuid(),
  dueInDays: z.number().int().min(0).max(365).default(14),
  /** Deposit already collected, deducted from the amount due. */
  depositAmount: moneySchema.optional(),
});
export type InvoiceCreate = z.infer<typeof invoiceCreateSchema>;

export const invoiceMarkPaidSchema = z.object({
  paidAt: isoDateTime.optional(),
  reference: z.string().max(120).optional(),
});
export type InvoiceMarkPaid = z.infer<typeof invoiceMarkPaidSchema>;

/* ------------------------------------------------------------------ */
/* AI-assisted quoting                                                 */
/* ------------------------------------------------------------------ */

/**
 * The whole point of this feature is to turn a customer's own words — a
 * voicemail transcript, an email, a note taken on site — into priced lines
 * drawn from the business's own price book. It suggests; it does not decide.
 * Every suggestion carries the reason it was made so the operator can reject it
 * in one look, and nothing is written until a human accepts it.
 */
export const draftQuoteRequestSchema = z.object({
  customerId: z.uuid(),
  /** Free text from the customer. */
  brief: z.string().min(10).max(4000),
});
export type DraftQuoteRequest = z.infer<typeof draftQuoteRequestSchema>;

export const draftQuoteSuggestionSchema = z.object({
  priceBookItemId: z.uuid(),
  code: z.string(),
  description: z.string(),
  unit: priceUnitSchema,
  unitPrice: moneySchema,
  taxRateBp: z.number().int(),
  quantity: z.number().int().min(1),
  /** Why this line was suggested, in the operator's language. */
  rationale: z.string(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});
export type DraftQuoteSuggestion = z.infer<typeof draftQuoteSuggestionSchema>;

export const draftQuoteResponseSchema = z.object({
  suggestions: z.array(draftQuoteSuggestionSchema),
  /** Which provider produced this, so the operator knows what they are reading. */
  provider: z.enum(['heuristic', 'llm']),
  /** Anything in the brief that could not be matched to the price book. */
  unmatched: z.array(z.string()),
});
export type DraftQuoteResponse = z.infer<typeof draftQuoteResponseSchema>;

/* ------------------------------------------------------------------ */
/* Transport helpers                                                   */
/* ------------------------------------------------------------------ */

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  q: z.string().max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * A query DTO has to be a real schema, not a TypeScript intersection.
 *
 * `@Query() query: PaginationQuery & { status?: string }` validates nothing at
 * runtime — the intersection has no constructor for the pipe to read, so
 * `limit` arrives as the string "5" and Prisma rejects it. Every list endpoint
 * therefore gets its own schema.
 */
export const quoteListQuerySchema = paginationQuerySchema.extend({
  status: quoteStatusSchema.optional(),
  customerId: z.uuid().optional(),
  /**
   * Sorting is part of the query, not of the page.
   *
   * Sort headers that reorder the rows the server happened to return are
   * correct only while everything fits on one page, and silently wrong after
   * that — the client sorts 25 rows and presents them as "the newest quotes".
   */
  sort: z.enum(['createdAt', 'number', 'status', 'validUntil']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type QuoteListQuery = z.infer<typeof quoteListQuerySchema>;

export const jobListQuerySchema = z.object({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  assigneeId: z.uuid().optional(),
  status: jobStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type JobListQuery = z.infer<typeof jobListQuerySchema>;

export const invoiceListQuerySchema = z.object({
  status: invoiceStatusSchema.optional(),
  customerId: z.uuid().optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const paginatedSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.uuid().nullable(),
    total: z.number().int(),
  });

export const problemSchema = z.object({
  statusCode: z.number().int(),
  /** Stable, machine-readable. The client switches on this, never on the message. */
  code: z.string(),
  message: z.string(),
  /** Field-level detail for form errors. */
  fields: z.record(z.string(), z.string()).optional(),
});
export type Problem = z.infer<typeof problemSchema>;
