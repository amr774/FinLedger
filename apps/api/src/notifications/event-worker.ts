import amqp, {
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
  Message,
} from 'amqplib';
import { randomUUID } from 'crypto';
import { Database } from '../infrastructure/database';
import { log, metrics } from '../infrastructure/http';
export const QUEUE =
  process.env.NODE_ENV === 'test'
    ? `finledger.test.notifications.${process.env.RATE_LIMIT_PREFIX || 'local'}`
    : 'finledger.notifications';
export const DEAD_QUEUE = QUEUE + '.dead';
const retryDelays = [1000, 5000, 30000];
export class EventWorker {
  private connection?: ChannelModel;
  private publisher?: ConfirmChannel;
  private consumer?: ConfirmChannel;
  private stopping = false;
  private lastSuccessfulIteration = 0;
  get ready() {
    return (
      !this.stopping &&
      !!this.publisher &&
      !!this.consumer &&
      Date.now() - this.lastSuccessfulIteration < 15000
    );
  }
  constructor(
    private readonly db: Database,
    private readonly url = process.env.RABBITMQ_URL!,
  ) {}
  async connect() {
    try {
      this.connection = await amqp.connect(this.url, { timeout: 5000 });
      const connection = this.connection;
      this.connection.on('error', () => log.error('RabbitMQ connection error'));
      this.connection.on('close', () => {
        if (this.connection !== connection) return;
        this.publisher = undefined;
        this.consumer = undefined;
      });
      this.publisher = await this.connection.createConfirmChannel();
      this.consumer = await this.connection.createConfirmChannel();
      const publisher = this.publisher;
      const consumer = this.consumer;
      this.publisher.on('close', () => {
        if (this.publisher === publisher) this.publisher = undefined;
      });
      this.consumer.on('close', () => {
        if (this.consumer === consumer) this.consumer = undefined;
      });
      for (const channel of [this.publisher, this.consumer])
        channel.on('error', () => log.error('RabbitMQ channel error'));
      await this.publisher.assertQueue(DEAD_QUEUE, { durable: true });
      await this.publisher.assertQueue(QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': DEAD_QUEUE,
        },
      });
      for (let index = 0; index < retryDelays.length; index++)
        await this.publisher.assertQueue(`${QUEUE}.retry.${index}`, {
          durable: true,
          arguments: {
            'x-message-ttl': retryDelays[index],
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': QUEUE,
          },
        });
      await this.consumer.prefetch(10);
      const channel = this.consumer;
      await channel.consume(QUEUE, (message) => {
        if (!message) {
          if (this.consumer === channel) this.consumer = undefined;
          return;
        }
        if (message)
          void this.consume(channel, message).catch(() => {
            log.error(
              'Consumer channel failed; delivery remains unacknowledged',
            );
            void channel.close().catch(() => undefined);
          });
      });
    } catch (error) {
      await this.connection?.close().catch(() => undefined);
      this.connection = undefined;
      this.publisher = undefined;
      this.consumer = undefined;
      throw error;
    }
  }
  private send(
    channel: ConfirmChannel,
    queue: string,
    body: Buffer,
    headers: Record<string, unknown> = {},
  ) {
    return new Promise<void>((resolve, reject) => {
      const messageId = randomUUID();
      const returned = (message: Message) => {
        if (message.properties.messageId === messageId) {
          cleanup();
          reject(new Error('Message was not routed to a queue'));
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        channel.removeListener('return', returned);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Publisher confirm timeout'));
        void channel.close().catch(() => undefined);
      }, 5000);
      channel.on('return', returned);
      try {
        channel.sendToQueue(
          queue,
          body,
          {
            persistent: true,
            mandatory: true,
            messageId,
            contentType: 'application/json',
            headers,
          },
          (error) => {
            cleanup();
            if (error) reject(error);
            else resolve();
          },
        );
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
  async publishBatch() {
    if (!this.publisher) throw new Error('Broker disconnected');
    const channel = this.publisher;
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "OutboxEvent" WHERE "publishedAt" IS NULL AND "deadAt" IS NULL AND "nextAttemptAt"<=now() ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 20`;
        for (const row of rows) {
          try {
            await this.send(
              channel,
              QUEUE,
              Buffer.from(JSON.stringify({ eventId: row.id })),
            );
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: { publishedAt: new Date(), lastError: null },
            });
            metrics.publications++;
          } catch {
            metrics.publishFailures++;
            const event = await tx.outboxEvent.findUniqueOrThrow({
              where: { id: row.id },
            });
            const attempts = event.attempts + 1;
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: {
                attempts,
                lastError: 'Broker publish failed',
                nextAttemptAt: new Date(
                  Date.now() +
                    Math.min(60000, 1000 * 2 ** Math.min(attempts, 6)),
                ),
                deadAt: attempts >= 20 ? new Date() : null,
              },
            });
            // Commit the retry schedule before further broker timeouts can exhaust the DB transaction.
            break;
          }
        }
        return rows.length;
      },
      { timeout: 30000 },
    );
  }
  async processEvent(eventId: string) {
    const event = await this.db.outboxEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    const payload = event.payload as {
      transferId: string;
      userIds: string[];
      amount: string;
      kind: string;
    };
    if (event.type !== 'transfer.completed' || !Array.isArray(payload.userIds))
      throw new Error('Unsupported event');
    await this.db.$transaction(async (tx) => {
      for (const userId of payload.userIds)
        await tx.notification.upsert({
          where: { eventId_userId: { eventId, userId } },
          update: {},
          create: {
            eventId,
            userId,
            message: `${payload.kind === 'DEMO_FUNDING' ? 'Demo funding' : 'Transfer'} ${payload.transferId} completed. Simulated email delivered to your notification inbox.`,
          },
        });
    });
  }
  private async consume(channel: ConfirmChannel, message: ConsumeMessage) {
    let eventId: string | undefined;
    try {
      const body = JSON.parse(message.content.toString()) as {
        eventId?: unknown;
      };
      if (
        typeof body.eventId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.eventId,
        )
      )
        throw new Error('Invalid event');
      eventId = body.eventId;
      await this.processEvent(eventId);
      metrics.deliveries++;
      channel.ack(message);
    } catch {
      metrics.notificationFailures++;
      const rawAttempt: unknown = message.properties.headers?.attempt ?? 0;
      const attempt =
        typeof rawAttempt === 'number' &&
        Number.isInteger(rawAttempt) &&
        rawAttempt >= 0
          ? Math.min(rawAttempt, retryDelays.length)
          : retryDelays.length;
      const target =
        attempt < retryDelays.length ? `${QUEUE}.retry.${attempt}` : DEAD_QUEUE;
      await this.send(channel, target, message.content, {
        attempt: attempt + 1,
      });
      if (eventId && target === DEAD_QUEUE) {
        await this.db.outboxEvent.updateMany({
          where: { id: eventId },
          data: {
            deadAt: new Date(),
            lastError: 'Notification exhausted retries',
          },
        });
      }
      channel.ack(message);
      log.warn(
        { eventId, attempt: attempt + 1, deadLetter: target === DEAD_QUEUE },
        'Notification processing failed',
      );
    }
  }
  async run() {
    await this.db.onModuleInit();
    while (!this.stopping) {
      try {
        if (!this.publisher || !this.consumer) {
          await this.connection?.close().catch(() => undefined);
          await this.connect();
        }
        await this.publishBatch();
        this.lastSuccessfulIteration = Date.now();
      } catch {
        log.error('Outbox iteration failed; retrying');
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  async close() {
    this.stopping = true;
    await this.connection?.close().catch(() => undefined);
  }
}
