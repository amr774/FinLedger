import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { SafeErrors } from './infrastructure/http';
import { completeOpenApi } from './infrastructure/openapi';
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api/v1');
  if (process.env.TRUST_PROXY_CIDRS)
    app
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', process.env.TRUST_PROXY_CIDRS.split(','));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: process.env.WEB_ORIGIN, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new SafeErrors());
  app
    .getHttpAdapter()
    .getInstance()
    .set('json replacer', (_key: string, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
  const config = new DocumentBuilder()
    .setTitle('FinLedger — virtual EGP simulator')
    .setDescription(
      'Educational simulation only. No real money. All amounts are integer minor-unit strings. Errors: {error:{code,message,requestId}}. All money writes require Idempotency-Key.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  completeOpenApi(document);
  if (process.env.NODE_ENV !== 'production')
    SwaggerModule.setup('api/docs', app, document);
  app.enableShutdownHooks();
}
