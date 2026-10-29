import {
  CanActivate,
  ExecutionContext,
  Global,
  HttpException,
  Injectable,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';
import { Request } from 'express';
import { log, metrics } from './http';
@Injectable()
export class RateLimit implements CanActivate, OnModuleDestroy {
  readonly redis = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    enableOfflineQueue: false,
    retryStrategy: (n) => Math.min(n * 500, 10000),
  });
  private readonly local = new Map<
    string,
    { count: number; expires: number }
  >();
  constructor() {
    this.redis.on('error', () =>
      log.warn('Redis rate limiter unavailable; using per-process fallback'),
    );
  }
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.path.includes('/health/')) return true;
    const auth = req.path.includes('/auth/');
    const key = `${auth ? 'auth' : 'api'}:${req.ip}`;
    const maximum = auth ? 30 : 240;
    let count: number;
    try {
      count = Number(
        await this.redis.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
          1,
          `${process.env.RATE_LIMIT_PREFIX || `finledger:${process.env.NODE_ENV || 'development'}`}:rate:${key}`,
        ),
      );
    } catch {
      metrics.redisFallbacks++;
      const now = Date.now();
      for (const [k, v] of this.local)
        if (v.expires < now) this.local.delete(k);
      const item = this.local.get(key) || { count: 0, expires: now + 60000 };
      count = ++item.count;
      this.local.set(key, item);
    }
    if (count > maximum)
      throw new HttpException('Too many requests; retry in one minute', 429);
    return true;
  }
  async onModuleDestroy() {
    this.redis.disconnect();
  }
}
@Global()
@Module({ providers: [RateLimit], exports: [RateLimit] })
export class RateLimitModule {}
