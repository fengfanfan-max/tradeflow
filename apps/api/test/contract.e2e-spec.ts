import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  paginatedSchema,
  publicQuoteSchema,
  sessionSchema,
} from '@tradeflow/shared';
import { z } from 'zod';
import { auth, bootstrapApp, closeApp, signIn, type Session } from './harness';

/**
 * The API's responses must match the schemas the browser parses with.
 *
 * These are the tests that would have caught a bug that cost an hour: a required
 * field was added to `sessionSchema`, the running API was a build older than
 * that change, and the web app's strict parse turned the mismatch into "you are
 * not signed in". The symptom was a redirect to the login page; the cause was
 * three layers away.
 *
 * A response is `unknown` to the client, so TypeScript cannot check this. Only a
 * request can — and only here, where the API is actually running.
 *
 * The rule this enforces: a field that is required in the contract must be
 * present in the response, and adding one is a breaking change until the API
 * ships it.
 */
describe('the API agrees with the shared contracts', () => {
  let server: INestApplication;
  let session: Session;

  beforeAll(async () => {
    server = await bootstrapApp();
    session = await signIn(server);
  }, 120_000);

  afterAll(closeApp);

  /** Fails with the exact field path, not just "did not match". */
  function expectMatches<T extends z.ZodType>(schema: T, payload: unknown, what: string): z.infer<T> {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
      throw new Error(`${what} does not match its contract:\n${issues}`);
    }
    return parsed.data;
  }

  it('login returns a Session the browser can parse', async () => {
    const response = await request(server.getHttpServer())
      .post('/api/auth/login')
      .send({ email: session.email, password: 'demo-password-2026' })
      .expect(201);

    expectMatches(sessionSchema, response.body.session, 'POST /auth/login → session');
  });

  it('GET /auth/session matches the same schema', async () => {
    const response = await request(server.getHttpServer())
      .get('/api/auth/session')
      .set(...auth(session))
      .expect(200);

    expectMatches(sessionSchema, response.body, 'GET /auth/session');
  });

  it('every collection endpoint answers with the documented envelope', async () => {
    const http = request(server.getHttpServer());
    const bearer = auth(session);

    const envelope = paginatedSchema(z.looseObject({ id: z.string() }));

    for (const path of [
      '/api/customers',
      '/api/quotes',
      '/api/jobs',
      '/api/invoices',
      '/api/price-book',
      '/api/users',
    ]) {
      const response = await http.get(path).set(...bearer).expect(200);
      expectMatches(envelope, response.body, `GET ${path}`);
    }
  });

  it('a public quote matches the schema the customer page parses with', async () => {
    const http = request(server.getHttpServer());
    const bearer = auth(session);

    const quotes = await http.get('/api/quotes?status=SENT&limit=1').set(...bearer).expect(200);
    const quote = quotes.body.items[0];
    expect(quote, 'the seed should contain a sent quote').toBeDefined();

    const detail = await http
      .get(`/api/quotes/${quote.id}`)
      .set(...bearer)
      .expect(200);
    const token = (detail.body.publicUrl as string).split('/q/')[1];

    const publicView = await http.get(`/api/public/quotes/${token}`).expect(200);
    expectMatches(publicQuoteSchema, publicView.body, 'GET /public/quotes/:token');
  });

  it('does not leak the tenant or internal ids through the public quote', async () => {
    const http = request(server.getHttpServer());
    const bearer = auth(session);

    const quotes = await http.get('/api/quotes?status=SENT&limit=1').set(...bearer).expect(200);
    const quote = quotes.body.items[0];
    const detail = await http.get(`/api/quotes/${quote.id}`).set(...bearer).expect(200);
    const token = (detail.body.publicUrl as string).split('/q/')[1];

    const publicView = await http.get(`/api/public/quotes/${token}`).expect(200);
    const body = JSON.stringify(publicView.body);

    expect(body).not.toContain(quote.id);
    expect(body).not.toContain(session.tenantId);
    expect(publicView.body).not.toHaveProperty('tenantId');
  });
});
