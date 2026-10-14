# Architecture

## Shape

```
Browser ──▶ Next.js (App Router)  ──▶  NestJS API  ──▶  PostgreSQL
              server components          REST + JWT        one database,
              server actions             Zod-validated      tenant-scoped
```

Three deployable things, one repository. The browser never talks to the database, and the
API never renders HTML.

## Why the split

Next.js alone could do all of this with server actions against Prisma directly, and for a
smaller product that would be the right call — fewer moving parts, less to deploy.

It is not the right call here. The pieces that make this a product rather than a form are
the ones that need to be usable when the web client is not the caller:

- A **public quote link** that a customer opens with no session and no cookies.
- A **scheduling guarantee** that has to hold when two office users act at once.
- An **invoice PDF** that is generated server-side from stored rows.
- A **mobile client** the trade business will eventually want, for engineers on site.

An API that only exists to serve one server-rendered front end tends to grow assumptions
about that front end. Separating them costs a network hop and buys the ability to add the
second caller without unpicking the first.

## Request path

1. `JwtAuthGuard` runs globally, registered in `AuthModule` rather than per route, so a new
   endpoint is protected unless it is explicitly marked `@Public()`. Failure is closed.
2. The guard verifies the bearer token and attaches a `Principal` to the request.
3. The controller takes `@CurrentUser()` or `@TenantId()` and passes `tenantId` to the
   service. Controllers hold no logic.
4. The service calls `prisma.forTenant(tenantId)`, which returns a client whose queries are
   already filtered. See [ADR 0005](adr/0005-tenant-scoping-in-the-data-layer.md).
5. Domain errors are thrown from `common/errors.ts`; `ProblemFilter` maps every failure —
   domain, Zod, Prisma, unexpected — to one `Problem` shape with a stable `code`.

## Modules

| Module | Owns |
| --- | --- |
| `config` | Environment validation. One Zod schema, checked at boot. |
| `prisma` | The client, the driver adapter, and the tenant extension. |
| `auth` | Sign-in, the global guard, the staff list. |
| `customers` | Customers and their sites. |
| `pricebook` | What this business bills for, and at what rate. |
| `quotes` | Quotes, lines, decisions, and the public accept link. |
| `jobs` | Jobs, scheduling, status history, availability. |
| `invoices` | Invoices, snapshotted lines, PDF, payment. |
| `ai` | Quote drafting, behind a provider interface. |

`documents/numbering.service.ts` is shared by quotes, jobs and invoices: per-tenant,
gap-free document numbers, allocated with a row lock rather than `MAX(number) + 1`.

## Data model notes

**Money.** Integer minor units, currency on the parent document. Rates in basis points.
[ADR 0003](adr/0003-tax-rounding-per-line.md)

**Time.** Instants are `timestamptz`; calendar dates (`validUntil`, `dueAt`) are `date`.
Prisma defaults to `timestamp without time zone`, which is wrong for scheduling: a naive
local time is ambiguous across a DST boundary, and the same appointment shifts by an hour.

**Invoice lines are a snapshot.** They carry `sourceQuoteLineId` as provenance and nothing
reads it to compute a total. An invoice is a legal document: what it said when it was issued
must not change because someone later corrected the quote.

**Child rows have no `tenantId`.** A quote line has no meaning apart from its quote, and is
reached through a parent that was scoped.

## Where the invariants live

| Invariant | Enforced by |
| --- | --- |
| No engineer double-booked | PostgreSQL exclusion constraint, plus a service check for the message |
| An end is after its start | PostgreSQL check constraint |
| Quote numbers do not repeat | Compound unique index plus a locked counter |
| A job only from an accepted quote | Service, on a status table |
| An invoice only from a completed job | Service |
| One invoice per job | Service, plus the `jobId` relation |
| Cross-tenant reads return nothing | Prisma query extension |
| Optimistic concurrency | `version` column, asserted inside the transaction |
| Lines sum to the document total | `computeTotals`, covered by property tests |

Each of those is enforced at the lowest level that can carry it. The two that matter most
under concurrency — double booking and document numbering — are in the database, because
application checks cannot be atomic with respect to each other.
