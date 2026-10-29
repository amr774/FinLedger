import {
  BadRequestException,
  Controller,
  Get,
  Module,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Principal } from '../auth/security';
import { Database } from '../infrastructure/database';
import { WalletsModule } from '../wallets/wallets.module';
import { WalletsService } from '../wallets/wallets.service';
import { HistoryQuery } from '../transfers/transfers.dto';
@ApiBearerAuth()
@ApiTags('Transactions')
@Controller('wallets/me')
class TransactionsController {
  constructor(
    private readonly db: Database,
    private readonly wallets: WalletsService,
  ) {}
  @Get('transactions') async history(
    @Req() req: { user: Principal },
    @Query() query: HistoryQuery,
  ) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to))
      throw new BadRequestException('From date must not be after to date');
    const wallet = await this.wallets.mine(req.user.id);
    const where = {
      OR: [{ sourceId: wallet.id }, { destinationId: wallet.id }],
      kind: query.kind,
      createdAt: {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      },
    };
    const [items, total] = await this.db.$transaction(
      [
        this.db.transfer.findMany({
          where,
          orderBy: [{ createdAt: query.order }, { id: query.order }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.db.transfer.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: query.page, limit: query.limit };
  }
}
@Module({ imports: [WalletsModule], controllers: [TransactionsController] })
export class TransactionsModule {}
