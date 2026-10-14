import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // `apps/web/Dockerfile` starts the app with `node apps/web/server.js` and
  // copies `apps/web/public` and `apps/web/.next/static` by hand. That layout is
  // exactly what `standalone` emits — it traces the server's dependencies into
  // one directory — so the Dockerfile and this setting are one decision.
  output: 'standalone',

  // `@tradeflow/shared` is a workspace symlink whose `exports` map points at a
  // CommonJS `dist/`. Without this the server build externalises it and the
  // browser build would try to resolve a `require` at runtime; transpiling it
  // makes the same source bundle correctly into both graphs.
  transpilePackages: ['@tradeflow/shared'],

  // The API already returns a full `Problem` for every failure, so the default
  // Next error overlay would only ever add a second, less precise one.
  poweredByHeader: false,
};

export default nextConfig;
