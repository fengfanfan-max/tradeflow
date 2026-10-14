import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { ENV, type Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './auth.guard';
import { UsersController } from './users.controller';

/**
 * Global because the guard is registered application-wide: every route is
 * authenticated unless it is explicitly marked `@Public()`. Registering the
 * guard here rather than in each feature module is what makes "forgot to
 * protect this endpoint" impossible.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env): JwtModuleOptions => ({
        secret: env.JWT_SECRET,
        // `expiresIn` is typed as a template-literal union ("8h", "30d", …) so
        // that a typo is caught; the value arrives as a plain string from the
        // environment, where the shape cannot be expressed.
        signOptions: { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] },
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [JwtModule, AuthService],
})
export class AuthModule {}
