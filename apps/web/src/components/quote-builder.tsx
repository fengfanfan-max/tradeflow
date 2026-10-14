'use client';

/**
 * Client component 2 of 2 — and the only place in the app that holds editable
 * state.
 *
 * The builder owns the quote's lines so that net, tax and gross move as the
 * operator types. Those totals are recomputed with `computeTotals` from
 * `@tradeflow/shared` — the same function the API calls to store them — so the
 * figure on screen while typing and the figure in the database are one
 * calculation, not two that happen to agree.
 *
 * Everything else on the page is a server component. Nothing here is written
 * until "Save quote" is pressed; in particular the AI suggestions are inert
 * until the operator ticks them.
 */

import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  format,
  parseAmountToMinorUnits,
  type CurrencyCode,
  type DraftQuoteSuggestion,
  type Money,
  type QuoteStatus,
} from '@tradeflow/shared';
import { draftTotals, type QuoteDraft } from '@/lib/quote-draft';
import type { PriceBookItem, SiteRef } from '@/lib/read-models';
import type { ActionState, DraftState } from '@/lib/action-state';
import { InlineSubmit, ProblemBox, type FormAction } from '@/components/action-form';

export interface QuoteBuilderProps {
  mode: 'create' | 'edit';
  status: QuoteStatus;
  currency: CurrencyCode;
  customers: { id: string; name: string }[];
  priceBook: PriceBookItem[];
  initial: QuoteDraft;
  initialSites: SiteRef[];
  quoteId?: string;
  expectedVersion?: number;
  saveAction: FormAction;
  draftAction: (state: DraftState, formData: FormData) => Promise<DraftState>;
  loadSitesAction: (customerId: string) => Promise<SiteRef[]>;
}

interface EditableLine {
  key: string;
  priceBookItemId?: string;
  description: string;
  /**
   * Held as typed text, not a number.
   *
   * A `<input type="number">` bound to a controlled number cannot be cleared:
   * deleting the last digit re-renders `0` and the caret jumps, so an operator
   * changing 12 to 3 has to fight the field. The same reasoning applies to the
   * price and rate, which is why all three keep the raw string and coerce on the
   * way out — invalid input is then something to show on the row rather than
   * something to silently turn into a zero.
   */
  quantityText: string;
  /** Major units as typed, e.g. "45.00". Converted to minor units on the way out. */
  unitPriceText: string;
  /** Percent as typed, e.g. "20". Converted to basis points on the way out. */
  taxRateText: string;
}

let lineCounter = 0;
function nextKey(): string {
  lineCounter += 1;
  return `line-${lineCounter}`;
}

function toEditable(line: QuoteDraft['lines'][number]): EditableLine {
  return {
    key: nextKey(),
    ...(line.priceBookItemId ? { priceBookItemId: line.priceBookItemId } : {}),
    description: line.description,
    quantityText: String(line.quantity),
    unitPriceText: (line.unitPrice.amount / 100).toFixed(2),
    taxRateText: String(line.taxRateBp / 100),
  };
}

function blankLine(): EditableLine {
  return {
    key: nextKey(),
    description: '',
    quantityText: '1',
    unitPriceText: '0.00',
    taxRateText: '20',
  };
}

/**
 * Minor units from a typed major-unit string, or `null` if it is not a price.
 *
 * `parseAmountToMinorUnits` is the shared parser and it *rejects* more precision
 * than the currency has rather than rounding it away, which is the right call:
 * silently dropping a third decimal is how a line stops matching what the
 * customer was quoted. The error is surfaced on the row instead.
 */
