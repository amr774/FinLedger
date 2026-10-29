import 'dotenv/config';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
const tables = [
  'User',
  'Session',
  'RefreshToken',
  'Wallet',
  'Transfer',
  'LedgerJournal',
  'LedgerPosting',
  'IdempotencyRecord',
  'OutboxEvent',
  'Notification',
  'AuditLog',
  '_prisma_migrations',
];
const functions = [
  'deny_mutation',
  'protect_wallet_identity',
  'apply_posting',
  'check_wallet_balance',
  'check_journal',
  'protect_user_role',
];
const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
export async function provision(adminUrl, migrationUrl, runtimeUrl, backupUrl) {
  const [admin, migration, runtime] = [adminUrl, migrationUrl, runtimeUrl].map(
    (value) => new URL(value),
  );
  if (
    process.env.NODE_ENV === 'production' &&
    admin.searchParams.get('sslmode') !== 'verify-full'
  )
    throw new Error('Production provisioning requires verified database TLS');
  const backup = backupUrl ? new URL(backupUrl) : undefined;
  const managed = [migration, runtime, ...(backup ? [backup] : [])];
  for (const target of managed) {
    if (target.host !== admin.host || target.pathname !== admin.pathname)
      throw new Error(
        'All provisioning URLs must address the same database endpoint',
      );
    if (
      !/^[a-z][a-z0-9_]{2,62}$/.test(target.username) ||
      decodeURIComponent(target.password).length < 24
    )
      throw new Error(
        'Dedicated role names and passwords of at least 24 characters required',
      );
  }
  if (
    new Set([admin.username, ...managed.map((role) => role.username)]).size !==
    managed.length + 1
  )
    throw new Error('Admin, migration and runtime roles must differ');
  const client = new pg.Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL standard_conforming_strings = on');
    for (const role of managed) {
      const found = await client.query(
        'SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname=$1',
        [role.username],
      );
      if (found.rows.some((row) => Object.values(row).some(Boolean)))
        throw new Error('Refusing to repurpose a privileged role');
      const memberships = await client.query(
        'SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=$1',
        [role.username],
      );
      if (memberships.rowCount)
        throw new Error('Managed roles must not inherit other roles');
      if (!found.rowCount)
        await client.query(`CREATE ROLE ${identifier(role.username)} NOLOGIN`);
      await client.query(
        `ALTER ROLE ${identifier(role.username)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD ${literal(decodeURIComponent(role.password))}`,
      );
    }
    const owner = identifier(migration.username);
    const app = identifier(runtime.username);
    const database = identifier(decodeURIComponent(admin.pathname.slice(1)));
    await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await client.query(`REVOKE ALL ON DATABASE ${database} FROM ${app}`);
    await client.query(
      `GRANT CONNECT ON DATABASE ${database} TO ${owner}, ${app}`,
    );
    await client.query(`GRANT CREATE ON DATABASE ${database} TO ${owner}`);
    await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await client.query(`REVOKE ALL ON SCHEMA public FROM ${app}`);
    await client.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${owner}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${app}`);
    for (const table of tables) {
      const found = await client.query('SELECT to_regclass($1) AS name', [
        `public.${identifier(table)}`,
      ]);
      if (found.rows[0].name)
        await client.query(
          `ALTER TABLE public.${identifier(table)} OWNER TO ${owner}`,
        );
    }
    for (const name of functions) {
      const found = await client.query('SELECT to_regprocedure($1) AS name', [
        `public.${name}()`,
      ]);
      if (found.rows[0].name)
        await client.query(
          `ALTER FUNCTION public.${identifier(name)}() OWNER TO ${owner}`,
        );
    }
    for (const name of ['Role', 'WalletStatus', 'TransferKind', 'Side']) {
      const found = await client.query('SELECT to_regtype($1) AS name', [
        `public.${identifier(name)}`,
      ]);
      if (found.rows[0].name)
        await client.query(
          `ALTER TYPE public.${identifier(name)} OWNER TO ${owner}`,
        );
    }
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${app}`);
    for (const table of tables.filter(
      (name) => name !== '_prisma_migrations',
    )) {
      const found = await client.query('SELECT to_regclass($1) AS name', [
        `public.${identifier(table)}`,
      ]);
      if (found.rows[0].name)
        await client.query(
          `GRANT SELECT, INSERT ON public.${identifier(table)} TO ${app}`,
        );
    }
    for (const [table, columns] of Object.entries({
      Wallet: ['balance'],
      Session: ['revokedAt'],
      RefreshToken: ['usedAt'],
      OutboxEvent: [
        'publishedAt',
        'attempts',
        'nextAttemptAt',
        'lastError',
        'deadAt',
      ],
      Notification: ['message'],
    })) {
      const found = await client.query('SELECT to_regclass($1) AS name', [
        `public.${identifier(table)}`,
      ]);
      if (found.rows[0].name)
        await client.query(
          `GRANT UPDATE (${columns.map(identifier).join(',')}) ON public.${identifier(table)} TO ${app}`,
        );
    }
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC`,
    );
    if (backup) {
      const reader = identifier(backup.username);
      await client.query(`REVOKE ALL ON DATABASE ${database} FROM ${reader}`);
      await client.query(`REVOKE ALL ON SCHEMA public FROM ${reader}`);
      await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${reader}`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${reader}`);
      await client.query(
        `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${reader}`,
      );
      for (const table of tables) {
        const found = await client.query('SELECT to_regclass($1) AS name', [
          `public.${identifier(table)}`,
        ]);
        if (found.rows[0].name)
          await client.query(
            `GRANT SELECT ON public.${identifier(table)} TO ${reader}`,
          );
      }
    }
    await client.query('COMMIT');
    console.log(
      'Database roles provisioned; existing rows preserved. Re-run after migrations to grant only reviewed tables.',
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.argv.includes('--apply'))
    throw new Error(
      'Explicit --apply required; use DATABASE_ADMIN_URL, MIGRATION_DATABASE_URL and RUNTIME_DATABASE_URL for the intended FinLedger database',
    );
  await provision(
    process.env.DATABASE_ADMIN_URL,
    process.env.MIGRATION_DATABASE_URL,
    process.env.RUNTIME_DATABASE_URL,
    process.env.BACKUP_DATABASE_URL,
  ).catch((error) => {
    console.error(
      `Provisioning failed (${error.code || error.name}); credentials and SQL omitted`,
    );
    process.exitCode = 1;
  });
}
