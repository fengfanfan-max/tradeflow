import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PriceBookService } from './pricebook.service';
import { CurrentUser, type Principal } from '../auth/auth.guard';
import { PriceBookItemCreateDto, PriceBookItemUpdateDto } from '../common/dto';

@ApiTags('price book')
@ApiBearerAuth()
@Controller('price-book')
export class PriceBookController {
  constructor(private readonly priceBook: PriceBookService) {}

  @Get()
  list(@CurrentUser() user: Principal, @Query() query: { q?: string; active?: string }) {
    return this.priceBook.list(user.tenantId, query);
  }

  @Post()
  create(@CurrentUser() user: Principal, @Body() body: PriceBookItemCreateDto) {
    return this.priceBook.create(user.tenantId, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: Principal, @Param('id') id: string, @Body() body: PriceBookItemUpdateDto) {
    return this.priceBook.update(user.tenantId, id, body);
  }
}
