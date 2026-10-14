import Link from 'next/link';
import type { Metadata } from 'next';
import type { PriceUnit } from '@tradeflow/shared';
import { requireClient } from '@/lib/session';
import { load } from '@/lib/load';
import { listPriceBook } from '@/lib/resources';
import { createPriceBookItemAction, updatePriceBookItemAction } from '@/lib/actions/price-book';
import { buildHref, enumParam, firstParam, type RawSearchParams } from '@/lib/url';
import { ActionForm } from '@/components/action-form';
import {
  Amount,
  EmptyState,
  ErrorPanel,
  Field,
  FilterChips,
  PageHeader,
  Panel,
  Pill,
  SearchBox,
  taxRateLabel,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Price book' };

const UNITS: PriceUnit[] = ['HOUR', 'DAY', 'EACH', 'SQUARE_METRE', 'METRE'];
const UNIT_LABEL: Record<PriceUnit, string> = {
  HOUR: 'per hour',
  DAY: 'per day',
  EACH: 'each',
  SQUARE_METRE: 'per m²',
  METRE: 'per metre',
};

/** The price fields, shared by the create form and the per-row edit form. */
function PriceFieldset({ item }: { item?: { unitPrice: { amount: number }; taxRateBp: number; unit: PriceUnit } }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Field label="Unit price" htmlFor={item ? 'unitPrice-edit' : 'unitPrice'} required hint="Net, excluding VAT.">
        <input
          id={item ? 'unitPrice-edit' : 'unitPrice'}
          name="unitPrice"
          inputMode="decimal"
          className="control num"
          required
          placeholder="45.00"
          defaultValue={item ? (item.unitPrice.amount / 100).toFixed(2) : ''}
        />
      </Field>
      <Field label="VAT rate %" htmlFor={item ? 'taxRate-edit' : 'taxRate'}>
        <input
          id={item ? 'taxRate-edit' : 'taxRate'}
          name="taxRate"
          inputMode="decimal"
          className="control num"
          placeholder="20"
          defaultValue={item ? String(item.taxRateBp / 100) : '20'}
        />
      </Field>
      <Field label="Unit" htmlFor={item ? 'unit-edit' : 'unit'}>
        <select id={item ? 'unit-edit' : 'unit'} name="unit" className="control" defaultValue={item?.unit ?? 'EACH'}>
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {UNIT_LABEL[unit]}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

export default async function PriceBookPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const query = firstParam(params, 'q');
  const activeParam = enumParam(params, 'active', ['true', 'false'] as const);
  const editingId = firstParam(params, 'edit');
  const showNew = firstParam(params, 'new') === '1';

  const client = await requireClient();
  const result = await load(() =>
    listPriceBook(client, {
      ...(query ? { q: query } : {}),
      ...(activeParam ? { active: activeParam === 'true' } : {}),
    }),
  );

  const items = result.ok ? result.data : [];
  const editing = items.find((item) => item.id === editingId);
  const hrefFor = (patch: Record<string, string | null>) => buildHref('/price-book', params, patch);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Price book"
        subtitle="What you charge, and at what rate. Quotes and AI drafts are built from these rows."
        actions={
          <>
            <SearchBox
              action="/price-book"
              defaultValue={query}
              placeholder="Code or description…"
              hidden={{ active: activeParam }}
            />
            <Link className="btn btn-primary" href={hrefFor({ new: showNew ? null : '1' })}>
              {showNew ? 'Close' : 'New item'}
            </Link>
          </>
        }
      />

      <FilterChips
        active={activeParam ?? ''}
        options={[
          { value: '', label: 'All' },
          { value: 'true', label: 'Active' },
          { value: 'false', label: 'Retired' },
        ]}
        hrefFor={(value) => hrefFor({ active: value || null })}
      />

      {showNew && (
        <Panel title="New price book item" description="The code is what the AI drafter matches against a brief, so make it speak the trade.">
          <ActionForm action={createPriceBookItemAction} submitLabel="Add to price book" pendingLabel="Adding…">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Code" htmlFor="code" required hint="Short and stable, e.g. LAB-HR or BOILER-SWAP.">
                <input id="code" name="code" className="control num" required maxLength={40} autoFocus />
              </Field>
              <Field label="Description" htmlFor="description" required>
                <input id="description" name="description" className="control" required maxLength={300} />
              </Field>
            </div>
            <PriceFieldset />
          </ActionForm>
        </Panel>
      )}

      {editing && (
        <Panel
          title={`Edit ${editing.code}`}
          actions={
            <Link className="btn btn-sm" href={hrefFor({ edit: null })}>
              Close
            </Link>
          }
        >
          <ActionForm
            action={updatePriceBookItemAction}
            submitLabel="Save item"
            pendingLabel="Saving…"
            hiddenValues={{ id: editing.id }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Code" htmlFor="code-edit" required>
                <input id="code-edit" name="code" className="control num" required maxLength={40} defaultValue={editing.code} />
              </Field>
              <Field label="Description" htmlFor="description-edit" required>
                <input id="description-edit" name="description" className="control" required maxLength={300} defaultValue={editing.description} />
              </Field>
            </div>
            <PriceFieldset item={editing} />
            <label className="flex items-center gap-2 text-sm text-ink-dim">
              <input type="checkbox" name="active" defaultChecked={editing.active} />
              Active — retired items stay on old quotes but are hidden from new ones.
            </label>
          </ActionForm>
        </Panel>
      )}

      <Panel bodyClassName="p-0">
        {!result.ok ? (
          <div className="p-4">
            <ErrorPanel title="The price book did not load" detail={`${result.problem.code}: ${result.problem.message}`} />
          </div>
        ) : items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={query ? `Nothing matches “${query}”` : 'The price book is empty'}
              description={
                query
                  ? 'Try a shorter search.'
                  : 'Nothing can be quoted until there is something to quote from — and the AI drafter has nothing to match against.'
              }
              action={
                <Link className="btn btn-sm btn-primary" href={hrefFor({ new: '1' })}>
                  New item
                </Link>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Unit</th>
                  <th className="right">Unit price</th>
                  <th className="right">VAT</th>
                  <th className="right">State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="num text-ink">{item.code}</td>
                    <td className="truncate">{item.description}</td>
                    <td className="text-ink-dim">{UNIT_LABEL[item.unit]}</td>
                    <td className="right"><Amount value={item.unitPrice} /></td>
                    <td className="num right text-ink-dim">{taxRateLabel(item.taxRateBp)}</td>
                    <td className="right">
                      <Pill tone={item.active ? 'ok' : 'neutral'}>{item.active ? 'Active' : 'Retired'}</Pill>
                    </td>
                    <td className="right">
                      <Link className="btn btn-sm" href={hrefFor({ edit: editingId === item.id ? null : item.id, new: null })}>
                        {editingId === item.id ? 'Editing' : 'Edit'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
