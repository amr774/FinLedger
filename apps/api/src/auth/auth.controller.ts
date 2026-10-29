import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { Principal, Public } from './security';
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: 7 * 86400000,
});
function checkOrigin(req: Request) {
  if (req.headers.origin && req.headers.origin !== process.env.WEB_ORIGIN)
    throw new ForbiddenException('Untrusted origin');
}
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  private send(
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
  ) {
    res.cookie('refresh', tokens.refreshToken, cookieOptions());
    return { accessToken: tokens.accessToken };
  }
  @Public() @Post('register') async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkOrigin(req);
    return this.send(res, await this.auth.register(dto));
  }
  @Public() @Post('login') async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkOrigin(req);
    return this.send(res, await this.auth.login(dto));
  }
  @Public() @Post('refresh') async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkOrigin(req);
    return this.send(res, await this.auth.refresh(req.cookies?.refresh));
  }
  @Public() @Post('logout') async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkOrigin(req);
    const result = await this.auth.logout(req.cookies?.refresh);
    res.clearCookie('refresh', cookieOptions());
    return result;
  }
  @ApiBearerAuth() @Get('me') me(@Req() req: Request & { user: Principal }) {
    const { sid: _sid, ...user } = req.user;
    return user;
  }
}
