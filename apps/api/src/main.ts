import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { validateConfig } from './infrastructure/config';
import { log, FrameworkLogger } from './infrastructure/http';
async function main() {
  validateConfig();
  const app = await NestFactory.create(AppModule, {
    logger: new FrameworkLogger(),
  });
  configureApp(app);
  await app.listen(Number(process.env.PORT || 3000), '0.0.0.0');
}
void main().catch((error) => {
  log.fatal(
    { errorType: error instanceof Error ? error.name : 'unknown' },
    'Startup failed',
  );
  process.exitCode = 1;
});
