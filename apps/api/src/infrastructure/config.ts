import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
export function databaseOptions() {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.NODE_ENV !== 'production')
    return { connectionString: url.toString() };
  // pg connection-string SSL parameters override explicit TLS options. Reject that ambiguity.
  if (
    [...url.searchParams.keys()].some((key) =>
      key.toLowerCase().startsWith('ssl'),
    )
  )
    throw new Error('Use DATABASE_CA_FILE, not database URL SSL parameters');
  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync(process.env.DATABASE_CA_FILE!, 'utf8'),
    },
  };
}
export function validateConfig() {
  if (
    process.env.NODE_ENV &&
    !['production', 'development', 'test'].includes(process.env.NODE_ENV)
  )
    throw new Error('Invalid NODE_ENV');
  for (const key of [
    'DATABASE_URL',
    'JWT_SECRET',
    'WEB_ORIGIN',
    'REDIS_URL',
    'RABBITMQ_URL',
  ]) {
    if (!process.env[key]) throw new Error(`Missing configuration: ${key}`);
  }
  if (process.env.JWT_SECRET!.length < 32)
    throw new Error('JWT_SECRET must contain at least 32 characters');
  const origin = new URL(process.env.WEB_ORIGIN!);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.origin !== process.env.WEB_ORIGIN
  )
    throw new Error(
      'WEB_ORIGIN must be an exact origin without a trailing slash',
    );
  const db = new URL(process.env.DATABASE_URL!);
  if (!['postgres:', 'postgresql:'].includes(db.protocol))
    throw new Error('Invalid database protocol');
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid PORT');
  if (process.env.TRUST_PROXY_CIDRS) {
    for (const cidr of process.env.TRUST_PROXY_CIDRS.split(',')) {
      if (cidr.split('/').length > 2) throw new Error('Invalid proxy CIDR');
      const [address, bits] = cidr.split('/');
      const version = isIP(address);
      if (
        !version ||
        (bits !== undefined &&
          (!/^\d+$/.test(bits) ||
            Number(bits) < 8 ||
            Number(bits) > (version === 4 ? 32 : 128)))
      )
        throw new Error(
          'TRUST_PROXY_CIDRS requires explicit restricted IP/CIDR values',
        );
    }
  }
  if (process.env.NODE_ENV === 'production') {
    if (origin.protocol !== 'https:')
      throw new Error('Production requires HTTPS');
    for (const key of ['JWT_SECRET', 'MONITORING_TOKEN']) {
      const value = process.env[key] || '';
      if (value.length < 48 || /REPLACE|CHANGE_ME|example/i.test(value))
        throw new Error(`Invalid production ${key}`);
    }
    if (process.env.JWT_SECRET === process.env.MONITORING_TOKEN)
      throw new Error('Use separate monitoring and JWT secrets');
    if (!process.env.DATABASE_CA_FILE)
      throw new Error('DATABASE_CA_FILE is required');
    if (
      !db.password ||
      !db.username ||
      ['postgres', 'finledger', 'finledger_migrator'].includes(
        decodeURIComponent(db.username),
      )
    )
      throw new Error(
        'Production requires dedicated runtime database credentials',
      );
    if (process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_ADMIN_URL)
      throw new Error('Do not give the runtime migration/admin credentials');
    if (new URL(process.env.REDIS_URL!).protocol !== 'rediss:')
      throw new Error('Production Redis requires TLS');
    if (new URL(process.env.RABBITMQ_URL!).protocol !== 'amqps:')
      throw new Error('Production RabbitMQ requires TLS');
    if (
      !new URL(process.env.REDIS_URL!).password ||
      !new URL(process.env.RABBITMQ_URL!).password ||
      new URL(process.env.RABBITMQ_URL!).username === 'guest'
    )
      throw new Error(
        'Production infrastructure requires dedicated credentials',
      );
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
      throw new Error('TLS verification cannot be disabled');
    databaseOptions();
  }
}
