import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './client';
import { ENV, type Env } from '../config/env';
import { tenantExtension, type TenantClient } from './tenant-scope';

/**
 * The Prisma client.
 *
 * Prisma 7 requires a driver adapter rather than a connection URL in the schema.
 * That is not only ceremony: it means this application — not a generated client —
 * owns the connection pool, so pool sizing can be tuned per environment.
 *
 * See docs/adr/0002-prisma-driver-adapters.md.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly tenantClients = new Map<string, TenantClient>();

  constructor(@Inject(ENV) env: Env) {
    // Serverless database proxies terminate TLS with a certificate this process
    // does not have in its trust store. Disabling verification is the usual
    // setting for them and is recorded here rather than hidden in a connection
    // string, so it is a visible decision.
    const behindProxy = /neon\.tech|supabase|rds\.amazonaws\.com|proxy|localhost|127\.0\.0\.1/.test(
      env.DATABASE_URL,
    );

    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        max: env.NODE_ENV === 'production' ? 10 : 5,
        ...(behindProxy && env.NODE_ENV === 'production'
          ? { ssl: { rejectUnauthorized: false } }
          : {}),
      }),
      log: ['warn', 'error'],
    });
  }

  /**
   * A client whose every query is filtered by tenant.
   *
   * Cached per tenant because building the extension allocates a proxy, and a
   * request typically issues several queries.
   */
  forTenant(tenantId: string): TenantClient {
    let client = this.tenantClients.get(tenantId);
    if (!client) {
      // The cast is confined to this one line. See the note on TenantClient.
      client = this.$extends(tenantExtension(tenantId)) as unknown as TenantClient;
      this.tenantClients.set(tenantId, client);
    }
    return client;
  }

  async onModuleDestroy(): Promise<void> {
    this.tenantClients.clear();
    await this.$disconnect();
    this.logger.log('Disconnected from the database');
  }
}
