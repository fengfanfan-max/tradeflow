'use server';

import { revalidatePath } from 'next/cache';
import { jobScheduleSchema, jobStatusChangeSchema } from '@tradeflow/shared';
import { fail, failWith, problemFrom, succeed, type ActionState } from '@/lib/action-state';
import { requireClient } from '@/lib/session';
import { changeJobStatus, scheduleJob } from '@/lib/resources';
import { fromZonedInputValue } from '@/lib/format';
import { optionalText, text, validationProblem } from './shared';

/**
 * Reschedule a job.
 *
 * Carries `expectedVersion` for the same reason a quote edit does, and the
 * failure here is a `SCHEDULE_CONFLICT` rather than a `STALE_WRITE` when the
 * engineer was booked for an overlapping slot in the meantime — the message
 * names the clashing job, which is more useful than "try again".
 */
export async function scheduleJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
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

  const parsed = jobScheduleSchema.safeParse({
    assigneeId: assigneeId ?? null,
    scheduledStart: scheduledStart.toISOString(),
    scheduledEnd: scheduledEnd.toISOString(),
    expectedVersion: Number(text(formData, 'expectedVersion')) || 1,
  });
  if (!parsed.success) return fail(validationProblem(parsed.error));

  try {
    const client = await requireClient();
    await scheduleJob(client, id, parsed.data);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/');
  revalidatePath('/jobs');
  revalidatePath(`/jobs/${id}`);
  return succeed('Schedule updated.');
}

/**
 * Append a status change.
 *
 * `completionSummary` is required to move to COMPLETED — the API's contract
 * makes the field optional and the domain makes it mandatory, because it becomes
 * the invoice narrative. Catching it here means the operator gets told on the
 * form rather than by a 409 after the fact.
 */
export async function changeJobStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  const status = text(formData, 'status');
  const note = optionalText(formData, 'note');
  const completionSummary = optionalText(formData, 'completionSummary');

  if (status === 'COMPLETED' && !completionSummary) {
    return failWith('VALIDATION_FAILED', 'A completed job needs a summary — it becomes the invoice narrative.', {
      completionSummary: 'Describe what was done.',
    });
  }

  const parsed = jobStatusChangeSchema.safeParse({
    status,
    ...(note ? { note } : {}),
    ...(completionSummary ? { completionSummary } : {}),
  });
  if (!parsed.success) return fail(validationProblem(parsed.error));

  try {
    const client = await requireClient();
    await changeJobStatus(client, id, parsed.data);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/');
  revalidatePath('/jobs');
  revalidatePath(`/jobs/${id}`);
  return succeed(`Job marked ${status.toLowerCase().replace('_', ' ')}.`);
}
