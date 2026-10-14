import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireClient } from '@/lib/session';
import { load } from '@/lib/load';
import { getInvoice } from '@/lib/resources';
import {
  markInvoicePaidAction,
  sendInvoiceAction,
  voidInvoiceAction,
} from '@/lib/actions/invoices';
import { formatDate, formatDateTime } from '@/lib/format';
import { ActionForm } from '@/components/action-form';
import {
  Amount,
  Detail,
  ErrorPanel,
  Field,
  InvoiceStatusPill,
  Notice,
  PageHeader,
  Panel,
  taxRateLabel,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Invoice' };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await requireClient();

  const result = await load(() => getInvoice(client, id));
  if (!result.ok && result.problem.code === 'NOT_FOUND') notFound();
  if (!result.ok) {
    return (
      <ErrorPanel
        title="This invoice did not load"
        detail={`${result.problem.code}: ${result.problem.message}`}
        retry={
          <Link className="btn btn-sm" href="/invoices">
            Back to invoices
          </Link>
        }
      />
    );
  }

  const invoice = result.data;
  const canSend = invoice.status === 'DRAFT';
  const canPay = invoice.status === 'DRAFT' || invoice.status === 'SENT';
  const canVoid = invoice.status !== 'PAID' && invoice.status !== 'VOID';

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={[{ label: 'Invoices', href: '/invoices' }]}
        title={
          <span className="flex items-center gap-3">
            {invoice.number}
            <InvoiceStatusPill status={invoice.status} />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link className="link underline decoration-line-strong" href={`/customers/${invoice.customer.id}`}>
              {invoice.customer.name}
            </Link>
            {invoice.job && (
              <>
                <span className="text-ink-faint">·</span>
                <Link className="link underline decoration-line-strong" href={`/jobs/${invoice.job.id}`}>
                  Job {invoice.job.number}
                </Link>
              </>
            )}
          </span>
        }
        actions={
          // The PDF is fetched through a route handler rather than linked to the
          // API directly, because the bearer token lives in an httpOnly cookie
          // that only the server can read.
          <a className="btn btn-primary" href={`/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
            Download PDF
          </a>
        }
      />

      {invoice.status === 'PAID' && (
        <Notice tone="ok" title="Paid">
          Recorded {formatDateTime(invoice.paidAt)}
          {invoice.paymentReference ? ` · reference ${invoice.paymentReference}` : ''}
        </Notice>
      )}
      {invoice.status === 'VOID' && (
        <Notice tone="bad" title="Void">
          This invoice is void. It is kept for the audit trail and cannot be paid.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Lines" description="A snapshot taken when the invoice was raised — editing the quote later cannot change these figures." bodyClassName="p-0">
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
                {invoice.lines.map((line, index) => (
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
            </table>
          </div>

          <div className="border-t border-line px-4 py-3">
            <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="text-ink-dim">Net</dt>
                <dd><Amount value={invoice.totals.net} /></dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-ink-dim">
                  VAT
                  <span className="num ml-1.5 text-xs text-ink-faint">
                    {(invoice.totals.effectiveTaxRateBp / 100).toFixed(2)}%
                  </span>
                </dt>
                <dd><Amount value={invoice.totals.tax} /></dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-line pt-1.5">
                <dt className="text-ink-dim">Gross</dt>
                <dd><Amount value={invoice.totals.gross} strong /></dd>
              </div>
              {invoice.depositAmount.amount > 0 && (
                <>
                  <div className="flex items-baseline justify-between">
                    <dt className="text-ink-dim">Less deposit</dt>
                    <dd><Amount value={invoice.depositAmount} muted /></dd>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-line pt-1.5">
                    <dt className="font-semibold text-ink">Amount due</dt>
                    <dd className="text-base"><Amount value={invoice.amountDue} strong /></dd>
                  </div>
                </>
              )}
            </dl>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Details">
            <dl className="space-y-4">
              <Detail label="Issued">
                <span className="num">{formatDateTime(invoice.issuedAt)}</span>
              </Detail>
              <Detail label="Due">
                <span className="num">{formatDate(invoice.dueAt)}</span>
              </Detail>
              <Detail label="Paid">
                <span className="num">{formatDateTime(invoice.paidAt)}</span>
              </Detail>
              <Detail label="Amount due">
                <Amount value={invoice.amountDue} strong />
              </Detail>
            </dl>
          </Panel>

          {canSend && (
            <Panel title="Send">
              <p className="mb-3 text-xs text-ink-faint">
                Marks the invoice as issued. The PDF is what goes to the customer.
              </p>
              <ActionForm
                action={sendInvoiceAction}
                submitLabel="Mark as sent"
                pendingLabel="Marking…"
                hiddenValues={{ id: invoice.id }}
              />
            </Panel>
          )}

          {canPay && (
            <Panel title="Record payment">
              <ActionForm
                action={markInvoicePaidAction}
                submitLabel="Mark as paid"
                pendingLabel="Recording…"
                hiddenValues={{ id: invoice.id }}
              >
                <Field label="Reference" htmlFor="reference" hint="Bank reference, cheque number, anything that identifies it.">
                  <input id="reference" name="reference" className="control" maxLength={120} />
                </Field>
              </ActionForm>
            </Panel>
          )}

          {canVoid && (
            <Panel title="Void">
              <p className="mb-3 text-xs text-ink-faint">
                Keeps the invoice and its number for the audit trail, but takes it out of what is owed.
              </p>
              <ActionForm
                action={voidInvoiceAction}
                submitLabel="Void invoice"
                pendingLabel="Voiding…"
                submitClassName="btn btn-danger"
                confirmText="Void this invoice? This cannot be undone from here."
                hiddenValues={{ id: invoice.id }}
              />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
