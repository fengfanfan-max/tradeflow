import type { Metadata } from 'next';
import { publicQuoteSchema, format, type PublicQuote } from '@tradeflow/shared';
import { getPublicQuote } from '@/lib/resources';
import { publicQuoteDecisionAction } from '@/lib/actions/public';
import { firstParam, type RawSearchParams } from '@/lib/url';
import { ActionForm } from '@/components/action-form';

export const metadata: Metadata = {
  title: 'Your quote',
  robots: { index: false, follow: false },
};

// The token is the only key to this page, and the response must never be reused
// from a cache shared with another visitor. Explicit rather than inferred, so a
// future change to the fetches cannot quietly make a private quote static.
export const dynamic = 'force-dynamic';

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function date(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : DATE_FORMAT.format(parsed);
}

function percent(taxRateBp: number): string {
  const value = taxRateBp / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
}

/**
 * A page that is deliberately not the application.
 *
 * The customer prints it or saves it as a PDF, so it is white, set in a
 * document-like rhythm, and carries no navigation, no sign-in and no dark
 * chrome. It is a separate visual language from the tool the office uses, which
 * is why it does not reuse the app's components beyond `ActionForm`.
 *
 * The print button is a keyboard hint rather than a button: making one would
 * mean a third client component purely for `window.print()`.
 */
