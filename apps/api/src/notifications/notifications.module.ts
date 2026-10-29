import { Controller, Get, Module, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Principal } from '../auth/security';
import { Database } from '../infrastructure/database';
import { HistoryQuery } from '../transfers/transfers.dto';
@ApiBearerAuth()
@ApiTags('Notifications')
@Controller('notifications')
class NotificationsController {
  constructor(private readonly db: Database) {}
  @Get() list(@Req() req: { user: Principal }, @Query() q: HistoryQuery) {
    return this.db.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: q.order },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    });
  }
}
@Module({ controllers: [NotificationsController] })
export class NotificationsModule {}
