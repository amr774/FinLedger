import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Database } from '../src/infrastructure/database';
import { LedgerService, TREASURY_ID } from '../src/ledger/ledger.service';
import { RateLimit } from '../src/infrastructure/rate-limit';
import { JwtService } from '@nestjs/jwt';
type Actor = { id: string; token: string; wallet: string; email: string };
describe('Real PostgreSQL / HTTP financial platform', () => {
  let app: INestApplication;
  let db: Database;
  let alice: Actor;
  let bob: Actor;
  let stranger: Actor;
  let ledger: LedgerService;
  const password = 'Test-FinLedger-2026!';
  const prefix = randomUUID();
  async function actor(label: string): Promise<Actor> {
    const email = `${label}-${prefix}@example.test`;
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: label })
      .expect(201);
    expect(registered.body.accessToken).toBeTruthy();
    expect(registered.headers['set-cookie'][0]).toContain('HttpOnly');
    const token = registered.body.accessToken as string;
    const profile = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .auth(token, { type: 'bearer' })
      .expect(200);
    const wallet = await request(app.getHttpServer())
      .post('/api/v1/wallets')
      .auth(token, { type: 'bearer' })
      .expect(201);
    return { id: profile.body.id, token, wallet: wallet.body.id, email };
  }
  const fund = (who: Actor, amount = '100000') =>
    request(app.getHttpServer())
      .post('/api/v1/demo/fund')
      .auth(who.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ amount, currency: 'EGP' });
  const transfer = (
    who: Actor,
    destinationId: string,
    amount: string,
    key = randomUUID(),
    sourceId = who.wallet,
  ) =>
    request(app.getHttpServer())
      .post('/api/v1/transfers')
      .auth(who.token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({ sourceId, destinationId, amount, currency: 'EGP' });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0);
    db = app.get(Database);
    ledger = app.get(LedgerService);
    const redis = app.get(RateLimit).redis;
    if (redis.status !== 'ready')
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Test Redis did not become ready')),
          5000,
        );
        redis.once('ready', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    alice = await actor('Alice');
    bob = await actor('Bob');
    stranger = await actor('Stranger');
    await fund(alice).expect(201);
  });
  afterAll(async () => {
    await app?.close();
  });
  test('registration, validation and protected routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/wallets/me').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: alice.email, password: 'incorrect-password' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'bad', password: 'short', name: 'x', role: 'ADMIN' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .auth(alice.token, { type: 'bearer' })
      .expect(403);
    await db.user.update({
      where: { id: stranger.id },
      data: { role: 'ADMIN' },
    });
    await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .auth(stranger.token, { type: 'bearer' })
      .expect(200);
  });
  test('malformed signed claims and expired JWTs are unauthorized', async () => {
    const jwt = app.get(JwtService);
    const bad = await jwt.signAsync({ sub: alice.id, sid: 'invalid' });
    const expired = await jwt.signAsync(
      { sub: alice.id, sid: randomUUID() },
      { expiresIn: -1 },
    );
    for (const token of [bad, expired, alice.token + 'tampered']) {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .auth(token, { type: 'bearer' })
        .expect(401);
    }
  });
  test('reversed transaction date ranges are rejected', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/wallets/me/transactions?from=2026-10-28&to=2026-10-01')
      .auth(alice.token, { type: 'bearer' })
      .expect(400);
  });
  test('admin routes enforce roles and notification lists enforce ownership', async () => {
    for (const path of ['/admin/stats', '/admin/audit', '/admin/jobs/failed']) {
      await request(app.getHttpServer())
        .get('/api/v1' + path)
        .auth(alice.token, { type: 'bearer' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1' + path)
        .auth(stranger.token, { type: 'bearer' })
        .expect(200);
    }
    const notification = await db.notification.create({
      data: {
        userId: bob.id,
        eventId: randomUUID(),
        message: 'Private test notification',
      },
    });
    const mine = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .auth(alice.token, { type: 'bearer' })
      .expect(200);
    expect(
      mine.body.some((row: { id: string }) => row.id === notification.id),
    ).toBe(false);
    const theirs = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .auth(bob.token, { type: 'bearer' })
      .expect(200);
    expect(
      theirs.body.some((row: { id: string }) => row.id === notification.id),
    ).toBe(true);
  });
  test('registration rolls back the user when session token creation fails', async () => {
    const email = `rollback-${prefix}@example.test`;
    const sign = jest
      .spyOn(app.get(JwtService), 'signAsync')
      .mockRejectedValueOnce(new Error('Injected signing failure'));
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password, name: 'Rollback' })
        .expect(500);
      expect(await db.user.findUnique({ where: { email } })).toBeNull();
    } finally {
      sign.mockRestore();
    }
  });
  test('refresh rotates, replay revokes the session, logout revokes access', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: alice.email, password })
      .expect(201);
    const original = login.headers['set-cookie'][0].split(';')[0];
    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', original)
      .expect(201);
    expect(refreshed.headers['set-cookie'][0]).not.toBe(
      login.headers['set-cookie'][0],
    );
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .auth(refreshed.body.accessToken, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', original)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .auth(refreshed.body.accessToken, { type: 'bearer' })
      .expect(401);
    const next = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: alice.email, password })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', next.headers['set-cookie'][0].split(';')[0])
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .auth(next.body.accessToken, { type: 'bearer' })
      .expect(401);
  });
  test('rejects cross-origin cookie writes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://attacker.example')
      .expect(403);
  });
  test('production authentication cookies carry Secure and SameSite protections', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: alice.email, password })
        .expect(201);
      const cookie = response.headers['set-cookie'][0];
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(response.body.refreshToken).toBeUndefined();
    } finally {
      process.env.NODE_ENV = original;
    }
  });
  test('successful transfer is balanced, traceable and private', async () => {
    const res = await transfer(alice, bob.wallet, '1234').expect(201);
    expect(res.body.amount).toBe('1234');
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/transfers/${res.body.id}`)
      .auth(alice.token, { type: 'bearer' })
      .expect(200);
    expect(detail.body.journal.postings).toHaveLength(2);
    expect(
      detail.body.journal.postings.map((p: { amount: string }) => p.amount),
    ).toEqual(['1234', '1234']);
    await request(app.getHttpServer())
      .get(`/api/v1/transfers/${res.body.id}`)
      .auth(bob.token, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/transfers/${res.body.id}`)
      .auth(stranger.token, { type: 'bearer' })
      .expect(404);
    const history = await request(app.getHttpServer())
      .get('/api/v1/wallets/me/transactions?limit=1&kind=TRANSFER&order=asc')
      .auth(bob.token, { type: 'bearer' })
      .expect(200);
    expect(history.body.items[0].id).toBe(res.body.id);
  });
  test('authorization, invalid destination, self-transfer and insufficient funds', async () => {
    await transfer(
      bob,
      alice.wallet,
      '1',
      randomUUID(),
      stranger.wallet,
    ).expect(403);
    await transfer(alice, randomUUID(), '1').expect(404);
    await transfer(alice, alice.wallet, '1').expect(400);
    await transfer(bob, alice.wallet, '10000000').expect(409);
  });
  test.each(['0', '-1', '1.1', '1e2', '10000001'])(
    'rejects invalid amount %s',
    async (amount) => {
      await transfer(alice, bob.wallet, amount).expect(400);
    },
  );
  test('idempotency returns stored response, conflicts on changed payload', async () => {
    const key = randomUUID();
    const first = await transfer(alice, bob.wallet, '100', key).expect(201);
    const second = await transfer(alice, bob.wallet, '100', key).expect(201);
    expect(second.body).toEqual(first.body);
    await transfer(alice, bob.wallet, '101', key).expect(409);
    expect(await db.transfer.count({ where: { id: first.body.id } })).toBe(1);
  });
  test('20 concurrent identical requests have exactly one financial effect', async () => {
    const key = randomUUID();
    const before = await db.wallet.findUniqueOrThrow({
      where: { id: alice.wallet },
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => transfer(alice, bob.wallet, '100', key)),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(
      (await db.wallet.findUniqueOrThrow({ where: { id: alice.wallet } }))
        .balance,
    ).toBe(before.balance - 100n);
  });
  test('database failure rolls back transfer, postings, balances, audit, outbox and idempotency', async () => {
    const before = await db.wallet.findUniqueOrThrow({
      where: { id: alice.wallet },
    });
    const key = randomUUID();
    const count = await db.transfer.count();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION test_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected storage failure'; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_outbox_failure BEFORE INSERT ON "OutboxEvent" FOR EACH ROW EXECUTE FUNCTION test_reject_outbox()`,
    );
    try {
      await transfer(alice, bob.wallet, '123', key).expect(500);
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER test_outbox_failure ON "OutboxEvent"',
      );
      await db.$executeRawUnsafe('DROP FUNCTION test_reject_outbox()');
    }
    expect(
      (await db.wallet.findUniqueOrThrow({ where: { id: alice.wallet } }))
        .balance,
    ).toBe(before.balance);
    expect(await db.transfer.count()).toBe(count);
    expect(
      await db.idempotencyRecord.count({ where: { userId: alice.id, key } }),
    ).toBe(0);
    await transfer(alice, bob.wallet, '123', key).expect(201);
  });
  test('ledger and balances reject direct mutation; incomplete journals cannot commit', async () => {
    const posting = await db.ledgerPosting.findFirstOrThrow({
      where: { walletId: alice.wallet },
    });
    await expect(
      db.ledgerPosting.update({
        where: { id: posting.id },
        data: { amount: 1n },
      }),
    ).rejects.toThrow();
    await expect(
      db.ledgerPosting.delete({ where: { id: posting.id } }),
    ).rejects.toThrow();
    await expect(
      db.ledgerJournal.update({
        where: { id: posting.journalId },
        data: { createdAt: new Date() },
      }),
    ).rejects.toThrow();
    await expect(
      db.wallet.update({
        where: { id: alice.wallet },
        data: { balance: 999999n },
      }),
    ).rejects.toThrow();
    await expect(
      db.transfer.create({
        data: {
          sourceId: alice.wallet,
          destinationId: bob.wallet,
          amount: 1n,
          kind: 'TRANSFER',
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.$transaction(async (tx) => {
        const t = await tx.transfer.create({
          data: {
            sourceId: alice.wallet,
            destinationId: bob.wallet,
            amount: 10n,
            kind: 'TRANSFER',
          },
        });
        const j = await tx.ledgerJournal.create({ data: { transferId: t.id } });
        await tx.ledgerPosting.create({
          data: {
            journalId: j.id,
            walletId: alice.wallet,
            side: 'DEBIT',
            amount: 10n,
          },
        });
      }),
    ).rejects.toThrow();
  });
  test('50 simultaneous transfers cannot overspend; total money and journal consistency hold', async () => {
    const spender = await actor('Concurrent');
    await fund(spender, '1000').expect(201);
    const initial = await db.wallet.findUniqueOrThrow({
      where: { id: bob.wallet },
    });
    const results = await Promise.all(
      Array.from({ length: 50 }, () => transfer(spender, bob.wallet, '100')),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 409)).toHaveLength(40);
    expect(
      new Set(results.filter((r) => r.status === 201).map((r) => r.body.id))
        .size,
    ).toBe(10);
    expect(
      (await db.wallet.findUniqueOrThrow({ where: { id: spender.wallet } }))
        .balance,
    ).toBe(0n);
    expect(
      (await db.wallet.findUniqueOrThrow({ where: { id: bob.wallet } }))
        .balance,
    ).toBe(initial.balance + 1000n);
    expect(
      (await db.wallet.aggregate({ _sum: { balance: true } }))._sum.balance,
    ).toBe(0n);
    const bad = await db.$queryRaw<
      unknown[]
    >`SELECT "journalId" FROM "LedgerPosting" GROUP BY "journalId" HAVING SUM(CASE WHEN side='CREDIT' THEN amount ELSE -amount END)<>0 OR COUNT(*)<>2`;
    expect(bad).toEqual([]);
    const inconsistent = await db.$queryRaw<
      unknown[]
    >`SELECT w.id FROM "Wallet" w LEFT JOIN "LedgerPosting" p ON p."walletId"=w.id GROUP BY w.id HAVING w.balance<>COALESCE(SUM(CASE WHEN p.side='CREDIT' THEN p.amount ELSE -p.amount END),0)`;
    expect(inconsistent).toEqual([]);
  });
  test('funding quota is database-backed and replay does not consume it twice', async () => {
    const who = await actor('Quota');
    const keys = Array.from({ length: 6 }, () => randomUUID());
    const results = await Promise.all(
      keys.map((key) =>
        ledger
          .post(
            who.id,
            key,
            {
              sourceId: TREASURY_ID,
              destinationId: who.wallet,
              amount: '100',
              currency: 'EGP',
            },
            'DEMO_FUNDING',
          )
          .then(
            () => 201,
            (error) => error.getStatus(),
          ),
      ),
    );
    expect(results.filter((code) => code === 201)).toHaveLength(5);
    expect(results.filter((code) => code === 429)).toHaveLength(1);
    const accepted = keys[results.indexOf(201)];
    await expect(
      ledger.post(
        who.id,
        accepted,
        {
          sourceId: TREASURY_ID,
          destinationId: who.wallet,
          amount: '100',
          currency: 'EGP',
        },
        'DEMO_FUNDING',
      ),
    ).resolves.toBeTruthy();
  });
  test('frozen wallets and unsupported currency are rejected without balance changes', async () => {
    await db.wallet.update({
      where: { id: bob.wallet },
      data: { status: 'FROZEN' },
    });
    try {
      await transfer(alice, bob.wallet, '1').expect(409);
    } finally {
      await db.wallet.update({
        where: { id: bob.wallet },
        data: { status: 'ACTIVE' },
      });
    }
    await request(app.getHttpServer())
      .post('/api/v1/transfers')
      .auth(alice.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceId: alice.wallet,
        destinationId: bob.wallet,
        amount: '1',
        currency: 'USD',
      })
      .expect(400);
  });
  test('equivalent UUID casing replays the original transfer', async () => {
    const key = randomUUID();
    const first = await transfer(alice, bob.wallet, '1', key).expect(201);
    const second = await transfer(
      alice,
      bob.wallet.toUpperCase(),
      '1',
      key,
      alice.wallet.toUpperCase(),
    ).expect(201);
    expect(second.body).toEqual(first.body);
  });
  test('Redis outage preserves safe transfers and funding quotas', async () => {
    const redis = app.get(RateLimit).redis;
    redis.disconnect();
    try {
      await transfer(alice, bob.wallet, '1').expect(201);
    } finally {
      await redis.connect();
    }
  });
  test('authentication rate limiter rejects excessive requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 31 }, () =>
        request(app.getHttpServer()).post('/api/v1/auth/refresh'),
      ),
    );
    expect(responses.some((response) => response.status === 429)).toBe(true);
    expect(
      responses.every((response) => [401, 429].includes(response.status)),
    ).toBe(true);
  });
  test('health, swagger and request correlation are available', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200);
    expect(res.headers['x-request-id']).toBeTruthy();
    await request(app.getHttpServer()).get('/api/docs-json').expect(200);
  });
});
