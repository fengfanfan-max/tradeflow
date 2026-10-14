# Tradeflow

Job management for trade businesses — customers, quotes, jobs, scheduling and invoicing.

A vertical slice rather than a set of screens: one job travels from a customer's first
phone call to a paid invoice, and every step in between is real. Nothing is mocked, and
the interesting decisions are written down in [`docs/adr/`](docs/adr/).

**Stack:** Next.js · NestJS · PostgreSQL · TypeScript · AWS

---

## Run it

Needs Node 22+ and PostgreSQL 17. Three commands.

```bash
brew install postgresql@17        # or: apt-get install postgresql-17
./scripts/db-local.sh start       # a cluster inside the repo, on port 55432
pnpm install
cp .env.example .env

pnpm --filter @tradeflow/api db:migrate   # apply the schema
pnpm --filter @tradeflow/api db:seed      # ~14 customers, 22 quotes, 16 jobs
pnpm dev:api                              # http://localhost:3001
pnpm dev:web                              # http://localhost:3000
```

Sign in as `daniel.halstead@halsteadelectrical.co.uk` / `demo-password-2026`.

`scripts/db-local.sh` never touches a system PostgreSQL or launchd: it creates its own
cluster under `.pgdata/` and listens on a non-default port. `./scripts/db-local.sh reset`
removes it.

### What to click

The demo follows one document through the whole business.

1. **Customers** → open *Oakleigh Lettings*, which has several sites. That is why a site is
   its own entity rather than a second address on the customer.
2. **Price book** → 55 items a domestic electrical and heating firm actually bills for,
   at the standard, reduced and zero VAT rates.
3. **Quotes → New** → add lines. The totals update as you type, and the lines always add up
   to the total — see [ADR 0003](docs/adr/0003-tax-rounding-per-line.md).
4. **Draft from brief** → paste a customer's message. Ten priced lines come back with the
   reasoning for each, and a list of what could not be priced.
5. **Send** → the quote gets a public link. Open `/q/<token>` in a private window: no
   account, no app chrome, and nothing in the payload that could be used to address the API.
6. **Accept**, then **raise a job** from it.
7. **Schedule** it → assign an engineer. Booking someone over an existing job is refused,
   and so is booking them back-to-back at exactly the boundary — because that is not a
   clash. See [ADR 0004](docs/adr/0004-scheduling-constraint-in-the-database.md).
8. **Complete** it with a summary. The summary is required, because it becomes the invoice.
9. **Raise an invoice** → the lines are snapshotted, not referenced. Download the PDF, then
   mark it paid.

Somewhere in the middle, try saving the same quote twice from two tabs. The second save is
refused rather than silently overwriting the first.

---

## Layout

```
apps/api        NestJS. Modules per bounded context, Prisma 7, driver adapter, PostgreSQL.
apps/web        Next.js App Router. Server components, server actions, two client components.
packages/shared Zod contracts and the money module — imported by both sides.
docs/adr        The decisions, with the alternatives that were rejected.
docs/api-routes.md  Every endpoint, and the domain rules attached to it.
```

`packages/shared/src/contracts.ts` is the single definition of every request and response
shape. The API validates with it, the browser forms validate with it, and the TypeScript
types on each side are inferred from it, so a field cannot be added to one and forgotten in
the other.

---

## The parts worth reading

**`packages/shared/src/money.ts`** — amounts are integer minor units and rates are integer
basis points. Floating point cannot represent £0.10 exactly, and in an invoicing product that
error is a total that disagrees with the lines printed above it.

**`packages/shared/src/documents.ts`** — tax is rounded per line and the rounded amounts
summed, in one place. A reader can add the printed lines and reach the printed total, which
is the only property an invoice actually needs. [ADR 0003](docs/adr/0003-tax-rounding-per-line.md)

**`apps/api/src/prisma/tenant-scope.ts`** — tenant isolation is a Prisma query extension, so
a query cannot forget the filter. Cross-tenant reads answer 404 rather than 403, because 403
would confirm the id exists. [ADR 0005](docs/adr/0005-tenant-scoping-in-the-data-layer.md)

**`apps/api/prisma/migrations/*_scheduling_constraints/`** — the exclusion constraint that
makes a double booking impossible, added in raw SQL because the application check cannot
survive two users saving at once. [ADR 0004](docs/adr/0004-scheduling-constraint-in-the-database.md)

