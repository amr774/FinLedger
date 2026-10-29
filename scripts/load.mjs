import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const base = process.env.LOAD_URL || 'http://localhost:3000/api/v1';
const duration = [];
const statuses = {};
async function call(path, body, token, key) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(`Setup ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
const tag = randomUUID();
const password = 'Load-Test-Simulator-2026!';
const sender = await call('/auth/register', {
  email: `load-a-${tag}@example.test`,
  name: 'Load sender',
  password,
});
const recipient = await call('/auth/register', {
  email: `load-b-${tag}@example.test`,
  name: 'Load recipient',
  password,
});
const source = await call('/wallets', {}, sender.accessToken);
const destination = await call('/wallets', {}, recipient.accessToken);
await call(
  '/demo/fund',
  { amount: '1000', currency: 'EGP' },
  sender.accessToken,
  randomUUID(),
);
const start = performance.now();
await Promise.all(
  Array.from({ length: 50 }, async () => {
    const begin = performance.now();
    const response = await fetch(base + '/transfers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sender.accessToken}`,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({
        sourceId: source.id,
        destinationId: destination.id,
        amount: '100',
        currency: 'EGP',
      }),
    });
    await response.arrayBuffer();
    duration.push(performance.now() - begin);
    statuses[response.status] = (statuses[response.status] || 0) + 1;
  }),
);
const elapsed = performance.now() - start;
duration.sort((a, b) => a - b);
const report = {
  timestamp: new Date().toISOString(),
  conditions: {
    base,
    requests: 50,
    concurrency: 50,
    startingMinor: '1000',
    transferMinor: '100',
    runtime: process.version,
    platform: process.platform,
  },
  elapsedMs: elapsed,
  requestsPerSecond: 50 / (elapsed / 1000),
  latencyMs: { p50: duration[24], p95: duration[47], max: duration[49] },
  statuses,
  unexpectedErrorRate: (50 - (statuses[201] || 0) - (statuses[409] || 0)) / 50,
};
writeFileSync('docs/load-results.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (statuses[201] !== 10 || statuses[409] !== 40) process.exitCode = 1;
