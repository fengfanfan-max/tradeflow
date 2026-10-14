import { Inject, Injectable } from '@nestjs/common';
import { draftQuoteResponseSchema, type DraftQuoteRequest, type DraftQuoteResponse } from '@tradeflow/shared';
import { ENV, type Env } from '../config/env';
import { NotFoundError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { HeuristicDraftProvider } from './heuristic';
import { LlmDraftProvider } from './llm';
import type { DraftProvider } from './types';

@Injectable()
export class AiService {
  private readonly provider: DraftProvider;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    const heuristic = new HeuristicDraftProvider();
    this.provider =
      env.AI_PROVIDER === 'llm' && env.OPENAI_API_KEY
        ? new LlmDraftProvider(
            {
              apiKey: env.OPENAI_API_KEY,
              baseUrl: env.OPENAI_BASE_URL,
              model: env.OPENAI_MODEL,
            },
            heuristic,
          )
        : heuristic;
  }

  /**
   * Suggest priced lines for a customer's brief.
   *
   * Reads only — nothing is written. The operator accepts suggestions one at a
   * time, which is the difference between a tool that saves typing and one that
   * puts unverified prices in front of a customer.
   */
  async draftQuote(tenantId: string, input: DraftQuoteRequest): Promise<DraftQuoteResponse> {
    const db = this.prisma.forTenant(tenantId);

    const customer = await db.customer.findFirst({ where: { id: input.customerId } });
    if (!customer) throw new NotFoundError('Customer');

    const priceBook = await db.priceBookItem.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
      take: 500,
    });

    const result = await this.provider.draft({
      brief: input.brief,
      priceBook: priceBook.map((entry) => ({
        id: entry.id,
        code: entry.code,
        description: entry.description,
        unit: entry.unit,
        unitPrice: entry.unitPrice,
        taxRateBp: entry.taxRateBp,
      })),
    });

    // Validated on the way out as well as on the way in: a provider is an
    // external boundary even when it is local code, and the browser parses this
    // with the same schema.
    return draftQuoteResponseSchema.parse(result);
  }
}
