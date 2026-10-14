import { Injectable } from '@nestjs/common';
import type { InvoiceCreate, InvoiceListQuery, InvoiceMarkPaid } from '@tradeflow/shared';
import { computeTotals } from '@tradeflow/shared';
import { ConflictError, NotFoundError } from '../common/errors';
import { asCurrency, asMoney, amountDue } from '../common/serialize';
import { NumberingService } from '../documents/numbering.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../prisma/client';
import { renderInvoicePdf, type InvoicePdfInput } from './invoice-pdf';

const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['SENT', 'VOID'],
  SENT: ['PAID', 'VOID'],
  PAID: [],
  VOID: [],
};

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async list(tenantId: string, query: InvoiceListQuery) {
    const db = this.prisma.forTenant(tenantId);
    const rows = await db.invoice.findMany({
      where: {
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
      include: listInclude,
    });
    return { items: rows.map(serialize), total: rows.length, nextCursor: null };
  }

  async get(tenantId: string, id: string) {
    const invoice = await this.prisma.forTenant(tenantId).invoice.findFirst({
      where: { id },
      include: detailInclude,
    });
    if (!invoice) throw new NotFoundError('Invoice');
    return serializeDetail(invoice);
  }

  /**
   * Raise an invoice from a completed job.
   *
   * Only COMPLETED jobs can be invoiced: billing work that is not finished is
   * how a business ends up issuing credit notes.
   *
   * The lines are copied, not referenced. `sourceQuoteLineId` records where each
   * came from, and nothing reads it to compute a total — an issued invoice must
   * render identically in five years, whatever the quote says by then.
   */
  async create(tenantId: string, input: InvoiceCreate) {
    const db = this.prisma.forTenant(tenantId);
    const job = await db.job.findFirst({
      where: { id: input.jobId },
      include: { quote: { include: { lines: { orderBy: { position: 'asc' } } } }, invoices: true },
    });
    if (!job) throw new NotFoundError('Job');
    if (job.status !== 'COMPLETED') {
      throw new ConflictError('JOB_NOT_COMPLETE', 'Only a completed job can be invoiced.');
    }
    if (job.invoices.some((invoice) => invoice.status !== 'VOID')) {
      throw new ConflictError('ALREADY_INVOICED', 'This job already has an invoice.');
    }

    const currency = job.quote.currency;
    const totals = computeTotals(
      job.quote.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: asMoney(line.unitPrice, currency),
        taxRateBp: line.taxRateBp,
      })),
      asCurrency(currency),
    );

    const deposit = input.depositAmount?.amount ?? 0;
    if (deposit > totals.gross.amount) {
      throw new ConflictError('DEPOSIT_TOO_LARGE', 'The deposit cannot exceed the invoice total.');
    }

    const number = await this.numbering.next(tenantId, 'INVOICE');
    const dueAt = new Date(Date.now() + input.dueInDays * 86_400_000);

    const created = await db.invoice.create({
      data: {
        tenantId,
        jobId: job.id,
        customerId: job.customerId,
        number,
        status: 'DRAFT',
        currency,
        netTotal: totals.net.amount,
        taxTotal: totals.tax.amount,
        // The full gross of the document. What is still owed is derived on read
        // as `grossTotal - depositAmount`, so a deposit does not change what the
        // invoice says it was for — it changes only the balance.
        grossTotal: totals.gross.amount,
        depositAmount: deposit,
        dueAt,
        lines: {
          create: totals.lines.map((line, index) => ({
            position: index,
            sourceQuoteLineId: job.quote.lines[index]?.id,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice.amount,
            taxRateBp: line.taxRateBp,
            netAmount: line.net.amount,
            taxAmount: line.tax.amount,
          })),
        },
      },
      include: detailInclude,
    });

    return serializeDetail(created);
  }

  async send(tenantId: string, id: string) {
    return this.transition(tenantId, id, 'SENT', { issuedAt: new Date() });
  }

  async markPaid(tenantId: string, id: string, input: InvoiceMarkPaid) {
    return this.transition(tenantId, id, 'PAID', {
      paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
      paymentReference: input.reference,
    });
  }

  async void(tenantId: string, id: string) {
    return this.transition(tenantId, id, 'VOID', {});
  }

  private async transition(
    tenantId: string,
    id: string,
    to: 'SENT' | 'PAID' | 'VOID',
    extra: Record<string, unknown>,
  ) {
    const db = this.prisma.forTenant(tenantId);
    const invoice = await db.invoice.findFirst({ where: { id } });
    if (!invoice) throw new NotFoundError('Invoice');

    const allowed = ALLOWED_TRANSITIONS[invoice.status] ?? [];
    if (!allowed.includes(to)) {
      throw new ConflictError(
        'INVALID_INVOICE_TRANSITION',
        `Cannot move from ${invoice.status} to ${to}. Allowed: ${allowed.join(', ') || 'none'}.`,
      );
    }

    const updated = await db.invoice.update({
      where: { id },
      data: { status: to, ...extra },
      include: detailInclude,
    });
    return serializeDetail(updated);
  }

  /** Streams a PDF rendered from the stored rows. */
  async pdf(tenantId: string, id: string): Promise<{ stream: PDFKit.PDFDocument; filename: string }> {
    const invoice = await this.get(tenantId, id);

    const input: InvoicePdfInput = {
      number: invoice.number,
      status: invoice.status,
      currency: invoice.currency,
      issuedAt: invoice.issuedAt ? new Date(invoice.issuedAt) : null,
      dueAt: invoice.dueAt ? new Date(invoice.dueAt) : null,
      paidAt: invoice.paidAt ? new Date(invoice.paidAt) : null,
      paymentReference: invoice.paymentReference,
      notes: invoice.notes,
      // The PDF layer works in minor units; the wire shape carries Money.
      depositAmount: invoice.depositAmount.amount,
      business: {
        name: invoice.business.name,
        vatNumber: invoice.business.vatNumber,
      },
      customer: { name: invoice.customer.name, address: invoice.customer.address ?? undefined },
      job: invoice.job,
      lines: invoice.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice.amount,
        taxRateBp: line.taxRateBp,
        netAmount: line.net.amount,
        taxAmount: line.tax.amount,
      })),
      netTotal: invoice.net.amount,
      taxTotal: invoice.tax.amount,
      grossTotal: invoice.gross.amount,
    };

    return { stream: renderInvoicePdf(input), filename: `${invoice.number}.pdf` };
  }
}

