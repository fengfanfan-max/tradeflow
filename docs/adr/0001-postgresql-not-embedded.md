# ADR 0001 — Run a real PostgreSQL, not an embedded one

**Status:** accepted · **Date:** 2026-10

## Context

The demo has to run on a reviewer's machine in one command. That pushes towards an
embedded database — SQLite, or PostgreSQL compiled to WebAssembly — because it needs no
install step. It was used for a previous project in this portfolio and worked well there.

The behaviour this product depends on is different, though. What matters here is:

- an **exclusion constraint** that refuses two overlapping bookings for one engineer
- **transactions** that roll back a document, its lines and its audit event together
- a **compound unique index** behind per-tenant document numbering
- `timestamptz` semantics, which a naive-timestamp store quietly gets wrong across DST

None of those exist in SQLite, and the WebAssembly build supports extensions only
partially. A database that cannot express the invariant cannot test it either.

## Decision

Run a real PostgreSQL 17 locally, created by `scripts/db-local.sh` on a non-default port
inside the repository, and the same image in CI.

## Consequences

**Good.** The invariants are enforced where they can actually be enforced. `pg_dump`,
`psql` and every PostgreSQL tool work. Local, CI and production are the same engine, so a
migration that passes locally is not a different proposition in production. The e2e suite
can assert that an overlapping insert is rejected *by the database*, not merely by the
service layer that happens to check first.

**Costly.** A contributor needs PostgreSQL 17 installed. `scripts/db-local.sh` reduces that
to one `brew install` and one command, and the script refuses to touch any system cluster.
CI gains a service container.

**Rejected.** SQLite with the constraint enforced only in application code. That is the
configuration where a race between two office users produces a double booking, and the
failure is invisible until two engineers arrive at the same address.
