import { Controller, Get, Module, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Principal } from '../auth/security';
@ApiBearerAuth()
@ApiTags('Users')
@Controller('users')
class UsersController {
  @Get('me') me(@Req() req: { user: Principal }) {
    const { sid: _sid, ...profile } = req.user;
    return profile;
  }
}
@Module({ controllers: [UsersController] })
export class UsersModule {}
