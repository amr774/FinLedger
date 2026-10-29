import 'dotenv/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const database = process.env.TEST_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith('_test'))
  throw new Error('Isolated test database required');
const port = 3101;
const origin = `http://127.0.0.1:${port}`;
try {
  await fetch(`${origin}/api/v1/health/live`);
  throw new Error('Audit load port is already occupied');
} catch (error) {
  if (!(error instanceof TypeError)) throw error;
}
const env = {
  ...process.env,
  DATABASE_URL: database,
  NODE_ENV: 'test',
  PORT: String(port),
  LOG_LEVEL: 'silent',
  RATE_LIMIT_PREFIX: `finledger-load-${randomUUID()}`,
  LOAD_URL: `${origin}/api/v1`,
};
const api = spawn(process.execPath, ['apps/api/dist/src/main.js'], {
  env,
  stdio: 'inherit',
});
async function run(script) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)),
    );
  });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    ready = await fetch(`${origin}/api/v1/health/ready`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ready) break;
    if (api.exitCode !== null)
      throw new Error('Test API exited before readiness');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Test API did not become ready');
  await run('scripts/load.mjs');
  await run('scripts/check-integrity.mjs');
} finally {
  api.kill();
}
