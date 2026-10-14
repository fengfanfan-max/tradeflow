import { Injectable } from '@nestjs/common';
import type { CustomerCreate, CustomerUpdate, PaginationQuery } from '@tradeflow/shared';
import { NotFoundError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: PaginationQuery) {
    const db = this.prisma.forTenant(tenantId);
    const where = {
      archivedAt: null,
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };

    // Fetch one extra row to know whether a next page exists, rather than
    // running a second count query on every page load.
    const rows = await db.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { _count: { select: { sites: true, jobs: true } } },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const total = await db.customer.count({ where });

    return {
      items: page.map(serialize),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      total,
    };
  }

  async get(tenantId: string, id: string) {
    const customer = await this.prisma.forTenant(tenantId).customer.findFirst({
      where: { id },
      include: { sites: { where: { archivedAt: null }, orderBy: { label: 'asc' } } },
    });
    if (!customer) throw new NotFoundError('Customer');
    return { ...serialize(customer), sites: customer.sites.map(serializeSite) };
  }

  async create(tenantId: string, input: CustomerCreate) {
    const created = await this.prisma.forTenant(tenantId).customer.create({
      data: {
        // The extension injects this at runtime, but Prisma's input type asks
        // for it, so it is passed explicitly. The two agree because both come
        // from the caller's validated token.
        tenantId,
        name: input.name,
        email: input.email,
        phone: input.phone,
        notes: input.notes,
        billingLine1: input.billingAddress?.line1,
        billingLine2: input.billingAddress?.line2,
        billingCity: input.billingAddress?.city,
        billingPostcode: input.billingAddress?.postcode,
        billingCountry: input.billingAddress?.country,
      },
    });
    return serialize(created);
  }

  async update(tenantId: string, id: string, input: CustomerUpdate) {
    // Confirm the row is visible to this tenant first; an update on a record
    // that belongs elsewhere must read as "not found", not as a silent no-op.
    await this.get(tenantId, id);

    const updated = await this.prisma.forTenant(tenantId).customer.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.billingAddress ? {
          billingLine1: input.billingAddress.line1,
          billingLine2: input.billingAddress.line2,
          billingCity: input.billingAddress.city,
          billingPostcode: input.billingAddress.postcode,
          billingCountry: input.billingAddress.country,
        } : {}),
      },
    });
    return serialize(updated);
  }

  /**
   * Archive rather than delete.
   *
   * A customer is referenced by quotes, jobs and invoices; deleting one would
   * either cascade away financial history or fail on a foreign key. Archive is
   * what the domain actually wants — stop offering them in pickers, keep the
   * record.
   */
  async archive(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.prisma.forTenant(tenantId).customer.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return { id, archived: true };
  }

  async listSites(tenantId: string, customerId: string) {
    const sites = await this.prisma.forTenant(tenantId).site.findMany({
      where: { customerId, archivedAt: null },
      orderBy: { label: 'asc' },
    });
    return sites.map(serializeSite);
  }

  async createSite(tenantId: string, input: {
    customerId: string;
    label: string;
    address: { line1: string; line2?: string; city: string; postcode: string; country: string };
    accessNotes?: string;
  }) {
    const created = await this.prisma.forTenant(tenantId).site.create({
      data: {
        tenantId,
        customerId: input.customerId,
        label: input.label,
        line1: input.address.line1,
        line2: input.address.line2,
        city: input.address.city,
        postcode: input.address.postcode,
        country: input.address.country,
        accessNotes: input.accessNotes,
      },
    });
    return serializeSite(created);
  }
}

type CustomerRow = {
  id: string; name: string; email: string | null; phone: string | null; notes: string | null;
  billingLine1: string | null; billingLine2: string | null; billingCity: string | null;
  billingPostcode: string | null; billingCountry: string | null; createdAt: Date; updatedAt: Date;
  _count?: { sites: number; jobs: number };
};

function serialize(row: CustomerRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    billingAddress: row.billingLine1
      ? {
          line1: row.billingLine1,
          line2: row.billingLine2 ?? undefined,
          city: row.billingCity ?? '',
          postcode: row.billingPostcode ?? '',
          country: row.billingCountry ?? 'GB',
        }
      : null,
    counts: row._count ? { sites: row._count.sites, jobs: row._count.jobs } : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type SiteRow = {
  id: string; customerId: string; label: string; line1: string; line2: string | null;
  city: string; postcode: string; country: string; accessNotes: string | null;
};

function serializeSite(row: SiteRow) {
  return {
    id: row.id,
    customerId: row.customerId,
    label: row.label,
    address: {
      line1: row.line1,
      line2: row.line2 ?? undefined,
      city: row.city,
      postcode: row.postcode,
      country: row.country,
    },
    accessNotes: row.accessNotes,
  };
}
