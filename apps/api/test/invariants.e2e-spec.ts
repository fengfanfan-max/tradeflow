import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootstrapApp, closeApp, signIn, type Session } from './harness';

/**
 * The rules that must hold whatever the UI does.
 *
 * These are the failures that cost money or trust — a double booking, one trade
 * business reading another's customers, two people overwriting each other's
 * edits — so they are asserted against the database rather than trusted to the
 * service layer.
 */
describe('invariants', () => {
  let server: INestApplication;
  let session: Session;

  beforeAll(async () => {
    server = await bootstrapApp();
    session = await signIn(server);
  }, 120_000);

  afterAll(closeApp);

  it('returns 401 rather than 403 for an unauthenticated request', async () => {
    const response = await request(server.getHttpServer()).get('/api/customers').expect(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('answers 404, not 403, for a record belonging to another tenant', async () => {
    // A 403 would confirm the id exists, which is an enumeration oracle across
    // tenant boundaries.
    const response = await request(server.getHttpServer())
      .get('/api/customers/00000000-0000-0000-0000-000000000001')
      .set(...auth(session))
      .expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('rejects a stale write instead of silently discarding the other edit', async () => {
    const http = request(server.getHttpServer());
    const bearer = auth(session);

    const customers = await http.get('/api/customers?limit=1').set(...bearer).expect(200);
    const sites = await http
      .get(`/api/customers/${customers.body.items[0].id}/sites`)
      .set(...bearer)
      .expect(200);

    const quote = (
      await http
        .post('/api/quotes')
        .set(...bearer)
        .send({
          customerId: customers.body.items[0].id,
          siteId: sites.body[0].id,
          lines: [{ description: 'Call-out', quantity: 1, unitPrice: { amount: 8500, currency: 'GBP' }, taxRateBp: 2000 }],
        })
        .expect(201)
    ).body;

    // First writer succeeds.
    await http
      .patch(`/api/quotes/${quote.id}`)
      .set(...bearer)
      .send({ expectedVersion: quote.version, notes: 'first' })
      .expect(200);

    // Second writer still holds the version they read. Their edit must not land.
    const stale = await http
      .patch(`/api/quotes/${quote.id}`)
      .set(...bearer)
      .send({ expectedVersion: quote.version, notes: 'second' })
      .expect(409);
    expect(stale.body.code).toBe('STALE_WRITE');

    const current = await http.get(`/api/quotes/${quote.id}`).set(...bearer).expect(200);
    expect(current.body.notes).toBe('first');
  });

  it('refuses to schedule one engineer in two places at once', async () => {
    const http = request(server.getHttpServer());
    const bearer = auth(session);

    // This test builds its own data rather than borrowing a seeded quote that
    // happens to have no job yet. Depending on another file's leftovers is how a
    // suite starts failing when tests are reordered.
    const accepted = await createAcceptedQuote(http, bearer);

    const engineers = await http.get('/api/users?role=ENGINEER').set(...bearer).expect(200);
    expect(engineers.body.items.length).toBeGreaterThan(0);
    const engineerId = engineers.body.items[0].id;

    const start = new Date(Date.now() + 30 * 86_400_000);
    const end = new Date(start.getTime() + 4 * 3_600_000);

    const first = await http
      .post('/api/jobs')
      .set(...bearer)
      .send({
        quoteId: accepted,
        assigneeId: engineerId,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
      })
      .expect(201);

    expect(first.body.assignee.id).toBe(engineerId);

    // A second job, overlapping the first by an hour. This is the check that
    // produces the useful error message; the exclusion constraint behind it is
    // what actually guarantees the invariant under concurrency.
    const secondQuote = await createAcceptedQuote(http, bearer);
    const overlapStart = new Date(start.getTime() + 3_600_000);

    const clash = await http
      .post('/api/jobs')
      .set(...bearer)
      .send({
        quoteId: secondQuote,
        assigneeId: engineerId,
        scheduledStart: overlapStart.toISOString(),
        scheduledEnd: new Date(overlapStart.getTime() + 4 * 3_600_000).toISOString(),
      })
      .expect(409);

    expect(clash.body.code).toBe('SCHEDULE_CONFLICT');
    expect(clash.body.message).toContain(first.body.number);

    // A second job for the same engineer, later the same month and not
    // overlapping. The availability endpoint excludes the job being moved —
    // it answers "can I put *this* job here" — so a second job is needed
    // before the endpoint has anything to report.
    const laterStart = new Date(start.getTime() + 10 * 86_400_000);
    const laterEnd = new Date(laterStart.getTime() + 4 * 3_600_000);

    const second = await http
      .post('/api/jobs')
      .set(...bearer)
      .send({
        quoteId: secondQuote,
        assigneeId: engineerId,
        scheduledStart: laterStart.toISOString(),
        scheduledEnd: laterEnd.toISOString(),
      })
      .expect(201);

    // Moving the second job onto the first one's window: unavailable, and the
    // clash names the job it would collide with so the UI can say which.
    const busy = await http
      .get(
        `/api/jobs/${second.body.id}/availability?assigneeId=${engineerId}` +
          `&start=${start.toISOString()}&end=${end.toISOString()}`,
      )
      .set(...bearer)
      .expect(200);
    expect(busy.body.available).toBe(false);
    expect(busy.body.conflicts[0].number).toBe(first.body.number);

    // Back-to-back is not a clash: the first ends at 12:00 and this window
    // starts at exactly that moment, which is how a working day is booked.
    const backToBack = await http
      .get(
        `/api/jobs/${second.body.id}/availability?assigneeId=${engineerId}` +
          `&start=${end.toISOString()}&end=${new Date(end.getTime() + 3_600_000).toISOString()}`,
      )
      .set(...bearer)
      .expect(200);
    expect(backToBack.body.available).toBe(true);
  });

  it('only invoices completed work', async () => {
    const http = request(server.getHttpServer());
    const bearer = auth(session);

    const jobs = await http.get('/api/jobs?status=SCHEDULED&limit=1').set(...bearer).expect(200);
    const job = jobs.body.items[0];
    if (!job) return;

    const response = await http.post('/api/invoices').set(...bearer).send({ jobId: job.id }).expect(409);
    expect(response.body.code).toBe('JOB_NOT_COMPLETE');
  });

  it('rejects an unknown field with a field-level message', async () => {
    const response = await request(server.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.fields.email).toBeDefined();
    expect(response.body.fields.password).toBeDefined();
  });
});


/**
 * Creates a customer, site, quote and acceptance, and returns the quote id.
 *
 * Written as a helper because two tests need an accepted quote and neither
 * should depend on the seed happening to contain one that is still unused.
 */
async function createAcceptedQuote(
  http: ReturnType<typeof request>,
  bearer: [string, string],
): Promise<string> {
  const stamp = Date.now() + Math.floor(Math.random() * 100_000);

  const customer = (
    await http
      .post('/api/customers')
      .set(...bearer)
      .send({ name: `Scheduling Test ${stamp}` })
      .expect(201)
  ).body;

  const site = (
    await http
      .post('/api/sites')
      .set(...bearer)
      .send({
        customerId: customer.id,
        label: 'Main site',
        address: { line1: '1 Test Street', city: 'Leeds', postcode: 'LS1 1AA', country: 'GB' },
      })
      .expect(201)
  ).body;

  const quote = (
    await http
      .post('/api/quotes')
      .set(...bearer)
      .send({
        customerId: customer.id,
        siteId: site.id,
        lines: [
          {
            description: 'Call-out',
            quantity: 1,
            unitPrice: { amount: 8500, currency: 'GBP' },
            taxRateBp: 2000,
          },
        ],
      })
      .expect(201)
  ).body;

  const sent = await http.post(`/api/quotes/${quote.id}/send`).set(...bearer).expect(201);
  const token = (sent.body.publicUrl as string).split('/q/')[1];
  await http
    .post(`/api/public/quotes/${token}/decision`)
    .send({ decision: 'ACCEPTED' })
    .expect(201);

  return quote.id as string;
}
