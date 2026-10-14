import { Module } from '@nestjs/common';
import { QuotesController } from './quotes.controller';
import { PublicQuotesController } from './quotes.public.controller';
import { QuotesService } from './quotes.service';
import { NumberingService } from '../documents/numbering.service';

@Module({
  controllers: [QuotesController, PublicQuotesController],
  providers: [QuotesService, NumberingService],
  exports: [QuotesService],
})
export class QuotesModule {}
