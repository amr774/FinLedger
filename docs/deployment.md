# Deployment and operations

For the implemented hardening controls and exact staging commands, use [production deployment](production-deployment.md), [backup recovery](backup-recovery.md), and [the readiness report](../PRODUCTION_READINESS_REPORT.md). The notes below describe the original **local demo defaults**; they are not the new production Compose configuration.

## Local reviewer setup

Run the README Docker commands. Compose starts PostgreSQL/Redis/RabbitMQ, applies migrations through a one-shot job, starts the API and worker, and serves the built dashboard with nginx. API readiness waits for PostgreSQL; broker/Redis availability does not gate financial API readiness. Health probes and persistent PostgreSQL/RabbitMQ volumes are configured. The API image runs as the non-root Node user. The local nginx image uses its standard process configuration.

All host ports bind loopback. Compose uses `NODE_ENV=development` by default so HTTP-only localhost demos work. Set production mode and an HTTPS `WEB_ORIGIN` when placing the service behind a trusted TLS reverse proxy. Do not use the public development seed accounts in an internet-facing environment.

## Before public hosting

1. Use TLS termination and a private network for PostgreSQL, Redis and RabbitMQ. Set `NODE_ENV=production`, a random JWT secret, exact HTTPS origin and secret-manager credentials. Cookies become Secure automatically. Do not commit `.env` or image-build secrets.
2. Separate the migration role from the runtime role. The latter needs SELECT/INSERT on ledger, journals, transfers, audit and idempotency, UPDATE on wallets for the posting trigger, and appropriate CRUD on sessions/outbox/notifications. It must not own tables, disable triggers, truncate financial records or run DDL. Compose's local bootstrap database user is intentionally not a hardened hosting role.
3. Configure trusted proxy handling explicitly if per-client IP limits are needed behind nginx/load balancers. This version does not trust arbitrary forwarded headers; the nginx stack therefore limits by proxy IP. Add a trusted-proxy CIDR and edge throttling before exposing multiple tenants.
4. Back up PostgreSQL with point-in-time recovery, test restores, and monitor disk space. Protect the treasury and ledger migrations through code review. Never modify old financial records to "repair" an incident.
5. Monitor pending/old outbox rows, dead jobs, Redis fallback logs, broker queue depths, HTTP failures and database readiness. Basic API counters are process-local and reset on restart; use an external metrics pipeline for long-term monitoring.
6. Use replicated quorum RabbitMQ queues and at-least-once dead-lettering if broker-node failure tolerance is required. The local single-node classic queues demonstrate retry mechanics but do not promise high availability. Apply retention and message-size controls.
7. Pin deployed image digests after scanning, use a dedicated non-root web image as appropriate, and enforce resource limits. The reviewer image includes build/migration tools for reproducibility; separate lean runtime/migration images are a future optimization.

## Recovery

If a client times out, retry its original idempotency key and payload. Never manually adjust a balance. PostgreSQL rolls back incomplete financial writes. If RabbitMQ is down, transfers remain committed and outbox rows await publication. Restarting the worker resumes eligible jobs; duplicates are safe.

Failed publications retry up to 20 times with exponential backoff. Admins can inspect `/api/v1/admin/jobs/failed`. After diagnosing a permanent problem, an operator may replay an event using the same event ID: clear `deadAt`, `publishedAt`, `lastError`, reset attempts, and set `nextAttemptAt` to now in that outbox row. Preserve its payload and ID. Consumer uniqueness prevents duplicate notifications. This operational DB procedure requires a reviewed privileged session; an admin replay endpoint is not exposed.

Authentication refresh reuse revokes the entire session; the user signs in again. JWT secret rotation invalidates access tokens, but refresh tokens remain valid unless sessions are also revoked. Plan both operations when rotating after compromise.

No deployment is automated to a public host. GitHub Actions validates build/deployment artifacts; environment promotion, secrets, TLS and restore testing remain hosting-specific responsibilities.
