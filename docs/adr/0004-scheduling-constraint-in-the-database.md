# ADR 0004 — Enforce scheduling overlap in the database

**Status:** accepted · **Date:** 2026-10

## Context

An engineer must not be booked in two places at once. The service checks for a clash before
inserting, which produces a useful error naming the job that conflicts.

That check is not sufficient. Two office users booking the same engineer at the same moment
both read no clash, both insert, and the invariant is broken. The application check is a
courtesy; it cannot be a guarantee under concurrency.

## Decision

Add a PostgreSQL exclusion constraint in a migration of raw SQL:

```sql
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_no_overlapping_assignments"
  EXCLUDE USING gist (
    "assigneeId" WITH =,
    tstzrange("scheduledStart", "scheduledEnd", '[)') WITH &&
  )
  WHERE ("assigneeId" IS NOT NULL AND status <> 'CANCELLED');
```

plus a check constraint that an end is after its start. The service check stays, because a
good error message and a constraint are answers to different questions.

`'[)'` is deliberate: a job ending at 12:00 and the next starting at 12:00 do not overlap,
which is how back-to-back appointments work. `btree_gist` is required so one index can mix
equality with a range operator.

## Consequences

**Good.** The invariant holds under concurrency, and the e2e suite asserts it by inserting an
overlap directly in SQL — through the application, a passing test could mean only that the
service check ran.

**Costly.** Prisma does not model exclusion constraints, so it is raw SQL that a future
`migrate dev` will not regenerate. Verified that Prisma does not read it as schema drift
(`migrate diff` reports "No difference detected"), so it will not be silently dropped.

**Rejected.** A serialisable transaction around the booking. It works, at the cost of
retry logic on every scheduling write and a lock on a much wider range than necessary.
