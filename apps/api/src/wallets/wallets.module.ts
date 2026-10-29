import { Controller, Get, Module, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Principal } from '../auth/security';
import { WalletsService } from './wallets.service';
@ApiBearerAuth()
@ApiTags('Wallets')
@Controller('wallets')
class WalletsController {
  constructor(private readonly wallets: WalletsService) {}
  @Post() create(@Req() req: { user: Principal }) {
    return this.wallets.create(req.user.id);
  }
  @Get('me') mine(@Req() req: { user: Principal }) {
    return this.wallets.mine(req.user.id);
  }
}
@Module({
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
