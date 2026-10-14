import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  add,
  allocate,
  applyBasisPoints,
  compare,
  equals,
  format,
  money,
  multiplyBy,
  multiplyByQuantity,
  negate,
  parseAmountToMinorUnits,
  roundHalfAwayFromZero,
  subtract,
  sum,
  zero,
} from './money';

describe('the reason this module exists', () => {
  it('accumulates a float total that disagrees with its parts', () => {
    // The motivating bug. Ten lots of £0.10 must be exactly £1.00. Adding the
    // same value as a float does not get there, which in an invoice means the
    // total does not reconcile against the lines printed above it.
    let floatTotal = 0;
    for (let i = 0; i < 10; i += 1) floatTotal += 0.1;
    expect(floatTotal).not.toBe(1);

    const lines = Array.from({ length: 10 }, () => money(10, 'GBP'));
    expect(sum(lines, 'GBP')).toEqual(money(100, 'GBP'));
  });

  it('rejects a fractional amount at the boundary', () => {
    expect(() => money(12.5, 'GBP')).toThrow(MoneyError);
  });

  it('rejects an amount beyond the safe integer range', () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 2, 'GBP')).toThrow(MoneyError);
  });
});

describe('roundHalfAwayFromZero', () => {
  it('rounds a half away from zero in both directions', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(3.5)).toBe(4);
    // Math.round would give -0 and -1 here, quietly favouring the business by a
    // penny on every credit line.
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(-3.5)).toBe(-4);
  });

  it('leaves non-half values alone', () => {
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(roundHalfAwayFromZero(2.6)).toBe(3);
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
    expect(roundHalfAwayFromZero(0)).toBe(0);
  });

  it('refuses non-finite input instead of producing NaN money', () => {
    expect(() => roundHalfAwayFromZero(Number.NaN)).toThrow(MoneyError);
    expect(() => roundHalfAwayFromZero(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts within a currency', () => {
    expect(add(money(1250, 'GBP'), money(750, 'GBP'))).toEqual(money(2000, 'GBP'));
    expect(subtract(money(1250, 'GBP'), money(750, 'GBP'))).toEqual(money(500, 'GBP'));
  });

  it('refuses to combine different currencies', () => {
    expect(() => add(money(100, 'GBP'), money(100, 'USD'))).toThrow(/Cannot combine/);
    expect(() => compare(money(100, 'GBP'), money(100, 'USD'))).toThrow(/Cannot combine/);
    expect(() => sum([money(100, 'GBP'), money(100, 'USD')], 'GBP')).toThrow(/Expected every amount/);
  });

  it('negates and detects zero', () => {
    expect(negate(money(500, 'GBP'))).toEqual(money(-500, 'GBP'));
    expect(equals(zero('GBP'), money(0, 'GBP'))).toBe(true);
    expect(equals(money(1, 'GBP'), money(1, 'USD'))).toBe(false);
  });

  it('orders amounts', () => {
    expect(compare(money(1, 'GBP'), money(2, 'GBP'))).toBe(-1);
    expect(compare(money(2, 'GBP'), money(2, 'GBP'))).toBe(0);
    expect(compare(money(3, 'GBP'), money(2, 'GBP'))).toBe(1);
  });
});

describe('multiplication', () => {
  it('multiplies by an integer quantity exactly', () => {
    expect(multiplyByQuantity(money(4999, 'GBP'), 7)).toEqual(money(34_993, 'GBP'));
  });

  it('rejects a fractional or negative quantity', () => {
    expect(() => multiplyByQuantity(money(100, 'GBP'), 1.5)).toThrow(MoneyError);
    expect(() => multiplyByQuantity(money(100, 'GBP'), -1)).toThrow(MoneyError);
    expect(multiplyByQuantity(money(100, 'GBP'), 0)).toEqual(money(0, 'GBP'));
  });

  it('rounds a fractional product half away from zero', () => {
    // 3 hours at £33.33 is £99.99 exactly, but a blended rate is rarely so kind.
    expect(multiplyBy(money(3333, 'GBP'), 2.5)).toEqual(money(8333, 'GBP'));
    expect(multiplyBy(money(3333, 'GBP'), -2.5)).toEqual(money(-8333, 'GBP'));
  });
});

