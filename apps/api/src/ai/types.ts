import type { DraftQuoteSuggestion } from '@tradeflow/shared';

export interface PriceBookEntry {
  id: string;
  code: string;
  description: string;
  unit: string;
  unitPrice: number;
  taxRateBp: number;
}

export interface DraftContext {
  brief: string;
  priceBook: PriceBookEntry[];
}

export interface DraftResult {
  suggestions: DraftQuoteSuggestion[];
  provider: 'heuristic' | 'llm';
  unmatched: string[];
}

/**
 * A drafting provider turns a customer's words into priced lines.
 *
 * One implementation matches against the price book locally and needs no key;
 * another calls a hosted model. They are interchangeable because the provider is
 * a seam, not because the heuristic is a fallback for a missing key — the
 * heuristic is what CI and the offline demo run on, so it has to be genuinely
 * useful rather than a stub.
 */
export interface DraftProvider {
  readonly name: 'heuristic' | 'llm';
  draft(context: DraftContext): Promise<DraftResult>;
}
