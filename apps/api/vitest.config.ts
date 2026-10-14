import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * NestJS resolves constructor dependencies from `emitDecoratorMetadata`, which
 * esbuild — Vitest's default transformer — does not emit. The project therefore
 * builds its tests with SWC, which does, so the DI container sees real types
 * instead of `Object` and the tests exercise the same wiring as production.
 *
 * Two projects: `unit` runs fast without a database, `e2e` boots the application
 * against a real PostgreSQL and is given a longer timeout for migrations.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    projects: [
      {
        plugins: [swc.vite({ module: { type: 'es6' } })],
        test: {
          name: 'unit',
          root: './',
          include: ['src/**/*.spec.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [swc.vite({ module: { type: 'es6' } })],
        test: {
          name: 'e2e',
          root: './',
          include: ['test/**/*.e2e-spec.ts'],
          environment: 'node',
          // Booting the app, running migrations and seeding takes longer than a
          // unit test's default budget.
          globalSetup: ['./test/global-setup.ts'],
          hookTimeout: 120_000,
          testTimeout: 60_000,
          // These share one database, so they run in a single process rather
          // than racing each other across workers.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
