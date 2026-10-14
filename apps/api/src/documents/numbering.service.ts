import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type DocumentKind = 'QUOTE' | 'JOB' | 'INVOICE';

const PREFIX: Record<DocumentKind, string> = {
  QUOTE: 'Q',
  JOB: 'J',
  INVOICE: 'INV',
};

/**
 * Per-tenant document numbers.
 *
 * Uses the *unscoped* client deliberately. The counter row is addressed by a
 * compound key that already contains the tenant id, so the tenant-scoping
 * extension has nothing to add and would only make the selector harder to read.
 * `tenantId` is a required argument, so a caller cannot forget it — the
 * compiler stops them, which is the same guarantee the extension provides
 * elsewhere by a different mechanism.
 *
 * The increment is a single `upsert` with `RETURNING`, which takes a row lock.
 * `MAX(number) + 1` would be simpler and wrong twice over: two concurrent saves
 * read the same maximum, and deleting a draft hands its number to the next
 * document. An auditor asks about gaps; they ask harder about reuse.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  async next(tenantId: string, kind: DocumentKind): Promise<string> {
    const year = new Date().getUTCFullYear();
    const key = `${kind}-${year}`;

    const counter = await this.prisma.documentCounter.upsert({
      where: { tenantId_kind: { tenantId, kind: key } },
      create: { tenantId, kind: key, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
    });

    const sequence = counter.nextValue - 1;
    return `${PREFIX[kind]}-${year}-${String(sequence).padStart(4, '0')}`;
  }
}
