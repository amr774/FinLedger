import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { Prisma, TransferKind } from '@prisma/client';
import { createHash } from 'crypto';
import { parseMinor } from '@finledger/shared';
import { Database } from '../infrastructure/database';
export const TREASURY_ID = '00000000-0000-4000-8000-000000000001';
export type MoneyRequest = {
  sourceId: string;
  destinationId: string;
  amount: string;
  currency: string;
};
@Injectable()
export class LedgerService {
  constructor(private readonly db: Database) {}
  async post(
    userId: string,
    key: string | undefined,
    request: MoneyRequest,
    kind: TransferKind,
  ) {
    request = {
      ...request,
      sourceId: request.sourceId.toLowerCase(),
      destinationId: request.destinationId.toLowerCase(),
    };
    if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key))
      throw new BadRequestException(
        'Idempotency-Key must be 8–128 letters, digits, hyphens or underscores',
      );
    let amount: bigint;
    try {
      amount = parseMinor(request.amount);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (request.currency !== 'EGP')
      throw new BadRequestException('Only demo EGP is supported');
    if (request.sourceId === request.destinationId)
      throw new BadRequestException('Self-transfers are not supported');
    if (kind === 'DEMO_FUNDING' && amount > 100000n)
      throw new BadRequestException(
        'Demo funding maximum is EGP 1,000 per request',
      );
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          kind,
          request.sourceId,
          request.destinationId,
          amount.toString(),
          request.currency,
        ]),
      )
      .digest('hex');
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            // Transaction-scoped database lock serializes identical keys across all API instances.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId + ':' + key},0))`;
            const previous = await tx.idempotencyRecord.findUnique({
              where: { userId_key: { userId, key } },
            });
            if (previous) {
              if (previous.fingerprint !== fingerprint)
                throw new ConflictException(
                  'Idempotency key already used with different parameters',
                );
              return previous.response;
            }
            const ids = [request.sourceId, request.destinationId].sort();
            for (const id of ids)
              await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id=${id}::uuid FOR UPDATE`;
            const source = await tx.wallet.findUnique({
              where: { id: request.sourceId },
            });
            const destination = await tx.wallet.findUnique({
              where: { id: request.destinationId },
            });
            if (!source || !destination)
              throw new NotFoundException('Wallet not found');
            if (kind === 'TRANSFER' && source.userId !== userId)
              throw new ForbiddenException(
                'Source wallet does not belong to you',
              );
            if (
              kind === 'DEMO_FUNDING' &&
              (source.systemKey !== 'SIMULATOR_TREASURY' ||
                destination.userId !== userId)
            )
              throw new ForbiddenException();
            if (destination.systemKey)
              throw new BadRequestException('Cannot send to a system wallet');
            if (source.status !== 'ACTIVE' || destination.status !== 'ACTIVE')
              throw new ConflictException('Wallet is not active');
            if (
              source.currency !== request.currency ||
              destination.currency !== request.currency
            )
              throw new BadRequestException('Currency mismatch');
            if (kind === 'TRANSFER' && source.balance < amount)
              throw new ConflictException('Insufficient funds');
            if (kind === 'DEMO_FUNDING') {
              // Protected by destination wallet lock, including during Redis outages.
              const recent = await tx.transfer.aggregate({
                where: {
                  destinationId: destination.id,
                  kind: 'DEMO_FUNDING',
                  createdAt: { gte: new Date(Date.now() - 86400000) },
                },
                _sum: { amount: true },
                _count: true,
              });
              if (
                recent._count >= 5 ||
                (recent._sum.amount || 0n) + amount > 500000n
              )
                throw new HttpException(
                  'Demo funding daily quota reached',
                  429,
                );
            }
            const transfer = await tx.transfer.create({
              data: {
                sourceId: source.id,
                destinationId: destination.id,
                amount,
                currency: 'EGP',
                kind,
              },
            });
            const journal = await tx.ledgerJournal.create({
              data: { transferId: transfer.id },
            });
            await tx.ledgerPosting.createMany({
              data: [
                {
                  journalId: journal.id,
                  walletId: source.id,
                  side: 'DEBIT',
                  amount,
                },
                {
                  journalId: journal.id,
                  walletId: destination.id,
                  side: 'CREDIT',
                  amount,
                },
              ],
            });
            // Posting triggers update the balance cache. Deferred constraints verify it at commit.
            await tx.auditLog.create({
              data: { userId, action: kind, resourceId: transfer.id },
            });
            await tx.outboxEvent.create({
              data: {
                type: 'transfer.completed',
                payload: {
                  transferId: transfer.id,
                  userIds: [source.userId, destination.userId].filter(
                    (id): id is string => !!id,
                  ),
                  amount: amount.toString(),
                  kind,
                },
              },
            });
            const result = {
              id: transfer.id,
              sourceId: source.id,
              destinationId: destination.id,
              amount: amount.toString(),
              currency: 'EGP',
              kind,
              status: 'COMPLETED',
              journalId: journal.id,
              createdAt: transfer.createdAt.toISOString(),
            };
            await tx.idempotencyRecord.create({
              data: { userId, key, fingerprint, response: result },
            });
            return result;
          },
          { maxWait: 15000, timeout: 20000, isolationLevel: 'ReadCommitted' },
        );
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          (e.code === 'P2034' ||
            (e.code === 'P2010' &&
              ['40001', '40P01'].includes(String(e.meta?.code)))) &&
          attempt < 3
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, 20 * 2 ** attempt + Math.random() * 30),
          );
          continue;
        }
        throw e;
      }
    }
    throw new ConflictException('Please retry with the same idempotency key');
  }
}
