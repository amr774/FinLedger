import { randomUUID } from 'crypto';
import amqp, { ChannelModel, ConfirmChannel } from 'amqplib';
import { Database } from '../src/infrastructure/database';
import { LedgerService, TREASURY_ID } from '../src/ledger/ledger.service';
import {
  EventWorker,
  QUEUE,
  DEAD_QUEUE,
} from '../src/notifications/event-worker';
async function eventually(check: () => Promise<boolean>, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for broker processing');
}
describe('Real RabbitMQ transactional outbox', () => {
  let db: Database;
  let worker: EventWorker;
  let connection: ChannelModel;
  let channel: ConfirmChannel;
  let eventId: string;
  let userId: string;
  beforeAll(async () => {
    db = new Database();
    const user = await db.user.create({
      data: {
        email: `events-${randomUUID()}@example.test`,
        name: 'Events',
        passwordHash: 'not-a-login-account',
      },
    });
    userId = user.id;
    const wallet = await db.wallet.create({ data: { userId } });
    const ledger = new LedgerService(db);
    const transfer = (await ledger.post(
      userId,
      randomUUID(),
      {
        sourceId: TREASURY_ID,
        destinationId: wallet.id,
        amount: '100',
        currency: 'EGP',
      },
      'DEMO_FUNDING',
    )) as { id: string };
    const events = await db.outboxEvent.findMany({
      where: { publishedAt: null },
    });
    eventId = events.find(
      (e) => (e.payload as { transferId: string }).transferId === transfer.id,
    )!.id;
    worker = new EventWorker(db);
    await worker.connect();
    connection = await amqp.connect(process.env.RABBITMQ_URL!);
    channel = await connection.createConfirmChannel();
  });
  afterAll(async () => {
    await worker?.close();
    await connection?.close();
    await db?.$disconnect();
  });
  const deliver = (id: string, attempt = 0) =>
    new Promise<void>((resolve, reject) => {
      channel.sendToQueue(
        QUEUE,
        Buffer.from(JSON.stringify({ eventId: id })),
        { persistent: true, headers: { attempt } },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  test('publisher confirms and duplicate deliveries create one notification', async () => {
    while (await worker.publishBatch()) {
      /* drain committed events */
    }
    await eventually(
      async () =>
        (await db.notification.count({ where: { eventId, userId } })) === 1,
    );
    await deliver(eventId);
    await deliver(eventId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await db.notification.count({ where: { eventId, userId } })).toBe(1);
    expect(
      (await db.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }))
        .publishedAt,
    ).not.toBeNull();
  });
  test('unroutable publications fail instead of being treated as delivered', async () => {
    await expect(
      worker['send'](channel, `missing-${randomUUID()}`, Buffer.from('{}')),
    ).rejects.toThrow('not routed');
  });
  test('invalid retry headers safely route a failed event to the dead-letter queue', async () => {
    const before = (await channel.checkQueue(DEAD_QUEUE)).messageCount;
    await deliver(randomUUID(), -1);
    await eventually(
      async () => (await channel.checkQueue(DEAD_QUEUE)).messageCount > before,
    );
  });
  test('transient consumer failure is retried with backoff and acknowledged after recovery', async () => {
    const original = worker.processEvent.bind(worker);
    const process = jest.spyOn(worker, 'processEvent');
    let targetCalls = 0;
    process.mockImplementation(async (id) => {
      if (id === eventId && ++targetCalls === 1)
        throw new Error('Injected transient failure');
      return original(id);
    });
    const started = Date.now();
    await deliver(eventId);
    await eventually(async () => targetCalls >= 2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(await db.notification.count({ where: { eventId, userId } })).toBe(1);
    process.mockRestore();
  });
  test('exhausted deliveries are routed to the dead-letter queue and exposed to admin', async () => {
    const before = (await channel.checkQueue(DEAD_QUEUE)).messageCount;
    const process = jest
      .spyOn(worker, 'processEvent')
      .mockRejectedValue(new Error('Injected permanent failure'));
    try {
      await deliver(eventId, 3);
      await eventually(
        async () =>
          (await channel.checkQueue(DEAD_QUEUE)).messageCount > before,
      );
      await eventually(
        async () =>
          !!(await db.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }))
            .deadAt,
      );
    } finally {
      process.mockRestore();
    }
    expect(
      (await db.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }))
        .lastError,
    ).toBe('Notification exhausted retries');
  });
  test('a broker outage cannot undo a completed financial transaction', async () => {
    const ledger = new LedgerService(db);
    const wallet = await db.wallet.findUniqueOrThrow({ where: { userId } });
    const disconnected = new EventWorker(db, 'amqp://127.0.0.1:1');
    await expect(disconnected.connect()).rejects.toThrow();
    const before = wallet.balance;
    await ledger.post(
      userId,
      randomUUID(),
      {
        sourceId: TREASURY_ID,
        destinationId: wallet.id,
        amount: '100',
        currency: 'EGP',
      },
      'DEMO_FUNDING',
    );
    expect(
      (await db.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).balance,
    ).toBe(before + 100n);
    expect(
      await db.outboxEvent.count({ where: { publishedAt: null } }),
    ).toBeGreaterThan(0);
    await worker.publishBatch();
  });
  test('connection recovery preserves duplicate suppression', async () => {
    await worker['connection']!.close();
    await worker.connect();
    const process = jest.spyOn(worker, 'processEvent');
    try {
      await deliver(eventId);
      await eventually(async () =>
        process.mock.calls.some(([id]) => id === eventId),
      );
      expect(await db.notification.count({ where: { eventId, userId } })).toBe(
        1,
      );
    } finally {
      process.mockRestore();
    }
  });
});