const listInclude = {
  customer: { select: { id: true, name: true } },
  job: { select: { id: true, number: true } },
} satisfies Prisma.InvoiceInclude;

const detailInclude = {
  lines: { orderBy: { position: 'asc' } },
  customer: true,
  tenant: true,
  job: {
    select: {
      id: true,
      number: true,
      completionSummary: true,
      quote: { select: { currency: true } },
    },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof listInclude }>;
type InvoiceDetailRow = Prisma.InvoiceGetPayload<{ include: typeof detailInclude }>;

function serialize(row: InvoiceRow) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    currency: row.currency,
    net: asMoney(row.netTotal, row.currency),
    tax: asMoney(row.taxTotal, row.currency),
    gross: asMoney(row.grossTotal, row.currency),
    depositAmount: asMoney(row.depositAmount, row.currency),
    amountDue: asMoney(amountDue(row.grossTotal, row.depositAmount), row.currency),
    issuedAt: row.issuedAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    paymentReference: row.paymentReference,
    customer: row.customer,
    job: row.job,
  };
}


function serializeDetail(row: InvoiceDetailRow) {
  const totals = computeTotals(
    row.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: asMoney(line.unitPrice, row.currency),
      taxRateBp: line.taxRateBp,
    })),
    asCurrency(row.currency),
  );

  return {
    id: row.id,
    number: row.number,
    status: row.status,
    currency: row.currency,
    net: asMoney(row.netTotal, row.currency),
    tax: asMoney(row.taxTotal, row.currency),
    gross: asMoney(row.grossTotal, row.currency),
    depositAmount: asMoney(row.depositAmount, row.currency),
    amountDue: asMoney(amountDue(row.grossTotal, row.depositAmount), row.currency),
    effectiveTaxRateBp: totals.effectiveTaxRateBp,
    notes: row.notes,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    paymentReference: row.paymentReference,
    business: { name: row.tenant.name, vatNumber: row.tenant.vatNumber },
    customer: {
      id: row.customer.id,
      name: row.customer.name,
      address: [row.customer.billingLine1, row.customer.billingCity, row.customer.billingPostcode]
        .filter(Boolean)
        .join(', ') || null,
    },
    job: row.job ? { id: row.job.id, number: row.job.number, completionSummary: row.job.completionSummary } : null,
    lines: row.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: asMoney(line.unitPrice, row.currency),
      taxRateBp: line.taxRateBp,
      net: asMoney(line.netAmount, row.currency),
      tax: asMoney(line.taxAmount, row.currency),
      gross: asMoney(line.netAmount + line.taxAmount, row.currency),
    })),
  };
}
