import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { CurrentUser, type Principal } from '../auth/auth.guard';
import { DraftQuoteRequestDto } from '../common/dto';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('draft-quote')
  @ApiOperation({ summary: 'Suggest priced lines from a customer brief' })
  draftQuote(@CurrentUser() user: Principal, @Body() body: DraftQuoteRequestDto) {
    return this.ai.draftQuote(user.tenantId, body);
  }
}