export default async function PublicQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const justDecided = firstParam(query, 'decision');

  let payload: unknown;
  let failed: string | null = null;
  try {
    payload = await getPublicQuote(token);
  } catch {
    failed = 'This link could not be opened. It may have been replaced by a newer version of the quote.';
    payload = null;
  }

  const parsed = publicQuoteSchema.safeParse(payload);
  const quote: PublicQuote | null = parsed.success ? parsed.data : null;

  if (!parsed.success && payload !== null) {
    // The contract is the source of truth and this page refuses to render a
    // half-read quote to a customer. But a schema that gained a required field
    // is the most likely cause, so the issue is logged where the office can see
    // it rather than only in the customer's browser.
    console.error(
      `[public quote] ${token} did not match publicQuoteSchema: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
    );
  }

  if (!quote) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-16">
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-lg font-semibold text-slate-900">This quote is not available</h1>
          <p className="mt-2 text-sm text-slate-600">
            {failed ??
              'The link did not return a quote the page could read. Ask the business to send it again.'}
          </p>
        </div>
      </main>
    );
  }

  const decided = quote.status === 'ACCEPTED' || quote.status === 'DECLINED';
  const awaitingDecision = quote.status === 'SENT';
  const expired = quote.status === 'EXPIRED';

  return (
    <main className="paper min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-10 sm:py-14">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
              {quote.businessName}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Quote</h1>
            <p className="mt-1 font-mono text-sm text-slate-600">{quote.quoteNumber}</p>
            {/* A UK quote must show the supplier's VAT number when they are
                registered, so it is printed next to the name or not at all. */}
            {quote.businessVatNumber && (
              <p className="mt-1 font-mono text-xs text-slate-500">VAT no. {quote.businessVatNumber}</p>
            )}
          </div>
          <dl className="text-right text-sm">
            <div>
              <dt className="text-xs tracking-wider text-slate-500 uppercase">Issued</dt>
              <dd className="font-mono text-slate-900">{date(quote.issuedAt)}</dd>
            </div>
            <div className="mt-2">
              <dt className="text-xs tracking-wider text-slate-500 uppercase">Valid until</dt>
              <dd className="font-mono text-slate-900">{date(quote.validUntil)}</dd>
            </div>
            <div className="mt-2">
              <dt className="text-xs tracking-wider text-slate-500 uppercase">Status</dt>
              <dd className="font-medium text-slate-900">
                {quote.status.charAt(0) + quote.status.slice(1).toLowerCase()}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs tracking-wider text-slate-500 uppercase">Prepared for</p>
            <p className="mt-1 font-medium text-slate-900">{quote.customerName}</p>
          </div>
          <div>
            <p className="text-xs tracking-wider text-slate-500 uppercase">Where</p>
            <p className="mt-1 font-medium text-slate-900">{quote.siteLabel}</p>
            {quote.siteAddress && <p className="text-sm text-slate-600">{quote.siteAddress}</p>}
          </div>
        </div>

        {/* `keep-together` and the table header group are for the print path:
            a line must not be split from its own figures, and the column
            headings must repeat on a second sheet. */}
        <table className="keep-together w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs tracking-wider text-slate-500 uppercase">
              <th className="py-2 pr-3 font-semibold">Description</th>
              <th className="py-2 pr-3 text-right font-semibold">Qty</th>
              <th className="py-2 pr-3 text-right font-semibold">Unit</th>
              <th className="py-2 pr-3 text-right font-semibold">VAT</th>
              <th className="py-2 text-right font-semibold">Net</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((line, index) => (
              <tr key={`${line.description}-${index}`} className="border-b border-slate-200 align-top">
                <td className="py-2.5 pr-3 text-slate-900">{line.description}</td>
                <td className="py-2.5 pr-3 text-right font-mono text-slate-700">{line.quantity}</td>
                <td className="py-2.5 pr-3 text-right font-mono text-slate-700">{format(line.unitPrice)}</td>
                <td className="py-2.5 pr-3 text-right font-mono text-slate-500">{percent(line.taxRateBp)}</td>
                <td className="py-2.5 text-right font-mono text-slate-900">{format(line.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="keep-together mt-6 flex justify-end">
          <dl className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Net</dt>
              <dd className="font-mono text-slate-900">{format(quote.net)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">VAT</dt>
              <dd className="font-mono text-slate-900">{format(quote.tax)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-1.5">
              <dt className="font-semibold text-slate-900">Total</dt>
              <dd className="font-mono text-base font-semibold text-slate-900">{format(quote.gross)}</dd>
            </div>
          </dl>
        </div>

        {quote.notes && (
          <div className="keep-together mt-10 border-t border-slate-200 pt-4">
            <p className="text-xs tracking-wider text-slate-500 uppercase">Notes</p>
            <p className="mt-1 text-sm whitespace-pre-line text-slate-700">{quote.notes}</p>
          </div>
        )}

        {/* ---------------------------------------------------- decision */}
        <div className="no-print mt-10 border-t border-slate-200 pt-6">
          {justDecided && (
            <div
              className={`keep-together mb-6 rounded-md border p-4 ${
                justDecided === 'ACCEPTED'
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-300 bg-slate-50'
              }`}
              role="status"
            >
              <p className="font-medium text-slate-900">
                {justDecided === 'ACCEPTED' ? 'Thank you — the quote is accepted.' : 'The quote has been declined.'}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {justDecided === 'ACCEPTED'
                  ? 'The business has been told and will be in touch to arrange the work.'
                  : 'The business has been told and will not book the work.'}
              </p>
            </div>
          )}

          {decided && !justDecided && (
            <p className="text-sm text-slate-600">
              This quote has been{' '}
              <strong className="text-slate-900">{quote.status.toLowerCase()}</strong>. Nothing further to do here.
            </p>
          )}

          {expired && !justDecided && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
              <p className="font-medium text-slate-900">This quote has expired.</p>
              <p className="mt-1 text-sm text-slate-600">
                Prices are only held for a limited time. Ask {quote.businessName} for an updated quote.
              </p>
            </div>
          )}

          {awaitingDecision && (
            <ActionForm
              action={publicQuoteDecisionAction}
              submitLabel="Accept this quote"
              pendingLabel="Sending…"
              submitName="decision"
              submitValue="ACCEPTED"
              submitClassName="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
              className="space-y-4"
              hiddenValues={{ token }}
              footer={
                <button
                  type="submit"
                  name="decision"
                  value="DECLINED"
                  className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Decline
                </button>
              }
            >
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="note">
                  Anything to add? (optional)
                </label>
                <textarea
                  id="note"
                  name="note"
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                  placeholder="Access details, a preferred date, or anything else."
                />
              </div>
              <p className="text-xs text-slate-500">
                Accepting tells {quote.businessName} to go ahead. They will confirm a date before starting.
              </p>
            </ActionForm>
          )}
        </div>

        <p className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-400">
          To keep a copy, use your browser&rsquo;s print dialog and choose &ldquo;Save as PDF&rdquo;.
        </p>
      </div>
    </main>
  );
}
