import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { QuotesService } from './quotes.service';
import { CurrentUser, type Principal } from '../auth/auth.guard';
import { QuoteCreateDto, QuoteDecisionDto, QuoteListQueryDto, QuoteUpdateDto } from '../common/dto';

@ApiTags('quotes')
@ApiBearerAuth()
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  list(@CurrentUser() user: Principal, @Query() query: QuoteListQueryDto) {
    return this.quotes.list(user.tenantId, query);
  }

  @Post()
  create(@CurrentUser() user: Principal, @Body() body: QuoteCreateDto) {
    return this.quotes.create(user.tenantId, body);
  }

  @Get(':id')
  get(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.quotes.get(user.tenantId, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: Principal, @Param('id') id: string, @Body() body: QuoteUpdateDto) {
    return this.quotes.update(user.tenantId, id, body);
  }

  @Post(':id/send')
  send(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.quotes.send(user.tenantId, id);
  }

  @Post(':id/decision')
  decide(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() body: QuoteDecisionDto,
  ) {
    return this.quotes.decide(user.tenantId, id, user.userId, body);
  }
}
