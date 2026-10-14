import Link from 'next/link';
import type { Metadata } from 'next';
import { add, type CurrencyCode, type Money } from '@tradeflow/shared';
import { requireClient } from '@/lib/session';
import { load } from '@/lib/load';
import { listInvoices, listJobs, listQuotes } from '@/lib/resources';
import { businessDayRange, formatDate, formatDateRange } from '@/lib/format';
import type { Invoice, Job, Quote } from '@/lib/read-models';
import {
  Amount,
  EmptyState,
  ErrorPanel,
  PageHeader,
  Panel,
  QuoteStatusPill,
  JobStatusPill,
  InvoiceStatusPill,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Today' };

const UNSCHEDULED_LOOKBACK_DAYS = 180;
const UNSCHEDULED_LOOKAHEAD_DAYS = 365;

/**
 * Accepted quotes that have not become a job.
 *
 * The API does not filter on this and the Quote read model does not always say,
 * so the honest reading is: trust an explicit `jobCount`/`jobs` when it is there,
 * and otherwise ask the job feed which quotes already have a job. The window is
 * wide rather than correct — a job booked further out than a year would be missed
 * — which is why the explicit field is preferred when the API grows one.
 */
async function unscheduledAcceptedQuotes(
  client: Awaited<ReturnType<typeof requireClient>>,
  accepted: Quote[],
): Promise<Quote[]> {
  if (accepted.length === 0) return [];
  if (accepted.every((quote) => quote.hasJob !== null)) {
    return accepted.filter((quote) => quote.hasJob === false);
  }

  const now = Date.now();
  const jobs = await listJobs(client, {
    from: new Date(now - UNSCHEDULED_LOOKBACK_DAYS * 86_400_000).toISOString(),
    to: new Date(now + UNSCHEDULED_LOOKAHEAD_DAYS * 86_400_000).toISOString(),
    // Wide windows can hold more jobs than the default page, and a silently
    // truncated feed would report a scheduled quote as unscheduled.
    limit: 500,
  });
  const scheduledQuoteIds = new Set(jobs.map((job) => job.quote?.id).filter(Boolean));

  return accepted.filter((quote) =>
    quote.hasJob === null ? !scheduledQuoteIds.has(quote.id) : quote.hasJob === false,
  );
}

/** Unpaid, grouped by currency so a mixed book cannot be added up wrongly. */
function unpaidByCurrency(invoices: Invoice[]): { currency: CurrencyCode; total: Money }[] {
  const groups = new Map<CurrencyCode, Money>();
  for (const invoice of invoices) {
    const current = groups.get(invoice.amountDue.currency);
    groups.set(
      invoice.amountDue.currency,
      current ? add(current, invoice.amountDue) : invoice.amountDue,
    );
  }
  return Array.from(groups, ([currency, total]) => ({ currency, total })).sort((a, b) =>
    a.currency.localeCompare(b.currency),
  );
}

function JobRow({ job }: { job: Job }) {
  return (
    <tr>
      <td className="num whitespace-nowrap text-ink-dim">{formatDateRange(job.scheduledStart, job.scheduledEnd)}</td>
      <td>
        <Link className="link font-medium" href={`/jobs/${job.id}`}>
          {job.number}
        </Link>
      </td>
      <td className="truncate">{job.customer.name}</td>
      <td className="truncate text-ink-dim">{job.site?.label ?? '—'}</td>
      <td className="text-ink-dim">{job.assignee?.name ?? <span className="text-warn">Unassigned</span>}</td>
      <td className="right">
        <JobStatusPill status={job.status} />
      </td>
    </tr>
  );
}

export default async function DashboardPage() {
  const client = await requireClient();
  const { from, to } = businessDayRange();

  const [todayJobs, acceptedQuotes, invoices] = await Promise.all([
    load(() => listJobs(client, { from: from.toISOString(), to: to.toISOString() })),
    load(() => listQuotes(client, { status: 'ACCEPTED', limit: 50 })),
    load(() => listInvoices(client)),
  ]);

  const accepted = acceptedQuotes.ok ? acceptedQuotes.data.items : [];
  const unscheduled = acceptedQuotes.ok
    ? await load(() => unscheduledAcceptedQuotes(client, accepted))
    : ({ ok: false, problem: acceptedQuotes.problem } as const);

  const unpaid = invoices.ok ? invoices.data.filter((invoice) => invoice.status !== 'PAID' && invoice.status !== 'VOID') : [];
  const unpaidTotals = unpaidByCurrency(unpaid);

  const problems = [todayJobs, acceptedQuotes, invoices, unscheduled].filter(
    (result): result is { ok: false; problem: import('@tradeflow/shared').Problem } => !result.ok,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Today"
        subtitle={formatDate(from)}
        actions={
          <>
            <Link className="btn" href="/jobs">
              Calendar
            </Link>
            <Link className="btn btn-primary" href="/quotes/new">
              New quote
            </Link>
          </>
        }
      />

      {/* A partial page beats a blank one: each panel below still renders what it
          could load, and this names what it could not. */}
      {problems.length > 0 && (
        <div className="space-y-2">
          {problems.map((problem) => (
            <ErrorPanel
              key={problem.problem.code + problem.problem.message}
              title="Could not load part of this page"
              detail={`${problem.problem.code}: ${problem.problem.message}`}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" bodyClassName="p-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">
              Today&rsquo;s jobs
              {todayJobs.ok && (
                <span className="num ml-2 text-xs font-normal text-ink-faint">{todayJobs.data.length}</span>
              )}
            </h2>
            <Link className="text-xs text-ink-dim hover:text-accent" href="/jobs">
              All jobs →
            </Link>
          </div>
          {!todayJobs.ok ? (
            <div className="p-4">
              <ErrorPanel title="Today's jobs did not load" detail={todayJobs.problem.message} />
            </div>
          ) : todayJobs.data.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="Nothing booked for today"
                description="Accepted quotes waiting to be scheduled are on the right."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Job</th>
                    <th>Customer</th>
                    <th>Site</th>
                    <th>Engineer</th>
                    <th className="right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {todayJobs.data.map((job) => (
                    <JobRow key={job.id} job={job} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel bodyClassName="p-4">
            <h2 className="text-sm font-semibold text-ink">Unpaid</h2>
            {!invoices.ok ? (
              <p className="mt-2 text-xs text-bad">{invoices.problem.message}</p>
            ) : unpaid.length === 0 ? (
              <p className="mt-2 text-sm text-ink-faint">Everything is settled.</p>
            ) : (
              <>
                <div className="mt-2 space-y-1">
                  {unpaidTotals.map(({ currency, total }) => (
                    <p key={currency} className="text-2xl font-semibold tracking-tight text-ink">
                      <Amount value={total} strong />
                    </p>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  across {unpaid.length} {unpaid.length === 1 ? 'invoice' : 'invoices'}
                </p>
                <ul className="mt-3 space-y-1 border-t border-line pt-3">
                  {unpaid.slice(0, 5).map((invoice) => (
                    <li key={invoice.id} className="flex items-center justify-between gap-2 text-xs">
                      <Link className="link truncate" href={`/invoices/${invoice.id}`}>
                        {invoice.number} · {invoice.customer.name}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        <Amount value={invoice.amountDue} muted />
                        <InvoiceStatusPill status={invoice.status} />
                      </span>
                    </li>
                  ))}
                </ul>
                {unpaid.length > 5 && (
                  <Link className="mt-2 block text-xs text-ink-dim hover:text-accent" href="/invoices">
                    See all {unpaid.length} →
                  </Link>
                )}
              </>
            )}
          </Panel>
        </div>
      </div>

      <Panel bodyClassName="p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Accepted, not yet scheduled</h2>
            <p className="mt-0.5 text-xs text-ink-faint">
              The customer has said yes. Book an engineer to turn each one into a job.
            </p>
          </div>
          <Link className="text-xs text-ink-dim hover:text-accent" href="/quotes?status=ACCEPTED">
            All accepted →
          </Link>
        </div>

        {!unscheduled.ok ? (
          <div className="p-4">
            <ErrorPanel title="Accepted quotes did not load" detail={unscheduled.problem.message} />
          </div>
        ) : unscheduled.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Nothing waiting"
              description="When a customer accepts a quote it appears here until a job is booked against it."
              action={
                <Link className="btn btn-sm" href="/quotes">
                  Look at quotes
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
                  <th>Customer</th>
                  <th>Site</th>
                  <th className="right">Net</th>
                  <th className="right">Tax</th>
                  <th className="right">Gross</th>
                  <th>Valid until</th>
                  <th className="right">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {unscheduled.data.map((quote) => (
                  <tr key={quote.id}>
                    <td>
                      <Link className="link font-medium" href={`/quotes/${quote.id}`}>
                        {quote.number}
                      </Link>
                    </td>
                    <td className="truncate">{quote.customer.name}</td>
                    <td className="truncate text-ink-dim">{quote.site?.label ?? '—'}</td>
                    <td className="right">
                      <Amount value={quote.totals.net} muted />
                    </td>
                    <td className="right">
                      <Amount value={quote.totals.tax} muted />
                    </td>
                    <td className="right">
                      <Amount value={quote.totals.gross} strong />
                    </td>
                    <td className="num text-ink-dim">{formatDate(quote.validUntil)}</td>
                    <td className="right">
                      <QuoteStatusPill status={quote.status} />
                    </td>
                    <td className="right">
                      <Link className="btn btn-sm" href={`/quotes/${quote.id}#schedule`}>
                        Schedule
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Add something" description="The quickest way into each record." bodyClassName="p-4">
        <div className="flex flex-wrap gap-2">
          <Link className="btn" href="/customers?new=1">
            New customer
          </Link>
          <Link className="btn" href="/quotes/new">
            New quote
          </Link>
          <Link className="btn" href="/price-book">
            Price book
          </Link>
          <Link className="btn" href="/jobs">
            Job calendar
          </Link>
        </div>
      </Panel>
    </div>
  );
}
