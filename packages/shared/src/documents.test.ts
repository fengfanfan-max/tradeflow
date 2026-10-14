import { describe, expect, it } from 'vitest';
import { computeLine, computeTotals, emptyTotals, balanceAfterDeposit } from './documents';
import { money, sum } from './money';

const line = (
  quantity: number,
  unitPence: number,
  taxRateBp = 2000,
  description = 'Labour',
) => ({ description, quantity, unitPrice: money(unitPence, 'GBP'), taxRateBp });

describe('a single line', () => {
  it('computes net, tax and gross', () => {
    // 3 hours at £45.00, standard rate.
    const computed = computeLine(line(3, 4500), 'GBP');
    expect(computed.net).toEqual(money(13_500, 'GBP'));
    expect(computed.tax).toEqual(money(2700, 'GBP'));
    expect(computed.gross).toEqual(money(16_200, 'GBP'));
  });

  it('handles a zero-rated line', () => {
    const computed = computeLine(line(2, 9000, 0), 'GBP');
    expect(computed.net).toEqual(money(18_000, 'GBP'));
    expect(computed.tax).toEqual(money(0, 'GBP'));
    expect(computed.gross).toEqual(money(18_000, 'GBP'));
  });

  it('handles a line that is entirely tax', () => {
    const computed = computeLine(line(1, 5000, 10_000), 'GBP');
    expect(computed.tax).toEqual(money(5000, 'GBP'));
    expect(computed.gross).toEqual(money(10_000, 'GBP'));
  });

  it('handles a free line without dividing by zero', () => {
    const computed = computeLine(line(1, 0), 'GBP');
    expect(computed.net).toEqual(money(0, 'GBP'));
    expect(computed.tax).toEqual(money(0, 'GBP'));
  });
});

describe('the rounding rule', () => {
  it('rounds tax per line, so the printed lines add up to the printed total', () => {
    // Three lines whose individual taxes each land on a half-penny.
    const totals = computeTotals([line(1, 833, 2000), line(1, 833, 2000), line(1, 833, 2000)], 'GBP');

    const printedGross = sum(
      totals.lines.map((l) => l.gross),
      'GBP',
    );
    expect(printedGross).toEqual(totals.gross);

    // Per-line: each tax rounds 166.6 -> 167, giving 501.
    expect(totals.tax).toEqual(money(501, 'GBP'));

    // On the total it would be a different number, which is the whole reason
    // the rule is stated in one place and applied in one place.
    const taxOnTotal = Math.round((2499 * 2000) / 10_000);
    expect(taxOnTotal).toBe(500);
    expect(totals.tax.amount).not.toBe(taxOnTotal);
  });

  it('keeps the invariant across mixed rates', () => {
    const totals = computeTotals(
      [
        line(4, 4750, 2000), // labour, standard
        line(12, 1233, 500), // materials, reduced
        line(1, 22_000, 0), // zero-rated export
        line(3, 999, 2000),
      ],
      'GBP',
    );

    expect(sum(totals.lines.map((l) => l.net), 'GBP')).toEqual(totals.net);
    expect(sum(totals.lines.map((l) => l.tax), 'GBP')).toEqual(totals.tax);
    expect(sum(totals.lines.map((l) => l.gross), 'GBP')).toEqual(totals.gross);
    expect(totals.gross.amount).toBe(totals.net.amount + totals.tax.amount);
  });

  it('holds for every line set in a spread', () => {
    // The guarantee the invoice renderer depends on. Assert it over many
    // combinations rather than trusting the examples above.
    const quantities = [1, 2, 3, 7, 13];
    const prices = [1, 3, 7, 99, 833, 1233, 4750];
    const rates = [0, 500, 1750, 2000];

    for (const quantity of quantities) {
      for (const price of prices) {
        for (const rate of rates) {
          const totals = computeTotals([line(quantity, price, rate)], 'GBP');
          expect(totals.gross.amount).toBe(totals.net.amount + totals.tax.amount);
          expect(totals.gross).toEqual(sum(totals.lines.map((l) => l.gross), 'GBP'));
        }
      }
    }
  });
});

describe('document totals', () => {
  it('sums lines, tax and gross', () => {
    const totals = computeTotals([line(2, 5000), line(1, 10_000)], 'GBP');
    expect(totals.net).toEqual(money(20_000, 'GBP'));
    expect(totals.tax).toEqual(money(4000, 'GBP'));
    expect(totals.gross).toEqual(money(24_000, 'GBP'));
  });

  it('reports an effective rate for cross-checking', () => {
    const totals = computeTotals([line(1, 10_000, 2000), line(1, 10_000, 0)], 'GBP');
    expect(totals.net).toEqual(money(20_000, 'GBP'));
    expect(totals.tax).toEqual(money(2000, 'GBP'));
    expect(totals.effectiveTaxRateBp).toBe(1000);
  });

  it('reports a zero effective rate rather than NaN on an empty document', () => {
    const totals = computeTotals([], 'GBP');
    expect(totals.effectiveTaxRateBp).toBe(0);
    expect(totals.gross).toEqual(money(0, 'GBP'));
    expect(totals.lines).toHaveLength(0);
  });

  it('produces an empty document for a new quote', () => {
    expect(emptyTotals('GBP')).toMatchObject({
      currency: 'GBP',
      lines: [],
      effectiveTaxRateBp: 0,
    });
  });
});

describe('deposits', () => {
  it('reduces the balance', () => {
    const totals = computeTotals([line(1, 100_000)], 'GBP');
    expect(totals.gross).toEqual(money(120_000, 'GBP'));
    expect(balanceAfterDeposit(totals, money(20_000, 'GBP'))).toEqual(money(100_000, 'GBP'));
  });

  it('allows a deposit equal to the total', () => {
    const totals = computeTotals([line(1, 1000)], 'GBP');
    expect(balanceAfterDeposit(totals, totals.gross)).toEqual(money(0, 'GBP'));
  });

  it('refuses a deposit larger than the document', () => {
    const totals = computeTotals([line(1, 1000)], 'GBP');
    expect(() => balanceAfterDeposit(totals, money(totals.gross.amount + 1, 'GBP'))).toThrow(
      /cannot exceed/,
    );
  });
});
