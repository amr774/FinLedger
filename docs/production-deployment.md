# Production and staging operations

This is a deployment preparation guide, not approval to deploy. No production/staging service has been started as part of hardening. Commands below that provision roles, migrate or start services are for an explicitly approved deployment window. Existing local Compose remains available for portfolio review.

## Architecture and resources

Use a Linux Docker host with private connectivity to PostgreSQL 17, authenticated TLS Redis and authenticated TLS RabbitMQ. Production Compose intentionally contains **no database, Redis or broker server and publishes none of their ports**. Only Caddy exposes public 80/443; Prometheus binds loopback 9090. API and worker ports are private to Docker. Use provider firewalls to allow database access only from the app host and controlled operator/backup hosts, enforce `hostssl`/SCRAM, and reject plaintext connections. Restrict broker credentials to a dedicated FinLedger virtual host; isolate Redis per environment. Never use the public development seed accounts.

Start planning with 2–4 vCPU and 4 GiB RAM for the app host including optional Prometheus, plus managed infrastructure. These are estimates, not measured capacity requirements. The supplied limits are API 768 MiB/1 CPU, worker 512 MiB/0.5 CPU, web 128 MiB/0.25 CPU, edge 256 MiB/0.5 CPU and Prometheus 512 MiB/0.5 CPU. Disk must cover logs, metrics and certificates; size database storage from observed growth, with alerts before exhaustion. Same-wallet transfers and treasury funding serialize; run a representative staging load before setting capacity claims.

Staging must use a separate host, DNS name, database, Redis and broker virtual host. Production/staging network templates use the same dedicated subnet `172.30.80.0/24`; do not launch both on one host or on an overlapping network. If changing that subnet, change Caddy's static address and API `TRUST_PROXY_CIDRS` together. Only Caddy's address is trusted, and Caddy overwrites forwarded client/protocol headers. Do not enable broad proxy trust or publish API ports.

## Credentials and database roles

1. Copy `.env.production.example` to `.env.staging` on the staging host. Replace domain, ACME contact and infrastructure URLs. Use separately generated random runtime, migration and backup passwords of at least 24 characters. JWT and monitoring secrets must be independent and at least 48 characters. Restrict the env file to the deployment operator (`chmod 600`). Keep secrets in a secret manager for real hosting; never commit the filled file.
2. Install the database CA at `secrets/database-ca.pem` and the service CA bundle at `secrets/services-ca.pem`. Copy the exact monitoring token into `secrets/monitoring-token`; on Linux make it readable only by the Prometheus container UID (65534) and the operator. CA certificates are public; private keys and secret values are not. Provider certificates and hostname validation must succeed; disabling TLS verification is rejected.
3. Copy `.env.provision.example` to `.env.provision` in an operator-only checkout. Set the same role names/passwords and database as staging, with host-accessible CA paths. Only the bootstrap/admin URL is used for provisioning. The runtime receives neither admin nor migration credentials. Use a dedicated FinLedger database: provisioning revokes PUBLIC schema/database privileges and changes ownership of the known FinLedger tables, functions and enums. It does not delete rows or reset schemas. Coordinate existing connections before switching credentials.
4. Back up an existing installation before ownership changes. After approval, provision, migrate, and provision again to grant privileges on the reviewed new objects:

```sh
node --env-file=.env.provision scripts/provision-db.mjs --apply
docker compose --env-file .env.staging -f compose.production.yml -f compose.staging.yml --profile operations run --rm migrate
node --env-file=.env.provision scripts/provision-db.mjs --apply
```

The migrator owns application tables/functions/types, can create schema objects in this database, and cannot create databases or roles. Runtime can read/insert application records and update only required columns: wallet balance, session revocation, refresh consumption, delivery state and notification message. It cannot alter/drop schema, truncate/delete ledger data, impersonate the migrator, change user roles or read migration metadata. Administrator insertion also requires the table-owning migration role. The optional backup role can SELECT but cannot write. Future schema changes require reviewing the explicit grant list and rerunning provisioning. Do not add blanket runtime grants on future tables.

Runtime startup verifies that the connected role is not superuser, owner, schema creator, database creator, temporary-object creator, role administrator or replication/bypass-RLS user. Do not grant these permissions to bypass a startup failure. For an existing populated database, role adoption must be rehearsed on its restored copy first. Cluster-level connectivity to other databases and provider-specific role administration remain operator responsibilities.

## TLS and application security

