import { createZodDto } from 'nestjs-zod';
import {
  customerCreateSchema,
  customerUpdateSchema,
  draftQuoteRequestSchema,
  invoiceCreateSchema,
  invoiceListQuerySchema,
  invoiceMarkPaidSchema,
  jobCreateSchema,
  jobListQuerySchema,
  jobScheduleSchema,
  jobStatusChangeSchema,
  loginRequestSchema,
  paginationQuerySchema,
  priceBookItemCreateSchema,
  priceBookItemUpdateSchema,
  quoteCreateSchema,
  quoteDecisionSchema,
  quoteListQuerySchema,
  quoteUpdateSchema,
  siteCreateSchema,
  siteUpdateSchema,
} from '@tradeflow/shared';

/**
 * The adapter between the shared Zod contracts and Nest's decorator-based
 * routing.
 *
 * The schemas themselves live in `packages/shared`, where the browser imports
 * the same objects to validate its forms. This file only wraps them so that
 * Nest's validation pipe and Swagger can see them — one place where the contract
 * meets the framework, rather than a class per endpoint duplicated on both
 * sides.
 *
 * `createZodDto` reads the schema, so Swagger's request bodies stay in step with
 * validation automatically. What it cannot infer — response shapes, which are
 * plain objects rather than a class with decorators — is declared in
 * `docs/openapi.json`, emitted by `pnpm --filter @tradeflow/api openapi`.
 */
export class LoginRequestDto extends createZodDto(loginRequestSchema) {}
export class PaginationQueryDto extends createZodDto(paginationQuerySchema) {}

export class CustomerCreateDto extends createZodDto(customerCreateSchema) {}
export class CustomerUpdateDto extends createZodDto(customerUpdateSchema) {}

export class SiteCreateDto extends createZodDto(siteCreateSchema) {}
export class SiteUpdateDto extends createZodDto(siteUpdateSchema) {}

export class PriceBookItemCreateDto extends createZodDto(priceBookItemCreateSchema) {}
export class PriceBookItemUpdateDto extends createZodDto(priceBookItemUpdateSchema) {}

export class QuoteListQueryDto extends createZodDto(quoteListQuerySchema) {}
export class QuoteCreateDto extends createZodDto(quoteCreateSchema) {}
export class QuoteUpdateDto extends createZodDto(quoteUpdateSchema) {}
export class QuoteDecisionDto extends createZodDto(quoteDecisionSchema) {}

export class JobListQueryDto extends createZodDto(jobListQuerySchema) {}
export class InvoiceListQueryDto extends createZodDto(invoiceListQuerySchema) {}
export class JobCreateDto extends createZodDto(jobCreateSchema) {}
export class JobScheduleDto extends createZodDto(jobScheduleSchema) {}
export class JobStatusChangeDto extends createZodDto(jobStatusChangeSchema) {}

export class InvoiceCreateDto extends createZodDto(invoiceCreateSchema) {}
export class InvoiceMarkPaidDto extends createZodDto(invoiceMarkPaidSchema) {}

export class DraftQuoteRequestDto extends createZodDto(draftQuoteRequestSchema) {}
