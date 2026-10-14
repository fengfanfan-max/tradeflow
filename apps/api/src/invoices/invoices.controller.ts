import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { InvoicesService } from './invoices.service';
import { CurrentUser, type Principal } from '../auth/auth.guard';
import { InvoiceCreateDto, InvoiceListQueryDto, InvoiceMarkPaidDto } from '../common/dto';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(@CurrentUser() user: Principal, @Query() query: InvoiceListQueryDto) {
    return this.invoices.list(user.tenantId, query);
  }

  @Post()
  create(@CurrentUser() user: Principal, @Body() body: InvoiceCreateDto) {
    return this.invoices.create(user.tenantId, body);
  }

  @Get(':id')
  get(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.invoices.get(user.tenantId, id);
  }

  @Get(':id/pdf')
  async pdf(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, filename } = await this.invoices.pdf(user.tenantId, id);

    // `inline` rather than `attachment`: an invoice is usually read in the
    // browser's viewer, and the viewer's download button still works.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    stream.pipe(res);
  }

  @Post(':id/send')
  send(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.invoices.send(user.tenantId, id);
  }

  @Post(':id/paid')
  markPaid(@CurrentUser() user: Principal, @Param('id') id: string, @Body() body: InvoiceMarkPaidDto) {
    return this.invoices.markPaid(user.tenantId, id, body);
  }

  @Post(':id/void')
  void(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.invoices.void(user.tenantId, id);
  }
}
