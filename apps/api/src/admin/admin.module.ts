import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Admin } from '../auth/security';
import { Database } from '../infrastructure/database';
import { metrics } from '../infrastructure/http';
import { HistoryQuery } from '../transfers/transfers.dto';
@Admin()
@ApiBearerAuth()
@ApiTags('Admin')
@Controller('admin')
class AdminController {
  constructor(private readonly db: Database) {}
  @Get('stats') async stats() {
    const [users, transfers, wallets, pendingEvents] = await Promise.all([
      this.db.user.count(),
      this.db.transfer.count(),
      this.db.wallet.count(),
      this.db.outboxEvent.count({ where: { publishedAt: null } }),
    ]);
    return { users, transfers, wallets, pendingEvents, metrics };
  }
  @Get('jobs/failed') jobs(@Query() q: HistoryQuery) {
    return this.db.outboxEvent.findMany({
      where: {
        OR: [
          { publishedAt: null, attempts: { gt: 0 } },
          { deadAt: { not: null } },
        ],
      },
      orderBy: { createdAt: q.order },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    });
  }
  @Get('audit') audit(@Query() q: HistoryQuery) {
    return this.db.auditLog.findMany({
      orderBy: { createdAt: q.order },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    });
  }
}
@Module({ controllers: [AdminController] })
export class AdminModule {}
