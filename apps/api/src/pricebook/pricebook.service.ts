import { Injectable } from '@nestjs/common';
import type { PriceBookItemCreate, PriceBookItemUpdate } from '@tradeflow/shared';
import { ConflictError, NotFoundError } from '../common/errors';
import { asMoney } from '../common/serialize';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PriceBookService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: { q?: string; active?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const rows = await db.priceBookItem.findMany({
      where: {
        ...(query.active === 'false' ? {} : { active: true }),
        ...(query.q
          ? {
              OR: [
                { code: { contains: query.q, mode: 'insensitive' as const } },
                { description: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ active: 'desc' }, { code: 'asc' }],
      take: 200,
    });
    return { items: rows.map(serialize), total: rows.length };
  }

  async create(tenantId: string, input: PriceBookItemCreate) {
    const db = this.prisma.forTenant(tenantId);
    const duplicate = await db.priceBookItem.findFirst({ where: { code: input.code } });
    if (duplicate) {
      // Checked here so the caller gets a field-level error rather than the
      // generic unique-violation mapping in the filter.
      throw new ConflictError('DUPLICATE', 'That code is already in the price book.', {
        code: 'Already in use.',
      });
    }
    const created = await db.priceBookItem.create({
      data: {
        tenantId,
        code: input.code,
        description: input.description,
        unit: input.unit,
        unitPrice: input.unitPrice.amount,
        taxRateBp: input.taxRateBp,
      },
    });
    return serialize(created);
  }

  async update(tenantId: string, id: string, input: PriceBookItemUpdate) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.priceBookItem.findFirst({ where: { id } });
    if (!existing) throw new NotFoundError('Price book item');

    const updated = await db.priceBookItem.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.unitPrice !== undefined ? { unitPrice: input.unitPrice.amount } : {}),
        ...(input.taxRateBp !== undefined ? { taxRateBp: input.taxRateBp } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    return serialize(updated);
  }
}

type Row = {
  id: string; code: string; description: string; unit: string;
  unitPrice: number; taxRateBp: number; active: boolean;
};

function serialize(row: Row) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    unit: row.unit,
    unitPrice: asMoney(row.unitPrice, 'GBP'),
    taxRateBp: row.taxRateBp,
    active: row.active,
  };
}
