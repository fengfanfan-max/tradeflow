import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { CurrentUser, type Principal } from '../auth/auth.guard';
import { JobCreateDto, JobListQueryDto, JobScheduleDto, JobStatusChangeDto } from '../common/dto';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@CurrentUser() user: Principal, @Query() query: JobListQueryDto) {
    return this.jobs.list(user.tenantId, query);
  }

  @Post()
  create(@CurrentUser() user: Principal, @Body() body: JobCreateDto) {
    return this.jobs.create(user.tenantId, user.userId, body);
  }

  @Get(':id')
  get(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.jobs.get(user.tenantId, id);
  }

  @Patch(':id/schedule')
  schedule(@CurrentUser() user: Principal, @Param('id') id: string, @Body() body: JobScheduleDto) {
    return this.jobs.schedule(user.tenantId, user.userId, id, body);
  }

  @Post(':id/status')
  changeStatus(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() body: JobStatusChangeDto,
  ) {
    return this.jobs.changeStatus(user.tenantId, user.userId, id, body);
  }

  @Get(':id/availability')
  availability(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Query('assigneeId') assigneeId: string,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.jobs.availability(user.tenantId, assigneeId, start, end, id);
  }
}
