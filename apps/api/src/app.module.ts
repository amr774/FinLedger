import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './infrastructure/database';
import { RateLimit, RateLimitModule } from './infrastructure/rate-limit';
import { RequestLog } from './infrastructure/http';
import { AuthModule } from './auth/auth.module';
import { JwtGuard, RoleGuard } from './auth/security';
import { WalletsModule } from './wallets/wallets.module';
import { TransfersModule } from './transfers/transfers.module';
import { TransactionsModule } from './transactions/transactions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { UsersModule } from './users/users.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { MonitoringModule } from './infrastructure/monitoring';
@Module({
  imports: [
    DatabaseModule,
    RateLimitModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    TransfersModule,
    TransactionsModule,
    NotificationsModule,
    AuditModule,
    AdminModule,
    HealthModule,
    MonitoringModule,
  ],
  providers: [
    { provide: APP_GUARD, useExisting: RateLimit },
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: RoleGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLog).forRoutes('{*path}');
  }
}
