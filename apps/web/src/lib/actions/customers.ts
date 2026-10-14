'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { customerCreateSchema, customerUpdateSchema, siteCreateSchema } from '@tradeflow/shared';
import { fail, problemFrom, succeed, type ActionState } from '@/lib/action-state';
import { requireClient } from '@/lib/session';
import { archiveCustomer, createCustomer, createSite, updateCustomer } from '@/lib/resources';
import { optionalText, text, validationProblem } from './shared';

/** The billing address is a flattened block on the customer, so it posts flat. */
function addressFrom(formData: FormData) {
  const line1 = text(formData, 'billingLine1');
  if (!line1) return undefined;
  return {
    line1,
    ...(optionalText(formData, 'billingLine2') ? { line2: text(formData, 'billingLine2') } : {}),
    city: text(formData, 'billingCity'),
    postcode: text(formData, 'billingPostcode'),
    country: (text(formData, 'billingCountry') || 'GB').toUpperCase().slice(0, 2),
  };
}

export async function createCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const candidate = {
    name: text(formData, 'name'),
    ...(optionalText(formData, 'email') ? { email: text(formData, 'email') } : {}),
    ...(optionalText(formData, 'phone') ? { phone: text(formData, 'phone') } : {}),
    ...(optionalText(formData, 'notes') ? { notes: text(formData, 'notes') } : {}),
    ...(addressFrom(formData) ? { billingAddress: addressFrom(formData) } : {}),
  };

  const parsed = customerCreateSchema.safeParse(candidate);
  if (!parsed.success) return fail(validationProblem(parsed.error));

  let id: string;
  try {
    const client = await requireClient();
    const customer = await createCustomer(client, parsed.data);
    id = customer.id;
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/customers');
  redirect(`/customers/${id}`);
}

export async function updateCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  const candidate = {
    name: text(formData, 'name'),
    email: optionalText(formData, 'email'),
    phone: optionalText(formData, 'phone'),
    notes: optionalText(formData, 'notes'),
    ...(addressFrom(formData) ? { billingAddress: addressFrom(formData) } : {}),
  };

  const parsed = customerUpdateSchema.safeParse(candidate);
  if (!parsed.success) return fail(validationProblem(parsed.error));

  try {
    const client = await requireClient();
    await updateCustomer(client, id, parsed.data);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath(`/customers/${id}`);
  revalidatePath('/customers');
  return succeed('Customer saved.');
}

export async function archiveCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  try {
    const client = await requireClient();
    await archiveCustomer(client, id);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/customers');
  redirect('/customers');
}

export async function createSiteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const customerId = text(formData, 'customerId');
  const candidate = {
    customerId,
    label: text(formData, 'label'),
    address: {
      line1: text(formData, 'line1'),
      ...(optionalText(formData, 'line2') ? { line2: text(formData, 'line2') } : {}),
      city: text(formData, 'city'),
      postcode: text(formData, 'postcode'),
      country: (text(formData, 'country') || 'GB').toUpperCase().slice(0, 2),
    },
    ...(optionalText(formData, 'accessNotes') ? { accessNotes: text(formData, 'accessNotes') } : {}),
  };

  const parsed = siteCreateSchema.safeParse(candidate);
  if (!parsed.success) return fail(validationProblem(parsed.error));

  try {
    const client = await requireClient();
    await createSite(client, parsed.data);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath(`/customers/${customerId}`);
  return succeed('Site added.');
}
