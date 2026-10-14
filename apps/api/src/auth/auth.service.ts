import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Session } from '@tradeflow/shared';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from './password';
import type { JwtPayload } from './auth.guard';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Sign in.
   *
   * Email is unique per tenant rather than globally, so a login form that only
   * asks for an email cannot identify a user on its own. This demo has one
   * tenant, so the lookup is unambiguous; a multi-tenant deployment would ask
   * for the business slug as well, and this is where that would change.
   */
  async login(email: string, password: string): Promise<{ token: string; session: Session }> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), active: true },
      include: { tenant: true },
    });

    // Hash a throwaway value when the user is missing so that the response time
    // does not reveal whether the address exists.
    if (!user) {
      await verifyPassword(password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Email or password is incorrect.');

    const payload: JwtPayload = {
      sub: user.id,
      tid: user.tenantId,
      role: user.role,
      email: user.email,
      name: user.name,
    };

    return {
      token: await this.jwt.signAsync(payload),
      session: {
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        currency: user.tenant.currency as 'GBP' | 'USD' | 'EUR',
      },
      },
    };
  }

  /** Who the token says you are. Used by the web app on load. */
  async session(payload: JwtPayload): Promise<Session> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub },
      include: { tenant: true },
    });
    if (!user) throw new UnauthorizedException();
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        currency: user.tenant.currency as 'GBP' | 'USD' | 'EUR',
      },
    };
  }
}
