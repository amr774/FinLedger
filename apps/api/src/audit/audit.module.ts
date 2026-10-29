import { Module, Injectable } from '@nestjs/common';
import { Database } from '../infrastructure/database';
@Injectable()
export class AuditService {
  constructor(private readonly db: Database) {}
  latest() {
    return this.db.auditLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
  }
}
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
