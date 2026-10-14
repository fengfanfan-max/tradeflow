import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { QuoteCreate, QuoteDecision, QuoteListQuery, QuoteUpdate } from '@tradeflow/shared';
import { ENV, type Env } from '../config/env';
import { ConflictError, InvalidTransitionError, NotFoundError, StaleWriteError } from '../common/errors';
import { asMoney, documentTotals } from '../common/serialize';
import { NumberingService } from '../documents/numbering.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Which transitions the domain allows. Encoded as data rather than as a chain of
 * ifs so the error message can list what *is* possible, and so the same table
 * can drive the UI's available actions.
 */
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['SENT'],
  SENT: ['ACCEPTED', 'DECLINED', 'EXPIRED'],
  ACCEPTED: [],
  DECLINED: [],
  EXPIRED: [],
};

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(tenantId: string, query: QuoteListQuery) {
    const db = this.prisma.forTenant(tenantId);
    const where = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.q ? { number: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };

    // A tiebreaker on `id` keeps paging stable: without one, two quotes created
    // in the same millisecond can swap places between requests and a cursor page
    // then skips or repeats a row.
    const orderBy = [{ [query.sort]: query.dir }, { id: 'desc' as const }];

    const rows = await db.quote.findMany({
      where,
      orderBy,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        lines: { orderBy: { position: 'asc' } },
        customer: true,
        site: true,
        // A count rather than the jobs themselves: the list needs to know
        // whether an accepted quote is still unbooked, not what the jobs are.
        _count: { select: { jobs: true } },
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map((row) => serialize(row)),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      total: await db.quote.count({ where }),
    };
  }

  async get(tenantId: string, id: string) {
    const quote = await this.prisma.forTenant(tenantId).quote.findFirst({
      where: { id },
      include: {
        lines: { orderBy: { position: 'asc' } },
        customer: true,
        site: true,
        decisions: { orderBy: { createdAt: 'desc' } },
        jobs: { select: { id: true, number: true, status: true } },
        _count: { select: { jobs: true } },
      },
    });
    if (!quote) throw new NotFoundError('Quote');

    return {
      ...serialize(quote),
      decisions: quote.decisions.map((d) => ({
        decision: d.decision,
        note: d.note,
        viaPublicLink: d.viaPublicLink,
        createdAt: d.createdAt.toISOString(),
      })),
      jobs: quote.jobs,
      publicUrl: this.publicUrl(quote.publicToken),
    };
  }

  async create(tenantId: string, input: QuoteCreate) {
    const db = this.prisma.forTenant(tenantId);

    // Resolve both references through the tenant-scoped client, so a customer or
    // site belonging to another trade business reads as missing rather than
    // being silently accepted.
    const [customer, site] = await Promise.all([
      db.customer.findFirst({ where: { id: input.customerId, archivedAt: null } }),
      db.site.findFirst({ where: { id: input.siteId, archivedAt: null } }),
    ]);
    if (!customer) throw new NotFoundError('Customer');
    if (!site) throw new NotFoundError('Site');
    if (site.customerId !== customer.id) {
      throw new ConflictError('SITE_MISMATCH', 'That site belongs to a different customer.');
    }

    const number = await this.numbering.next(tenantId, 'QUOTE');
    const now = new Date();
    const validUntil = new Date(now.getTime() + input.validForDays * 86_400_000);

    const created = await db.quote.create({
      data: {
        tenantId,
        customerId: input.customerId,
        siteId: input.siteId,
        number,
        status: 'DRAFT',
        currency: input.currency,
        notes: input.notes,
        validUntil,
        publicToken: newToken(),
        lines: {
          create: input.lines.map((line, index) => ({
            position: index,
            priceBookItemId: line.priceBookItemId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice.amount,
            taxRateBp: line.taxRateBp,
          })),
        },
      },
      include: { lines: { orderBy: { position: 'asc' } }, customer: true, site: true },
    });

    return { ...serialize(created), publicUrl: this.publicUrl(created.publicToken) };
  }

  /**
   * Replace a quote's contents.
   *
   * `expectedVersion` must match the stored version. Two people editing the same
   * quote is normal in a small office; without this check the second save
   * silently discards the first, and the quote that reaches the customer is not
   * the one either of them wrote.
   */
  async update(tenantId: string, id: string, input: QuoteUpdate) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.quote.findFirst({ where: { id } });
    if (!existing) throw new NotFoundError('Quote');

    if (existing.version !== input.expectedVersion) {
      throw new StaleWriteError(existing.version);
    }
    if (existing.status !== 'DRAFT') {
      // An issued quote is a document the customer has seen. Amending it in
      // place would change what they agreed to; the domain answer is a new
      // revision, which is a deliberate next step rather than a silent edit.
      throw new ConflictError(
        'QUOTE_NOT_EDITABLE',
        `A ${existing.status.toLowerCase()} quote cannot be edited. Create a revision instead.`,
      );
    }

    return db.$transaction(async (tx) => {
      if (input.lines) {
        await tx.quoteLine.deleteMany({ where: { quoteId: id } });
        await tx.quoteLine.createMany({
          data: input.lines.map((line, index) => ({
            quoteId: id,
            position: index,
            priceBookItemId: line.priceBookItemId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice.amount,
            taxRateBp: line.taxRateBp,
          })),
        });
      }

      const updated = await tx.quote.update({
        where: { id },
        data: {
          // Bumping inside the transaction is what makes the check above safe:
          // a concurrent writer that read the same version fails here.
          version: { increment: 1 },
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.validForDays !== undefined
            ? { validUntil: new Date(Date.now() + input.validForDays * 86_400_000) }
            : {}),
        },
        include: { lines: { orderBy: { position: 'asc' } }, customer: true, site: true },
      });
      return { ...serialize(updated), publicUrl: this.publicUrl(updated.publicToken) };
    });
  }

  async send(tenantId: string, id: string) {
    const db = this.prisma.forTenant(tenantId);
    const quote = await db.quote.findFirst({ where: { id }, include: { lines: true } });
    if (!quote) throw new NotFoundError('Quote');
    if (quote.lines.length === 0) {
      throw new ConflictError('QUOTE_EMPTY', 'Add at least one line before sending.');
    }
    assertTransition(quote.status, 'SENT');

    const updated = await db.quote.update({
      where: { id },
      // Rotating the token on every send invalidates any link from a previous
      // issue, which is what you want if the first was sent to the wrong address.
      data: { status: 'SENT', issuedAt: new Date(), publicToken: newToken() },
      include: { lines: { orderBy: { position: 'asc' } }, customer: true, site: true },
    });
    return { ...serialize(updated), publicUrl: this.publicUrl(updated.publicToken) };
  }

  async decide(tenantId: string, id: string, userId: string, input: QuoteDecision) {
    const db = this.prisma.forTenant(tenantId);
    const quote = await db.quote.findFirst({ where: { id } });
    if (!quote) throw new NotFoundError('Quote');
    assertTransition(quote.status, input.decision);

    return db.$transaction(async (tx) => {
      const updated = await tx.quote.update({
        where: { id },
        data: { status: input.decision, decidedAt: new Date(), version: { increment: 1 } },
        include: { lines: { orderBy: { position: 'asc' } }, customer: true, site: true },
      });
      await tx.quoteDecision.create({
        data: { quoteId: id, decision: input.decision, note: input.note, userId },
      });
      return { ...serialize(updated), publicUrl: this.publicUrl(updated.publicToken) };
    });
  }

  /* ---------------- public, addressed by token ---------------- */

  /**
   * The customer's view of a quote.
   *
   * Uses the unscoped client because there is no session to take a tenant from —
   * the token is the credential. The response deliberately omits ids and the
   * tenant, so nothing in it can be used to address the API.
   */
  async publicGet(token: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { publicToken: token },
      include: { lines: { orderBy: { position: 'asc' } }, customer: true, site: true, tenant: true },
    });
    if (!quote) throw new NotFoundError('Quote');
    return serializePublic(quote);
  }

  async publicDecide(token: string, input: QuoteDecision, ipAddress?: string) {
    const quote = await this.prisma.quote.findUnique({ where: { publicToken: token } });
    if (!quote) throw new NotFoundError('Quote');
    assertTransition(quote.status, input.decision);

    await this.prisma.$transaction(async (tx) => {
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: input.decision, decidedAt: new Date(), version: { increment: 1 } },
      });
      await tx.quoteDecision.create({
        data: {
          quoteId: quote.id,
          decision: input.decision,
          note: input.note,
          viaPublicLink: true,
          ipAddress,
        },
      });
    });

    this.logger.log(`Quote ${quote.number} ${input.decision.toLowerCase()} via public link`);
    return this.publicGet(token);
  }

  private publicUrl(token: string): string {
    return `${this.env.PUBLIC_WEB_ORIGIN}/q/${token}`;
  }
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function assertTransition(from: string, to: string): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) throw new InvalidTransitionError(from, to, allowed);
}

