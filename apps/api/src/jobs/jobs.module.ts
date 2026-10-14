import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { NumberingService } from '../documents/numbering.service';

@Module({
  controllers: [JobsController],
  providers: [JobsService, NumberingService],
  exports: [JobsService],
})
export class JobsModule {}
