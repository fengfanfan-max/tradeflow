/**
 * Money.
 *
 * Amounts are integers in the currency's minor unit (pence, cents) and are never
 * floats. Binary floating point cannot represent 0.1 exactly, so a penny added
 * to a penny ten times does not reliably equal ten pence; in an invoicing product
 * that error shows up as a total that disagrees with the sum of its lines, which
 * is the kind of bug that costs a client a week of reconciliation.
 *
 * Rates are basis points (integers): 2000 = 20%. Keeping the rate an integer
 * avoids the same problem on the tax side, where 17.5% is not representable.
 *
 * The rounding rule is stated once, in `roundHalfAwayFromZero`, and applied at
 * exactly one place per calculation: the line. Tax is computed per line and then
 * summed. That is deliberate — see `computeTotals`.
 */

export const CURRENCIES = ['GBP', 'USD', 'EUR'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

/** ISO 4217 minor-unit exponents for the currencies this product supports. */
const MINOR_UNIT_EXPONENT: Record<CurrencyCode, number> = {
  GBP: 2,
  USD: 2,
  EUR: 2,
};

export interface Money {
  /** Integer number of minor units. Never fractional. */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

function assertInteger(value: number, what: string): void {
  if (!Number.isInteger(value)) {
    throw new MoneyError(
      `${what} must be an integer number of minor units, received ${value}. ` +
        `Money is stored in minor units to avoid floating point drift.`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${what} exceeds the safe integer range: ${value}.`);
  }
}

/**
 * Round half away from zero.
 *
 * `Math.round` rounds half towards +Infinity, so `Math.round(-0.5)` is `-0` and
 * `Math.round(-1.5)` is `-1`. On a credit note that systematically favours the
 * business by a penny per line. This rounds in the direction a person would.
 */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Cannot round a non-finite value: ${value}.`);
  }
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function money(amount: number, currency: CurrencyCode): Money {
  assertInteger(amount, 'amount');
  return { amount, currency };
}

export function zero(currency: CurrencyCode): Money {
  return { amount: 0, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `Cannot combine ${a.currency} with ${b.currency}. Convert explicitly first.`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function sum(amounts: readonly Money[], currency: CurrencyCode): Money {
  let total = 0;
  for (const amount of amounts) {
    if (amount.currency !== currency) {
      throw new MoneyError(
        `Expected every amount to be ${currency}, found ${amount.currency}.`,
      );
    }
    total += amount.amount;
  }
  return money(total, currency);
}

export function negate(a: Money): Money {
  return money(-a.amount, a.currency);
}

export function isZero(a: Money): boolean {
  return a.amount === 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount === b.amount) return 0;
  return a.amount < b.amount ? -1 : 1;
}

/**
 * Multiply by a rational factor, rounding the product half away from zero.
 *
 * Used for quantities (integer) and for percentage adjustments. Both operands
 * stay exact until this single rounding step.
 */
export function multiplyBy(a: Money, factor: number): Money {
  if (!Number.isFinite(factor)) {
    throw new MoneyError(`Cannot multiply money by ${factor}.`);
  }
  return money(roundHalfAwayFromZero(a.amount * factor), a.currency);
}

export function multiplyByQuantity(a: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(
      `Quantity must be a non-negative integer, received ${quantity}.`,
    );
  }
  return money(a.amount * quantity, a.currency);
}

/**
 * A rate expressed in basis points (1 bp = 0.01%). 2000 bp = 20%.
 *
 * Integers only: a float rate such as 0.2 would reintroduce the drift the whole
 * module exists to avoid.
 */
export function bp(rate: number): number {
  assertInteger(rate, 'basis point rate');
  return rate;
}

export function applyBasisPoints(a: Money, rateInBp: number): Money {
  assertInteger(rateInBp, 'basis point rate');
  return multiplyBy(a, rateInBp / 10_000);
}

export function format(a: Money, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: a.currency,
    minimumFractionDigits: MINOR_UNIT_EXPONENT[a.currency],
    maximumFractionDigits: MINOR_UNIT_EXPONENT[a.currency],
  }).format(a.amount / 10 ** MINOR_UNIT_EXPONENT[a.currency]);
}

/**
 * Parse user input such as "1234.56" into minor units.
 *
 * Rejects anything with more precision than the currency supports rather than
 * silently rounding it, because silently discarding a third decimal place on a
 * quantity is how line totals stop matching what the customer was shown.
 */
export function parseAmountToMinorUnits(
  input: string,
  currency: CurrencyCode,
): Money {
  const trimmed = input.trim().replace(/[£$€,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new MoneyError(`Cannot parse "${input}" as an amount.`);
  }
  const exponent = MINOR_UNIT_EXPONENT[currency];
  const negative = trimmed.startsWith('-');
  const [whole = '0', fraction = ''] = trimmed.replace('-', '').split('.');
  if (fraction.length > exponent) {
    throw new MoneyError(
      `"${input}" has more than ${exponent} decimal places, which ${currency} cannot represent.`,
    );
  }
  const padded = fraction.padEnd(exponent, '0');
  const value = Number(`${whole}${padded}`);
  assertInteger(value, 'parsed amount');
  return money(negative ? -value : value, currency);
}

/**
 * Split an amount into parts that sum back to the original.
 *
 * Used for deposits and for dividing a shared cost. The remainder is distributed
 * a minor unit at a time so that `sum(allocate(x, w)) === x` always holds —
 * naive division loses pennies, which then have to be found during a VAT return.
 */
export function allocate(
  a: Money,
  weights: readonly number[],
): Money[] {
  if (weights.length === 0) {
    throw new MoneyError('Cannot allocate across zero buckets.');
  }
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new MoneyError('Allocation weights must be finite and non-negative.');
  }
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  if (totalWeight === 0) {
    throw new MoneyError('Allocation weights must not all be zero.');
  }

  const sign = a.amount < 0 ? -1 : 1;
  const magnitude = Math.abs(a.amount);

  const shares = weights.map((w) => Math.floor((magnitude * w) / totalWeight));
  let remainder = magnitude - shares.reduce((acc, s) => acc + s, 0);

  // Hand the leftover minor units to the largest fractional parts first, so the
  // distribution is the closest possible to the exact proportion.
  const order = weights
    .map((w, index) => ({
      index,
      fraction: (magnitude * w) / totalWeight - Math.floor((magnitude * w) / totalWeight),
    }))
    .sort((x, y) => y.fraction - x.fraction || x.index - y.index);

  for (const { index } of order) {
    if (remainder <= 0) break;
    // `noUncheckedIndexedAccess` is on, so the read is written explicitly rather
    // than asserted away. The value is always defined here — `shares` is built
    // from `weights` — but the assertion would hide a future regression where it
    // is not.
    shares[index] = (shares[index] ?? 0) + 1;
    remainder -= 1;
  }

  return shares.map((s) => money(sign * s, a.currency));
}
