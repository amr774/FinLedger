import 'dotenv/config';
import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
import { provision } from './provision-db.mjs';
import { backup, restore } from './backup.mjs';
const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !new URL(adminUrl).pathname.endsWith('_test'))
  throw new Error('Isolated TEST_DATABASE_URL required');
const tag = randomUUID().replaceAll('-', '').slice(0, 12);
const database = `finledger_hardening_${tag}_test`;
const source = new URL(adminUrl);
source.pathname = '/' + database;
function credentials(username) {
  const url = new URL(source);
  url.username = username;
  url.password = randomBytes(32).toString('hex');
  return url.toString();
}
const migration = credentials('fl_m_' + tag);
const runtime = credentials('fl_r_' + tag);
const reader = credentials('fl_b_' + tag);
const results = [];
async function check(name, action) {
  await action();
  results.push({ name, status: 'VERIFIED' });
  console.log('VERIFIED: ' + name);
}
async function connection(url) {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  return client;
}
async function run(script, args = [], env = {}) {
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? done() : reject(new Error(`${script} failed (${code})`)),
    );
  });
}
let api;
let worker;
let appDb;
let owner;
try {
  await check(
    'production backup and restore reject plaintext URLs before filesystem or database access',
    async () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await assert.rejects(
          backup(runtime, 'not-used', 'not-used'),
          /sslmode=verify-full/,
        );
        await assert.rejects(
          restore('not-used', 'not-used', adminUrl),
          /sslmode=verify-full/,
        );
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
    },
  );
  const admin = await connection(adminUrl);
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
  await provision(source.toString(), migration, runtime, reader);
  await run(
    'node_modules/prisma/build/index.js',
    ['migrate', 'deploy', '--config', 'apps/api/prisma.config.ts'],
    { MIGRATION_DATABASE_URL: migration },
  );
  await provision(source.toString(), migration, runtime, reader);
  appDb = await connection(runtime);
  owner = await connection(migration);
  await check(
    'runtime is non-owner and non-superuser; migrator owns schema tables',
    async () => {
      const role = (
        await appDb.query(
          'SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user',
        )
      ).rows[0];
      assert(Object.values(role).every((value) => value === false));
      const tables = await owner.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner=current_user",
      );
      assert.equal(tables.rowCount, 12);
    },
  );
  const denied = [
    ['schema DDL', 'CREATE TABLE public.forbidden_table(id int)'],
    ['trigger disabling', 'ALTER TABLE "LedgerPosting" DISABLE TRIGGER ALL'],
    ['ledger deletion', 'DELETE FROM "LedgerPosting"'],
    ['ledger truncation', 'TRUNCATE "Transfer" CASCADE'],
    ['table dropping', 'DROP TABLE "AuditLog"'],
    ['role creation', 'CREATE ROLE forbidden_role'],
    ['migration metadata', 'SELECT * FROM "_prisma_migrations"'],
    ['migration impersonation', `SET ROLE "${new URL(migration).username}"`],
    ['role updates', 'UPDATE "User" SET role=\'ADMIN\''],
    ['event payload mutation', 'UPDATE "OutboxEvent" SET payload=\'{}\''],
  ];
  for (const [name, sql] of denied)
    await check('runtime denies ' + name, async () => {
      await assert.rejects(appDb.query(sql), (error) => error.code === '42501');
    });
  const token = randomBytes(48).toString('hex');
  const base = 'http://127.0.0.1:3102/api/v1';
  await assert.rejects(
    fetch(base + '/health/live'),
    (error) => error instanceof TypeError,
  );
  const env = {
    ...process.env,
    DATABASE_URL: runtime,
    MIGRATION_DATABASE_URL: '',
    NODE_ENV: 'test',
    PORT: '3102',
    WEB_ORIGIN: 'http://127.0.0.1:8182',
    LOG_LEVEL: 'silent',
    MONITORING_TOKEN: token,
    RATE_LIMIT_PREFIX: 'hardening-' + tag,
  };
  api = spawn(process.execPath, ['apps/api/dist/src/main.js'], {
    env,
    stdio: 'inherit',
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    ready = await fetch(base + '/health/ready')
      .then((r) => r.ok)
      .catch(() => false);
    if (ready) break;
    if (api.exitCode !== null) throw new Error('Restricted API failed startup');
    await new Promise((done) => setTimeout(done, 100));
  }
  assert(ready);
  async function call(path, body, bearer, key) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  const alice = await call('/auth/register', {
    email: `alice-${tag}@example.test`,
    name: 'Restricted Alice',
    password: 'Restricted-Test-2026!',
  });
  assert.equal(alice.status, 201);
  const bob = await call('/auth/register', {
    email: `bob-${tag}@example.test`,
    name: 'Restricted Bob',
    password: 'Restricted-Test-2026!',
  });
  assert.equal(bob.status, 201);
  const a = await call('/wallets', {}, alice.data.accessToken);
  const b = await call('/wallets', {}, bob.data.accessToken);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  await check(
    'registration, wallet creation and funding work with restricted credentials',
    async () => {
      assert.equal(
        (
          await call(
            '/demo/fund',
            { amount: '1000', currency: 'EGP' },
            alice.data.accessToken,
            randomUUID(),
          )
        ).status,
        201,
      );
    },
  );
  await check('runtime cannot provision an administrator', async () => {
    await assert.rejects(
      appDb.query(
        'INSERT INTO "User" (id,email,name,"passwordHash",role) VALUES ($1,$2,$3,$4,\'ADMIN\')',
        [randomUUID(), `bad-${tag}@example.test`, 'Bad', 'not-a-hash'],
      ),
      (error) => error.code === '42501',
    );
  });
  const body = {
    sourceId: a.data.id,
    destinationId: b.data.id,
    amount: '100',
    currency: 'EGP',
  };
  await check(
    '20 concurrent identical requests have one effect under restricted role',
    async () => {
      const key = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          call('/transfers', body, alice.data.accessToken, key),
        ),
      );
      assert(responses.every((r) => r.status === 201));
      assert.equal(new Set(responses.map((r) => r.data.id)).size, 1);
    },
  );
  await check(
    '50 concurrent transfers cannot overdraw under restricted role',
    async () => {
      const responses = await Promise.all(
        Array.from({ length: 50 }, () =>
          call('/transfers', body, alice.data.accessToken, randomUUID()),
        ),
      );
      assert.equal(responses.filter((r) => r.status === 201).length, 9);
      assert.equal(responses.filter((r) => r.status === 409).length, 41);
    },
  );
  await check(
    'direct balance corruption rolls back under restricted role',
    async () => {
      await assert.rejects(
        appDb.query('UPDATE "Wallet" SET balance=balance+1 WHERE id=$1', [
          a.data.id,
        ]),
        (error) => error.code === '23514',
      );
      assert.equal(
        (
          await appDb.query('SELECT balance FROM "Wallet" WHERE id=$1', [
            a.data.id,
          ])
        ).rows[0].balance,
        '0',
      );
    },
  );
  await check(
    'protected metrics reject missing/wrong tokens and expose no account data',
    async () => {
      assert.equal((await fetch(base + '/monitoring/metrics')).status, 401);
      assert.equal(
        (
          await fetch(base + '/monitoring/metrics', {
            headers: { Authorization: 'Bearer wrong' },
          })
        ).status,
        401,
      );
      const response = await fetch(base + '/monitoring/metrics', {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert(text.includes('finledger_money_request_failures_total 41'));
      assert(
        !text.includes('@example.test') &&
          !text.includes(a.data.id) &&
          !text.includes(token),
      );
    },
  );
  await check(
    'restricted worker becomes ready, publishes events and delivers notifications',
    async () => {
      worker = spawn(process.execPath, ['apps/api/dist/src/worker.js'], {
        env: { ...env, WORKER_HEALTH_PORT: '3104' },
        stdio: 'inherit',
      });
      const expected = Number(
        (
          await appDb.query(
            'SELECT SUM(jsonb_array_length(payload->\'userIds\')) AS total FROM "OutboxEvent"',
          )
        ).rows[0].total,
      );
      let complete = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        const ready = await fetch('http://127.0.0.1:3104/health/ready')
          .then((r) => r.ok)
          .catch(() => false);
        const delivered = Number(
          (await appDb.query('SELECT count(*) AS total FROM "Notification"'))
            .rows[0].total,
        );
        if (ready && delivered === expected) {
          complete = true;
          break;
        }
        await new Promise((done) => setTimeout(done, 100));
      }
      assert(complete);
      assert.equal((await fetch('http://127.0.0.1:3104/metrics')).status, 401);
      assert.equal(
        (
          await fetch('http://127.0.0.1:3104/metrics', {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).status,
        200,
      );
      const exited = new Promise((done) => worker.once('exit', done));
      worker.kill();
      await exited;
      worker = undefined;
    },
  );
  const exited = new Promise((done) => api.once('exit', done));
  api.kill();
  await exited;
  api = undefined;
  await run('scripts/check-integrity.mjs', [], { DATABASE_URL: runtime });
  const directory = resolve('.hardening-test', tag);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const keyFile = resolve(directory, 'backup-key');
  await writeFile(keyFile, randomBytes(32).toString('hex'), {
    mode: 0o600,
    flag: 'wx',
  });
  const options = {
    container:
      process.env.HARDENING_PG_CONTAINER || 'finledger-postgres-test-1',
    host: '127.0.0.1',
    port: '5432',
  };
  await check(
    'backup role can read but cannot change financial data',
    async () => {
      const client = await connection(reader);
      try {
        await assert.rejects(
          client.query('UPDATE "Wallet" SET balance=0'),
          (error) => error.code === '42501',
        );
      } finally {
        await client.end();
      }
    },
  );
  const archive = await backup(reader, keyFile, directory, options);
  await check('backup ciphertext does not contain fixture emails', async () =>
    assert(
      !(await readFile(archive)).includes(
        Buffer.from(`alice-${tag}@example.test`),
      ),
    ),
  );
  await check(
    'tampered backup fails authentication before restore',
    async () => {
      const bytes = await readFile(archive);
      bytes[25] ^= 1;
      const bad = resolve(directory, 'tampered.flbk');
      await writeFile(bad, bytes);
      await assert.rejects(restore(bad, keyFile, adminUrl, options));
    },
  );
  const restored = await restore(archive, keyFile, adminUrl, options);
  const restoredDb = await connection(restored.url);
  try {
    await check(
      'encrypted backup restores all application rows into a new isolated database',
      async () => {
        for (const table of [
          'User',
          'Wallet',
          'Transfer',
          'LedgerJournal',
          'LedgerPosting',
          'IdempotencyRecord',
          'OutboxEvent',
          'AuditLog',
          'Session',
          'RefreshToken',
          'Notification',
        ]) {
          const sql = `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) AS count FROM "${table}" t`;
          assert.equal(
            (await restoredDb.query(sql)).rows[0].count,
            (await owner.query(sql)).rows[0].count,
          );
        }
      },
    );
    await check(
      'restored ledger constraints reject direct balance corruption',
      async () => {
        await assert.rejects(
          restoredDb.query(
            'UPDATE "Wallet" SET balance=balance+1 WHERE id=$1',
            [a.data.id],
          ),
          (error) => error.code === '23514',
        );
      },
    );
  } finally {
    await restoredDb.end();
  }
  await run('scripts/check-integrity.mjs', [], { DATABASE_URL: restored.url });
  await check(
    'restored ledger reconciles and conserves total money',
    async () => {},
  );
  await writeFile(
    'docs/hardening-results.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        status: 'VERIFIED',
        sourceDatabase: database,
        restoredDatabase: restored.database,
        checks: results,
        note: 'Existing databases retained; generated test databases/roles remain for inspection. Key/archive are in ignored .hardening-test.',
      },
      null,
      2,
    ) + '\n',
  );
} catch (error) {
  console.error(
    `Hardening check FAILED: ${error.code || error.name}; latest successful check: ${results.at(-1)?.name || 'none'}`,
  );
  if (error.code === 'ERR_ASSERTION') console.error(error.message);
  process.exitCode = 1;
} finally {
  api?.kill();
  worker?.kill();
  await appDb?.end();
  await owner?.end();
}
