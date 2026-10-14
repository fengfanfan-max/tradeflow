'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { quoteDecisionSchema } from '@tradeflow/shared';
import { fail, problemFrom, type ActionState } from '@/lib/action-state';
import { decidePublicQuote } from '@/lib/resources';
import { optionalText, text, validationProblem } from './shared';

/**
 * The customer's decision, from the no-login page.
 *
 * Deliberately unauthenticated and deliberately narrow: the token identifies one
 * quote, and the only thing this can do is record accept or decline against it.
 * There is no session to establish and nothing to read back, so the page after
 * the redirect is a receipt rather than the quote again — re-rendering the quote
 * after a decision invites a second click that the API would rightly refuse.
 */
export async function publicQuoteDecisionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = text(formData, 'token');
  if (!token) return fail({ statusCode: 400, code: 'VALIDATION_FAILED', message: 'That link is incomplete.' });

  const parsed = quoteDecisionSchema.safeParse({
    decision: text(formData, 'decision'),
    ...(optionalText(formData, 'note') ? { note: text(formData, 'note') } : {}),
  });
  if (!parsed.success) return fail(validationProblem(parsed.error));

  try {
    await decidePublicQuote(token, parsed.data);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/quotes');
  redirect(`/q/${encodeURIComponent(token)}?decision=${parsed.data.decision}`);
}