describe('tax rates as basis points', () => {
  it('applies a standard rate', () => {
    expect(applyBasisPoints(money(10_000, 'GBP'), 2000)).toEqual(money(2000, 'GBP'));
  });

  it('applies a zero rate without special-casing', () => {
    expect(applyBasisPoints(money(10_000, 'GBP'), 0)).toEqual(money(0, 'GBP'));
  });

  it('represents a rate that is not exact in binary', () => {
    // 17.5% has no exact float representation; as 1750 basis points it does.
    expect(applyBasisPoints(money(10_000, 'GBP'), 1750)).toEqual(money(1750, 'GBP'));
    expect(applyBasisPoints(money(9999, 'GBP'), 1750)).toEqual(money(1750, 'GBP'));
  });

  it('rejects a fractional rate', () => {
    expect(() => applyBasisPoints(money(100, 'GBP'), 2000.5)).toThrow(MoneyError);
  });
});

describe('parsing user input', () => {
  it('reads the formats people actually type', () => {
    expect(parseAmountToMinorUnits('1234.56', 'GBP')).toEqual(money(123_456, 'GBP'));
    expect(parseAmountToMinorUnits('£1,234.56', 'GBP')).toEqual(money(123_456, 'GBP'));
    expect(parseAmountToMinorUnits('  42  ', 'GBP')).toEqual(money(4200, 'GBP'));
    expect(parseAmountToMinorUnits('42', 'GBP')).toEqual(money(4200, 'GBP'));
    expect(parseAmountToMinorUnits('0.07', 'GBP')).toEqual(money(7, 'GBP'));
    expect(parseAmountToMinorUnits('-15.50', 'GBP')).toEqual(money(-1550, 'GBP'));
  });

  it('refuses more precision than the currency has, rather than dropping it', () => {
    // Silently rounding here is how a line total stops matching what the
    // customer was shown on the quote.
    expect(() => parseAmountToMinorUnits('1.234', 'GBP')).toThrow(/more than 2 decimal places/);
  });

  it('refuses text that is not a number', () => {
    expect(() => parseAmountToMinorUnits('twelve', 'GBP')).toThrow(MoneyError);
    expect(() => parseAmountToMinorUnits('1.2.3', 'GBP')).toThrow(MoneyError);
    expect(() => parseAmountToMinorUnits('', 'GBP')).toThrow(MoneyError);
  });
});

describe('allocation', () => {
  it('splits evenly and still sums to the original', () => {
    const parts = allocate(money(10_000, 'GBP'), [1, 1, 1]);
    expect(sum(parts, 'GBP')).toEqual(money(10_000, 'GBP'));
  });

  it('distributes an indivisible remainder without losing a penny', () => {
    // £0.10 across three buckets cannot divide evenly. Naive division loses a
    // penny or invents one; both show up later in a reconciliation.
    const parts = allocate(money(10, 'GBP'), [1, 1, 1]);
    expect(parts.map((p) => p.amount)).toEqual([4, 3, 3]);
    expect(sum(parts, 'GBP')).toEqual(money(10, 'GBP'));
  });

  it('respects weights', () => {
    const parts = allocate(money(10_000, 'GBP'), [70, 30]);
    expect(parts.map((p) => p.amount)).toEqual([7000, 3000]);
  });

  it('preserves the sign of the original', () => {
    const parts = allocate(money(-10, 'GBP'), [1, 1, 1]);
    expect(sum(parts, 'GBP')).toEqual(money(-10, 'GBP'));
  });

  it('always sums back, across many awkward splits', () => {
    // A property rather than an example: this is the guarantee the callers rely
    // on, so assert it over a spread of amounts and weight sets.
    const weightSets = [[1, 1, 1], [1, 2, 3], [7], [1, 1, 1, 1, 1, 1, 1], [5, 3, 2, 1]];
    for (let amount = 0; amount < 500; amount += 7) {
      for (const weights of weightSets) {
        const parts = allocate(money(amount, 'GBP'), weights);
        expect(sum(parts, 'GBP').amount).toBe(amount);
        expect(parts).toHaveLength(weights.length);
      }
    }
  });

  it('refuses allocations it cannot honour', () => {
    expect(() => allocate(money(100, 'GBP'), [])).toThrow(MoneyError);
    expect(() => allocate(money(100, 'GBP'), [0, 0])).toThrow(MoneyError);
    expect(() => allocate(money(100, 'GBP'), [1, -1])).toThrow(MoneyError);
  });
});

describe('formatting', () => {
  it('formats to the currency minor unit', () => {
    expect(format(money(123_456, 'GBP'))).toBe('£1,234.56');
    expect(format(money(-1550, 'GBP'))).toBe('-£15.50');
    expect(format(money(0, 'GBP'))).toBe('£0.00');
    expect(format(money(123_456, 'USD'), 'en-US')).toBe('$1,234.56');
  });
});
