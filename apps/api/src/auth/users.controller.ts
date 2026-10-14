import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type Principal } from './auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import type { UserRole } from '@tradeflow/shared';

/**
 * The tenant's staff.
 *
 * Needed by the scheduling screen, which has to offer a list of engineers to
 * assign work to. Never returns `passwordHash` — the select is explicit for that
 * reason rather than relying on the caller to strip it.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Staff in this business' })
  async list(
    @CurrentUser() user: Principal,
    @Query('role') role?: UserRole,
    @Query('active') active?: string,
  ) {
    const rows = await this.prisma.forTenant(user.tenantId).user.findMany({
      where: {
        ...(role ? { role } : {}),
        ...(active === 'all' ? {} : { active: true }),
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    return { items: rows, total: rows.length, nextCursor: null };
  }
}
