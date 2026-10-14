/**
 * The quote draft the builder edits.
 *
 * Shared between the client component that owns the form state and the server
 * action that turns it into a `QuoteCreate`/`QuoteUpdate`, so the two cannot
 * drift. Kept free of server imports for the same reason.
 */

import { computeTotals, type CurrencyCode, type DocumentTotals, type Money } from '@tradeflow/shared';

export interface QuoteDraftLine {
  /** Provenance only — the price book row the line was copied from. */
  priceBookItemId?: string;
  description: string;
  quantity: number;
  /** Minor units. The builder edits this through a major-unit text field. */
  unitPrice: Money;
  taxRateBp: number;
}

export interface QuoteDraft {
  customerId: string;
  siteId: string;
  currency: CurrencyCode;
  validForDays: number;
  notes: string;
  lines: QuoteDraftLine[];
}

export function emptyDraft(currency: CurrencyCode = 'GBP', validForDays = 30): QuoteDraft {
  return { customerId: '', siteId: '', currency, validForDays, notes: '', lines: [] };
}

/**
 * The draft's totals, computed with the same function the API calls.
 *
 * The live figure in the builder and the figure the server stores are therefore
 * the same arithmetic, not two implementations that agree today.
 */
export function draftTotals(draft: QuoteDraft): DocumentTotals {
  return computeTotals(
    draft.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRateBp: line.taxRateBp,
    })),
    draft.currency,
  );
}

/** A brief has to be long enough for the API's `min(10)` to be worth sending. */
export const MIN_BRIEF_LENGTH = 10;
