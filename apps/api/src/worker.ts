import 'dotenv/config';
import { Database } from './infrastructure/database';
import { EventWorker } from './notifications/event-worker';
import { validateConfig } from './infrastructure/config';
import { log } from './infrastructure/http';
import { createServer } from 'node:http';
import {
  monitoringAuthorized,
  renderMetrics,
} from './infrastructure/monitoring';
validateConfig();
const db = new Database();
const worker = new EventWorker(db);
const health = createServer((req, res) => {
  if (req.url === '/health/ready') {
    res
      .writeHead(worker.ready ? 200 : 503)
      .end(worker.ready ? 'ready' : 'unavailable');
  } else if (
    req.url === '/metrics' &&
    monitoringAuthorized(req.headers.authorization)
  ) {
    void renderMetrics(db)
      .then((body) => {
        res
          .writeHead(200, {
            'Content-Type': 'text/plain; version=0.0.4',
            'Cache-Control': 'no-store',
          })
          .end(body);
      })
      .catch(() => res.writeHead(503).end('unavailable'));
  } else res.writeHead(401).end('unauthorized');
});
health.listen(Number(process.env.WORKER_HEALTH_PORT || 3001), '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    health.close();
    void worker.close().then(() => db.$disconnect());
  });
void worker.run().catch(() => {
  log.fatal('Worker stopped unexpectedly');
  health.close();
  void db.$disconnect();
  process.exitCode = 1;
});
