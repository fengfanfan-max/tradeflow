import { Prisma, type PrismaClient } from './client';

/**
 * Tenant isolation, enforced in the data layer.
 *
 * Every query the application makes against a tenant-owned table carries the
 * tenant id in its `where`, and every insert sets it. Doing that by hand in
 * forty call sites means one of them is eventually missing it, and the failure
 * mode — one trade business reading another's customers — is the kind that ends
 * a contract.
 *
 * This extension injects it instead. `prisma.forTenant(id)` returns a client
 * whose model operations are already scoped; the unscoped `this` is never
 * exposed to a request handler.
 *
 * ## What it covers
 *
 * Read and write operations on the models listed below. Raw SQL (`$queryRaw`)
 * bypasses it entirely, so the rule is: raw SQL is only used in this file and in
 * the reporting module, and both are reviewed as such.
 *
 * ## What it does not cover
 *
 * Child rows. `quoteLine` and friends have no `tenantId`; they are reached
 * through a parent that was itself fetched with `forTenant`, so the filter has
 * already been applied by the time the child is loaded. A query that starts from
 * a child table directly would not be scoped, which is why the rule is that
 * handlers do not query child tables except through an included parent.
 *
 * Nested writes are likewise not rewritten: `quote.create({ data: { lines: {
 * create: [...] } } })` scopes the quote and not the lines. That is safe here
 * because a line cannot be created without its parent, and the parent was
 * scoped.
 *
 * The e2e suite asserts that a cross-tenant read returns 404 for every entity.
 */
/**
 * Only the tables that carry a `tenantId` column.
 *
 * Child rows — quote lines, job status events, attachments, invoice lines — do
 * not have one. They inherit their tenant through their parent, which is the
 * normal shape: a line has no meaning apart from its quote. Listing them here
 * would inject a `tenantId` filter into a query for a column that does not
 * exist, which fails at runtime rather than at compile time.
 */
const TENANT_SCOPED_MODELS = new Set<string>([
  'User',
  'Customer',
  'Site',
  'PriceBookItem',
  'Quote',
  'Job',
  'Invoice',
  'DocumentCounter',
]);

/** Operations whose `args.where` selects rows. */
const WHERE_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

/** Operations whose `args.data` (or `args.create`) inserts rows. */
const CREATE_OPERATIONS = new Set<string>(['create', 'createMany', 'createManyAndReturn', 'upsert']);

export function tenantExtension(tenantId: string) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const next = { ...(args as Record<string, unknown>) };

          if (WHERE_OPERATIONS.has(operation)) {
            // `findUnique` accepts additional scalar filters alongside the unique
            // one (extended where-unique), so this works for it too. If a caller
            // passes a `where` containing OR/AND, the tenant filter is added
            // alongside rather than merged into it, which keeps both conditions
            // enforced by De Morgan rather than by luck.
            next.where = { ...((next.where as object | undefined) ?? {}), tenantId };
          }

          if (CREATE_OPERATIONS.has(operation)) {
            const data = next.data;
            if (Array.isArray(data)) {
              next.data = data.map((row) => ({ ...(row as object), tenantId }));
            } else if (data && typeof data === 'object') {
              next.data = { ...(data as object), tenantId };
            }

            if (operation === 'upsert' && next.create && typeof next.create === 'object') {
              // `update` inside an upsert must not reassign the tenant.
              next.create = { ...(next.create as object), tenantId };
            }
          }

          return query(next);
        },
      },
    },
  });
}

/**
 * The client returned by `$extends` with a query-only extension.
 *
 * A query extension wraps `query` and leaves the model delegates alone, so the
 * extended client exposes exactly the same API. `ReturnType<PrismaClient['$extends']>`
 * resolves to an opaque overload result, which would make every model access
 * `unknown` at the call sites, so the type is named here instead.
 */
export type TenantClient = PrismaClient;
