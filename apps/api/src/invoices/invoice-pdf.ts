import PDFDocument from 'pdfkit';

/**
 * Invoice PDF.
 *
 * Laid out from the *stored* line and total rows rather than recomputed from the
 * quote. An invoice is a legal document: what it said when it was issued must not
 * change because someone later corrected the quote or the price book.
 *
 * The layout is deliberately plain. An invoice is read by an accounts package
 * and by a person checking a figure; ornament gets in the way of both.
 */

const PAGE_MARGIN = 48;
const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#d1d5db';

export interface InvoicePdfInput {
  number: string;
  status: string;
  currency: string;
  issuedAt: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  paymentReference: string | null;
  notes: string | null;
  depositAmount: number;
  business: { name: string; vatNumber: string | null; address?: string };
  customer: { name: string; address?: string };
  job: { number: string; completionSummary: string | null } | null;
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    taxRateBp: number;
    netAmount: number;
    taxAmount: number;
  }[];
  netTotal: number;
  taxTotal: number;
  grossTotal: number;
}

function formatMoney(pence: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(pence / 100);
}

function formatDate(date: Date | null): string {
  return date ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date) : '—';
}

export function renderInvoicePdf(input: InvoicePdfInput): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
  const left = PAGE_MARGIN;
  const right = doc.page.width - PAGE_MARGIN;
  const width = right - left;

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text('INVOICE', left, PAGE_MARGIN);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  doc.text(input.business.name, left, PAGE_MARGIN + 30);
  if (input.business.vatNumber) doc.text(`VAT No. ${input.business.vatNumber}`, left);
  if (input.business.address) doc.text(input.business.address, left, doc.y, { width: width * 0.5 });

  // Right column: the identifiers an accounts department matches on.
  const metaY = PAGE_MARGIN + 30;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10);
  doc.text(input.number, left, metaY, { width, align: 'right' });
  doc.font('Helvetica').fillColor(MUTED);
  doc.text(`Issued ${formatDate(input.issuedAt)}`, { width, align: 'right' });
  doc.text(`Due ${formatDate(input.dueAt)}`, { width, align: 'right' });
  if (input.job) doc.text(`Job ${input.job.number}`, { width, align: 'right' });
  if (input.paidAt) {
    doc.fillColor('#047857').text(`Paid ${formatDate(input.paidAt)}`, { width, align: 'right' });
  }

  let y = Math.max(doc.y, metaY + 70) + 12;

  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('BILL TO', left, y);
  doc.fillColor(INK).font('Helvetica').fontSize(10).text(input.customer.name, left, y + 12);
  if (input.customer.address) doc.fillColor(MUTED).text(input.customer.address, left, doc.y);

  y = doc.y + 22;

  // Completing the job writes the narrative that becomes the invoice body — the
  // customer should be able to tell what they are being billed for without
  // reading the line items.
  if (input.job?.completionSummary) {
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('WORK COMPLETED', left, y);
    doc.fillColor(INK).font('Helvetica').fontSize(10).text(input.job.completionSummary, left, y + 12, {
      width,
    });
    y = doc.y + 18;
  }

  // Table header
  doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).lineWidth(1).stroke();
  y += 8;
  const cols = { desc: left, qty: left + width * 0.55, unit: left + width * 0.65, vat: left + width * 0.78, net: right };
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
  doc.text('DESCRIPTION', cols.desc, y);
  doc.text('QTY', cols.qty, y, { width: 40, align: 'right' });
  doc.text('UNIT', cols.unit, y, { width: 60, align: 'right' });
  doc.text('VAT', cols.vat, y, { width: 40, align: 'right' });
  doc.text('NET', cols.net - 70, y, { width: 70, align: 'right' });
  y += 14;

  doc.font('Helvetica').fontSize(10).fillColor(INK);
  for (const line of input.lines) {
    const rowTop = y;
    doc.text(line.description, cols.desc, rowTop, { width: width * 0.52 });
    const afterDesc = doc.y;
    doc.text(String(line.quantity), cols.qty, rowTop, { width: 40, align: 'right' });
    doc.text(formatMoney(line.unitPrice, input.currency), cols.unit, rowTop, { width: 60, align: 'right' });
    doc.text(`${line.taxRateBp / 100}%`, cols.vat, rowTop, { width: 40, align: 'right' });
    doc.text(formatMoney(line.netAmount, input.currency), cols.net - 70, rowTop, { width: 70, align: 'right' });
    y = Math.max(afterDesc, rowTop + 14) + 8;
  }

  doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).stroke();
  y += 12;

  // Totals, right aligned, with tax shown separately because that is what has to
  // go on a VAT return.
  const totalRows: [string, string, boolean][] = [
    ['Subtotal', formatMoney(input.netTotal, input.currency), false],
    ['VAT', formatMoney(input.taxTotal, input.currency), false],
    ['Total', formatMoney(input.grossTotal, input.currency), false],
  ];
  if (input.depositAmount > 0) {
    totalRows.push(['Deposit received', `-${formatMoney(input.depositAmount, input.currency)}`, false]);
    totalRows.push([
      'Amount due',
      formatMoney(input.grossTotal - input.depositAmount, input.currency),
      true,
    ]);
  }

  for (const [label, value, emphasise] of totalRows) {
    doc.font(emphasise ? 'Helvetica-Bold' : 'Helvetica').fillColor(emphasise ? INK : MUTED);
    doc.text(label, cols.unit, y, { width: 120, align: 'right' });
    doc.font(emphasise ? 'Helvetica-Bold' : 'Helvetica').fillColor(INK);
    doc.text(value, cols.net - 80, y, { width: 80, align: 'right' });
    y = doc.y + 6;
  }

  if (input.status === 'PAID' && input.paymentReference) {
    doc.fillColor('#047857').font('Helvetica-Bold').text(`Paid — ref ${input.paymentReference}`, left, y + 12);
  }

  if (input.notes) {
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('NOTES', left, y + 30);
    doc.fillColor(INK).font('Helvetica').fontSize(10).text(input.notes, left, y + 42, { width });
  }

  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(8)
    .text(
      'Payment due within the stated terms. Please quote the invoice number with your payment.',
      left,
      doc.page.height - PAGE_MARGIN - 12,
      { width, align: 'center' },
    );

  doc.end();
  return doc;
}
