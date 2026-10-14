import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { NumberingService } from '../documents/numbering.service';

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, NumberingService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
