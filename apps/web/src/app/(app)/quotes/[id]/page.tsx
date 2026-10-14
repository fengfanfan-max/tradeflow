import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError } from '@/lib/api';
import { requireClient } from '@/lib/session';
import { load } from '@/lib/load';
import { getQuote, listJobs, listPriceBook } from '@/lib/resources';
import { assignableEngineers } from '@/lib/roster';
import { createJobFromQuoteAction, decideQuoteAction, loadSitesAction, saveQuoteAction, sendQuoteAction } from '@/lib/actions/quotes';
import { draftQuoteAction } from '@/lib/actions/ai';
import { firstParam, type RawSearchParams } from '@/lib/url';
import { addBusinessDays, formatDate, formatDateTime, toIsoDate } from '@/lib/format';
import { siteAddressLine, type Quote } from '@/lib/read-models';
import type { QuoteDraft } from '@/lib/quote-draft';
import { ActionForm } from '@/components/action-form';
import { QuoteBuilder } from '@/components/quote-builder';
import {
  Detail,
  ErrorPanel,
  Field,
  Flash,
  Notice,
  PageHeader,
  Panel,
  QuoteStatusPill,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Quote' };

const JOB_WINDOW_DAYS = 400;

/** The stored read model, back in the shape the builder edits. */
function draftFrom(quote: Quote): QuoteDraft {
  return {
    customerId: quote.customer.id,
    siteId: quote.site?.id ?? '',
    currency: quote.currency,
    validForDays: 30,
    notes: quote.notes ?? '',
    lines: quote.lines.map((line) => ({
      ...(line.priceBookItemId ? { priceBookItemId: line.priceBookItemId } : {}),
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRateBp: line.taxRateBp,
    })),
  };
}

/** A public link is a URL; this keeps only the part the operator recognises. */
function tokenFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = /\/q\/([^/?#]+)/.exec(url);
  return match?.[1] ?? null;
}

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const client = await requireClient();

  const result = await load(() => getQuote(client, id));
  if (!result.ok && result.problem.code === 'NOT_FOUND') notFound();
  if (!result.ok) {
    return (
      <ErrorPanel
        title="This quote did not load"
        detail={`${result.problem.code}: ${result.problem.message}`}
        retry={
          <Link className="btn btn-sm" href="/quotes">
            Back to quotes
          </Link>
        }
      />
    );
  }

  const quote = result.data;
  const isDraft = quote.status === 'DRAFT';
  const needsScheduling = quote.status === 'ACCEPTED';

  const now = Date.now();
  const [priceBook, jobs] = await Promise.all([
    isDraft ? load(() => listPriceBook(client, { active: true })) : Promise.resolve({ ok: true as const, data: [] }),
    load(() =>
      listJobs(client, {
        from: new Date(now - JOB_WINDOW_DAYS * 86_400_000).toISOString(),
        to: new Date(now + JOB_WINDOW_DAYS * 86_400_000).toISOString(),
        limit: 500,
      }),
    ),
  ]);

  const jobList = jobs.ok ? jobs.data : [];
  const existingJobs = jobList.filter((job) => job.quote?.id === quote.id);
  const engineers = needsScheduling ? await assignableEngineers(client, jobList) : [];

  // `toIsoDate`, not `toISOString().slice(0, 10)`: a London midnight in summer is
  // 23:00 UTC the day before, so slicing the ISO string would pre-fill the
  // booking form with yesterday — which is what it did until this was fixed.
  const defaultDate = toIsoDate(addBusinessDays(new Date(), 1));
  const sent = firstParam(query, 'sent') === '1';
  const publicToken = tokenFromUrl(quote.publicUrl);

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={[{ label: 'Quotes', href: '/quotes' }]}
        title={
          <span className="flex items-center gap-3">
            {quote.number}
            <QuoteStatusPill status={quote.status} />
            {isDraft && <span className="num text-xs font-normal text-ink-faint">v{quote.version}</span>}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link className="link underline decoration-line-strong" href={`/customers/${quote.customer.id}`}>
              {quote.customer.name}
            </Link>
            <span className="text-ink-faint">·</span>
            <span>{quote.site?.label ?? 'No site'}</span>
            {quote.site && siteAddressLine(quote.site) && (
              <span className="text-ink-faint">{siteAddressLine(quote.site)}</span>
            )}
          </span>
        }
        actions={
          <>
            {isDraft && (
              <ActionForm
                action={sendQuoteAction}
                submitLabel="Send to customer"
                pendingLabel="Sending…"
                className=""
                hiddenValues={{ id: quote.id }}
                confirmText="Send this quote? A new public accept link is generated and the previous one stops working."
              />
            )}
            {quote.customer.id && (
              <Link className="btn" href={`/customers/${quote.customer.id}`}>
                Customer
              </Link>
            )}
          </>
        }
      />

      {sent && (
        <Flash>
          Quote sent. The customer&rsquo;s accept link is below — send it however you normally reach them.
        </Flash>
      )}

      {publicToken && (
        <Panel title="Customer accept link" bodyClassName="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <code className="num min-w-0 flex-1 truncate rounded-md border border-line-strong bg-inset px-3 py-2 text-xs text-ink">
              {quote.publicUrl}
            </code>
            <Link className="btn btn-sm" href={`/q/${publicToken}`} target="_blank" rel="noreferrer">
              Open
            </Link>
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            No login required. Re-sending rotates this token, so an old link stops working.
          </p>
        </Panel>
      )}

      <QuoteBuilder
        mode="edit"
        status={quote.status}
        currency={quote.currency}
        customers={[{ id: quote.customer.id, name: quote.customer.name }]}
        priceBook={priceBook.ok ? priceBook.data : []}
        initial={draftFrom(quote)}
        initialSites={quote.site ? [quote.site] : []}
        quoteId={quote.id}
        expectedVersion={quote.version}
        saveAction={saveQuoteAction}
        draftAction={draftQuoteAction}
        loadSitesAction={loadSitesAction}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Record">
          <dl className="space-y-4">
            <Detail label="Issued">
              <span className="num">{formatDateTime(quote.issuedAt)}</span>
            </Detail>
            <Detail label="Valid until">
              <span className="num">{formatDate(quote.validUntil)}</span>
            </Detail>
            <Detail label="Decided">
              <span className="num">{formatDateTime(quote.decidedAt)}</span>
            </Detail>
            <Detail label="Version">
              <span className="num">{quote.version}</span>
            </Detail>
            <Detail label="Effective VAT rate">
              <span className="num">{(quote.totals.effectiveTaxRateBp / 100).toFixed(2)}%</span>
            </Detail>
          </dl>
        </Panel>

        <div className="space-y-4">
          {quote.status === 'SENT' && (
            <Panel
              title="Record the customer's answer"
              description="For a decision taken over the phone or in person."
            >
              <ActionForm action={decideQuoteAction} submitLabel="Record decision" hiddenValues={{ id: quote.id }}>
                <Field label="Decision" htmlFor="decision" required>
                  <select id="decision" name="decision" className="control" defaultValue="ACCEPTED">
                    <option value="ACCEPTED">Accepted</option>
                    <option value="DECLINED">Declined</option>
                  </select>
                </Field>
                <Field label="Note" htmlFor="note" hint="Who said what, and when.">
                  <input id="note" name="note" className="control" maxLength={1000} />
                </Field>
              </ActionForm>
            </Panel>
          )}

          {needsScheduling && existingJobs.length === 0 && (
            <Panel
              id="schedule"
              title="Turn this into a job"
              description="Book the engineer. A job can only be created from an accepted quote."
            >
              {engineers.length === 0 && (
                <div className="mb-3">
                  <Notice tone="warn" title="No engineers to choose from">
                    Assigning is optional, but nothing will show a name until the app can list users.
                  </Notice>
                </div>
              )}
              <ActionForm
                action={createJobFromQuoteAction}
                submitLabel="Create job"
                pendingLabel="Booking…"
                hiddenValues={{ quoteId: quote.id }}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Date" htmlFor="date" required className="sm:col-span-3">
                    <input id="date" name="date" type="date" className="control" defaultValue={defaultDate} required />
                  </Field>
                  <Field label="Start" htmlFor="startTime" required>
                    <input id="startTime" name="startTime" type="time" className="control" defaultValue="09:00" required />
                  </Field>
                  <Field label="Finish" htmlFor="endTime" required>
                    <input id="endTime" name="endTime" type="time" className="control" defaultValue="17:00" required />
                  </Field>
                  <Field label="Engineer" htmlFor="assigneeId">
                    <select id="assigneeId" name="assigneeId" className="control" defaultValue="">
                      <option value="">Unassigned</option>
                      {engineers.map((engineer) => (
                        <option key={engineer.id} value={engineer.id}>
                          {engineer.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Notes" htmlFor="jobNotes" hint="Anything the engineer needs before arriving.">
                  <textarea id="jobNotes" name="notes" className="control min-h-16" maxLength={2000} />
                </Field>
              </ActionForm>
            </Panel>
          )}

          {existingJobs.length > 0 && (
            <Panel title="Jobs from this quote" bodyClassName="p-4">
              <ul className="space-y-2">
                {existingJobs.map((job) => (
                  <li key={job.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link className="link font-medium" href={`/jobs/${job.id}`}>
                      {job.number}
                    </Link>
                    <span className="num text-xs text-ink-dim">
                      {formatDateTime(job.scheduledStart)} · {job.assignee?.name ?? 'Unassigned'}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {quote.status === 'DECLINED' && (
            <Panel title="Declined">
              <p className="text-sm text-ink-dim">
                This quote was declined. Copy it as a new draft if the customer wants to negotiate.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
