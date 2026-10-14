import Link from 'next/link';
import type { Metadata } from 'next';
import { add, type CurrencyCode, type Money } from '@tradeflow/shared';
import { requireClient } from '@/lib/session';
import { load } from '@/lib/load';
import { listInvoices } from '@/lib/resources';
import { buildHref, enumParam, firstParam, type RawSearchParams } from '@/lib/url';
import { formatDate } from '@/lib/format';
import type { Invoice } from '@/lib/read-models';
import {
  Amount,
  EmptyState,
  ErrorPanel,
  FilterChips,
  InvoiceStatusPill,
  PageHeader,
  Panel,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Invoices' };

const STATUSES = ['DRAFT', 'SENT', 'PAID', 'VOID'] as const;
type InvoiceStatusFilter = (typeof STATUSES)[number];

function outstanding(invoices: Invoice[]): { currency: CurrencyCode; total: Money }[] {
  const groups = new Map<CurrencyCode, Money>();
  for (const invoice of invoices) {
    if (invoice.status === 'PAID' || invoice.status === 'VOID') continue;
    const current = groups.get(invoice.amountDue.currency);
    groups.set(invoice.amountDue.currency, current ? add(current, invoice.amountDue) : invoice.amountDue);
  }
  return Array.from(groups, ([currency, total]) => ({ currency, total }));
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const status = enumParam(params, 'status', STATUSES) as InvoiceStatusFilter | undefined;
  const customerId = firstParam(params, 'customerId');

  const client = await requireClient();
  const result = await load(() =>
    listInvoices(client, {
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
    }),
  );

  const invoices = result.ok ? result.data : [];
  const owed = outstanding(invoices);
  const hrefFor = (patch: Record<string, string | null>) => buildHref('/invoices', params, patch);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices"
        subtitle={result.ok ? `${invoices.length} shown` : 'Raised from completed jobs.'}
        actions={
          customerId ? (
            <Link className="btn" href={hrefFor({ customerId: null })}>
              Clear customer filter
            </Link>
          ) : (
            <Link className="btn" href="/jobs?status=COMPLETED">
              Completed jobs
            </Link>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterChips
          active={status ?? ''}
          options={[
            { value: '', label: 'All' },
            ...STATUSES.map((value) => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() })),
          ]}
          hrefFor={(value) => hrefFor({ status: value || null })}
        />
        {owed.length > 0 && (
          <span className="ml-auto flex items-baseline gap-2 text-xs text-ink-faint">
            Outstanding
            {owed.map(({ currency, total }) => (
              <Amount key={currency} value={total} strong className="text-sm" />
            ))}
          </span>
        )}
      </div>

      <Panel bodyClassName="p-0">
        {!result.ok ? (
          <div className="p-4">
            <ErrorPanel title="Invoices did not load" detail={`${result.problem.code}: ${result.problem.message}`} />
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No invoices here"
              description="An invoice is raised from a completed job — that is what makes its lines a snapshot rather than a live view of the quote."
              action={
                <Link className="btn btn-sm" href="/jobs">
                  Go to jobs
                </Link>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Job</th>
                  <th className="right">Net</th>
                  <th className="right">Tax</th>
                  <th className="right">Gross</th>
                  <th className="right">Deposit</th>
                  <th className="right">Due</th>
                  <th>Due date</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link className="link font-medium" href={`/invoices/${invoice.id}`}>
                        {invoice.number}
                      </Link>
                    </td>
                    <td className="truncate">{invoice.customer.name}</td>
                    <td className="text-ink-dim">
                      {invoice.job ? (
                        <Link className="link" href={`/jobs/${invoice.job.id}`}>
                          {invoice.job.number}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="right"><Amount value={invoice.totals.net} muted /></td>
                    <td className="right"><Amount value={invoice.totals.tax} muted /></td>
                    <td className="right"><Amount value={invoice.totals.gross} muted /></td>
                    <td className="right"><Amount value={invoice.depositAmount} muted /></td>
                    <td className="right"><Amount value={invoice.amountDue} strong /></td>
                    <td className="num whitespace-nowrap text-ink-dim">{formatDate(invoice.dueAt)}</td>
                    <td className="right"><InvoiceStatusPill status={invoice.status} /></td>
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
