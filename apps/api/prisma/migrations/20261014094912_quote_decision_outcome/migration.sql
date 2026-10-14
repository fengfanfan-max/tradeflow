-- A dedicated enum for what a customer decided, instead of reusing QuoteStatus.
--
-- Reusing QuoteStatus let DRAFT, SENT and EXPIRED be stored as "decisions" —
-- states describing what the business did with a quote, not what the customer
-- said about it. Only the request DTO stood between those values and the
-- database. This removes the possibility.
--
-- Written by hand because Prisma refuses to generate it, and it is right to:
-- changing an enum column's type has no implicit cast, so the default plan drops
-- and recreates the column, discarding every recorded decision. The USING clause
-- casts the existing values explicitly. They are already ACCEPTED or DECLINED,
-- so the cast is total.

CREATE TYPE "QuoteDecisionOutcome" AS ENUM ('ACCEPTED', 'DECLINED');

ALTER TABLE "quote_decisions"
  ALTER COLUMN "decision" TYPE "QuoteDecisionOutcome"
  USING ("decision"::text::"QuoteDecisionOutcome");

-- QuoteStatus is deliberately not dropped: `quotes.status` still uses it, and it
-- describes a different thing.
