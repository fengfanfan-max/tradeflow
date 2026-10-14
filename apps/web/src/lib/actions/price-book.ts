'use server';

import { revalidatePath } from 'next/cache';
import { priceBookItemCreateSchema, priceBookItemUpdateSchema, type Money } from '@tradeflow/shared';
import { fail, problemFrom, succeed, type ActionState } from '@/lib/action-state';
import { requireClient } from '@/lib/session';
import { createPriceBookItem, updatePriceBookItem } from '@/lib/resources';
import { checked, moneyField, optionalText, taxRateField, text, validationProblem } from './shared';

interface PriceFields {
  /** Per-field messages, empty when both parsed cleanly. */
  fields: Record<string, string>;
  unitPrice?: Money;
  taxRateBp?: number;
}

/**
 * Read the price fields off the form.
 *
 * Money is parsed with the shared parser rather than `Number()`, so "12.345"
 * is refused on the input it was typed into instead of being rounded into a
 * price the business never agreed.
 */
function priceFields(formData: FormData): PriceFields {
  const fields: Record<string, string> = {};
  const price = moneyField(formData, 'unitPrice', 'GBP');
  if (!price.ok) fields.unitPrice = price.reason;

  const tax = taxRateField(formData, 'taxRate', 2000);
  if (!tax.ok) fields.taxRateBp = tax.reason;

  return {
    fields,
    ...(price.ok ? { unitPrice: price.value } : {}),
    ...(tax.ok ? { taxRateBp: tax.value } : {}),
  };
}

export async function createPriceBookItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const price = priceFields(formData);

  const parsed = priceBookItemCreateSchema.safeParse({
    code: text(formData, 'code'),
    description: text(formData, 'description'),
    unit: text(formData, 'unit') || 'EACH',
    ...(price.unitPrice ? { unitPrice: price.unitPrice } : {}),
    ...(price.taxRateBp !== undefined ? { taxRateBp: price.taxRateBp } : {}),
  });

  // Local money errors are merged in ahead of the schema's, because "12.345 is
  // not an amount" says more than "expected object, received undefined".
  if (!parsed.success) {
    const problem = validationProblem(parsed.error);
    return fail({ ...problem, fields: { ...problem.fields, ...price.fields } });
  }
  if (Object.keys(price.fields).length > 0) {
    return fail({ statusCode: 400, code: 'VALIDATION_FAILED', message: 'Some values need attention.', fields: price.fields });
  }

  try {
    const client = await requireClient();
    await createPriceBookItem(client, parsed.data);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/price-book');
  return succeed('Price book item added.');
}

export async function updatePriceBookItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  const price = priceFields(formData);

  if (Object.keys(price.fields).length > 0) {
    return fail({ statusCode: 400, code: 'VALIDATION_FAILED', message: 'Some values need attention.', fields: price.fields });
  }

  const parsed = priceBookItemUpdateSchema.safeParse({
    code: text(formData, 'code'),
    description: text(formData, 'description'),
    ...(optionalText(formData, 'unit') ? { unit: text(formData, 'unit') } : {}),
    ...(price.unitPrice ? { unitPrice: price.unitPrice } : {}),
    ...(price.taxRateBp !== undefined ? { taxRateBp: price.taxRateBp } : {}),
    active: checked(formData, 'active'),
  });
  if (!parsed.success) return fail(validationProblem(parsed.error));

  try {
    const client = await requireClient();
    await updatePriceBookItem(client, id, parsed.data);
  } catch (error) {
    return fail(problemFrom(error));
  }

  revalidatePath('/price-book');
  return succeed('Price book item saved.');
}
