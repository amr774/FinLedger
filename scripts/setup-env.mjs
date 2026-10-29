import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
if (existsSync('.env')) throw new Error('.env exists; refusing to overwrite');
const password = randomBytes(24).toString('hex');
const secret = randomBytes(48).toString('hex');
writeFileSync(
  '.env',
  readFileSync('.env.example', 'utf8')
    .replaceAll('REPLACE_WITH_RANDOM_LOCAL_PASSWORD', password)
    .replace('REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS', secret),
);
console.log('Created local .env with random credentials. Do not commit it.');
