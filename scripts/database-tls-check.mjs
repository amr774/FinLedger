import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import pg from 'pg';
import { provision } from './provision-db.mjs';
const require = createRequire(import.meta.url);
const { Database } = require('../apps/api/dist/src/infrastructure/database.js');
const tag = randomUUID().slice(0, 8);
const directory = resolve('.hardening-test', 'database-tls-' + tag);
await mkdir(directory, { recursive: true, mode: 0o700 });
async function docker(args) {
  return new Promise((done, reject) => {
    const child = spawn('docker', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let diagnostic = '';
    child.stderr.on('data', (data) => (diagnostic += data));
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? done()
        : reject(new Error(`Docker check failed (${code}): ${diagnostic}`)),
    );
  });
}
async function openssl(args) {
  await docker([
    'run',
    '--rm',
    '--network',
    'none',
    '--user',
    `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '--mount',
    `type=bind,source=${directory},target=/tls`,
    '-w',
    '/tls',
    '--entrypoint',
    'openssl',
    'finledger-api',
    ...args,
  ]);
}
await openssl([
  'req',
  '-x509',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-keyout',
  'ca.key',
  '-out',
  'ca.pem',
  '-days',
  '2',
  '-subj',
  '/CN=FinLedger isolated test CA',
]);
await openssl([
  'req',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-keyout',
  'server.key',
  '-out',
  'server.csr',
  '-subj',
  '/CN=localhost',
  '-addext',
  'subjectAltName=DNS:localhost',
]);
await openssl([
  'x509',
  '-req',
  '-in',
  'server.csr',
  '-CA',
  'ca.pem',
  '-CAkey',
  'ca.key',
  '-CAcreateserial',
  '-out',
  'server.pem',
  '-days',
  '2',
  '-copy_extensions',
  'copy',
]);
const password = randomBytes(32).toString('hex');
await writeFile(
  resolve(directory, 'db.env'),
  `POSTGRES_USER=fl_tls_admin\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=finledger_tls_test\n`,
  { mode: 0o600 },
);
await writeFile(
  resolve(directory, 'pg_hba.conf'),
  'local all all trust\nhostssl all all 0.0.0.0/0 scram-sha-256\nhostssl all all ::/0 scram-sha-256\nhostnossl all all 0.0.0.0/0 reject\nhostnossl all all ::/0 reject\n',
);
// PostgreSQL's non-root process must read public certificates/HBA on Linux.
// The generated private keys and env file remain owner-only.
await chmod(directory, 0o755);
await chmod(resolve(directory, 'ca.key'), 0o600);
await chmod(resolve(directory, 'server.key'), 0o600);
const name = 'finledger-db-tls-check-' + tag;
let started = false;
let db;
try {
  await docker([
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '-p',
    '127.0.0.1:55434:5432',
    '--tmpfs',
    '/var/lib/postgresql/data',
    '--env-file',
    resolve(directory, 'db.env'),
    '--mount',
    `type=bind,source=${directory},target=/tls,readonly`,
    'postgres:17-alpine',
    'sh',
    '-c',
    'cp /tls/server.key /tmp/finledger-server.key && chmod 600 /tmp/finledger-server.key && chown postgres /tmp/finledger-server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tls/server.pem -c ssl_key_file=/tmp/finledger-server.key -c hba_file=/tls/pg_hba.conf',
  ]);
  started = true;
  const url = `postgresql://fl_tls_admin:${password}@localhost:55434/finledger_tls_test`;
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = url;
  process.env.DATABASE_CA_FILE = resolve(directory, 'ca.pem');
  db = new Database();
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await db.$queryRaw`SELECT 1`;
      ready = true;
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 200));
    }
  }
  assert(ready);
  assert.equal(
    (
      await db.$queryRaw`SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()`
    )[0].ssl,
    true,
  );
  await assert.rejects(db.onModuleInit(), /Unsafe runtime database privileges/);
  const operator = new URL(url);
  operator.searchParams.set('sslmode', 'verify-full');
  operator.searchParams.set('sslrootcert', resolve(directory, 'ca.pem'));
  const migrator = new URL(url);
  migrator.username = 'fl_tls_migrator';
  migrator.password = randomBytes(32).toString('hex');
  const runtime = new URL(url);
  runtime.username = 'fl_tls_runtime';
  runtime.password = randomBytes(32).toString('hex');
  await provision(operator.toString(), migrator.toString(), runtime.toString());
  process.env.DATABASE_URL = runtime.toString();
  const restricted = new Database();
  try {
    await restricted.onModuleInit();
  } finally {
    await restricted.$disconnect();
  }
  const noTls = new pg.Client({
    connectionString: url,
    ssl: false,
    connectionTimeoutMillis: 2000,
  });
  try {
    await assert.rejects(noTls.connect());
  } finally {
    await noTls.end();
  }
  const untrusted = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 2000,
  });
  try {
    await assert.rejects(untrusted.connect());
  } finally {
    await untrusted.end();
  }
  const wrongHost = new pg.Client({
    connectionString: url.replace('localhost', '127.0.0.1'),
    ssl: {
      rejectUnauthorized: true,
      ca: await readFile(resolve(directory, 'ca.pem'), 'utf8'),
    },
    connectionTimeoutMillis: 2000,
  });
  try {
    await assert.rejects(
      wrongHost.connect(),
      (error) => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID',
    );
  } finally {
    await wrongHost.end();
  }
  const result = {
    timestamp: new Date().toISOString(),
    status: 'VERIFIED',
    checks: [
      'PostgreSQL TLS connection using configured CA',
      'Server rejects unencrypted connections',
      'Client rejects untrusted CA',
      'Client rejects incorrect hostname',
      'Production runtime rejects superuser credentials',
      'Production runtime accepts a restricted role over verified TLS',
    ],
    limitation:
      'Isolated temporary PostgreSQL 17 container; hosted database firewall and CA provisioning still require staging verification.',
  };
  await writeFile(
    'docs/database-tls-results.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db?.$disconnect();
  if (started) await docker(['stop', name]);
}
