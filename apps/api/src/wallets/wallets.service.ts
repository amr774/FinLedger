import { Injectable, NotFoundException } from '@nestjs/common';
import { Database } from '../infrastructure/database';
@Injectable()
export class WalletsService {
  constructor(private readonly db: Database) {}
  create(userId: string) {
    return this.db.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }
  async mine(userId: string) {
    const wallet = await this.db.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Create your demo wallet first');
    return wallet;
  }
}
