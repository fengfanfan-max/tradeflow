import Link from 'next/link';
import type { Metadata } from 'next';
import { requireClient } from '@/lib/session';
import { load } from '@/lib/load';
import { listCustomers } from '@/lib/resources';
import { createCustomerAction } from '@/lib/actions/customers';
import { buildHref, firstParam, intParam, type RawSearchParams } from '@/lib/url';
import { formatDate } from '@/lib/format';
import { ActionForm } from '@/components/action-form';
import {
  EmptyState,
  ErrorPanel,
  Field,
  PageHeader,
  Panel,
  SearchBox,
} from '@/components/ui';
import { addressLines } from '@/lib/read-models';

export const metadata: Metadata = { title: 'Customers' };

const PAGE_SIZE = 25;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const query = firstParam(params, 'q');
  const cursor = firstParam(params, 'cursor');
  const showNew = firstParam(params, 'new') === '1';
  const limit = Math.min(100, Math.max(1, intParam(params, 'limit', PAGE_SIZE)));

  const client = await requireClient();
  const result = await load(() =>
    listCustomers(client, {
      ...(query ? { q: query } : {}),
      limit,
      ...(cursor ? { cursor } : {}),
    }),
  );

  const hrefFor = (patch: Record<string, string | null>) => buildHref('/customers', params, patch);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customers"
        subtitle={
          result.ok
            ? `${result.data.total} ${result.data.total === 1 ? 'customer' : 'customers'}`
            : 'Accounts, billing details and the sites the work happens at.'
        }
        actions={
          <>
            <SearchBox action="/customers" defaultValue={query} placeholder="Name, email, phone…" />
            <Link className="btn btn-primary" href={hrefFor({ new: showNew ? null : '1' })}>
              {showNew ? 'Close' : 'New customer'}
            </Link>
          </>
        }
      />

      {showNew && (
        <Panel
          title="New customer"
          description="The billing address is printed on invoices; sites are added on the customer's page."
        >
          <ActionForm
            action={createCustomerAction}
            submitLabel="Create customer"
            pendingLabel="Creating…"
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="name" required>
                <input id="name" name="name" className="control" required maxLength={200} autoFocus />
              </Field>
              <Field label="Email" htmlFor="email" hint="Where quotes and invoices are sent.">
                <input id="email" name="email" type="email" className="control" />
              </Field>
              <Field label="Phone" htmlFor="phone">
                <input id="phone" name="phone" className="control" maxLength={40} />
              </Field>
              <div />
              <Field label="Billing line 1" htmlFor="billingLine1">
                <input id="billingLine1" name="billingLine1" className="control" maxLength={200} />
              </Field>
              <Field label="Billing line 2" htmlFor="billingLine2">
                <input id="billingLine2" name="billingLine2" className="control" maxLength={200} />
              </Field>
              <Field label="City" htmlFor="billingCity">
                <input id="billingCity" name="billingCity" className="control" maxLength={120} />
              </Field>
              <Field label="Postcode" htmlFor="billingPostcode">
                <input id="billingPostcode" name="billingPostcode" className="control" maxLength={20} />
              </Field>
              <Field label="Country" htmlFor="billingCountry" hint="Two-letter code. Defaults to GB.">
                <input id="billingCountry" name="billingCountry" className="control uppercase" maxLength={2} defaultValue="GB" />
              </Field>
            </div>
            <Field label="Notes" htmlFor="notes" hint="Internal only — not printed on anything the customer sees.">
              <textarea id="notes" name="notes" className="control min-h-20" maxLength={2000} />
            </Field>
          </ActionForm>
        </Panel>
      )}

      <Panel bodyClassName="p-0">
        {!result.ok ? (
          <div className="p-4">
            <ErrorPanel title="Customers did not load" detail={`${result.problem.code}: ${result.problem.message}`} />
          </div>
        ) : result.data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={query ? `No customers match “${query}”` : 'No customers yet'}
              description={query ? 'Try a shorter search.' : 'Add the first account to start quoting.'}
              action={
                query ? (
                  <Link className="btn btn-sm" href="/customers">
                    Clear search
                  </Link>
                ) : (
                  <Link className="btn btn-sm btn-primary" href="/customers?new=1">
                    New customer
                  </Link>
                )
              }
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Billing address</th>
                    <th>Added</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {result.data.items.map((customer) => (
                    <tr key={customer.id}>
                      <td>
                        <Link className="link font-medium" href={`/customers/${customer.id}`}>
                          {customer.name}
                        </Link>
                        {customer.archivedAt && (
                          <span className="ml-2 text-[11px] text-ink-faint">archived</span>
                        )}
                      </td>
                      <td className="truncate text-ink-dim">{customer.email ?? '—'}</td>
                      <td className="num text-ink-dim">{customer.phone ?? '—'}</td>
                      <td className="truncate text-ink-dim">
                        {addressLines(customer.billingAddress).join(', ') || '—'}
                      </td>
                      <td className="num whitespace-nowrap text-ink-faint">{formatDate(customer.createdAt)}</td>
                      <td className="right">
                        <Link className="btn btn-sm" href={`/customers/${customer.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(result.data.nextCursor || cursor) && (
              <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-ink-faint">
                <span>
                  Showing {result.data.items.length} of {result.data.total}
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
