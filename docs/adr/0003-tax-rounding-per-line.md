# ADR 0003 — Round tax per line, and store money as integer minor units

**Status:** accepted · **Date:** 2026-10

## Context

Money has to reconcile. A quote, the job raised from it, and the invoice raised from that
must show the same figures, and each document's lines must add up to its own printed total.
Two decisions determine whether that holds.

**Floats.** Binary floating point cannot represent 0.1 exactly, so a penny added ten times
does not reliably reach ten pence. In an invoicing product this surfaces as a total that
disagrees with the lines above it.

**Where to round tax.** Tax can be computed per line and summed, or computed on the net
total and rounded once. The two answers differ whenever lines carry different rates, which
is the normal case here: labour at the standard rate, some materials reduced, an export
zero-rated.

## Decision

Amounts are integers in the currency's minor unit. Rates are integers in basis points
(2000 = 20%), so 17.5% is exact. Tax is rounded **per line** and the rounded amounts summed,
with the rule stated once in `roundHalfAwayFromZero` and applied at exactly one place.

Rounding is half away from zero, not `Math.round`'s half towards `+Infinity`, which would
favour the business by a penny on every credit line.

## Consequences

**Good.** A reader can add the printed lines and reach the printed total, which is the only
property an invoice actually needs. `sum(allocate(x, weights)) === x` holds for every split,
so deposits and shared costs do not lose pennies.

**Costly.** The document total is accurate only to the sum of the per-line roundings — at
most half a minor unit per line. That is the correct trade: an invoice must reconcile against
what is printed on it, not against an unrounded figure nobody can see.

**Rejected.** A `Decimal` column with a library. It solves the float problem but not the
rounding-placement one, and it adds a type that has to be converted at every boundary
between the database, the API and the browser.