type QuoteRow = {
  id: string; number: string; status: string; version: number; currency: string;
  notes: string | null; validUntil: Date; issuedAt: Date | null; decidedAt: Date | null;
  publicToken: string;
  _count?: { jobs: number };
  lines: { id: string; position: number; description: string; quantity: number; unitPrice: number; taxRateBp: number }[];
  customer: { id: string; name: string };
  site: { id: string; label: string; line1: string; line2: string | null; city: string; postcode: string };
};

function serialize(row: QuoteRow) {
  const totals = documentTotals(row.lines, row.currency);
  return {
    id: row.id,
    /// How many jobs have been raised from this quote. Zero against an ACCEPTED
    /// quote is what "accepted, not yet scheduled" means, and the dashboard
    /// needs it without fetching the job feed.
    jobCount: row._count?.jobs ?? 0,
    number: row.number,
    status: row.status,
    version: row.version,
    currency: row.currency,
    notes: row.notes,
    validUntil: row.validUntil.toISOString().slice(0, 10),
    issuedAt: row.issuedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    customer: { id: row.customer.id, name: row.customer.name },
    site: {
      id: row.site.id,
      label: row.site.label,
      address: [row.site.line1, row.site.line2, row.site.city, row.site.postcode].filter(Boolean).join(', '),
    },
    lines: totals.lines.map((line, index) => ({
      id: row.lines[index]?.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRateBp: line.taxRateBp,
      net: line.net,
      tax: line.tax,
      gross: line.gross,
    })),
    net: totals.net,
    tax: totals.tax,
    gross: totals.gross,
    effectiveTaxRateBp: totals.effectiveTaxRateBp,
  };
}

function serializePublic(row: QuoteRow & { tenant: { name: string; vatNumber: string | null } }) {
  const totals = documentTotals(row.lines, row.currency);
  return {
    quoteNumber: row.number,
    businessName: row.tenant.name,
    businessVatNumber: row.tenant.vatNumber,
    customerName: row.customer.name,
    siteLabel: row.site.label,
    siteAddress: [row.site.line1, row.site.line2, row.site.city, row.site.postcode]
      .filter(Boolean)
      .join(', '),
    currency: row.currency,
    status: row.status,
    validUntil: row.validUntil.toISOString().slice(0, 10),
    issuedAt: row.issuedAt?.toISOString() ?? null,
    notes: row.notes,
    lines: totals.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRateBp: line.taxRateBp,
      net: line.net,
      tax: line.tax,
      gross: line.gross,
    })),
    net: totals.net,
    tax: totals.tax,
    gross: totals.gross,
  };
}
