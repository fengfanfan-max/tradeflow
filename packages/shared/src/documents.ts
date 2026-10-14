/**
 * Quote, job and invoice totals.
 *
 * ## The rounding decision
 *
 * Tax is rounded **per line** and the rounded amounts are then summed. The
 * alternative — summing the net, then rounding the tax on the total — produces
 * a different answer whenever lines carry different rates, and it is the reason
 * two otherwise identical invoices can disagree by a penny.
 *
 * Per-line rounding is used here because:
 *   1. It is what the printed invoice shows. Each line displays its own net and
 *      tax, so a reader can add them up and reach the total on the page. A
 *      total-level calculation can print lines that visibly do not sum.
 *   2. Mixed rates are the norm in this domain — a trade business bills labour
 *      at the standard rate and some materials at a reduced one, or zero-rates
 *      an export. Per-line keeps each rate's own rounding independent.
 *
 * The cost is that the total is only accurate to the sum of the per-line
 * roundings, which is at most half a minor unit per line. That is the correct
 * trade: an invoice must reconcile against what is printed on it.
 */

import {
  type CurrencyCode,
  type Money,
  applyBasisPoints,
  add,
  money,
  multiplyByQuantity,
  sum,
  zero,
} from './money';

export interface DocumentLineInput {
  readonly description: string;
  /** Integer quantity. Fractional units are expressed as smaller units instead. */
  readonly quantity: number;
  /** Net unit price, excluding tax. */
  readonly unitPrice: Money;
  /** Tax rate in basis points. 2000 = 20%, 0 = zero-rated. */
  readonly taxRateBp: number;
}

export interface ComputedLine {
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly taxRateBp: number;
  /** quantity × unitPrice */
  readonly net: Money;
  readonly tax: Money;
  readonly gross: Money;
}

export interface DocumentTotals {
  readonly currency: CurrencyCode;
  readonly lines: readonly ComputedLine[];
  readonly net: Money;
  readonly tax: Money;
  readonly gross: Money;
  /**
   * Effective tax rate across the document, in basis points, rounded half away
   * from zero. Shown on the document for cross-checking; never used to compute
   * a payable amount, because rounding a blended rate is less accurate than
   * summing the rates that were actually applied.
   */
  readonly effectiveTaxRateBp: number;
}

export function computeLine(
  input: DocumentLineInput,
  currency: CurrencyCode,
): ComputedLine {
  const unitPrice = { ...input.unitPrice, currency };
  const net = multiplyByQuantity(unitPrice, input.quantity);
  const tax = applyBasisPoints(net, input.taxRateBp);
  return {
    description: input.description,
    quantity: input.quantity,
    unitPrice,
    taxRateBp: input.taxRateBp,
    net,
    tax,
    gross: add(net, tax),
  };
}

export function computeTotals(
  inputs: readonly DocumentLineInput[],
  currency: CurrencyCode,
): DocumentTotals {
  const lines = inputs.map((input) => computeLine(input, currency));

  const net = sum(
    lines.map((line) => line.net),
    currency,
  );
  const tax = sum(
    lines.map((line) => line.tax),
    currency,
  );

  return {
    currency,
    lines,
    net,
    tax,
    gross: add(net, tax),
    effectiveTaxRateBp:
      net.amount === 0
        ? 0
        : Math.round((tax.amount / net.amount) * 10_000),
  };
}

/** An empty document, for the "new quote" screen. */
export function emptyTotals(currency: CurrencyCode): DocumentTotals {
  return {
    currency,
    lines: [],
    net: zero(currency),
    tax: zero(currency),
    gross: zero(currency),
    effectiveTaxRateBp: 0,
  };
}

/**
 * What a deposit reduces the balance to.
 *
 * Exposed as a function because "percentage deposit" and "fixed deposit" both
 * exist in the domain and both have to agree with the invoice to the penny.
 */
export function balanceAfterDeposit(
  totals: DocumentTotals,
  deposit: Money,
): Money {
  if (deposit.amount > totals.gross.amount) {
    throw new Error('A deposit cannot exceed the document total.');
  }
  return money(totals.gross.amount - deposit.amount, totals.currency);
}
