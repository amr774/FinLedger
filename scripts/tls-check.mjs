import { createServer } from 'node:http';
import { request } from 'node:https';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const tag = randomUUID().slice(0, 8);
const directory = resolve('.hardening-test', 'tls-' + tag);
await mkdir(directory, { recursive: true, mode: 0o700 });
const config = (await readFile('docker/Caddyfile', 'utf8'))
  .replace(/^\s*email .*$/m, '')
  .replace(/^\s*acme_ca .*$/m, '')
  .replace('{$PUBLIC_DOMAIN} {', 'https://localhost:8443 {\n  tls internal')
  .replace('api:3000', 'host.docker.internal:3103')
  .replace('web:8080', 'host.docker.internal:3103');
await writeFile(resolve(directory, 'Caddyfile'), config);
async function docker(args) {
  return new Promise((done, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? done(output) : reject(new Error(output)),
    );
  });
}
function get(path, ca, headers = {}) {
  return new Promise((done, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: 8443,
        servername: 'localhost',
        path,
        ca,
        headers: { Host: 'localhost:8443', ...headers },
        rejectUnauthorized: true,
      },
      (res) => {
        let body = '';
        res.on('data', (data) => (body += data));
        res.on('end', () =>
          done({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.once('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('TLS request timeout')));
    req.end();
  });
}
const upstream = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      forwardedFor: req.headers['x-forwarded-for'],
      proto: req.headers['x-forwarded-proto'],
    }),
  );
});
await new Promise((done, reject) => {
  upstream.once('error', reject);
  upstream.listen(3103, '0.0.0.0', done);
});
const name = 'finledger-tls-check-' + tag;
let started = false;
try {
  await docker([
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '--add-host',
    'host.docker.internal:host-gateway',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'NET_BIND_SERVICE',
    '--security-opt',
    'no-new-privileges',
    '--tmpfs',
    '/data',
    '--tmpfs',
    '/config',
    '-p',
    '127.0.0.1:8443:8443',
    '-p',
    '127.0.0.1:8085:80',
    '--mount',
    `type=bind,source=${resolve(directory, 'Caddyfile')},target=/etc/caddy/Caddyfile,readonly`,
    'caddy:2-alpine',
  ]);
  started = true;
  let ca;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      ca = await docker([
        'exec',
        name,
        'cat',
        '/data/caddy/pki/authorities/local/root.crt',
      ]);
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  assert(ca);
  const redirect = await fetch('http://127.0.0.1:8085/api/echo', {
    redirect: 'manual',
    headers: { Host: 'localhost:8443' },
  });
  assert.equal(redirect.status, 308);
  assert(redirect.headers.get('location').startsWith('https://'));
  await assert.rejects(get('/api/echo'), (error) =>
    [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    ].includes(error.code),
  );
  const response = await get('/api/echo', ca, {
    'X-Forwarded-For': '203.0.113.99',
    'X-Forwarded-Proto': 'http',
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).proto, 'https');
  assert.notEqual(JSON.parse(response.body).forwardedFor, '203.0.113.99');
  assert(response.headers['strict-transport-security'].includes('31536000'));
  assert(
    response.headers['content-security-policy'].includes("default-src 'self'"),
  );
  assert.equal((await get('/api/v1/monitoring/metrics', ca)).status, 404);
  assert.equal((await get('/api/docs', ca)).status, 404);
  assert.equal((await get('/register', ca)).status, 200);
  const result = {
    timestamp: new Date().toISOString(),
    status: 'VERIFIED',
    checks: [
      'Untrusted certificate rejected',
      'Explicit CA validates HTTPS',
      'Spoofed forwarding headers overwritten',
      'HSTS and CSP present',
      'Public metrics and Swagger blocked',
      'Frontend route forwarded',
      'HTTP redirects to HTTPS under read-only capability-restricted edge configuration',
    ],
    limitation:
      'Local Caddy internal CA and diagnostic upstream; public ACME/DNS and provider TLS connectivity are not verified.',
  };
  await writeFile(
    'docs/tls-results.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (started) await docker(['stop', name]);
  upstream.close();
}
