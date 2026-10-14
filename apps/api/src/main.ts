import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc, ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { ProblemFilter } from './common/problem.filter';
import { ENV, corsOrigins, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const env = app.get<Env>(ENV);
  const logger = new Logger('bootstrap');

  // Validation comes from the same Zod schemas the browser uses, so a rule
  // cannot be enforced on one side and forgotten on the other.
  // Zod is the only validator. Nest's ValidationPipe is deliberately not
  // registered: it needs `class-validator` and would mean maintaining a second
  // set of rules for the same fields, with the two drifting apart in exactly the
  // place a mismatch is expensive.
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemFilter());

  app.setGlobalPrefix('api');

  // The API authenticates with a bearer token rather than a cookie, so it is not
  // subject to CSRF and does not need credentialed CORS. In production the web
  // app is same-origin through the platform's rewrite, and this list is the
  // narrow allowlist for local development.
  app.enableCors({ origin: corsOrigins(env), credentials: false });

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Tradeflow API')
      .setDescription(
        'Job management for trade businesses: customers, quotes, jobs, scheduling and invoicing.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
    SwaggerModule.setup('api/docs', app, document);
  }

  // The platform routes to this port; binding all interfaces keeps it reachable
  // inside a container.
  await app.listen(env.PORT, '0.0.0.0');

  logger.log(`API listening on :${env.PORT} (${env.NODE_ENV})`);
  if (env.NODE_ENV !== 'production') {
    logger.log(`OpenAPI documentation at http://localhost:${env.PORT}/api/docs`);
  }
}

void bootstrap();
