import 'dotenv/config';
import { spawnSync } from 'node:child_process';
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
)
  throw new Error('TEST_DATABASE_URL must name an isolated *_test database');
const result = spawnSync(
  process.execPath,
  [
    'node_modules/prisma/build/index.js',
    'migrate',
    'deploy',
    '--config',
    'apps/api/prisma.config.ts',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  },
);
process.exitCode = result.status ?? 1;
