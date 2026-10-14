# API routes

Base path `/api`. All routes require `Authorization: Bearer <token>` unless marked **public**.

Errors always use the `Problem` shape from `packages/shared`:
`{ statusCode, code, message, fields? }`. The web client switches on `code`.

## List envelope

Every collection endpoint answers with the same shape, so the client needs one
deserialiser:

```ts
{ items: T[], total: number, nextCursor: string | null }
```

`nextCursor` is `null` on endpoints that are not cursor-paged. `/jobs`,
`/invoices` and `/price-book` return the full matching set up to a cap and always
report `total`, so a client can tell when it is looking at a partial view.

## auth

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | **public** · body `{ email, password }` → `{ token, session }` |
| GET | `/auth/session` | → `Session` |

`Session.tenant` carries `currency` (GBP/USD/EUR). The quote builder needs it to
default correctly; assuming GBP would bill a EUR tenant in the wrong currency
with no error.

## users

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/users?role=ENGINEER&active=all` | → `{ items: [{id,name,email,role,active}], total }` |

Needed by the scheduling screen, which has to offer engineers to assign. Never
returns `passwordHash` — the select is explicit.

## customers

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/customers?q=&limit=&cursor=` | → `{ items, nextCursor, total }` |
| POST | `/customers` | `CustomerCreate` → `Customer` |
| GET | `/customers/:id` | → `Customer` with `sites` |
| PATCH | `/customers/:id` | `CustomerUpdate` |
| POST | `/customers/:id/archive` | soft delete |

## sites

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/customers/:customerId/sites` | |
| POST | `/sites` | `SiteCreate` |

## price book

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/price-book?q=&active=` | |
| POST | `/price-book` | `PriceBookItemCreate` |
| PATCH | `/price-book/:id` | `PriceBookItemUpdate` |

## quotes

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/quotes?status=&customerId=&q=&limit=&cursor=&sort=&dir=` | `sort` ∈ createdAt\|number\|status\|validUntil |
| POST | `/quotes` | `QuoteCreate` → `Quote` |
| GET | `/quotes/:id` | `Quote` with `lines`, `totals`, `customer`, `site`, `publicUrl` |
| PATCH | `/quotes/:id` | `QuoteUpdate` — **requires `expectedVersion`**; 409 `STALE_WRITE` if stale |
| POST | `/quotes/:id/send` | DRAFT → SENT, rotates `publicToken`, returns `publicUrl` |
| POST | `/quotes/:id/decision` | staff-recorded accept/decline |

### Public (no auth)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/public/quotes/:token` | → `PublicQuote` — no ids, no tenant |
| POST | `/public/quotes/:token/decision` | `{ decision, note? }` — accepted from the customer's link |

## jobs

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/jobs?from=&to=&assigneeId=&status=` | calendar feed |
| POST | `/jobs` | `JobCreate` — **the quote must be ACCEPTED**; 409 `INVALID_TRANSITION` otherwise |
| GET | `/jobs/:id` | `Job` with `statusEvents`, `quote`, `customer`, `site`, `invoices` |
| PATCH | `/jobs/:id/schedule` | `JobSchedule` — **requires `expectedVersion`**; 409 `SCHEDULE_CONFLICT` |
| POST | `/jobs/:id/status` | `JobStatusChange` — appends a `JobStatusEvent` |
| GET | `/jobs/:id/availability?assigneeId=&start=&end=` | `{ available, conflicts[] }` |

## invoices

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/invoices?status=&customerId=` | |
| POST | `/invoices` | `InvoiceCreate` — **the job must be COMPLETED**; lines are snapshotted |
| GET | `/invoices/:id` | `Invoice` with `lines`, `totals` |
| GET | `/invoices/:id/pdf` | `application/pdf` |
| POST | `/invoices/:id/send` | DRAFT → SENT |
| POST | `/invoices/:id/paid` | `InvoiceMarkPaid` → PAID |
| POST | `/invoices/:id/void` | → VOID |

## ai

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/ai/draft-quote` | `DraftQuoteRequest` → `DraftQuoteResponse` |

Returns suggestions drawn from **that tenant's** price book. `provider` says which
implementation answered (`heuristic` or `llm`), and `unmatched` lists anything in the
brief that could not be priced. Nothing is written — the operator accepts lines
explicitly.

## Response shapes

Entity shapes are inferred from `packages/shared/src/contracts.ts` for inputs.
Read models add server-computed fields:

- `Quote` — `{ id, number, status, version, currency, customer, site, lines[], net, tax, gross, effectiveTaxRateBp, validUntil, issuedAt, decidedAt, jobCount, publicUrl? }`

  `jobCount` is on the list item as well as the detail. The dashboard's
  "accepted, not yet scheduled" panel is exactly `status === 'ACCEPTED' &&
  jobCount === 0`; without the count it can only be derived by pulling a wide
  date range of jobs and cross-referencing.
- `Job` — `{ id, number, status, version, scheduledStart, scheduledEnd, assignee, customer, site, quote, completionSummary, statusEvents[] }`
- `Invoice` — `{ id, number, status, currency, customer, job, lines[], net, tax, gross, depositAmount, amountDue, issuedAt, dueAt, paidAt }`

  `gross` is the document total; `amountDue` is `gross - depositAmount`. Both are
  derived on read, so neither can disagree with the other or with the PDF.

  Invoice line fields are `net`, `tax` and `gross` as `Money`, matching quote
  lines. The database columns are `netAmount`/`taxAmount`; that spelling does not
  cross the API boundary.

## Money, always

Every amount on the wire is `{ amount, currency }` with `amount` an integer in
the currency's minor unit. A bare integer is never used, and never means pounds —
`1250` is £12.50. Sending major units would be silently wrong and is not a
supported encoding.

## Public quote payloads

`PublicQuote` is parsed strictly by the customer's page, which shows a clean
message rather than a stack trace if a field is missing. **Adding a required
field there takes the customer's quote page down**, so any change needs the page
updated in the same commit. `siteAddress` is a single pre-joined string with
empty parts omitted — the client must not have to reconstruct an address from
nullable pieces.
