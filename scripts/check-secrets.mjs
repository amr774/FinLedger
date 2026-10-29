import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// A publication guard, not a replacement for GitHub secret scanning or review.
// Report locations and categories only: never echo a matched credential.
const staged = process.argv.includes('--staged');
const files = [
  ...new Set(
    execFileSync(
      'git',
      staged
        ? ['ls-files', '--cached', '-z']
        : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean),
  ),
];
const localSecrets = existsSync('.env')
  ? readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = line.match(/^([A-Z_]*(?:PASSWORD|SECRET|TOKEN))=(.+)$/);
        return match && match[2].length >= 24 ? [match[2]] : [];
      })
  : [];
const patterns = [
  [
    'private key',
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
  ],
  [
    'GitHub token',
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/,
  ],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];
const findings = [];
for (const file of files) {
  if (!staged && !existsSync(file)) continue;
  if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.example'))
    findings.push(`${file}: unsafe environment file`);
  if (/\.(?:key|pem|p12|pfx|dump|backup|flbk|sql\.gz)$/i.test(file))
    findings.push(`${file}: sensitive artifact extension`);
  const bytes = staged
    ? execFileSync('git', ['show', `:${file}`], { maxBuffer: 20 * 1024 * 1024 })
    : readFileSync(file);
  if (bytes.includes(0)) continue;
  bytes
    .toString('utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      for (const [category, pattern] of patterns) {
        if (pattern.test(line))
          findings.push(`${file}:${index + 1}: ${category}`);
      }
      if (localSecrets.some((secret) => line.includes(secret)))
        findings.push(
          `${file}:${index + 1}: local credential copied into publication files`,
        );
    });
}
if (findings.length) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `PASS: ${files.length} ${staged ? 'index blobs' : 'tracked/prospective files'} checked; no supported secret patterns or copied local credentials found.`,
  );
}
console.log(
  `Scope: ${staged ? 'exact staged contents' : 'current publication files'} only; inspect history separately. Public simulator/test passwords are intentional. This heuristic does not prove absence of all secrets.`,
);
