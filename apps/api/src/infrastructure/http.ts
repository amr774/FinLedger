import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  NestMiddleware,
  LoggerService,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import pino from 'pino';
export const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: [
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'authorization',
    'cookie',
    '*.password',
    '*.token',
    '*.authorization',
    '*.cookie',
  ],
});
export class FrameworkLogger implements LoggerService {
  log(message: unknown) {
    log.info({ component: 'nest' }, String(message));
  }
  warn(message: unknown) {
    log.warn({ component: 'nest' }, String(message));
  }
  debug(message: unknown) {
    log.debug({ component: 'nest' }, String(message));
  }
  verbose(message: unknown) {
    log.trace({ component: 'nest' }, String(message));
  }
  error(message: unknown) {
    log.error(
      {
        component: 'nest',
        errorType: message instanceof Error ? message.name : 'FrameworkError',
      },
      'Framework error',
    );
  }
}
export const metrics = {
  requests: 0,
  failures: 0,
  totalDurationMs: 0,
  clientErrors: 0,
  moneyRequests: 0,
  moneyFailures: 0,
  rateLimited: 0,
  redisFallbacks: 0,
  publishFailures: 0,
  publications: 0,
  notificationFailures: 0,
  deliveries: 0,
};
@Injectable()
export class RequestLog implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const id = randomUUID();
    res.setHeader('X-Request-ID', id);
    const start = performance.now();
    res.on('finish', () => {
      const durationMs = performance.now() - start;
      metrics.requests++;
      metrics.totalDurationMs += durationMs;
      if (res.statusCode >= 500) metrics.failures++;
      if (res.statusCode >= 400 && res.statusCode < 500) metrics.clientErrors++;
      if (res.statusCode === 429) metrics.rateLimited++;
      if (
        req.method === 'POST' &&
        ['/api/v1/transfers', '/api/v1/demo/fund'].includes(req.path)
      ) {
        metrics.moneyRequests++;
        if (res.statusCode >= 400) metrics.moneyFailures++;
      }
      log.info(
        {
          requestId: id,
          method: req.method,
          route:
            typeof req.route?.path === 'string'
              ? req.route.path
              : '[unmatched]',
          status: res.statusCode,
          durationMs,
        },
        'request',
      );
    });
    next();
  }
}
@Catch()
export class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const raw =
      error instanceof HttpException
        ? error.getResponse()
        : 'Internal server error';
    const message =
      typeof raw === 'string' ? raw : (raw as { message: unknown }).message;
    if (status === 500)
      log.error(
        {
          requestId: res.getHeader('X-Request-ID'),
          errorType: error instanceof Error ? error.name : 'unknown',
        },
        'Unhandled request failure',
      );
    res.status(status).json({
      error: {
        code: `HTTP_${status}`,
        message,
        requestId: res.getHeader('X-Request-ID'),
      },
    });
  }
}
