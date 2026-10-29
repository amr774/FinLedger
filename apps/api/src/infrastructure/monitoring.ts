import {
  Controller,
  Get,
  Module,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';
import { Public } from '../auth/security';
import { Database } from './database';
import { metrics } from './http';
import { ApiExcludeController } from '@nestjs/swagger';

export function monitoringAuthorized(header?: string): boolean {
  const secret = process.env.MONITORING_TOKEN;
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer '))
    return false;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(header.slice(7)), hash(secret));
}
export async function renderMetrics(db: Database) {
  const [pending, dead, oldest] = await Promise.all([
    db.outboxEvent.count({ where: { publishedAt: null, deadAt: null } }),
    db.outboxEvent.count({ where: { deadAt: { not: null } } }),
    db.outboxEvent.findFirst({
      where: { publishedAt: null, deadAt: null },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);
  const counters: Record<string, number> = {
    http_requests: metrics.requests,
    http_server_errors: metrics.failures,
    http_client_errors: metrics.clientErrors,
    money_requests: metrics.moneyRequests,
    money_request_failures: metrics.moneyFailures,
    rate_limited_requests: metrics.rateLimited,
    redis_fallbacks: metrics.redisFallbacks,
    outbox_publish_failures: metrics.publishFailures,
    outbox_publications: metrics.publications,
    notification_failures: metrics.notificationFailures,
    notification_deliveries: metrics.deliveries,
  };
  const lines = Object.entries(counters).flatMap(([name, value]) => [
    `# TYPE finledger_${name}_total counter`,
    `finledger_${name}_total ${value}`,
  ]);
  for (const [name, value] of Object.entries({
    outbox_pending: pending,
    outbox_dead: dead,
    outbox_oldest_age_seconds: oldest
      ? Math.max(0, (Date.now() - oldest.createdAt.getTime()) / 1000)
      : 0,
    process_uptime_seconds: process.uptime(),
  }))
    lines.push(`# TYPE finledger_${name} gauge`, `finledger_${name} ${value}`);
  lines.push(
    '# TYPE finledger_http_duration_seconds summary',
    `finledger_http_duration_seconds_sum ${metrics.totalDurationMs / 1000}`,
    `finledger_http_duration_seconds_count ${metrics.requests}`,
  );
  return lines.join('\n') + '\n';
}
@Public()
@ApiExcludeController()
@Controller('monitoring')
class MonitoringController {
  constructor(private readonly db: Database) {}
  @Get('metrics') async get(@Req() req: Request, @Res() res: Response) {
    if (!monitoringAuthorized(req.headers.authorization))
      throw new UnauthorizedException();
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/plain; version=0.0.4').send(await renderMetrics(this.db));
  }
}
@Module({ controllers: [MonitoringController] })
export class MonitoringModule {}
