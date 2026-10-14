'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { invoiceCreateSchema, invoiceMarkPaidSchema } from '@tradeflow/shared';
import { fail, problemFrom, succeed, type ActionState } from '@/lib/action-state';
import { requireClient } from '@/lib/session';
import { createInvoice, markInvoicePaid, sendInvoice, voidInvoice } from '@/lib/resources';
import { moneyField, optionalText, text, validationProblem } from './shared';

/**
 * Raise an invoice from a completed job.
 *
 * The lines are snapshotted by the API, not recomputed here: an invoice is a
 * legal document whose figures must not move when the quote behind it is later
 * corrected, which is why the form only chooses *what to bill*, never *how much*.
 */
export async function createInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const jobId = text(formData, 'jobId');
  const depositRaw = text(formData, 'depositAmount');

  let deposit: { amount: number; currency: 'GBP' | 'USD' | 'EUR' } | undefined;
  if (depositRaw) {
    const parsedDeposit = moneyField(formData, 'depositAmount', 'GBP');
    if (!parsedDeposit.ok) {
      return fail({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: parsedDeposit.reason,
        fields: { depositAmount: parsedDeposit.reason },
      });
    }
    deposit = parsedDeposit.value;
  }

  const parsed = invoiceCreateSchema.safeParse({
    jobId,
    dueInDays: Number(text(formData, 'dueInDays')) || 14,
    ...(deposit ? { depositAmount: deposit } : {}),
  });
  if (!parsed.success) return fail(validationProblem(parsed.error));

  let id: string;
  try {
    const client = await requireClient();
    const invoice = await createInvoice(client, parsed.data);
    id = invoice.id;
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/invoices');
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/invoices/${id}`);
}

export async function sendInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  try {
    const client = await requireClient();
    await sendInvoice(client, id);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/invoices');
  revalidatePath(`/invoices/${id}`);
  return succeed('Invoice marked as sent.');
}

/**
 * Record payment.
 *
 * `paidAt` is optional on the contract; leaving it out lets the API stamp the
 * moment it was recorded, which is what the office means by "it came in today".
 */
export async function markInvoicePaidAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  const parsed = invoiceMarkPaidSchema.safeParse({
    ...(optionalText(formData, 'reference') ? { reference: text(formData, 'reference') } : {}),
  });
  if (!parsed.success) return fail(validationProblem(parsed.error));

  try {
    const client = await requireClient();
    await markInvoicePaid(client, id, parsed.data);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/');
  revalidatePath('/invoices');
  revalidatePath(`/invoices/${id}`);
  return succeed('Payment recorded.');
}

export async function voidInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  try {
    const client = await requireClient();
    await voidInvoice(client, id);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/');
  revalidatePath('/invoices');
  revalidatePath(`/invoices/${id}`);
  return succeed('Invoice voided.');
}
