# ADR 0005 — Scope every query to a tenant in the data layer

**Status:** accepted · **Date:** 2026-10

## Context

This is multi-tenant: one deployment serves several trade businesses, and one reading
another's customers is the failure that ends a contract. The straightforward approach is for
every service method to filter by `tenantId` taken from the authenticated principal.

That works until it does not. With forty call sites, one eventually omits the filter, and the
omission is invisible — the query succeeds and returns too much. Review does not reliably
catch it, because a missing `where` clause looks like nothing at all.

## Decision

Inject the filter. `PrismaService.forTenant(tenantId)` returns a client extended with a query
extension that adds `tenantId` to every `where` on a tenant-owned model and sets it on every
insert. Handlers receive that client and the unscoped one is not exposed to them.

Only tables that actually carry a `tenantId` column are in scope. Child rows — quote lines,
job status events, attachments, invoice lines — inherit their tenant through their parent, so
they are reached through a parent that was already scoped.

## Consequences

**Good.** Forgetting the filter is not possible for reads on the scoped models, because there
is no code path that omits it. Cross-tenant reads answer 404 rather than 403, so the API does
not confirm that an id exists in another business.

**Costly.** The extension is not visible at the call site, so a reader has to know it is
there — hence this record and the comment on the method. Nested writes are not rewritten:
`quote.create({ data: { lines: { create: [...] } } })` scopes the quote and not the lines.
That is safe because a line cannot exist without a parent that was scoped, but it is a rule
rather than a mechanism, and it is written down as one.

**Rejected.** PostgreSQL row-level security. It is the stronger answer — the filter would be
enforced even for raw SQL — but it needs a non-superuser role and a `SET LOCAL` per
transaction, which the adapter's connection pooling makes awkward to guarantee. It is the
natural next step, not the first one.
