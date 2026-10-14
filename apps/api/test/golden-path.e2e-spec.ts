import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootstrapApp, closeApp, signIn, type Session } from './harness';

/**
 * The demo path, asserted end to end.
 *
 * Every step here is something a person does in the UI. If this file passes, the
 * product's central claim — a quote becomes a job becomes an invoice — holds
 * against a real database.
 */
describe('customer to paid invoice', () => {
  let server: INestApplication;
  let session: Session;

  beforeAll(async () => {
    server = await bootstrapApp();
    session = await signIn(server);
  }, 180_000);

  afterAll(closeApp);

  it('signs in and reports the session', async () => {
    const response = await request(server.getHttpServer())
      .get('/api/auth/session')
      .set(...auth(session))
      .expect(200);

    expect(response.body.tenant.name).toContain('Halstead');
    expect(response.body.user.role).toBe('OWNER');
  });

  it('walks a quote from draft to paid', async () => {
    const http = request(server.getHttpServer());
    const bearer = auth(session);

    // --- a customer with a site ---
    const customers = await http.get('/api/customers?limit=1').set(...bearer).expect(200);
    const customer = customers.body.items[0];
    const sites = await http.get(`/api/customers/${customer.id}/sites`).set(...bearer).expect(200);
    const site = sites.body[0];
    expect(site).toBeDefined();

    // --- price book ---
    const priceBook = await http.get('/api/price-book').set(...bearer).expect(200);
    const labour = priceBook.body.items[0];

    // --- a quote, with mixed VAT rates so the tax logic is exercised ---
    const created = await http
      .post('/api/quotes')
      .set(...bearer)
      .send({
        customerId: customer.id,
        siteId: site.id,
        validForDays: 30,
        lines: [
          {
            priceBookItemId: labour.id,
            description: labour.description,
            quantity: 3,
            unitPrice: labour.unitPrice,
            taxRateBp: labour.taxRateBp,
          },
          { description: 'Materials', quantity: 11, unitPrice: { amount: 1233, currency: 'GBP' }, taxRateBp: 500 },
        ],
      })
      .expect(201);

    const quote = created.body;
    expect(quote.number).toMatch(/^Q-\d{4}-\d{4}$/);
    expect(quote.status).toBe('DRAFT');

    // The invariant the whole money module exists for: the printed lines add up
    // to the printed total.
    const lineNet = quote.lines.reduce((total: number, line: { net: { amount: number } }) => total + line.net.amount, 0);
    expect(lineNet).toBe(quote.net.amount);
    expect(quote.gross.amount).toBe(quote.net.amount + quote.tax.amount);

    // --- issuing gives the customer a link ---
    const sent = await http.post(`/api/quotes/${quote.id}/send`).set(...bearer).expect(201);
    expect(sent.body.status).toBe('SENT');
    const token = (sent.body.publicUrl as string).split('/q/')[1];
    expect(token).toMatch(/^[\w-]{40,}$/);

    // --- the customer sees it without an account ---
    const publicView = await http.get(`/api/public/quotes/${token}`).expect(200);
    expect(publicView.body.quoteNumber).toBe(quote.number);
    expect(publicView.body.gross.amount).toBe(quote.gross.amount);
    // Nothing in the public payload may be used to address the API.
    expect(JSON.stringify(publicView.body)).not.toContain(quote.id);

    // --- the customer accepts ---
    const decided = await http
      .post(`/api/public/quotes/${token}/decision`)
      .send({ decision: 'ACCEPTED', note: 'Go ahead' })
      .expect(201);
    expect(decided.body.status).toBe('ACCEPTED');

    // --- accepted work becomes a job ---
    const engineer = await http.get('/api/customers?limit=1').set(...bearer);
    void engineer;

    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 86_400_000 + 4 * 3_600_000).toISOString();

    const jobResponse = await http
      .post('/api/jobs')
      .set(...bearer)
      .send({ quoteId: quote.id, scheduledStart: start, scheduledEnd: end })
      .expect(201);

    const job = jobResponse.body;
    expect(job.number).toMatch(/^J-\d{4}-\d{4}$/);
    expect(job.status).toBe('SCHEDULED');

    // Creating a job writes its first audit event in the same transaction, so a
    // job can never exist with a status nothing explains.
    const jobDetail = await http.get(`/api/jobs/${job.id}`).set(...bearer).expect(200);
    expect(jobDetail.body.statusEvents).toHaveLength(1);

    // --- completing it requires a summary, because the invoice is raised from it ---
    await http.post(`/api/jobs/${job.id}/status`).set(...bearer).send({ status: 'COMPLETED' }).expect(409);

    const completed = await http
      .post(`/api/jobs/${job.id}/status`)
      .set(...bearer)
      .send({ status: 'COMPLETED', completionSummary: 'Replaced the consumer unit and tested all circuits.' })
      .expect(201);
    expect(completed.body.status).toBe('COMPLETED');
    expect(completed.body.completedAt).not.toBeNull();

    // --- and becomes an invoice, whose lines are a snapshot of the quote ---
    const invoiceResponse = await http
      .post('/api/invoices')
      .set(...bearer)
      .send({ jobId: job.id, dueInDays: 14 })
      .expect(201);

    const invoice = invoiceResponse.body;
    expect(invoice.number).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(invoice.net.amount).toBe(quote.net.amount);
    expect(invoice.tax.amount).toBe(quote.tax.amount);
    expect(invoice.lines.map((line: { description: string }) => line.description)).toEqual(
      quote.lines.map((line: { description: string }) => line.description),
    );

    // --- issuing, then payment ---
    await http.post(`/api/invoices/${invoice.id}/paid`).set(...bearer).send({}).expect(409);
    await http.post(`/api/invoices/${invoice.id}/send`).set(...bearer).expect(201);
    const paid = await http
      .post(`/api/invoices/${invoice.id}/paid`)
      .set(...bearer)
      .send({ reference: 'BACS-4471' })
      .expect(201);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.paymentReference).toBe('BACS-4471');

    // --- the PDF ---
    const pdf = await http.get(`/api/invoices/${invoice.id}/pdf`).set(...bearer).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
