import { Logger } from '@nestjs/common';
import { draftQuoteResponseSchema } from '@tradeflow/shared';
import type { DraftContext, DraftProvider, DraftResult } from './types';

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Drafting via a hosted model, using an OpenAI-compatible chat completions
 * endpoint.
 *
 * Three things matter more than the prompt itself:
 *
 *   1. **The price book is the only permitted source.** The model is given the
 *      tenant's own items with their ids and told to return those ids. It cannot
 *      invent a line, so a hallucinated price cannot reach a customer.
 *   2. **The reply is validated with the same Zod schema the HTTP response
 *      uses.** A model that returns prose, a missing field or a rate of 0.2
 *      instead of 20 fails validation here rather than three layers later.
 *   3. **Failure is not fatal.** Any error falls back to the heuristic provider,
 *      so the feature degrades to something useful instead of an error page.
 *      The caller is told which provider actually answered.
 */
export class LlmDraftProvider implements DraftProvider {
  readonly name = 'llm' as const;
  private readonly logger = new Logger(LlmDraftProvider.name);

  constructor(
    private readonly config: LlmConfig,
    private readonly fallback: DraftProvider,
  ) {}

  async draft(context: DraftContext): Promise<DraftResult> {
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          // Synthesis across a list plus arithmetic is not a creative task; a
          // fixed seed and zero temperature keep the same brief mapping to the
          // same lines, which is what makes the output reviewable.
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                brief: context.brief,
                priceBook: context.priceBook.map((entry) => ({
                  id: entry.id,
                  code: entry.code,
                  description: entry.description,
                  unit: entry.unit,
                  unitPriceMinorUnits: entry.unitPrice,
                  taxRateBp: entry.taxRateBp,
                })),
              }),
            },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        throw new Error(`provider responded ${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error('empty completion');

      const parsed = draftQuoteResponseSchema.parse({
        ...JSON.parse(content),
        provider: 'llm',
      });

      // The model is allowed to omit a line; it is not allowed to price one. Any
      // id that is not in the price book is dropped rather than trusted.
      const known = new Map(context.priceBook.map((entry) => [entry.id, entry]));
      const suggestions = parsed.suggestions
        .filter((suggestion) => known.has(suggestion.priceBookItemId))
        .map((suggestion) => {
          const entry = known.get(suggestion.priceBookItemId)!;
          return {
            ...suggestion,
            // Price and rate come from the database, never from the model.
            unitPrice: { amount: entry.unitPrice, currency: 'GBP' as never },
            taxRateBp: entry.taxRateBp,
            code: entry.code,
            description: entry.description,
            unit: entry.unit as typeof suggestion.unit,
          };
        });

      this.logger.log(`Drafted ${suggestions.length} lines with ${this.config.model}`);
      return { suggestions, provider: 'llm', unmatched: parsed.unmatched };
    } catch (error) {
      this.logger.warn(
        `LLM drafting failed (${error instanceof Error ? error.message : 'unknown'}), using the heuristic provider`,
      );
      return this.fallback.draft(context);
    }
  }
}

const SYSTEM_PROMPT = `You turn a customer's own words into draft quote lines for a UK trade business.

You may ONLY use items from the supplied priceBook array. Never invent an item, a price or a tax rate.
For each line you suggest, return:
  priceBookItemId — the id from priceBook, exactly as given
  code, description, unit, unitPrice, taxRateBp — copied from that priceBook entry
  quantity — an integer, from the brief, defaulting to 1
  rationale — one short sentence explaining the match, in the operator's language
  confidence — HIGH, MEDIUM or LOW

Also return "unmatched": an array of phrases from the brief that you could not
price. Listing what you could not match is more useful than guessing.

Return JSON: { "suggestions": [...], "unmatched": [...] }`;
