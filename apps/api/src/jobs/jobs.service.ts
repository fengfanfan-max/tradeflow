import { Injectable } from '@nestjs/common';
import type { JobCreate, JobListQuery, JobSchedule, JobStatusChange } from '@tradeflow/shared';
import {
  ConflictError,
  InvalidTransitionError,
  NotFoundError,
  ScheduleConflictError,
  StaleWriteError,
} from '../common/errors';
import { NumberingService } from '../documents/numbering.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../prisma/client';

/**
 * Permitted job transitions.
 *
 * COMPLETED is reachable from IN_PROGRESS or directly from SCHEDULED, because a
 * small job is often finished on the first visit and nobody goes back to set the
 * middle state. CANCELLED is reachable from anywhere except COMPLETED — a
 * completed job is a fact that produced an invoice.
 */
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  SCHEDULED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async list(tenantId: string, query: JobListQuery) {
    const db = this.prisma.forTenant(tenantId);
    const rows = await db.job.findMany({
      where: {
        ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.from || query.to
          ? {
              scheduledStart: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lt: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ scheduledStart: 'asc' }],
      take: query.limit,
      include: baseInclude,
    });
    // `nextCursor: null` because this endpoint is capped rather than cursor-paged.
    // The envelope is uniform so the client needs one deserialiser — see
    // docs/api-routes.md, "List envelope".
    return { items: rows.map(serialize), total: rows.length, nextCursor: null };
  }

  async get(tenantId: string, id: string) {
    const job = await this.prisma.forTenant(tenantId).job.findFirst({
      where: { id },
      include: {
        ...baseInclude,
        statusEvents: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true } } } },
        invoices: { select: { id: true, number: true, status: true, grossTotal: true } },
        attachments: true,
      },
    });
    if (!job) throw new NotFoundError('Job');

    return {
      ...serialize(job),
      statusEvents: job.statusEvents.map((event) => ({
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        note: event.note,
        actor: event.actor?.name ?? null,
        createdAt: event.createdAt.toISOString(),
      })),
      invoices: job.invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        gross: { amount: invoice.grossTotal, currency: job.quote.currency },
      })),
      attachments: job.attachments.map((a) => ({
        id: a.id,
        kind: a.kind,
        filename: a.filename,
        byteSize: a.byteSize,
      })),
    };
  }

  /**
   * Turn an accepted quote into scheduled work.
   *
   * Only an ACCEPTED quote can produce a job: scheduling work the customer has
   * not agreed to is how a business ends up arguing about an invoice.
   */
  async create(tenantId: string, actorId: string, input: JobCreate) {
    const db = this.prisma.forTenant(tenantId);
    const quote = await db.quote.findFirst({ where: { id: input.quoteId } });
    if (!quote) throw new NotFoundError('Quote');
    if (quote.status !== 'ACCEPTED') {
      throw new InvalidTransitionError(quote.status, 'JOB', ['ACCEPTED']);
    }

    const start = new Date(input.scheduledStart);
    const end = new Date(input.scheduledEnd);
    if (end <= start) {
      throw new ConflictError('INVALID_TIME_RANGE', 'The end time must be after the start time.');
    }

    if (input.assigneeId) {
      await this.assertNoClash(tenantId, input.assigneeId, start, end);
    }

    const number = await this.numbering.next(tenantId, 'JOB');

    // The status event is written in the same transaction as the job, so there
    // is no window in which a job has a status that nothing explains.
    const created = await db.job.create({
      data: {
        tenantId,
        quoteId: quote.id,
        customerId: quote.customerId,
        siteId: quote.siteId,
        assigneeId: input.assigneeId,
        number,
        status: 'SCHEDULED',
        scheduledStart: start,
        scheduledEnd: end,
        notes: input.notes,
        statusEvents: {
          create: { toStatus: 'SCHEDULED', actorId, note: 'Created from accepted quote' },
        },
      },
      include: baseInclude,
    });

    return serialize(created);
  }

  /** Move a job in the diary. Same optimistic-concurrency rule as a quote. */
  async schedule(tenantId: string, actorId: string, id: string, input: JobSchedule) {
    const db = this.prisma.forTenant(tenantId);
    const job = await db.job.findFirst({ where: { id } });
    if (!job) throw new NotFoundError('Job');
    if (job.version !== input.expectedVersion) throw new StaleWriteError(job.version);
    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
      throw new ConflictError('JOB_CLOSED', `A ${job.status.toLowerCase()} job cannot be rescheduled.`);
    }

    const start = new Date(input.scheduledStart);
    const end = new Date(input.scheduledEnd);
    if (end <= start) {
      throw new ConflictError('INVALID_TIME_RANGE', 'The end time must be after the start time.');
    }

    if (input.assigneeId) {
      await this.assertNoClash(tenantId, input.assigneeId, start, end, id);
    }

    const updated = await db.job.update({
      where: { id },
      data: {
        assigneeId: input.assigneeId,
        scheduledStart: start,
        scheduledEnd: end,
        version: { increment: 1 },
      },
      include: baseInclude,
    });

    // Rescheduling is worth recording: "why did nobody turn up on Tuesday" is a
    // question the audit trail should answer.
    await db.jobStatusEvent.create({
      data: {
        jobId: id,
        fromStatus: job.status,
        toStatus: job.status,
        actorId,
        note: `Rescheduled to ${start.toISOString()}`,
      },
    });

    return serialize(updated);
  }

  async changeStatus(tenantId: string, actorId: string, id: string, input: JobStatusChange) {
    const db = this.prisma.forTenant(tenantId);
    const job = await db.job.findFirst({ where: { id } });
    if (!job) throw new NotFoundError('Job');

    const allowed = ALLOWED_TRANSITIONS[job.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new InvalidTransitionError(job.status, input.status, allowed);
    }
    if (input.status === 'COMPLETED' && !input.completionSummary?.trim()) {
      // The invoice is raised from this text, so an empty summary would produce
      // an invoice that says nothing about the work.
      throw new ConflictError(
        'COMPLETION_SUMMARY_REQUIRED',
        'Describe the work completed before closing the job — the invoice is raised from it.',
        { completionSummary: 'Required' },
      );
    }

    return db.$transaction(async (tx) => {
      const updated = await tx.job.update({
        where: { id },
        data: {
          status: input.status,
          version: { increment: 1 },
          ...(input.status === 'COMPLETED'
            ? { completedAt: new Date(), completionSummary: input.completionSummary }
            : {}),
        },
        include: baseInclude,
      });
      await tx.jobStatusEvent.create({
        data: {
          jobId: id,
          fromStatus: job.status,
          toStatus: input.status,
          note: input.note ?? input.completionSummary ?? null,
          actorId,
        },
      });
      return serialize(updated);
    });
  }

  /** Whether an engineer is free in a window — used by the booking form. */
  async availability(tenantId: string, assigneeId: string, start: string, end: string, excludeJobId?: string) {
    const conflicts = await this.findClashes(
      tenantId,
      assigneeId,
      new Date(start),
      new Date(end),
      excludeJobId,
    );
    return {
      available: conflicts.length === 0,
      conflicts: conflicts.map((job) => ({
        id: job.id,
        number: job.number,
        scheduledStart: job.scheduledStart.toISOString(),
        scheduledEnd: job.scheduledEnd.toISOString(),
      })),
    };
  }

  private async assertNoClash(
    tenantId: string,
    assigneeId: string,
    start: Date,
    end: Date,
    excludeJobId?: string,
  ): Promise<void> {
    const clash = (await this.findClashes(tenantId, assigneeId, start, end, excludeJobId))[0];
    if (clash) throw new ScheduleConflictError(clash);
  }

  /**
   * Overlap test: an existing booking clashes when it starts before the new one
   * ends *and* ends after it starts. Two jobs meeting exactly at a boundary do
   * not clash, which is what back-to-back appointments require.
   *
   * This is the courtesy check that produces a useful error. The guarantee is
   * the exclusion constraint in the migration — two requests can both pass this
   * and only one can commit.
   */
  private findClashes(
    tenantId: string,
    assigneeId: string,
    start: Date,
    end: Date,
    excludeJobId?: string,
  ) {
    return this.prisma.forTenant(tenantId).job.findMany({
      where: {
        assigneeId,
        status: { not: 'CANCELLED' },
        ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
        scheduledStart: { lt: end },
        scheduledEnd: { gt: start },
      },
      select: { id: true, number: true, scheduledStart: true, scheduledEnd: true },
    });
  }
}

/**
 * The relations every job response needs.
 *
 * `satisfies` rather than a type annotation, so the object keeps its literal
 * shape and `JobGetPayload` below can derive the exact row type from it. A hand
 * written row type drifts the moment an `include` changes; this cannot.
 */
const baseInclude = {
  customer: { select: { id: true, name: true } },
  site: { select: { id: true, label: true, line1: true, city: true, postcode: true } },
  assignee: { select: { id: true, name: true } },
  quote: { select: { id: true, number: true, currency: true, status: true } },
} satisfies Prisma.JobInclude;

type JobRow = Prisma.JobGetPayload<{ include: typeof baseInclude }>;

function serialize(row: JobRow) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    version: row.version,
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    completionSummary: row.completionSummary,
    notes: row.notes,
    customer: row.customer,
    site: {
      id: row.site.id,
      label: row.site.label,
      address: [row.site.line1, row.site.city, row.site.postcode].filter(Boolean).join(', '),
    },
    assignee: row.assignee,
    quote: row.quote,
    currency: row.quote.currency,
  };
}
