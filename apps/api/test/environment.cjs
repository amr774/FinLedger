const path = require('node:path');
require('dotenv').config({
  path: path.resolve(__dirname, '../../..', '.env'),
  quiet: true,
});
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
)
  throw new Error(
    'Tests require an isolated TEST_DATABASE_URL ending in _test',
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_PREFIX =
  'finledger-test-' + require('node:crypto').randomUUID();
