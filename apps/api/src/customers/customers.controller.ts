import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CurrentUser, type Principal } from '../auth/auth.guard';
import { CustomerCreateDto, CustomerUpdateDto, PaginationQueryDto, SiteCreateDto } from '../common/dto';

@ApiTags('customers')
@ApiBearerAuth()
@Controller()
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('customers')
  list(@CurrentUser() user: Principal, @Query() query: PaginationQueryDto) {
    return this.customers.list(user.tenantId, query);
  }

  @Post('customers')
  create(@CurrentUser() user: Principal, @Body() body: CustomerCreateDto) {
    return this.customers.create(user.tenantId, body);
  }

  @Get('customers/:id')
  get(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.customers.get(user.tenantId, id);
  }

  @Patch('customers/:id')
  update(@CurrentUser() user: Principal, @Param('id') id: string, @Body() body: CustomerUpdateDto) {
    return this.customers.update(user.tenantId, id, body);
  }

  @Post('customers/:id/archive')
  archive(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.customers.archive(user.tenantId, id);
  }

  @Get('customers/:customerId/sites')
  sites(@CurrentUser() user: Principal, @Param('customerId') customerId: string) {
    return this.customers.listSites(user.tenantId, customerId);
  }

  @Post('sites')
  createSite(@CurrentUser() user: Principal, @Body() body: SiteCreateDto) {
    return this.customers.createSite(user.tenantId, body as never);
  }
}
