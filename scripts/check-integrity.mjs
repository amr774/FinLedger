import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
try {
  const result = await db.$transaction(
    async (tx) => {
      const total =
        (await tx.wallet.aggregate({ _sum: { balance: true } }))._sum.balance ??
        0n;
      const negativeWallets = await tx.wallet.count({
        where: { systemKey: null, balance: { lt: 0 } },
      });
      const unbalanced =
        await tx.$queryRaw`SELECT "journalId" FROM "LedgerPosting" GROUP BY "journalId" HAVING SUM(CASE WHEN side='CREDIT' THEN amount ELSE -amount END)<>0 OR COUNT(*)<>2`;
      const inconsistent =
        await tx.$queryRaw`SELECT w.id FROM "Wallet" w LEFT JOIN "LedgerPosting" p ON p."walletId"=w.id GROUP BY w.id HAVING w.balance<>COALESCE(SUM(CASE WHEN p.side='CREDIT' THEN p.amount ELSE -p.amount END),0)`;
      return {
        totalMinor: total.toString(),
        negativeUserWallets: negativeWallets,
        unbalancedJournals: unbalanced.length,
        inconsistentWalletCaches: inconsistent.length,
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
  console.log(JSON.stringify(result, null, 2));
  if (
    result.totalMinor !== '0' ||
    result.negativeUserWallets ||
    result.unbalancedJournals ||
    result.inconsistentWalletCaches
  )
    process.exitCode = 1;
} finally {
  await db.$disconnect();
}
