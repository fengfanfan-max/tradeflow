import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import type { Response } from 'express';
import { Prisma } from '../prisma/client';
import { DomainError } from './errors';

/**
 * One error shape for every failure.
 *
 * The client parses a single `Problem` object regardless of whether the failure
 * came from validation, the domain, Prisma or an unexpected crash. Without this
 * the browser has to distinguish Nest's `{ statusCode, message }`, Zod's
 * `{ errors: [...] }` and a raw stack trace, and it ends up switching on
 * substrings of English prose.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    const problem = this.toProblem(exception);

    if (problem.statusCode >= 500) {
      // 5xx means the request found a bug. Log the cause with the stack; the
      // client is told only that it failed, because the internals are not its
      // business and the details can be sensitive.
      this.logger.error(
        `${problem.code}: ${problem.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(problem.statusCode).json(problem);
  }

  private toProblem(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
    fields?: Record<string, string>;
  } {
    if (exception instanceof DomainError) {
      return {
        statusCode: exception.status,
        code: exception.code,
        message: exception.message,
        ...(exception.fields ? { fields: exception.fields } : {}),
      };
    }

    // nestjs-zod splits into "the request was malformed" and "the response did
    // not match its schema". The second is our bug, not the client's.
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as {
        issues: { path: (string | number)[]; message: string }[];
      };
      const fields: Record<string, string> = {};
      for (const issue of zodError.issues) {
        const path = issue.path.join('.') || '(body)';
        // First issue per field: showing three complaints about one input is
        // noise on a form.
        fields[path] ??= issue.message;
      }
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_FAILED',
        message: 'The request contains invalid values.',
        fields,
      };
    }

    if (exception instanceof ZodSerializationException) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'RESPONSE_INVALID',
        message: 'The server produced a response that does not match its contract.',
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      // A malformed query is a programming error, so it is a 500 rather than a
      // 400 — the client sent something the schema allowed.
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'QUERY_INVALID',
        message: 'The request could not be served.',
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
      return {
        statusCode: status,
        code: this.codeForStatus(status),
        message: Array.isArray(message) ? message.join(' ') : message,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong.',
    };
  }

  private fromPrisma(exception: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    code: string;
    message: string;
    fields?: Record<string, string>;
  } {
    switch (exception.code) {
      case 'P2002': {
        // Unique violation. The target tells us which one, which is what the
        // form needs to highlight the right input.
        const target = (exception.meta?.target as string[] | string | undefined) ?? [];
        const fields = Object.fromEntries(
          (Array.isArray(target) ? target : [target]).map((field) => [field, 'Already in use.']),
        );
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'DUPLICATE',
          message: 'That value is already taken.',
          fields,
        };
      }
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Not found.',
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'INVALID_REFERENCE',
          message: 'A referenced record does not exist.',
        };
      case 'P2034':
        // Prisma's serialisation failure from a transaction conflict. Retryable.
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'CONCURRENT_WRITE',
          message: 'Another change was saved at the same time. Try again.',
        };
      default:
        // Includes 23P01, which is how the schedule exclusion constraint
        // surfaces. The service checks for a clash and raises
        // ScheduleConflictError first; this is the race that got past the check.
        if (typeof exception.message === 'string' && exception.message.includes('23P01')) {
          return {
            statusCode: HttpStatus.CONFLICT,
            code: 'SCHEDULE_CONFLICT',
            message: 'That engineer was booked for an overlapping time just now.',
          };
        }
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'DATABASE_ERROR',
          message: 'The request could not be served.',
        };
    }
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHENTICATED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return 'ERROR';
    }
  }
}