Production requires exact HTTPS `WEB_ORIGIN`, TLS Redis (`rediss`) and RabbitMQ (`amqps`), a database CA, strong separate secrets and a restricted database role. Runtime database URLs must have **no SSL query parameters**: the pg adapter supplies strict CA/hostname verification explicitly. Migration/backup URLs use `sslmode=verify-full&sslrootcert=...` for their CLI clients; container CA paths differ from host paths.

Caddy obtains and renews certificates, redirects HTTP to HTTPS and sends HSTS/CSP/security headers. DNS A/AAAA records must reach this host, ports 80/443 must be available, certificate volumes must persist, and the ACME contact must be valid. The staging overlay deliberately uses ACME staging certificates, which browsers do not trust. For a trusted staging certificate, set its overlay ACME CA to the production ACME directory after validating DNS and issuance limits. Never bypass certificate warnings for public users.

Refresh cookies are Secure in production, HTTP-only, SameSite Strict and scoped to auth routes. Auth cookie writes check Origin, JWT uses fixed HS256/issuer/audience, and replay revokes the session. CORS allows the configured origin. Swagger is disabled in production and blocked at the edge; monitoring is also blocked publicly. Caddy does not enable raw request access logging. Application logs use route templates, request ID, method, status and duration, without bodies, credentials, wallet IDs or amounts. Token fields have additional redaction.

## Prepare without deployment

```sh
npm ci
npm run db:generate
npm run build
docker compose --env-file .env.production.example -f compose.production.yml config --quiet
docker compose --env-file .env.production.example -f compose.production.yml -f compose.staging.yml config --quiet
docker compose --env-file .env.staging -f compose.production.yml -f compose.staging.yml --profile operations build
```

The runtime image prunes development dependencies and runs as the Node user; migrations use a separate tooling target. Web runs nginx as an unprivileged user. Containers use capability restrictions, read-only filesystems, resource limits and bounded log rotation. Review/pin tested image digests in your release manifest and perform an OS/container vulnerability scan before promotion; npm audit does not scan system packages.

## Exact staging start commands — only after explicit approval

With secrets/CAs configured, backups verified and the role/migration sequence above completed:

```sh
docker compose --env-file .env.staging -f compose.production.yml -f compose.staging.yml --profile monitoring up -d --wait api worker web edge prometheus
docker compose --env-file .env.staging -f compose.production.yml -f compose.staging.yml ps
```

Check the real HTTPS site using its trusted CA, create non-public test accounts, test transfers/refresh/logout, run a restricted-role integrity check, and verify a fresh backup restores. Review Caddy certificate renewal, external provider firewalls, alerts and durable-volume behavior. These are release gates, not already verified hosting claims. Remote GitHub Actions has not been run by this phase.

## Monitoring and rollback

Prometheus scrapes API `/api/v1/monitoring/metrics` and worker `/metrics` over the private Docker network with a separate bearer token. SSH-forward loopback 9090 for operator access. Do not publish its UI publicly. Metrics include HTTP failures/duration, money request failures (including business rejections), Redis fallback, publication failures, delivery attempts, pending/dead events and oldest pending age. Counters reset with processes; publication/delivery counters count attempts, not unique monetary events. Financial success remains determined by the ledger.

The template selects Prometheus 3.13.5, listed as the current LTS release on the [official download page](https://prometheus.io/download/) when checked on 29 October 2026. Recheck support/security advisories and pin the tested digest before a real deployment. Intra-host metric scraping uses the private Docker network; remote scraping requires an authenticated TLS path.

`ops/alerts.yml` defines seven rules. Configure Alertmanager and a human notification receiver before relying on them; no external messages or receiver have been configured. Add provider database/Redis/broker disk and health alerts, backup-age checks and host resource monitoring. API readiness gates PostgreSQL; worker readiness requires a successful recent publishing iteration and active channels. Redis fallback allows continued financial operations with per-process throttling and emits an alert metric.

Migrations are forward-only. Never edit an applied migration, reset a database, truncate ledger records or automatically run down migrations. For application rollback, redeploy the previously approved digest only if it is compatible with the current schema. For failed migrations, stop promotion, inspect `_prisma_migrations` using the migrator, reconcile the exact partial change, and use Prisma resolve only after a reviewed repair. A data recovery is a restore into a new database plus verification and an approved cutover, not an overwrite of the live database. Preserve the original for investigation. Revoke copied sessions/refresh tokens before making a recovered database public; stop/reconcile workers to avoid inappropriate re-delivery.

References: [pg TLS options](https://node-postgres.com/features/ssl), [Caddy proxy header behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [PostgreSQL backup documentation](https://www.postgresql.org/docs/17/backup-dump.html).
