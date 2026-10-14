'use server';

import { draftQuoteRequestSchema } from '@tradeflow/shared';
import { problemFrom, type DraftState } from '@/lib/action-state';
import { requireClient } from '@/lib/session';
import { draftQuote } from '@/lib/resources';
import { text, validationProblem } from './shared';

/**
 * Turn a customer's own words into priced suggestions.
 *
 * Nothing here writes. The response is handed back to the builder, which lists
 * the suggestions with the reason each was made and adds only the ones the
 * operator ticks — the whole point of the feature is that the machine proposes
 * and a person decides, and a server action that quietly created lines would
 * take that decision away.
 *
 * The `unmatched` list travels back too, because "here are four lines" without
 * "and I could not price the radiator" is a quote that looks complete and is not.
 */
export async function draftQuoteAction(_prev: DraftState, formData: FormData): Promise<DraftState> {
  const parsed = draftQuoteRequestSchema.safeParse({
    customerId: text(formData, 'customerId'),
    brief: text(formData, 'brief'),
  });

  if (!parsed.success) {
    return { ok: false, problem: validationProblem(parsed.error) };
  }

  try {
    const client = await requireClient();
    return { ok: true, data: await draftQuote(client, parsed.data) };
  } catch (error) {
    return { ok: false, problem: problemFrom(error) };
  }
}
