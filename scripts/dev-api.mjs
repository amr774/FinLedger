import { spawn } from 'node:child_process';
let server;
const compiler = spawn(
  process.execPath,
  [
    '../../node_modules/typescript/bin/tsc',
    '-p',
    'tsconfig.build.json',
    '--watch',
    '--preserveWatchOutput',
  ],
  { stdio: ['inherit', 'pipe', 'inherit'] },
);
compiler.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (chunk.toString().includes('Found 0 errors')) {
    const start = () => {
      server = spawn(
        process.execPath,
        ['--env-file=../../.env', 'dist/src/main.js'],
        { stdio: 'inherit' },
      );
    };
    if (server && server.exitCode === null) {
      server.once('exit', start);
      server.kill();
    } else start();
  }
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    compiler.kill();
    server?.kill();
  });
compiler.on('exit', (code) => {
  server?.kill();
  process.exitCode = code ?? 1;
});
