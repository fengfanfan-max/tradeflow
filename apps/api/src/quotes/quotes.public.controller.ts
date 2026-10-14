import { Body, Controller, Ip, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Get } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { Public } from '../auth/auth.guard';
import { QuoteDecisionDto } from '../common/dto';

/**
 * The customer's side of a quote, addressed by an unguessable token rather than
 * by a session.
 *
 * Marked `@Public()` at the class level so a route added here later cannot be
 * forgotten. The token is 256 bits from a CSPRNG, and the response carries no
 * ids, so a leaked link exposes exactly one quote to exactly the person it was
 * sent to.
 */
@ApiTags('public')
@Public()
@Controller('public/quotes')
export class PublicQuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get(':token')
  @ApiOperation({ summary: 'A quote as the customer sees it' })
  get(@Param('token') token: string) {
    return this.quotes.publicGet(token);
  }

  @Post(':token/decision')
  @ApiOperation({ summary: 'Accept or decline, from the customer link' })
  decide(@Param('token') token: string, @Body() body: QuoteDecisionDto, @Ip() ip: string) {
    return this.quotes.publicDecide(token, body, ip);
  }
}
