import Link from 'next/link';
import type { Metadata } from 'next';
import { requireClient } from '@/lib/session';
import { load, loadedValue } from '@/lib/load';
import { listCustomers, listPriceBook } from '@/lib/resources';
import { loadSitesAction, saveQuoteAction } from '@/lib/actions/quotes';
import { draftQuoteAction } from '@/lib/actions/ai';
import { firstParam, type RawSearchParams } from '@/lib/url';
import { emptyDraft } from '@/lib/quote-draft';
import { QuoteBuilder } from '@/components/quote-builder';
import { ErrorPanel, PageHeader, Panel } from '@/components/ui';

export const metadata: Metadata = { title: 'New quote' };

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const preselectedCustomer = firstParam(params, 'customerId');

  const client = await requireClient();
  const [customers, priceBook] = await Promise.all([
    load(() => listCustomers(client, { limit: 100 })),
    load(() => listPriceBook(client, { active: true })),
  ]);

  const customerList = loadedValue(customers, { items: [], nextCursor: null, total: 0 }).items;

  // The currency is the tenant's, but `Session` does not carry it — see the
  // report. GBP is the only value the seed data uses.
  const initial = { ...emptyDraft('GBP', 30), customerId: preselectedCustomer };

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={[{ label: 'Quotes', href: '/quotes' }]}
        title="New quote"
        subtitle="Price it from the book, or paste the customer's message and let the drafting panel suggest lines."
      />

      {(!customers.ok || !priceBook.ok) && (
        <div className="space-y-2">
          {!customers.ok && (
            <ErrorPanel title="Customers did not load" detail={customers.problem.message} />
          )}
          {!priceBook.ok && (
            <ErrorPanel
              title="The price book did not load"
              detail={`${priceBook.problem.message} — lines can still be typed by hand, but “add from price book” will be empty.`}
            />
          )}
        </div>
      )}

      {customerList.length === 0 && customers.ok ? (
        <Panel>
          <p className="text-sm text-ink-dim">
            A quote needs a customer and one of their sites.{' '}
            <Link className="link underline decoration-line-strong" href="/customers?new=1">
              Add a customer first
            </Link>
            .
          </p>
        </Panel>
      ) : (
        <QuoteBuilder
          mode="create"
          status="DRAFT"
          currency={initial.currency}
          customers={customerList.map((customer) => ({ id: customer.id, name: customer.name }))}
          priceBook={loadedValue(priceBook, []).filter((item) => item.active)}
          initial={initial}
          initialSites={[]}
          saveAction={saveQuoteAction}
          draftAction={draftQuoteAction}
          loadSitesAction={loadSitesAction}
        />
      )}
    </div>
  );
}
