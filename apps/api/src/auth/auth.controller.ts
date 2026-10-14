import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CurrentUser, Public, type Principal } from './auth.guard';
import { LoginRequestDto } from '../common/dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Exchange credentials for a bearer token' })
  login(@Body() body: LoginRequestDto) {
    return this.auth.login(body.email, body.password);
  }

  @Get('session')
  @ApiOperation({ summary: 'The principal behind the current token' })
  session(@CurrentUser() principal: Principal) {
    return this.auth.session({
      sub: principal.userId,
      tid: principal.tenantId,
      role: principal.role,
      email: principal.email,
      name: principal.name,
    });
  }
}
