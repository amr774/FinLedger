import 'dotenv/config';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  mkdir,
  readFile,
  writeFile,
  appendFile,
  rename,
  stat,
  unlink,
  mkdtemp,
} from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
const magic = Buffer.from('FLBK1');
function verifiedConnection(url) {
  const parsed = new URL(url);
  if (
    process.env.NODE_ENV === 'production' &&
    parsed.searchParams.get('sslmode') !== 'verify-full'
  )
    throw new Error(
      'Production backup/restore connections require sslmode=verify-full',
    );
  return parsed;
}
async function key(path) {
  const value = (await readFile(path, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error('Backup key must be 32 random bytes encoded as hex');
  return Buffer.from(value, 'hex');
}
function client(tool, url, args, options = {}) {
  const parsed = verifiedConnection(url);
  const env = {
    ...process.env,
    PGHOST: options.host || parsed.hostname,
    PGPORT: options.port || parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '5',
    PGSSLMODE: parsed.searchParams.get('sslmode') || 'prefer',
    PGSSLROOTCERT:
      parsed.searchParams.get('sslrootcert') || process.env.PGSSLROOTCERT || '',
  };
  if (process.env.NODE_ENV === 'production' && env.PGSSLMODE !== 'verify-full')
    throw new Error(
      'Production backup/restore connections require sslmode=verify-full',
    );
  const names = [
    'PGHOST',
    'PGPORT',
    'PGUSER',
    'PGPASSWORD',
    'PGDATABASE',
    'PGCONNECT_TIMEOUT',
    'PGSSLMODE',
    'PGSSLROOTCERT',
  ];
  const command = options.container ? 'docker' : tool;
  const parameters = options.container
    ? [
        'exec',
        '-i',
        ...names.flatMap((name) => ['-e', name]),
        options.container,
        tool,
        ...args,
      ]
    : args;
  const child = spawn(command, parameters, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // Do not echo pg diagnostics: they may contain connection details or row values.
  child.stderr.resume();
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolveDone()
        : reject(
            new Error(
              `${tool} failed (${code}); sensitive diagnostics omitted`,
            ),
          ),
    );
  });
  void done.catch(() => undefined);
  return { child, done };
}
export async function backup(url, keyFile, directory, options = {}) {
  verifiedConnection(url);
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const destination = join(
    root,
    `finledger-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.flbk`,
  );
  const partial = destination + '.partial';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await key(keyFile), iv);
  cipher.setAAD(magic);
  await writeFile(partial, Buffer.concat([magic, iv]), {
    flag: 'wx',
    mode: 0o600,
  });
  const { child, done } = client(
    'pg_dump',
    url,
    ['--format=custom', '--no-owner', '--no-acl'],
    options,
  );
  child.stdin.end();
  try {
    await Promise.all([
      pipeline(
        child.stdout,
        cipher,
        createWriteStream(partial, { flags: 'a' }),
      ),
      done,
    ]);
    await appendFile(partial, cipher.getAuthTag());
    await rename(partial, destination);
    return destination;
  } catch (error) {
    child.kill();
    await unlink(partial).catch(() => undefined);
    throw error;
  }
}
export async function restore(file, keyFile, adminUrl, options = {}) {
  verifiedConnection(adminUrl);
  const size = (await stat(file)).size;
  if (size < 34) throw new Error('Invalid backup');
  const header = [];
  for await (const chunk of createReadStream(file, { start: 0, end: 16 }))
    header.push(chunk);
  const prefix = Buffer.concat(header);
  if (!prefix.subarray(0, 5).equals(magic))
    throw new Error('Invalid backup format');
  const tags = [];
  for await (const chunk of createReadStream(file, { start: size - 16 }))
    tags.push(chunk);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    await key(keyFile),
    prefix.subarray(5),
  );
  decipher.setAAD(magic);
  decipher.setAuthTag(Buffer.concat(tags));
  const scratch = await mkdtemp(join(tmpdir(), 'finledger-restore-'));
  const dump = join(scratch, 'verified.dump');
  const target =
    'finledger_restore_' + randomUUID().replaceAll('-', '') + '_test';
  try {
    // Authenticate the entire archive before creating a database or invoking pg_restore.
    await pipeline(
      createReadStream(file, { start: 17, end: size - 17 }),
      decipher,
      createWriteStream(dump, { flags: 'wx', mode: 0o600 }),
    );
    const admin = new pg.Client({
      connectionString: adminUrl,
      connectionTimeoutMillis: 5000,
    });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${target}"`);
    } finally {
      await admin.end();
    }
    const url = new URL(adminUrl);
    url.pathname = '/' + target;
    const { child, done } = client(
      'pg_restore',
      url.toString(),
      [
        '--dbname=' + target,
        '--single-transaction',
        '--exit-on-error',
        '--no-owner',
        '--no-acl',
      ],
      options,
    );
    child.stdout.resume();
    await Promise.all([pipeline(createReadStream(dump), child.stdin), done]);
    return { database: target, url: url.toString() };
  } finally {
    await unlink(dump).catch(() => undefined);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = {
    container: process.env.PG_CLIENT_CONTAINER,
    host: process.env.PG_CLIENT_HOST,
    port: process.env.PG_CLIENT_PORT,
  };
  try {
    if (process.argv[2] === 'create') {
      const file = await backup(
        process.env.BACKUP_DATABASE_URL,
        process.env.BACKUP_KEY_FILE,
        process.env.BACKUP_DIRECTORY || 'backups',
        options,
      );
      console.log(
        JSON.stringify({ status: 'VERIFIED', encryptedBackup: file }),
      );
    } else if (process.argv[2] === 'restore-isolated') {
      const result = await restore(
        process.env.BACKUP_FILE,
        process.env.BACKUP_KEY_FILE,
        process.env.RESTORE_ADMIN_URL,
        options,
      );
      console.log(
        JSON.stringify({
          status: 'VERIFIED',
          isolatedDatabase: result.database,
          note: 'Run integrity checks and provision roles before any promotion',
        }),
      );
    } else throw new Error('Use create or restore-isolated');
  } catch (error) {
    console.error(
      `Backup operation FAILED (${error.code || error.name}); credentials omitted`,
    );
    process.exitCode = 1;
  }
}
