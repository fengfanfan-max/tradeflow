import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ProblemFilter } from '../src/common/problem.filter';

/**
 * Test harness.
 *
 * These tests run against a real PostgreSQL, not a mock. The behaviour worth
 * asserting here — an exclusion constraint refusing an overlapping booking, a
 * unique index rejecting a duplicated document number, a transaction rolling
 * back — only exists in the database. A mocked Prisma client would assert that
 * the code calls the functions it calls, which is not the same claim.
 *
 * The database is reset and seeded once per run by `test/global-setup.ts`, which
 * also points `DATABASE_URL` at `TEST_DATABASE_URL`. The suite must not run
 * against a database anyone cares about.
 */

let app: INestApplication | undefined;

export async function bootstrapApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const created = moduleRef.createNestApplication({ logger: false });
  created.useGlobalPipes(new ZodValidationPipe());
  created.useGlobalFilters(new ProblemFilter());
  created.setGlobalPrefix('api');
  await created.init();
  app = created;
  return created;
}

export async function closeApp(): Promise<void> {
  await app?.close();
  app = undefined;
}

export interface Session {
  token: string;
  tenantId: string;
  email: string;
}

const OWNER_EMAIL = 'daniel.halstead@halsteadelectrical.co.uk';
const DEMO_PASSWORD = 'demo-password-2026';

/**
 * Signs in as the seeded owner and returns a bearer token.
 *
 * Takes the Nest application and calls `getHttpServer()` itself: supertest needs
 * the underlying Node server, and passing the application wrapper fails with
 * "app.address is not a function".
 */
export async function signIn(server: INestApplication, email = OWNER_EMAIL): Promise<Session> {
  const response = await request(server.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEMO_PASSWORD })
    .expect(201);

  const body = response.body as { token: string; session: { tenant: { id: string } } };
  return { token: body.token, tenantId: body.session.tenant.id, email };
}

export function auth(session: Session): [string, string] {
  return ['authorization', `Bearer ${session.token}`];
}

export { OWNER_EMAIL, DEMO_PASSWORD };