**`apps/api/src/ai/`** — quote drafting is a provider with two implementations. The default
matches against the price book locally and needs no API key, so CI and the offline demo work;
the other calls a hosted model and falls back to the first on any failure. Either way the
model may choose *which* price book item to use but never a price, and anything it could not
price is reported rather than guessed at.

---

## Tests

```bash
pnpm --filter @tradeflow/shared test      # money and document arithmetic
pnpm --filter @tradeflow/api test:e2e     # the whole flow, against real PostgreSQL
pnpm -r typecheck
```

The end-to-end suite resets and seeds a disposable database (`TEST_DATABASE_URL`), then
drives the application over HTTP. It asserts the things the compiler cannot:

- the printed lines sum to the printed total, on every document
- a stale write is refused, not silently applied
- a second overlapping booking for one engineer is refused, and back-to-back is allowed
- an unaccepted quote cannot become a job; an incomplete job cannot become an invoice
- an invoice cannot be paid before it is issued, and cannot be voided after it is
- a cross-tenant read answers 404
- a malformed request answers with field-level detail in the documented `Problem` shape

The scheduling constraint is separately asserted by inserting an overlap **directly in SQL**.
Through the application, a passing test could mean only that the service-layer check ran.

---

## What the first CI run caught

Five failures, none of which reproduced locally. A clean machine is a different
machine, and this is the argument for running CI on the first push rather than
after the work looks finished:

1. **`pnpm/action-setup` refused to start.** `packageManager` in package.json
   and `version` in the workflow are two pins for one thing; the action fails on
   the conflict before any other step runs.
2. **`typecheck` could not resolve `@tradeflow/shared`.** A clean checkout has no
   `packages/shared/dist`, and every type import resolves through it. Locally it
   was already built, so it had never failed.
3. **The fix for that did not apply.** CI ran `pnpm -r typecheck`, which invokes
   each package's script directly and skips the root one that does the build.
4. **A redundant seed step ran against an unmigrated database.** The e2e suite
   seeds its own database in `globalSetup`; the extra step seeded a database with
   no tables.
5. **The smoke test could not sign in.** The database it runs against had
   migrations but no data.

The fifth is the one worth keeping: the smoke test exists because a build that
compiles is not a build that boots, and it found a real gap in the pipeline
rather than a problem in the application.

## Honest status

| Area | State | Note |
| --- | --- | --- |
| The demo flow | Working, end to end | Verified against a real database, not a mock |
| CI | Green | 22 steps, including an end-to-end run and a boot of the built artefact |
| AWS deployment | Written, not run | `infra/deploy.sh` had no credentials to test against; see [infra/README.md](infra/README.md) |
| Payments | Not implemented | Invoices move to PAID by hand; there is no Stripe integration |
| Permissions | Three roles, coarse | OWNER / OFFICE / ENGINEER gate the routes; there is no per-record ACL |
| Attachments | Records only | `JobAttachment` stores a storage key; nothing uploads bytes yet |
| Email | Not implemented | The public accept link is generated and shown, not sent |
| Row-level security | Not used | Tenancy is enforced in the data layer, not by PostgreSQL RLS — see ADR 0005 |
| Reporting | Not implemented | No cross-job profit or utilisation reporting yet |
| Realtime | Not implemented | Two people editing the same quote get a conflict, not a live update |

Where a decision above has a cost, the cost is in the matching ADR rather than only here.

---

## Deploying

The API is a stateless container; the database is managed PostgreSQL.

```bash
docker build -f apps/api/Dockerfile -t tradeflow-api .
docker run -p 3001:3001 -e DATABASE_URL='postgresql://...' -e JWT_SECRET="$(openssl rand -base64 48)" tradeflow-api
```

On AWS: RDS for PostgreSQL in a private subnet, the API image on App Runner or ECS Fargate,
and the web app on Amplify or behind CloudFront. Set `JWT_SECRET` to a value of at least 32
characters — the process refuses to start in production with the example value, which is
deliberate rather than an inconvenience.

Nothing in the application assumes a single instance: there is no in-process session state,
and the scheduling guarantee is a database constraint rather than a lock held in memory.
