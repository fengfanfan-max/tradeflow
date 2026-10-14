import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError } from '@/lib/api';
import { requireClient } from '@/lib/session';
import { load } from '@/lib/load';
import { getCustomer, listInvoices, listJobs, listQuotes } from '@/lib/resources';
import { archiveCustomerAction, createSiteAction, updateCustomerAction } from '@/lib/actions/customers';
import { buildHref, firstParam, type RawSearchParams } from '@/lib/url';
import { formatDate, formatDateRange } from '@/lib/format';
import { addressLines, siteAddressLine } from '@/lib/read-models';
import { ActionForm } from '@/components/action-form';
import {
  Amount,
  Detail,
  EmptyState,
  ErrorPanel,
  Field,
  InvoiceStatusPill,
  JobStatusPill,
  PageHeader,
  Panel,
  QuoteStatusPill,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Customer' };

/** Jobs cannot be filtered by customer, so the feed is read and narrowed here. */
const JOB_WINDOW_DAYS = 400;

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const client = await requireClient();

  const customer = await load(() => getCustomer(client, id));
  if (!customer.ok && customer.problem.code === 'NOT_FOUND') notFound();
  if (!customer.ok) {
    return (
      <ErrorPanel
        title="This customer did not load"
        detail={`${customer.problem.code}: ${customer.problem.message}`}
        retry={
          <Link className="btn btn-sm" href="/customers">
            Back to customers
          </Link>
        }
      />
    );
  }

  const record = customer.data;
  const now = Date.now();

  const [quotes, invoices, jobs] = await Promise.all([
    load(() => listQuotes(client, { customerId: id, limit: 20 })),
    load(() => listInvoices(client, { customerId: id })),
    load(() =>
      listJobs(client, {
        from: new Date(now - JOB_WINDOW_DAYS * 86_400_000).toISOString(),
        to: new Date(now + JOB_WINDOW_DAYS * 86_400_000).toISOString(),
        limit: 500,
      }),
    ),
  ]);

  const customerJobs = jobs.ok ? jobs.data.filter((job) => job.customer.id === id) : [];

  const editing = firstParam(query, 'edit') === '1';
  const addingSite = firstParam(query, 'site') === '1';
  const hrefFor = (patch: Record<string, string | null>) => buildHref(`/customers/${id}`, query, patch);

  const billing = addressLines(record.billingAddress);

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={[{ label: 'Customers', href: '/customers' }]}
        title={record.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {record.email && <span>{record.email}</span>}
            {record.phone && <span className="num">{record.phone}</span>}
            {record.archivedAt && <span className="text-warn">Archived {formatDate(record.archivedAt)}</span>}
          </span>
        }
        actions={
          <>
            <Link className="btn" href={hrefFor({ edit: editing ? null : '1' })}>
              {editing ? 'Cancel' : 'Edit'}
            </Link>
            <Link className="btn btn-primary" href={`/quotes/new?customerId=${id}`}>
              New quote
            </Link>
          </>
        }
      />

      {editing && (
        <Panel title="Edit customer">
          <ActionForm action={updateCustomerAction} submitLabel="Save customer" hiddenValues={{ id }}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="name" required>
                <input id="name" name="name" className="control" defaultValue={record.name} required maxLength={200} />
              </Field>
              <Field label="Email" htmlFor="email">
                <input id="email" name="email" type="email" className="control" defaultValue={record.email ?? ''} />
              </Field>
              <Field label="Phone" htmlFor="phone">
                <input id="phone" name="phone" className="control" defaultValue={record.phone ?? ''} maxLength={40} />
              </Field>
              <div />
              <Field label="Billing line 1" htmlFor="billingLine1">
                <input id="billingLine1" name="billingLine1" className="control" defaultValue={record.billingAddress.line1 ?? ''} maxLength={200} />
              </Field>
              <Field label="Billing line 2" htmlFor="billingLine2">
                <input id="billingLine2" name="billingLine2" className="control" defaultValue={record.billingAddress.line2 ?? ''} maxLength={200} />
              </Field>
              <Field label="City" htmlFor="billingCity">
                <input id="billingCity" name="billingCity" className="control" defaultValue={record.billingAddress.city ?? ''} maxLength={120} />
              </Field>
              <Field label="Postcode" htmlFor="billingPostcode">
                <input id="billingPostcode" name="billingPostcode" className="control" defaultValue={record.billingAddress.postcode ?? ''} maxLength={20} />
              </Field>
            </div>
            <Field label="Notes" htmlFor="notes">
              <textarea id="notes" name="notes" className="control min-h-20" defaultValue={record.notes ?? ''} maxLength={2000} />
            </Field>
          </ActionForm>

          <div className="mt-4 border-t border-line pt-4">
            <ActionForm
              action={archiveCustomerAction}
              submitLabel="Archive customer"
              pendingLabel="Archiving…"
              submitClassName="btn btn-danger btn-sm"
              confirmText="Archive this customer? Their history is kept, but they disappear from pickers."
              hiddenValues={{ id }}
            >
              <p className="text-xs text-ink-faint">
                Archiving hides the customer from pickers without deleting their quotes, jobs or invoices.
              </p>
            </ActionForm>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Details" className="lg:col-span-1">
          <dl className="space-y-4">
            <Detail label="Email">{record.email ?? '—'}</Detail>
            <Detail label="Phone">
              <span className="num">{record.phone ?? '—'}</span>
            </Detail>
            <Detail label="Billing address">
              {billing.length > 0 ? (
                <address className="not-italic">{billing.map((line) => <span key={line} className="block">{line}</span>)}</address>
              ) : (
                '—'
              )}
            </Detail>
            <Detail label="Customer since">
              <span className="num">{formatDate(record.createdAt)}</span>
            </Detail>
            {record.notes && <Detail label="Notes">{record.notes}</Detail>}
          </dl>
        </Panel>

        <Panel
          className="lg:col-span-2"
          title="Sites"
          description="Where the work happens. A quote and a job are always booked against a site."
          actions={
            <Link className="btn btn-sm" href={hrefFor({ site: addingSite ? null : '1' })}>
              {addingSite ? 'Cancel' : 'Add site'}
            </Link>
          }
        >
          {addingSite && (
            <div className="mb-4 rounded-md border border-line bg-inset p-3">
              <ActionForm action={createSiteAction} submitLabel="Add site" hiddenValues={{ customerId: id }} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Label" htmlFor="label" required hint="e.g. “14 Alma Road” or “Unit 3, Bell Yard”.">
                    <input id="label" name="label" className="control" required maxLength={120} />
                  </Field>
                  <Field label="Access notes" htmlFor="accessNotes" hint="Gate codes, parking, key safe.">
                    <input id="accessNotes" name="accessNotes" className="control" maxLength={1000} />
                  </Field>
                  <Field label="Line 1" htmlFor="line1" required>
                    <input id="line1" name="line1" className="control" required maxLength={200} />
                  </Field>
                  <Field label="Line 2" htmlFor="line2">
                    <input id="line2" name="line2" className="control" maxLength={200} />
                  </Field>
                  <Field label="City" htmlFor="city" required>
                    <input id="city" name="city" className="control" required maxLength={120} />
                  </Field>
                  <Field label="Postcode" htmlFor="postcode" required>
                    <input id="postcode" name="postcode" className="control" required maxLength={20} />
                  </Field>
                </div>
              </ActionForm>
            </div>
          )}

          {record.sites.length === 0 ? (
            <EmptyState
              title="No sites yet"
              description="A quote cannot be raised for this customer until at least one site exists."
            />
          ) : (
            <ul className="divide-y divide-line">
              {record.sites.map((site) => (
                <li key={site.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{site.label}</p>
                    <p className="text-xs text-ink-dim">{siteAddressLine(site) || '—'}</p>
                    {site.accessNotes && <p className="mt-1 text-xs text-warn">{site.accessNotes}</p>}
                  </div>
                  <span className="num shrink-0 text-[11px] text-ink-faint">{site.id.slice(0, 8)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Quotes"
        actions={
          <Link className="text-xs text-ink-dim hover:text-accent" href={`/quotes?customerId=${id}`}>
            Filtered list →
          </Link>
        }
        bodyClassName="p-0"
      >
        {!quotes.ok ? (
          <div className="p-4">
            <ErrorPanel title="Quotes did not load" detail={quotes.problem.message} />
          </div>
        ) : quotes.data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No quotes"
              action={
                <Link className="btn btn-sm btn-primary" href={`/quotes/new?customerId=${id}`}>
                  New quote
                </Link>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Quote</th>
                  <th className="right">Net</th>
                  <th className="right">Tax</th>
                  <th className="right">Gross</th>
                  <th>Valid until</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {quotes.data.items.map((quote) => (
                  <tr key={quote.id}>
                    <td>
                      <Link className="link font-medium" href={`/quotes/${quote.id}`}>
                        {quote.number}
                      </Link>
                    </td>
                    <td className="right"><Amount value={quote.totals.net} muted /></td>
                    <td className="right"><Amount value={quote.totals.tax} muted /></td>
                    <td className="right"><Amount value={quote.totals.gross} strong /></td>
                    <td className="num text-ink-dim">{formatDate(quote.validUntil)}</td>
                    <td className="right"><QuoteStatusPill status={quote.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Jobs" bodyClassName="p-0">
        {!jobs.ok ? (
          <div className="p-4">
            <ErrorPanel title="Jobs did not load" detail={jobs.problem.message} />
          </div>
        ) : customerJobs.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No jobs" description="A job is created from an accepted quote." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>When</th>
                  <th>Site</th>
                  <th>Engineer</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {customerJobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <Link className="link font-medium" href={`/jobs/${job.id}`}>
                        {job.number}
                      </Link>
                    </td>
                    <td className="num whitespace-nowrap text-ink-dim">
                      {formatDateRange(job.scheduledStart, job.scheduledEnd)}
                    </td>
                    <td className="truncate text-ink-dim">{job.site?.label ?? '—'}</td>
                    <td className="text-ink-dim">{job.assignee?.name ?? '—'}</td>
                    <td className="right"><JobStatusPill status={job.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Invoices"
        actions={
          <Link className="text-xs text-ink-dim hover:text-accent" href={`/invoices?customerId=${id}`}>
            Filtered list →
          </Link>
        }
        bodyClassName="p-0"
      >
        {!invoices.ok ? (
          <div className="p-4">
            <ErrorPanel title="Invoices did not load" detail={invoices.problem.message} />
          </div>
        ) : invoices.data.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No invoices" description="An invoice is raised from a completed job." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th className="right">Gross</th>
                  <th className="right">Due</th>
                  <th>Due date</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.data.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link className="link font-medium" href={`/invoices/${invoice.id}`}>
                        {invoice.number}
                      </Link>
                    </td>
                    <td className="right"><Amount value={invoice.totals.gross} muted /></td>
                    <td className="right"><Amount value={invoice.amountDue} strong /></td>
                    <td className="num text-ink-dim">{formatDate(invoice.dueAt)}</td>
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
