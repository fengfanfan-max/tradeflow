import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireClient } from '@/lib/session';
import { load } from '@/lib/load';
import { getJob, getQuote, listInvoices, listJobs } from '@/lib/resources';
import type { ApiClient } from '@/lib/api';
import { assignableEngineers } from '@/lib/roster';
import { changeJobStatusAction, scheduleJobAction } from '@/lib/actions/jobs';
import { createInvoiceAction } from '@/lib/actions/invoices';
import { formatDate, formatDateTime, formatDuration, toZonedInputValue } from '@/lib/format';
import { siteAddressLine } from '@/lib/read-models';
import { ActionForm } from '@/components/action-form';
import {
  Amount,
  Detail,
  EmptyState,
  ErrorPanel,
  Field,
  InvoiceStatusPill,
  JobStatusPill,
  Notice,
  PageHeader,
  Panel,
  taxRateLabel,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Job' };

/**
 * The roster's fallback source.
 *
 * `/jobs` is the only feed that carries assignee names, so a wide window of it
 * is read to answer "who has been booked before" when the API exposes no users
 * endpoint. See `assignableEngineers`.
 */
async function listJobsForRoster(client: ApiClient) {
  const now = Date.now();
  return listJobs(client, {
    from: new Date(now - 400 * 86_400_000).toISOString(),
    to: new Date(now + 400 * 86_400_000).toISOString(),
    limit: 500,
  });
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await requireClient();

  const result = await load(() => getJob(client, id));
  if (!result.ok && result.problem.code === 'NOT_FOUND') notFound();
  if (!result.ok) {
    return (
      <ErrorPanel
        title="This job did not load"
        detail={`${result.problem.code}: ${result.problem.message}`}
        retry={
          <Link className="btn btn-sm" href="/jobs">
            Back to jobs
          </Link>
        }
      />
    );
  }

  const job = result.data;

  const [quote, invoices, allJobs] = await Promise.all([
    job.quote ? load(() => getQuote(client, job.quote!.id)) : Promise.resolve({ ok: true as const, data: null }),
    load(() => listInvoices(client)),
    load(() => listJobsForRoster(client)),
  ]);

  const jobInvoices = invoices.ok ? invoices.data.filter((invoice) => invoice.job?.id === job.id) : [];
  const engineers = await assignableEngineers(client, allJobs.ok ? allJobs.data : []);
  const alreadyInvoiced = jobInvoices.some((invoice) => invoice.status !== 'VOID');

  const canComplete = job.status === 'SCHEDULED' || job.status === 'IN_PROGRESS';

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={[{ label: 'Jobs', href: '/jobs' }]}
        title={
          <span className="flex items-center gap-3">
            {job.number}
            <JobStatusPill status={job.status} />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link className="link underline decoration-line-strong" href={`/customers/${job.customer.id}`}>
              {job.customer.name}
            </Link>
            <span className="text-ink-faint">·</span>
            <span>{job.site?.label ?? 'No site'}</span>
            {job.site && siteAddressLine(job.site) && <span className="text-ink-faint">{siteAddressLine(job.site)}</span>}
          </span>
        }
        actions={
          job.quote ? (
            <Link className="btn" href={`/quotes/${job.quote.id}`}>
              Quote {job.quote.number}
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Schedule" description="Moving a job needs the version you loaded — a clash is refused, not overwritten.">
          <ActionForm
            action={scheduleJobAction}
            submitLabel="Save schedule"
            pendingLabel="Saving…"
            reloadHref={`/jobs/${job.id}`}
            hiddenValues={{ id: job.id, expectedVersion: String(job.version) }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Date" htmlFor="date" required className="sm:col-span-3">
                <input
                  id="date"
                  name="date"
                  type="date"
                  className="control"
                  required
                  defaultValue={toZonedInputValue(job.scheduledStart).slice(0, 10)}
                />
              </Field>
              <Field label="Start" htmlFor="startTime" required>
                <input
                  id="startTime"
                  name="startTime"
                  type="time"
                  className="control"
                  required
                  defaultValue={toZonedInputValue(job.scheduledStart).slice(11, 16)}
                />
              </Field>
              <Field label="Finish" htmlFor="endTime" required>
                <input
                  id="endTime"
                  name="endTime"
                  type="time"
                  className="control"
                  required
                  defaultValue={toZonedInputValue(job.scheduledEnd).slice(11, 16)}
                />
              </Field>
              <Field label="Engineer" htmlFor="assigneeId">
                <select id="assigneeId" name="assigneeId" className="control" defaultValue={job.assignee?.id ?? ''}>
                  <option value="">Unassigned</option>
                  {engineers.map((engineer) => (
                    <option key={engineer.id} value={engineer.id}>
                      {engineer.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </ActionForm>
        </Panel>

        <Panel title="At a glance">
          <dl className="space-y-4">
            <Detail label="Starts">
              <span className="num">{formatDateTime(job.scheduledStart)}</span>
            </Detail>
            <Detail label="Ends">
              <span className="num">{formatDateTime(job.scheduledEnd)}</span>
            </Detail>
            <Detail label="Booked for">
              <span className="num">{formatDuration(job.scheduledStart, job.scheduledEnd)}</span>
            </Detail>
            <Detail label="Engineer">{job.assignee?.name ?? <span className="text-warn">Unassigned</span>}</Detail>
            <Detail label="Version">
              <span className="num">{job.version}</span>
            </Detail>
          </dl>
          {job.site?.accessNotes && (
            <div className="mt-4">
              <Notice tone="warn" title="Access notes">
                {job.site.accessNotes}
              </Notice>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Status"
          description="Every change is appended to the job's history, in the same transaction as the status itself."
        >
          <ActionForm
            action={changeJobStatusAction}
            submitLabel="Record status"
            pendingLabel="Recording…"
            hiddenValues={{ id: job.id }}
          >
            <Field label="New status" htmlFor="status" required>
              <select id="status" name="status" className="control" defaultValue={job.status}>
                <option value="SCHEDULED">Scheduled</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </Field>
            <Field
              label="Completion summary"
              htmlFor="completionSummary"
              required={canComplete}
              hint="Required to complete: it becomes the narrative on the invoice."
            >
              <textarea
                id="completionSummary"
                name="completionSummary"
                className="control min-h-20"
                maxLength={2000}
                defaultValue={job.completionSummary ?? ''}
              />
            </Field>
            <Field label="Note" htmlFor="note" hint="Internal — why the status changed.">
              <input id="note" name="note" className="control" maxLength={1000} />
            </Field>
          </ActionForm>
        </Panel>

        <Panel title="History" bodyClassName="p-4">
          {job.statusEvents.length === 0 ? (
            <p className="text-sm text-ink-faint">No recorded changes yet.</p>
          ) : (
            <ol className="space-y-3">
              {job.statusEvents.map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      {event.fromStatus ? `${event.fromStatus} → ` : ''}
                      <span className="font-medium">{event.toStatus}</span>
                    </p>
                    <p className="num text-xs text-ink-faint">
                      {formatDateTime(event.createdAt)}
                      {event.actor ? ` · ${event.actor.name}` : ''}
                    </p>
                    {event.note && <p className="mt-0.5 text-xs text-ink-dim">{event.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {quote.ok && quote.data && (
        <Panel title={`Work quoted on ${quote.data.number}`} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="right">Qty</th>
                  <th className="right">Unit</th>
                  <th className="right">VAT</th>
                  <th className="right">Net</th>
                  <th className="right">Tax</th>
                  <th className="right">Gross</th>
                </tr>
              </thead>
              <tbody>
                {quote.data.lines.map((line, index) => (
                  <tr key={line.id ?? index}>
                    <td>{line.description}</td>
                    <td className="num right">{line.quantity}</td>
                    <td className="right"><Amount value={line.unitPrice} muted /></td>
                    <td className="num right text-ink-faint">{taxRateLabel(line.taxRateBp)}</td>
                    <td className="right"><Amount value={line.net} /></td>
                    <td className="right"><Amount value={line.tax} muted /></td>
                    <td className="right"><Amount value={line.gross} strong /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="text-right text-xs tracking-wider text-ink-faint uppercase">
                    Totals
                  </td>
                  <td className="right"><Amount value={quote.data.totals.net} strong /></td>
                  <td className="right"><Amount value={quote.data.totals.tax} strong /></td>
                  <td className="right"><Amount value={quote.data.totals.gross} strong /></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {job.completionSummary && (
            <div className="border-t border-line px-4 py-3">
              <p className="text-[11px] font-semibold tracking-wider text-ink-faint uppercase">Completion summary</p>
              <p className="mt-1 text-sm text-ink">{job.completionSummary}</p>
            </div>
          )}
        </Panel>
      )}

      <Panel
        title="Invoices"
        description="An invoice can only be raised from a completed job, and its lines are snapshotted at that moment."
        bodyClassName="p-0"
      >
        {!invoices.ok ? (
          <div className="p-4">
            <ErrorPanel title="Invoices did not load" detail={invoices.problem.message} />
          </div>
        ) : jobInvoices.length === 0 ? (
          <div className="p-4">
            {job.status !== 'COMPLETED' ? (
              <Notice tone="warn" title="Not billable yet">
                Mark the job complete with a summary before raising an invoice.
              </Notice>
            ) : (
              <EmptyState title="No invoice raised yet" description="Raise one below; the lines are taken from the job." />
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th className="right">Gross</th>
                  <th className="right">Deposit</th>
                  <th className="right">Due</th>
                  <th>Due date</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {jobInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link className="link font-medium" href={`/invoices/${invoice.id}`}>
                        {invoice.number}
                      </Link>
                    </td>
                    <td className="right"><Amount value={invoice.totals.gross} muted /></td>
                    <td className="right"><Amount value={invoice.depositAmount} muted /></td>
                    <td className="right"><Amount value={invoice.amountDue} strong /></td>
                    <td className="num text-ink-dim">{formatDate(invoice.dueAt)}</td>
                    <td className="right"><InvoiceStatusPill status={invoice.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {job.status === 'COMPLETED' && !alreadyInvoiced && (
          <div className="border-t border-line p-4">
            <h3 className="text-sm font-semibold text-ink">Raise an invoice</h3>
            <p className="mt-0.5 mb-3 text-xs text-ink-faint">
              Amounts come from the job. A deposit already taken is deducted from the amount due.
            </p>
            <ActionForm
              action={createInvoiceAction}
              submitLabel="Raise invoice"
              pendingLabel="Raising…"
              hiddenValues={{ jobId: job.id }}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Payment terms (days)" htmlFor="dueInDays" required>
                  <input
                    id="dueInDays"
                    name="dueInDays"
                    type="number"
                    min={0}
                    max={365}
                    className="control num"
                    defaultValue={14}
                    required
                  />
                </Field>
                <Field label="Deposit already taken" htmlFor="depositAmount" hint="Optional. Leave blank if none.">
                  <input id="depositAmount" name="depositAmount" inputMode="decimal" className="control num" placeholder="0.00" />
                </Field>
              </div>
            </ActionForm>
          </div>
        )}
      </Panel>
    </div>
  );
}
