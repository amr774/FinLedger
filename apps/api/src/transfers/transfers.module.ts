import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiTags,
  ApiOperation,
} from '@nestjs/swagger';
import { Principal } from '../auth/security';
import { LedgerModule } from '../ledger/ledger.module';
import { LedgerService, TREASURY_ID } from '../ledger/ledger.service';
import { WalletsModule } from '../wallets/wallets.module';
import { WalletsService } from '../wallets/wallets.service';
import { Database } from '../infrastructure/database';
import { FundingDto, TransferDto } from './transfers.dto';
@ApiBearerAuth()
@ApiTags('Transfers')
@Controller()
class TransfersController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
    private readonly db: Database,
  ) {}
  @Post('transfers')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Atomically transfer virtual EGP' })
  transfer(
    @Req() req: { user: Principal },
    @Headers('idempotency-key') key: string,
    @Body() dto: TransferDto,
  ) {
    return this.ledger.post(req.user.id, key, dto, 'TRANSFER');
  }
  @Post('demo/fund')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary:
      'Demo only: issue virtual funds, at most five times per rolling 24 hours',
  })
  async fund(
    @Req() req: { user: Principal },
    @Headers('idempotency-key') key: string,
    @Body() dto: FundingDto,
  ) {
    const wallet = await this.wallets.mine(req.user.id);
    return this.ledger.post(
      req.user.id,
      key,
      { ...dto, sourceId: TREASURY_ID, destinationId: wallet.id },
      'DEMO_FUNDING',
    );
  }
  @Get('transfers/:id')
  async detail(
    @Req() req: { user: Principal },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const transfer = await this.db.transfer.findFirst({
      where: {
        id,
        OR: [
          { source: { userId: req.user.id } },
          { destination: { userId: req.user.id } },
        ],
      },
      include: { journal: { include: { postings: true } } },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    return { ...transfer, status: 'COMPLETED' };
  }
}
@Module({
  imports: [LedgerModule, WalletsModule],
  controllers: [TransfersController],
})
export class TransfersModule {}
