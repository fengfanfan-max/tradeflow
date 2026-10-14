# ADR 0002 — Prisma 7 with a driver adapter, and an explicit client output

**Status:** accepted · **Date:** 2026-10

## Context

Prisma 7 removed `url` from the `datasource` block, moved connection details into
`prisma.config.ts`, and requires the client to be constructed with a driver adapter.

Separately, in a pnpm workspace the generated client lands in a content-addressed store
directory that `@prisma/client` reaches through a re-export of `.prisma/client/default`.
That path is keyed on the peer dependency graph, so adding an unrelated dev dependency
changes it — and every type that depends on the client silently becomes `unknown`. That
happened during this build: adding `@types/pg` moved the store path and broke the whole
API's types at once, with an error that pointed at `PrismaClient` rather than at the cause.

## Decision

Adopt Prisma 7's model rather than pinning Prisma 6, and give the generator an explicit
`output = "../src/generated/prisma"`. Every module imports the client through
`src/prisma/client.ts`, which is the only file that knows that path.

## Consequences

**Good.** The generated client lives in the source tree, so its location is a decision
rather than a consequence of the lockfile. Type failures are immediate and localised.
Owning the connection pool — which is what an adapter means — makes `max` and TLS settings
explicit in one place instead of implied by the connection string.

**Costly.** `@prisma/client-runtime-utils` becomes a direct dependency; strict pnpm
`node_modules` does not expose it as a transitive one, and the generated runtime requires
it. NestJS's build copies the generated JavaScript as an asset, because `tsc` ignores it —
a failure that appears only at runtime, not at build time.

**Rejected.** Pinning Prisma 6 to keep `url` in the schema. It defers the migration to a
worse moment and gives up the adapter, which is the direction the project is moving.
