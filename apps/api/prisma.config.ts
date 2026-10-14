import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 removed the `url` property from the datasource block in
// schema.prisma; connection details now live here, and the client takes a
// driver adapter at runtime. See docs/adr/0002-prisma-driver-adapters.md.
//
// Prisma runs this file with the package directory as the working directory,
// but the single .env sits at the repo root so the API and the web app cannot
// drift apart. Load whichever exists.
for (const candidate of ['../../.env', '.env']) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) loadEnv({ path });
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
    // `migrate dev` diffs against a scratch database, and passing it explicitly
    // keeps the behaviour identical on a developer machine and in CI, where the
    // connecting role may not have CREATE DATABASE rights.
    //
    // Optional, because `migrate deploy` does not use a shadow database at all.
    // Requiring it here meant a production deploy failed on a variable that only
    // exists to serve a development command — and the failure named the config
    // file rather than the command that did not need it.
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
