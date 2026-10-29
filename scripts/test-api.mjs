import 'dotenv/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
)
  throw new Error('Isolated test database required');
const child = spawn(process.execPath, ['apps/api/dist/src/main.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_ENV: 'test',
    RATE_LIMIT_PREFIX: `finledger-e2e-${randomUUID()}`,
    PORT: '3100',
    WEB_ORIGIN: 'http://127.0.0.1:8180',
    LOG_LEVEL: 'silent',
  },
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
