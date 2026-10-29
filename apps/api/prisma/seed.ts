import 'dotenv/config';
import { Database } from '../src/infrastructure/database';
import { LedgerService } from '../src/ledger/ledger.service';
import { TREASURY_ID } from '../src/ledger/ledger.service';
import * as argon2 from 'argon2';
async function seed() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Development seed is disabled in production');
  const db = new Database();
  try {
    const ledger = new LedgerService(db);
    for (const [name, email, role] of [
      ['Alice Demo', 'alice@example.test', 'USER'],
      ['Bob Demo', 'bob@example.test', 'USER'],
      ['Demo Admin', 'admin@example.test', 'ADMIN'],
    ] as const) {
      const user = await db.user.upsert({
        where: { email },
        update: {},
        create: {
          name,
          email,
          role,
          passwordHash: await argon2.hash('FinLedger-Demo-2026!'),
        },
      });
      const wallet = await db.wallet.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
      await ledger.post(
        user.id,
        'seed-funding-v1',
        {
          sourceId: TREASURY_ID,
          destinationId: wallet.id,
          amount: '100000',
          currency: 'EGP',
        },
        'DEMO_FUNDING',
      );
    }
    console.log(
      'Development accounts ready; see README for simulator credentials.',
    );
  } finally {
    await db.$disconnect();
  }
}
void seed().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
});
