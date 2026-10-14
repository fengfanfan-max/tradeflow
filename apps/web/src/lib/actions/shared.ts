/**
 * Helpers for reading `FormData` in a server action.
 *
 * A form field is a string or nothing at all, and the contract is stricter than
 * that. Coercing in one place keeps every action from re-deciding whether an
 * empty optional text input means `''` or `undefined` — it means `undefined`,
 * because "the operator left it blank" and "the operator typed nothing" are the
 * same intent and the shared schemas treat an empty string as a value.
 */

import { parseAmountToMinorUnits, type CurrencyCode, type Money, type Problem } from '@tradeflow/shared';

export function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function optionalText(formData: FormData, key: string): string | undefined {
  const value = text(formData, key);
  return value.length > 0 ? value : undefined;
}

export function numberField(formData: FormData, key: string, fallback: number): number {
  const value = text(formData, key);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function optionalNumber(formData: FormData, key: string): number | undefined {
  const value = text(formData, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function checked(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === 'on' || value === 'true' || value === '1';
}

/**
 * The API's own validation failure, translated into a `Problem`.
 *
 * Typed structurally rather than with `zod`'s `ZodError`, so the web app does not
 * have to declare a direct dependency on a library it only ever reads an error
 * shape from.
 */
export function validationProblem(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): Problem {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.') || '(form)';
    // One complaint per field: a form that lists three reasons the same input is
    // wrong is a form nobody reads.
    fields[path] ??= issue.message;
  }
  return {
    statusCode: 400,
    code: 'VALIDATION_FAILED',
    message: 'Some values need attention.',
    fields,
  };
}

export type MoneyFieldResult =
  | { ok: true; value: Money }
  | { ok: false; reason: string };

/**
 * A money field typed in major units, as the contract's minor-unit object.
 *
 * Uses the shared parser, which refuses more decimal places than the currency
 * has rather than rounding them away — a price the operator typed with three
 * decimals is a mistake to show them, not one to swallow. The failure is
 * returned rather than thrown so the message can sit on the input it came from.
 */
export function moneyField(
  formData: FormData,
  key: string,
  currency: CurrencyCode = 'GBP',
): MoneyFieldResult {
  const raw = text(formData, key);
  if (!raw) return { ok: false, reason: 'Enter an amount.' };
  try {
    return { ok: true, value: parseAmountToMinorUnits(raw, currency) };
  } catch {
    return { ok: false, reason: `"${raw}" is not an amount in ${currency}.` };
  }
}

/**
 * A percentage typed as "20" or "17.5", as basis points.
 *
 * Rejects a rate finer than 0.01%: the contract stores basis points as an
 * integer, so rounding here would silently change the tax the customer is
 * charged.
 */
export function taxRateField(
  formData: FormData,
  key: string,
  fallback = 2000,
): { ok: true; value: number } | { ok: false; reason: string } {
  const raw = text(formData, key);
  if (!raw) return { ok: true, value: fallback };
  const percent = Number(raw.replace(/%/g, ''));
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { ok: false, reason: 'Enter a rate between 0 and 100.' };
  }
  const bp = percent * 100;
  if (Math.abs(bp - Math.round(bp)) > 1e-9) {
    return { ok: false, reason: 'A rate can be at most two decimal places.' };
  }
  return { ok: true, value: Math.round(bp) };
}
