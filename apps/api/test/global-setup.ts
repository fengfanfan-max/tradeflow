import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Resets and seeds the test database once for the whole e2e run.
 *
 * It has to be once. `prisma migrate reset` drops and recreates the database,
 * which PostgreSQL refuses while another connection is open — and each spec file
 * boots its own Nest application, so a per-file reset fails as soon as the
 * second file starts.
 *
 * This also runs before any spec imports the Prisma client, so the redirect of
 * DATABASE_URL below is in place by the time the connection string is read.
 */
export async function setup(): Promise<void> {
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }

  const cwd = resolve(__dirname, '..');
  const run = (args: string[]): void => {
    execFileSync('pnpm', ['exec', ...args], {
      cwd,
      env: { ...process.env },
      stdio: 'pipe',
      encoding: 'utf8',
    });
  };

  run(['prisma', 'migrate', 'reset', '--force']);
  run(['prisma', 'db', 'seed']);
}
