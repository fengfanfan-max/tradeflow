import type { CurrencyCode, Money } from '@tradeflow/shared';
import { computeTotals, type DocumentLineInput } from '@tradeflow/shared';

/**
 * Row shape to wire shape.
 *
 * The database stores a price as a bare integer and the currency on the parent
 * document. The wire contract carries `{ amount, currency }` so that an amount
 * cannot be rendered without knowing what it is denominated in. These helpers
 * do that join in one place rather than at each call site.
 */
export function asMoney(amount: number, currency: string): Money {
  return { amount, currency: currency as CurrencyCode };
}

export function asCurrency(value: string): CurrencyCode {
  return value as CurrencyCode;
}

export interface LineRow {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRateBp: number;
}

export function lineInputs(rows: LineRow[], currency: string): DocumentLineInput[] {
  return rows.map((row) => ({
    description: row.description,
    quantity: row.quantity,
    unitPrice: asMoney(row.unitPrice, currency),
    taxRateBp: row.taxRateBp,
  }));
}

/**
 * Totals for a document, computed with the same function the client uses.
 *
 * The rule — tax rounded per line, then summed — lives in `documents.ts` and is
 * never reimplemented here. If the API and the browser disagreed by a penny the
 * invoice would not match the page the customer accepted.
 */
export function documentTotals(rows: LineRow[], currency: string) {
  return computeTotals(lineInputs(rows, currency), asCurrency(currency));
}

/** Amount due after a deposit, floored at zero. */
export function amountDue(gross: number, deposit: number): number {
  return Math.max(0, gross - deposit);
}
