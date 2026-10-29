import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { databaseOptions, validateConfig } from '../src/infrastructure/config';
import { monitoringAuthorized } from '../src/infrastructure/monitoring';
describe('Production security configuration', () => {
  const original = { ...process.env };
  const directory = mkdtempSync(join(tmpdir(), 'finledger-ca-'));
  const ca = join(directory, 'ca.pem');
  beforeAll(() => writeFileSync(ca, rootCertificates[0]));
  beforeEach(() => {
    process.env = {
      ...original,
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgresql://finledger_runtime:securepassword@db.example.test:5432/finledger',
      DATABASE_CA_FILE: ca,
      JWT_SECRET: 'a'.repeat(64),
      MONITORING_TOKEN: 'b'.repeat(64),
      WEB_ORIGIN: 'https://ledger.example.test',
      REDIS_URL: 'rediss://default:securepassword@redis.example.test:6380',
      RABBITMQ_URL: 'amqps://finledger:securepassword@mq.example.test:5671',
    };
    delete process.env.MIGRATION_DATABASE_URL;
    delete process.env.DATABASE_ADMIN_URL;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });
  afterEach(() => {
    process.env = { ...original };
  });
  afterAll(() => {
    unlinkSync(ca);
    rmdirSync(directory);
  });
  test('valid production config enforces certificate validation', () => {
    expect(() => validateConfig()).not.toThrow();
    expect(databaseOptions().ssl?.rejectUnauthorized).toBe(true);
  });
  test.each([
    ['NODE_ENV', 'prod'],
    ['WEB_ORIGIN', 'http://ledger.example.test'],
    ['WEB_ORIGIN', 'https://ledger.example.test/path'],
    ['JWT_SECRET', 'REPLACE_WITH_48_OR_MORE_RANDOM_CHARACTERS'],
    ['MONITORING_TOKEN', 'short'],
    ['REDIS_URL', 'redis://redis:6379'],
    ['RABBITMQ_URL', 'amqp://mq:5672'],
    ['REDIS_URL', 'rediss://redis:6380'],
    ['NODE_TLS_REJECT_UNAUTHORIZED', '0'],
    ['DATABASE_URL', 'postgresql://postgres:password@db:5432/finledger'],
    [
      'DATABASE_URL',
      'postgresql://finledger_runtime:password@db:5432/finledger?sslmode=no-verify',
    ],
    ['TRUST_PROXY_CIDRS', '0.0.0.0/0'],
    ['TRUST_PROXY_CIDRS', 'true'],
    ['MIGRATION_DATABASE_URL', 'postgresql://migration:password@db/finledger'],
    ['PORT', '70000'],
  ])('rejects unsafe %s=%s', (name, value) => {
    process.env[name] = value;
    expect(() => validateConfig()).toThrow();
  });
  test('monitoring token uses separate authorization boundary', () => {
    expect(monitoringAuthorized()).toBe(false);
    expect(monitoringAuthorized('Bearer wrong')).toBe(false);
    expect(monitoringAuthorized('Bearer ' + process.env.JWT_SECRET)).toBe(
      false,
    );
    expect(monitoringAuthorized('Bearer ' + process.env.MONITORING_TOKEN)).toBe(
      true,
    );
  });
});