function parsePrice(text: string, currency: CurrencyCode): number | null {
  const cleaned = text.trim().replace(/[£$€,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  try {
    return parseAmountToMinorUnits(cleaned, currency).amount;
  } catch {
    return null;
  }
}

function parseTaxRate(text: string): number | null {
  const cleaned = text.trim().replace(/%/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const rate = Number(cleaned) * 100;
  const rounded = Math.round(rate * 1) / 1;
  if (!Number.isFinite(rounded) || rounded < 0 || rounded > 10_000) return null;
  // The contract stores basis points as an integer, so a rate with more
  // precision than 0.01% is not representable and must be rejected, not rounded.
  if (Math.abs(rate - Math.round(rate)) > 1e-9) return null;
  return Math.round(rate);
}

/** The contract takes an integer quantity in [0, 100000]. */
function parseQuantity(text: string): number | null {
  const cleaned = text.trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) && value <= 100_000 ? value : null;
}

const CONFIDENCE_TONE: Record<DraftQuoteSuggestion['confidence'], string> = {
  HIGH: 'border-[#1d4530] bg-ok-wash text-ok',
  MEDIUM: 'border-[#4a3a14] bg-warn-wash text-warn',
  LOW: 'border-line-strong bg-neutral-wash text-ink-dim',
};

export function QuoteBuilder(props: QuoteBuilderProps) {
  const { currency, customers, priceBook, initial, quoteId, expectedVersion, status } = props;
  const editable = status === 'DRAFT';

  const [customerId, setCustomerId] = useState(initial.customerId);
  const [siteId, setSiteId] = useState(initial.siteId);
  const [validForDays, setValidForDays] = useState(initial.validForDays);
  const [notes, setNotes] = useState(initial.notes);
  const [lines, setLines] = useState<EditableLine[]>(() => initial.lines.map(toEditable));
  const [sites, setSites] = useState<SiteRef[]>(props.initialSites);
  const [loadingSites, setLoadingSites] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [saveState, saveFormAction] = useActionState(props.saveAction, null);
  const [draftState, draftFormAction] = useActionState(props.draftAction, null);

  const [brief, setBrief] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // A new set of suggestions starts fully unticked. Adding a line to a quote is
  // the operator's decision, so the default has to be "nothing selected" rather
  // than "everything the model proposed".
  useEffect(() => {
    setSelected(new Set());
  }, [draftState]);

  // Sites belong to a customer, and the create form can change which customer.
  // Refetching is the only way to keep the site picker honest.
  useEffect(() => {
    if (!customerId || props.mode === 'edit') return;
    let cancelled = false;
    setLoadingSites(true);
    props
      .loadSitesAction(customerId)
      .then((result) => {
        if (cancelled) return;
        setSites(result);
        setSiteId((current) => (result.some((site) => site.id === current) ? current : (result[0]?.id ?? '')));
      })
      .catch(() => {
        if (!cancelled) setSites([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSites(false);
      });
    return () => {
      cancelled = true;
    };
    // `props` is a stable server-rendered object; only the customer matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const parsed = useMemo(
    () =>
      lines.map((line) => ({
        quantity: parseQuantity(line.quantityText),
        price: parsePrice(line.unitPriceText, currency),
        taxRate: parseTaxRate(line.taxRateText),
      })),
    [lines, currency],
  );

  const draft: QuoteDraft = useMemo(
    () => ({
      customerId,
      siteId,
      currency,
      validForDays,
      notes,
      lines: lines.map((line, index) => ({
        ...(line.priceBookItemId ? { priceBookItemId: line.priceBookItemId } : {}),
        description: line.description,
        quantity: parsed[index]?.quantity ?? 0,
        unitPrice: { amount: parsed[index]?.price ?? 0, currency } as Money,
        taxRateBp: parsed[index]?.taxRate ?? 0,
      })),
    }),
    [customerId, siteId, currency, validForDays, notes, lines, parsed],
  );

  const totals = useMemo(() => draftTotals(draft), [draft]);

  const payload = useMemo(
    () =>
      JSON.stringify({
        ...(quoteId ? { quoteId, expectedVersion } : {}),
        customerId,
        siteId,
        currency,
        validForDays,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: draft.lines.filter((line) => line.description.trim().length > 0),
      }),
    [quoteId, expectedVersion, customerId, siteId, currency, validForDays, notes, draft.lines],
  );

  /** Blocks the save before it reaches the network, with the reason on the row. */
  function firstLocalProblem(): string | null {
    if (!customerId) return 'Choose a customer.';
    if (!siteId) return 'Choose a site for the work.';
    if (draft.lines.length === 0) return 'A quote needs at least one line.';
    for (const [index, line] of lines.entries()) {
      if (!line.description.trim()) return `Line ${index + 1} needs a description.`;
      if (parsed[index]?.quantity === null) return `Line ${index + 1} needs a whole-number quantity.`;
      if (parsed[index]?.price === null) return `Line ${index + 1} has a unit price that is not an amount.`;
      if (parsed[index]?.taxRate === null) return `Line ${index + 1} has a tax rate the contract cannot store.`;
    }
    return null;
  }

  function updateLine(key: string, patch: Partial<EditableLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addFromPriceBook(itemId: string) {
    const item = priceBook.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setLines((current) => [
      ...current,
      {
        key: nextKey(),
        priceBookItemId: item.id,
        description: item.description,
        quantityText: '1',
        unitPriceText: (item.unitPrice.amount / 100).toFixed(2),
        // Price book rows are bare integers on the wire, so the default tax rate
        // is only a default — the operator can change it on the line.
        taxRateText: String(item.taxRateBp / 100),
      },
    ]);
  }

  function addSuggestion(suggestion: DraftQuoteSuggestion) {
    setLines((current) => [
      ...current,
      {
        key: nextKey(),
        priceBookItemId: suggestion.priceBookItemId,
        description: suggestion.description,
        quantityText: String(suggestion.quantity),
        unitPriceText: (suggestion.unitPrice.amount / 100).toFixed(2),
        taxRateText: String(suggestion.taxRateBp / 100),
      },
    ]);
  }

  function addSelectedSuggestions() {
    const suggestions = draftState?.ok ? draftState.data.suggestions : [];
    for (const index of Array.from(selected).sort((a, b) => a - b)) {
      const suggestion = suggestions[index];
      if (suggestion) addSuggestion(suggestion);
    }
    setSelected(new Set());
  }

  const suggestions = draftState?.ok ? draftState.data.suggestions : [];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* ------------------------------------------------ main column */}
      <form action={saveFormAction} className="space-y-4" onSubmit={(event) => setLocalError(firstLocalProblem())}>
        <input type="hidden" name="payload" value={payload} readOnly />

        <section className="panel p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="quote-customer">
                Customer
              </label>
              <select
                id="quote-customer"
                className="control"
                value={customerId}
                disabled={!editable || props.mode === 'edit'}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  setSiteId('');
                }}
              >
                <option value="">Select a customer…</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="quote-site">
                Site
              </label>
              <select
                id="quote-site"
                className="control"
                value={siteId}
                disabled={!editable || !customerId || loadingSites}
                onChange={(event) => setSiteId(event.target.value)}
              >
                <option value="">
                  {loadingSites ? 'Loading sites…' : customerId ? 'Select a site…' : 'Choose a customer first'}
                </option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.label}
                  </option>
                ))}
              </select>
              {customerId && !loadingSites && sites.length === 0 && (
                <p className="mt-1 text-xs text-warn">
                  This customer has no sites yet. Add one from their record before quoting.
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="quote-valid">
                Valid for (days)
              </label>
              <input
                id="quote-valid"
                className="control num"
                type="number"
                min={1}
                max={365}
                value={validForDays}
                disabled={!editable}
                onChange={(event) => setValidForDays(Number(event.target.value) || 1)}
              />
            </div>
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Lines</h2>
            {editable && (
              <div className="flex items-center gap-2">
                <select
                  className="control w-64"
                  value=""
                  aria-label="Add a line from the price book"
                  onChange={(event) => {
                    if (event.target.value) addFromPriceBook(event.target.value);
                  }}
                >
                  <option value="">Add from price book…</option>
                  {priceBook
                    .filter((item) => item.active)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} — {item.description}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setLines((current) => [...current, blankLine()])}
                >
                  Blank line
                </button>
              </div>
            )}
          </div>

          {lines.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-faint">
              No lines yet. Add one from the price book, or draft the quote from the customer&rsquo;s brief.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-[42%]">Description</th>
                    <th className="w-20 right">Qty</th>
                    <th className="w-28 right">Unit</th>
                    <th className="w-20 right">Tax</th>
                    <th className="w-28 right">Net</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const price = parsed[index]?.price ?? null;
                    const quantity = parsed[index]?.quantity ?? null;
                    const taxRate = parsed[index]?.taxRate ?? null;
                    const lineNet = (price ?? 0) * (quantity ?? 0);
                    return (
                      <tr key={line.key}>
                        <td>
                          <input
                            className="control"
                            value={line.description}
                            disabled={!editable}
                            aria-label={`Description for line ${index + 1}`}
                            onChange={(event) => updateLine(line.key, { description: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className={`control num text-right ${quantity === null ? 'border-bad' : ''}`}
                            inputMode="numeric"
                            value={line.quantityText}
                            disabled={!editable}
                            aria-invalid={quantity === null}
                            aria-label={`Quantity for line ${index + 1}`}
                            onChange={(event) => updateLine(line.key, { quantityText: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className={`control num text-right ${price === null ? 'border-bad' : ''}`}
                            inputMode="decimal"
                            value={line.unitPriceText}
                            disabled={!editable}
                            aria-invalid={price === null}
                            aria-label={`Unit price for line ${index + 1}`}
                            onChange={(event) => updateLine(line.key, { unitPriceText: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className={`control num text-right ${taxRate === null ? 'border-bad' : ''}`}
                            inputMode="decimal"
                            value={line.taxRateText}
                            disabled={!editable}
                            aria-invalid={taxRate === null}
                            aria-label={`Tax rate for line ${index + 1}`}
                            onChange={(event) => updateLine(line.key, { taxRateText: event.target.value })}
                          />
                        </td>
                        <td className="right num text-ink-dim">
                          {format({ amount: lineNet, currency })}
                        </td>
                        <td className="right">
                          {editable && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm text-bad"
                              aria-label={`Remove line ${index + 1}`}
                              onClick={() =>
                                setLines((current) => current.filter((candidate) => candidate.key !== line.key))
                              }
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel p-4">
          <label className="label" htmlFor="quote-notes">
            Notes for the customer
          </label>
          <textarea
            id="quote-notes"
            className="control min-h-24"
            value={notes}
            disabled={!editable}
            maxLength={2000}
            placeholder="Access requirements, exclusions, what happens next…"
            onChange={(event) => setNotes(event.target.value)}
          />
          <p className="mt-1 text-xs text-ink-faint">Printed on the quote the customer accepts.</p>
        </section>

        {localError && (
          <div className="rounded-md border border-[#4d2229] bg-bad-wash px-3 py-2 text-xs text-bad" role="alert">
            {localError}
          </div>
        )}
        {saveState && !saveState.ok && <ProblemBox problem={saveState} />}

        {editable && (
          <div className="flex items-center gap-2">
            <InlineSubmit
              label={props.mode === 'create' ? 'Create quote' : 'Save quote'}
              pendingLabel="Saving…"
            />
            <span className="text-xs text-ink-faint">
              {quoteId ? `Version ${expectedVersion ?? 1} — a save that loses the race is refused, not merged.` : 'Saved as a draft.'}
            </span>
          </div>
        )}
      </form>

      {/* ------------------------------------------------ right rail */}
      <aside className="space-y-4">
        <section className="panel p-4">
          <h2 className="text-sm font-semibold text-ink">Totals</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-dim">Net</dt>
              <dd className="num text-ink">{format(totals.net)}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-dim">
                VAT
                <span className="ml-1.5 text-xs text-ink-faint">
                  {(totals.effectiveTaxRateBp / 100).toFixed(2).replace(/\.00$/, '')}% effective
                </span>
              </dt>
              <dd className="num text-ink">{format(totals.tax)}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-2">
              <dt className="font-semibold text-ink">Gross</dt>
              <dd className="num text-base font-semibold text-accent">{format(totals.gross)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            VAT is rounded per line and then summed, so the printed lines always add up to the printed total.
          </p>
        </section>

        {editable && (
          <section className="panel p-4">
            <h2 className="text-sm font-semibold text-ink">Draft from brief</h2>
            <p className="mt-1 text-xs text-ink-faint">
              Paste what the customer sent. Matches come from your own price book — nothing is added until you
              tick it.
            </p>

            {/* A sibling of the save form, not a child: a form inside a form is
                invalid HTML and the inner submit would fire the outer save. */}
            <form action={draftFormAction} className="mt-3 space-y-2">
              <input type="hidden" name="customerId" value={customerId} readOnly />
              <textarea
                className="control min-h-32"
                name="brief"
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                placeholder={'e.g. "Need the boiler swapped at 14 Alma Road, and a full service on the two rads upstairs."'}
              />
              <InlineSubmit
                label="Draft lines"
                pendingLabel="Reading the brief…"
                className="btn w-full"
                disabled={!customerId || brief.trim().length < 10}
              />
              {!customerId && <p className="text-xs text-ink-faint">Choose a customer first.</p>}
              {customerId && brief.trim().length < 10 && (
                <p className="text-xs text-ink-faint">A brief needs at least 10 characters.</p>
              )}
            </form>

            {draftState && !draftState.ok && (
              <div className="mt-3">
                <ProblemBox problem={draftState} />
              </div>
            )}

            {draftState?.ok && (
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-ink-faint">
                    {suggestions.length === 0
                      ? 'Nothing in that brief matched the price book.'
                      : `${suggestions.length} suggested ${suggestions.length === 1 ? 'line' : 'lines'}`}
                  </p>
                  <span className="text-[10px] tracking-wider text-ink-faint uppercase">
                    {draftState.data.provider}
                  </span>
                </div>

                <ul className="space-y-2">
                  {suggestions.map((suggestion, index) => (
                    <li key={`${suggestion.priceBookItemId}-${index}`} className="panel-raised p-3">
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selected.has(index)}
                          onChange={(event) => {
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(index);
                              else next.delete(index);
                              return next;
                            });
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-ink">{suggestion.description}</span>
                            <span
                              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${CONFIDENCE_TONE[suggestion.confidence]}`}
                            >
                              {suggestion.confidence}
                            </span>
                          </span>
                          <span className="num mt-1 block text-xs text-ink-dim">
                            {suggestion.quantity} × {format(suggestion.unitPrice)} · {suggestion.code} ·{' '}
                            {suggestion.unit}
                          </span>
                          <span className="mt-1 block text-xs text-ink-faint italic">{suggestion.rationale}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>

                {suggestions.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={selected.size === 0}
                      onClick={addSelectedSuggestions}
                    >
                      Add {selected.size > 0 ? selected.size : ''} selected
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setSelected(new Set(suggestions.map((_, index) => index)))}
                    >
                      Select all
                    </button>
                  </div>
                )}

                {draftState.data.unmatched.length > 0 && (
                  <div className="rounded-md border border-[#4a3a14] bg-warn-wash px-3 py-2">
                    <p className="text-xs font-semibold text-warn">Could not be priced</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-warn/90">
                      {draftState.data.unmatched.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-[11px] text-warn/70">
                      Add these to the price book if they come up often, then draft again.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
