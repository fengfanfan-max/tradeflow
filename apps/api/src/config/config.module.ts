import { Global, Module } from '@nestjs/common';
import { ENV, validateEnv, type Env } from './env';

/**
 * Global so that any provider can inject `Env` without importing this module.
 * There is exactly one configuration and it is immutable for the process
 * lifetime, so re-providing it per feature module would only add noise.
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => validateEnv(process.env),
    },
  ],
  exports: [ENV],
})
export class AppConfigModule {}
