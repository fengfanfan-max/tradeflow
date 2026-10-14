'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  jobCreateSchema,
  quoteCreateSchema,
  quoteDecisionSchema,
  quoteUpdateSchema,
} from '@tradeflow/shared';
import { fail, failWith, problemFrom, succeed, type ActionState } from '@/lib/action-state';
import { requireClient } from '@/lib/session';
import { createJob, createQuote, decideQuote, listSites, sendQuote, updateQuote } from '@/lib/resources';
import { fromZonedInputValue } from '@/lib/format';
import type { SiteRef } from '@/lib/read-models';
import { optionalText, text, validationProblem } from './shared';

/**
 * Save a quote, create or update.
 *
 * The editor holds its lines in client state and posts them as one JSON field,
 * so the shape is validated against the same shared schema the API uses rather
 * than against a hand-rolled reader over twenty form inputs. `expectedVersion`
 * travels with an update: if the quote changed since the operator loaded it the
 * API refuses the write, and that refusal is the point.
 */
export async function saveQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = text(formData, 'payload');
  if (!raw) return failWith('VALIDATION_FAILED', 'Nothing to save.');

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return failWith('VALIDATION_FAILED', 'The quote could not be read back from the form.');
  }

  const quoteId = typeof payload.quoteId === 'string' ? payload.quoteId : undefined;

  // Two branches rather than one schema chosen by a ternary: an update carries
  // `expectedVersion` and a create does not, and the compiler is the cheapest
  // place to keep those apart.
  let id: string;
  try {
    const client = await requireClient();

    if (quoteId) {
      const parsed = quoteUpdateSchema.safeParse(payload);
      if (!parsed.success) return fail(validationProblem(parsed.error));
      await updateQuote(client, quoteId, parsed.data);
      id = quoteId;
    } else {
      const parsed = quoteCreateSchema.safeParse(payload);
      if (!parsed.success) return fail(validationProblem(parsed.error));
      const quote = await createQuote(client, parsed.data);
      id = quote.id;
    }
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/quotes');
  revalidatePath(`/quotes/${id}`);
  redirect(`/quotes/${id}`);
}

/**
 * Move a draft to SENT and rotate its public token.
 *
 * The token rotation is the reason this is not a plain field edit: the link the
 * customer previously held must stop working when the quote is re-issued, or an
 * old copy of the quote could still be accepted.
 */
export async function sendQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  try {
    const client = await requireClient();
    await sendQuote(client, id);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/quotes');
  revalidatePath(`/quotes/${id}`);
  redirect(`/quotes/${id}?sent=1`);
}

/** An accept or decline the office took over the phone. */
export async function decideQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  const parsed = quoteDecisionSchema.safeParse({
    decision: text(formData, 'decision'),
    ...(optionalText(formData, 'note') ? { note: text(formData, 'note') } : {}),
  });
  if (!parsed.success) return fail(validationProblem(parsed.error));

  try {
    const client = await requireClient();
    await decideQuote(client, id, parsed.data);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/');
  revalidatePath('/quotes');
  revalidatePath(`/quotes/${id}`);
  return succeed(`Quote marked ${parsed.data.decision.toLowerCase()}.`);
}

/**
 * Turn an accepted quote into a scheduled job.
 *
 * Separate from scheduling because the domain does: a job only exists once a
 * quote has been accepted, and `POST /jobs` refuses otherwise. The form asks for
 * a date and two times rather than two raw datetimes, because that is how the
 * office talks about a booking.
 */
export async function createJobFromQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const quoteId = text(formData, 'quoteId');
  const date = text(formData, 'date');
  const startTime = text(formData, 'startTime');
  const endTime = text(formData, 'endTime');
  const assigneeId = optionalText(formData, 'assigneeId');

  const scheduledStart = fromZonedInputValue(`${date}T${startTime}`);
  const scheduledEnd = fromZonedInputValue(`${date}T${endTime}`);

  if (!scheduledStart || !scheduledEnd) {
    return failWith('VALIDATION_FAILED', 'Enter a date and both times.', {
      scheduledStart: 'Required.',
      scheduledEnd: 'Required.',
    });
  }

  if (scheduledEnd.getTime() <= scheduledStart.getTime()) {
    return failWith('VALIDATION_FAILED', 'The finish time has to be after the start time.', {
      scheduledEnd: 'Must be after the start.',
    });
  }

  const parsed = jobCreateSchema.safeParse({
    quoteId,
    ...(assigneeId ? { assigneeId } : {}),
    scheduledStart: scheduledStart.toISOString(),
    scheduledEnd: scheduledEnd.toISOString(),
    ...(optionalText(formData, 'notes') ? { notes: text(formData, 'notes') } : {}),
  });
  if (!parsed.success) return fail(validationProblem(parsed.error));

  let jobId: string;
  try {
    const client = await requireClient();
    const job = await createJob(client, parsed.data);
    jobId = job.id;
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/');
  revalidatePath('/jobs');
  revalidatePath(`/quotes/${quoteId}`);
  redirect(`/jobs/${jobId}`);
}

/**
 * The sites for a customer, for the quote builder's picker.
 *
 * A server action rather than a page load because the create form can change
 * which customer is selected, and refetching a whole route to repopulate one
 * `<select>` would throw away the lines the operator has already entered.
 */
export async function loadSitesAction(customerId: string): Promise<SiteRef[]> {
  if (!customerId) return [];
  try {
    const client = await requireClient();
    return await listSites(client, customerId);
  } catch {
    // An unreachable API must not take the builder down with it: the operator
    // keeps their lines and sees "no sites", which is recoverable.
    return [];
  }
}
