import Link from 'next/link';
import type { Metadata } from 'next';
import type { QuoteStatus } from '@tradeflow/shared';
import { requireClient } from '@/lib/session';
import { load } from '@/lib/load';
import { listQuotes } from '@/lib/resources';
import { buildHref, enumParam, firstParam, intParam, type RawSearchParams } from '@/lib/url';
import { formatDate } from '@/lib/format';
import type { Quote } from '@/lib/read-models';
import {
  Amount,
  EmptyState,
  ErrorPanel,
  FilterChips,
  PageHeader,
  Panel,
  QuoteStatusPill,
  SearchBox,
  SortHeader,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Quotes' };

const STATUSES: QuoteStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'];
const PAGE_SIZE = 25;

type SortField = 'number' | 'customer' | 'gross' | 'validUntil' | 'status';
const SORT_FIELDS: SortField[] = ['number', 'customer', 'gross', 'validUntil', 'status'];

/**
 * Sort the rows the API returned.
 *
 * `GET /quotes` documents no `sort` parameter, so there is nothing to push this
 * down to. It orders the current page, which is honest for the default page size
 * and the reason `limit` is in the URL and can be raised to 100; a `sort` query
 * parameter on the API would let this become a true sort.
 */
function sortQuotes(quotes: Quote[], field: SortField, dir: 'asc' | 'desc'): Quote[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...quotes].sort((a, b) => {
    switch (field) {
      case 'gross':
        return sign * (a.totals.gross.amount - b.totals.gross.amount);
      case 'validUntil':
        return sign * a.validUntil.localeCompare(b.validUntil);
      case 'customer':
        return sign * a.customer.name.localeCompare(b.customer.name);
      case 'status':
        return sign * a.status.localeCompare(b.status);
      case 'number':
      default:
        return sign * a.number.localeCompare(b.number);
    }
  });
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const status = enumParam(params, 'status', STATUSES);
  const customerId = firstParam(params, 'customerId');
  const query = firstParam(params, 'q');
  const cursor = firstParam(params, 'cursor');
  const limit = Math.min(100, Math.max(1, intParam(params, 'limit', PAGE_SIZE)));
  const sort = (enumParam(params, 'sort', SORT_FIELDS) ?? 'number') as SortField;
  const dir = enumParam(params, 'dir', ['asc', 'desc'] as const) ?? 'desc';

  const client = await requireClient();
  const result = await load(() =>
    listQuotes(client, {
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
      ...(query ? { q: query } : {}),
      limit,
      ...(cursor ? { cursor } : {}),
    }),
  );

  const hrefFor = (patch: Record<string, string | number | null>) => buildHref('/quotes', params, patch);
  const rows = result.ok ? sortQuotes(result.data.items, sort, dir) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quotes"
        subtitle={result.ok ? `${result.data.total} matching` : 'Every quote, in every state.'}
        actions={
          <>
            <SearchBox
              action="/quotes"
              defaultValue={query}
              placeholder="Number, customer, notes…"
              hidden={{ status, customerId: customerId || undefined }}
            />
            <Link className="btn btn-primary" href="/quotes/new">
              New quote
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterChips
          active={status ?? ''}
          options={[
            { value: '', label: 'All' },
            ...STATUSES.map((value) => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() })),
          ]}
          hrefFor={(value) => hrefFor({ status: value || null, cursor: null })}
        />
        {customerId && (
          <span className="flex items-center gap-2 text-xs text-ink-dim">
            Filtered to one customer
            <Link className="link underline decoration-line-strong" href={hrefFor({ customerId: null })}>
              clear
            </Link>
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs text-ink-faint">
          Rows
          {[25, 50, 100].map((size) => (
            <Link
              key={size}
              href={hrefFor({ limit: size, cursor: null })}
              className={`num ${limit === size ? 'text-accent' : 'text-ink-dim hover:text-ink'}`}
            >
              {size}
            </Link>
          ))}
        </span>
      </div>

      <Panel bodyClassName="p-0">
        {!result.ok ? (
          <div className="p-4">
            <ErrorPanel title="Quotes did not load" detail={`${result.problem.code}: ${result.problem.message}`} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No quotes here"
              description="Change the filter, or start a new one from the price book."
              action={
                <Link className="btn btn-sm btn-primary" href="/quotes/new">
                  New quote
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader
                      label="Quote"
                      field="number"
                      activeField={sort}
                      activeDir={dir}
                      hrefFor={(field, nextDir) => hrefFor({ sort: field, dir: nextDir })}
                    />
                    <SortHeader
                      label="Customer"
                      field="customer"
                      activeField={sort}
                      activeDir={dir}
                      hrefFor={(field, nextDir) => hrefFor({ sort: field, dir: nextDir })}
                    />
                    <th>Site</th>
                    <th className="right">Net</th>
                    <th className="right">Tax</th>
                    <SortHeader
                      label="Gross"
                      field="gross"
                      activeField={sort === 'gross' ? 'gross' : '__none'}
                      activeDir={dir}
                      hrefFor={(field, nextDir) => hrefFor({ sort: field, dir: nextDir })}
                      align="right"
                    />
                    <SortHeader
                      label="Valid until"
                      field="validUntil"
                      activeField={sort}
                      activeDir={dir}
                      hrefFor={(field, nextDir) => hrefFor({ sort: field, dir: nextDir })}
                    />
                    <SortHeader
                      label="Status"
                      field="status"
                      activeField={sort}
                      activeDir={dir}
                      hrefFor={(field, nextDir) => hrefFor({ sort: field, dir: nextDir })}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((quote) => (
                    <tr key={quote.id}>
                      <td>
                        <Link className="link font-medium" href={`/quotes/${quote.id}`}>
                          {quote.number}
                        </Link>
                        {quote.hasJob && <span className="ml-2 text-[11px] text-ink-faint">jobbed</span>}
                      </td>
                      <td className="truncate">{quote.customer.name}</td>
                      <td className="truncate text-ink-dim">{quote.site?.label ?? '—'}</td>
                      <td className="right"><Amount value={quote.totals.net} muted /></td>
                      <td className="right"><Amount value={quote.totals.tax} muted /></td>
                      <td className="right"><Amount value={quote.totals.gross} strong /></td>
                      <td className="num whitespace-nowrap text-ink-dim">{formatDate(quote.validUntil)}</td>
                      <td className="right"><QuoteStatusPill status={quote.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(result.data.nextCursor || cursor) && (
              <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-ink-faint">
                <span>
                  Showing {rows.length} of {result.data.total}
                </span>
                <span className="flex gap-2">
                  {cursor && (
                    <Link className="btn btn-sm" href={hrefFor({ cursor: null })}>
                      First page
                    </Link>
                  )}
                  {result.data.nextCursor && (
                    <Link className="btn btn-sm" href={hrefFor({ cursor: result.data.nextCursor })}>
                      Next →
                    </Link>
                  )}
                </span>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
