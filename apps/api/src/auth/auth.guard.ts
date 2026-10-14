import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '@tradeflow/shared';
import { ForbiddenError, UnauthorizedError } from '../common/errors';

export interface JwtPayload {
  sub: string;
  tid: string;
  role: UserRole;
  email: string;
  name: string;
}

/** The authenticated principal for the current request. */
export interface Principal {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
  name: string;
}

const IS_PUBLIC = 'isPublic';
const ROLES = 'roles';

/**
 * Marks a route as reachable without a token.
 *
 * Opt-out rather than opt-in: a new endpoint is protected unless someone
 * deliberately says otherwise, so forgetting an annotation fails closed.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const request = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    if (!request.principal) throw new UnauthorizedError();
    return request.principal;
  },
);

/** Sugar for the common case of only needing the tenant. */
export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
  if (!request.principal) throw new UnauthorizedError();
  return request.principal.tenantId;
});

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: Principal }>();

    // A public route still resolves the token when one is present, so an
    // endpoint can behave differently for a signed-in user without a second
    // guard.
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const payload = await this.jwt.verifyAsync<JwtPayload>(header.slice(7));
        request.principal = {
          userId: payload.sub,
          tenantId: payload.tid,
          role: payload.role,
          email: payload.email,
          name: payload.name,
        };
      } catch {
        if (!isPublic) throw new UnauthorizedException('Token is invalid or expired.');
      }
    } else if (!isPublic) {
      throw new UnauthorizedException('Authentication required.');
    }

    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && request.principal && !required.includes(request.principal.role)) {
      throw new ForbiddenError(
        `This action requires one of: ${required.join(', ')}.`,
      );
    }

    return true;
  }
}
