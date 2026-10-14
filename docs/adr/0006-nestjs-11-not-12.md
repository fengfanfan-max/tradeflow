# ADR 0006 — NestJS 11, one major behind

**Status:** accepted · **Date:** 2026-10

## Context

NestJS 12 is the current release. The team also wants Zod schemas shared with the browser, so
that a validation rule cannot be enforced on one side and forgotten on the other.

`nestjs-zod`, which bridges Zod to Nest's validation pipe and to Swagger, declares its peer
support as `@nestjs/common: ^10 || ^11`. It does not support 12 yet.

## Decision

Use NestJS 11.2.x and `nestjs-zod` 5.5.x.

## Consequences

**Good.** One schema definition drives request validation, the inferred TypeScript types on
both sides, and the generated OpenAPI document. There is no `class-validator` decorator set
to keep in step with a Zod schema.

**Costly.** The framework is a major version behind, and the upgrade is blocked on an
unrelated package. This is recorded so the constraint is visible rather than looking like an
oversight, and so the upgrade has an obvious trigger: when `nestjs-zod` declares support for
12, move.

**Considered.** Dropping `nestjs-zod` for `class-validator`, which NestJS 12 supports. That
means maintaining two definitions of every field — the Zod schema the browser validates with
and the decorated DTO the server validates with — and the two drifting apart in exactly the
place a mismatch is expensive. Not worth a major version.
