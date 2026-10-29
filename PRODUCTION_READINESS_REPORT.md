# Production hardening and deployment readiness

Date: 29 October 2026, Africa/Cairo. Existing project hardened in place. The previous audit baseline was **48 tests**, not eight. No GitHub push, public deployment, staging startup or live database reset was performed. Existing demo containers still run their prior images; new images/configuration are prepared separately. New test databases/roles and temporary TLS containers were used for verification.

## 1. Completed improvements

| Feature                                                             | Classification | Evidence / boundary                                                                                                                                                           |
| ------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate migration/runtime/backup credentials                       | VERIFIED       | Provisioning and real permission checks in isolated PostgreSQL; live demo credentials deliberately unchanged                                                                  |
| Explicit runtime grants and protected admin provisioning            | VERIFIED       | DDL, trigger disabling, deletion, truncation, role escalation, migration impersonation/metadata access and outbox payload mutation denied; authorized transfers still succeed |
| Private production service topology                                 | VERIFIED       | Production/staging Compose validates; no database/Redis/broker servers or published API/worker ports in the template                                                          |
| Hosted firewall rules and network reachability                      | NOT VERIFIED   | No hosting environment supplied or deployed                                                                                                                                   |
| Production configuration validation                                 | VERIFIED       | Rejects insecure URLs, weak/placeholding secrets, broad proxy trust, privileged credential names, migration credentials in runtime, invalid ports/environment and TLS bypass  |
| Database TLS and role startup guard                                 | VERIFIED       | Dedicated local TLS PostgreSQL test: valid CA succeeds, plaintext/untrusted CA/wrong hostname fail, superuser rejected                                                        |
| HTTPS/security headers/proxy trust                                  | VERIFIED       | Local restricted Caddy checks HTTPS redirect, certificate validation, HSTS/CSP, forwarding-header replacement and blocked public monitoring/docs                              |
| Real DNS, public ACME issuance/renewal, provider certificates       | NOT VERIFIED   | Local internal CA is not public certificate evidence                                                                                                                          |
| Secure refresh cookie/auth regressions                              | VERIFIED       | Secure, HttpOnly, SameSite Strict; existing rotation/replay/logout/ownership/RBAC tests retained                                                                              |
| Structured logs and secret handling                                 | VERIFIED       | Route templates replace raw URL paths; existing body-free logs retained; sensitive fields redacted; secrets/backup artifacts excluded from Git/build context                  |
| Protected application/worker metrics and readiness                  | VERIFIED       | Missing/wrong tokens denied; correct token returns counters/gauges; restricted worker becomes ready and delivers events                                                       |
| Prometheus configuration and seven alert rules                      | VERIFIED       | Prometheus 3.13.5 LTS promtool validates config and seven rules; endpoint behavior tested separately                                                                          |
| Hosted continuous scraping and alert notifications                  | NOT VERIFIED   | Prometheus stack/Alertmanager receiver not deployed; no messages sent                                                                                                         |
| Encrypted backups and isolated restoration                          | VERIFIED       | SELECT-only backup role, authenticated encryption, tamper rejection, table-digest comparison, restored constraints and ledger integrity                                       |
| Backup schedule/retention procedure                                 | VERIFIED       | systemd templates and runbook prepared; tool has no silent archive-pruning or target-overwrite option                                                                         |
| Installed backup timer, offsite retention, PITR, production RPO/RTO | NOT VERIFIED   | Windows development environment; no production scheduler/storage provider supplied                                                                                            |
| Production/staging image preparation                                | VERIFIED       | API/worker/migration/web images build; non-root runtime imports without Jest/secrets; read-only non-root web image serves SPA. Full hosted startup remains unverified         |
| Actual production/staging deployment                                | NOT VERIFIED   | Explicit approval required; no deployment attempted                                                                                                                           |

## 2. Remaining vulnerabilities

**FAILED — zero findings across all development dependencies:** npm audit still reports six low-severity entries in the Jest/ts-jest/deepmerge chain. The registry's latest deepmerge is 4.3.1, within the advisory's affected range. npm proposes incompatible old Jest/ts-jest downgrades; these were not applied. Evidence: `docs/hardening-dependencies.json`; advisory [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). This is a development-tool exposure; do not consume untrusted Jest configuration.

**VERIFIED: runtime npm audit reports zero vulnerabilities**, with evidence in `docs/hardening-runtime-dependencies.json`. Production images built successfully, API imports load as a non-root user without Jest or workspace secrets, and the non-root web image serves the SPA with a read-only filesystem. These smoke checks do not establish a complete hosted production startup. Runtime images prune development dependencies; the migration tooling image intentionally retains build tools and is an operator-only job. **NOT VERIFIED:** OS-package/container vulnerability scan, image signing/SBOM attestation and hosted penetration testing. Review immutable release digests and scan them before promotion.

## 3. Actual test results

**VERIFIED: 67 tests passed** — 31 unit, 33 PostgreSQL/Redis/RabbitMQ integration cases and three Chromium browser scenarios. Formatting, lint, typecheck and all workspace production builds passed. The restricted-role/backup runner passed 25 additional check groups; HTTPS passed seven groups and PostgreSQL TLS passed six groups. These script check groups are reported separately from Jest/Playwright test counts.

Separate hardening evidence is in `docs/hardening-results.json`; HTTPS evidence in `docs/tls-results.json`; database TLS evidence in `docs/database-tls-results.json`. Raw local outputs are retained in ignored `docs/hardening-*.log`, `docs/tls-check.log`, `docs/database-tls-check.log` and `docs/production-docker-build.log`.

The local built-image inventory is in `docs/production-image-manifest.json`. Production Node/nginx/Caddy/Prometheus base or infrastructure references are pinned to observed digests; application image IDs have not been published to a registry. Prometheus 3.13.5 LTS successfully validated the configuration and all seven rules. Public certificate issuance, alert delivery and OS-package scanning are still NOT VERIFIED.

Restricted-role concurrency verifies 20 identical requests have one effect, then 50 separate requests spend the remaining funds with nine successes and 41 insufficient-funds responses. The normal integration suite still tests the original 10-success/40-rejection scenario. Direct balance corruption rolls back. Existing rollback, idempotency, funding quota, immutable journal, refresh replay, authorization and RabbitMQ retry/duplicate tests remain. A new broker reconnection test preserves duplicate suppression.

Implementation-stage failures were real and corrected: initial migrator grants lacked database CREATE needed by the first migration; the private metrics controller initially lacked a Swagger exclusion and caused strict schema generation to fail; initial Caddy syntax used unsupported inline blocks; the first TLS test omitted the matching Host header; a test script had a missing brace. Failed runs were not counted as verification. Dedicated dotenv runtime declaration was added so pruning development dependencies does not remove a startup import.

## 4. Database security status

**VERIFIED in isolated databases.** Provisioning creates non-superuser, non-role-creating, non-replicating roles, refuses privileged/member-role reuse, transfers ownership of known tables/functions/enums to the migrator, revokes PUBLIC schema/database privileges, grants only reviewed runtime columns and optional backup SELECT. The runtime has no migration metadata access and cannot provision admins. Migration 004 protects admin insertion without changing ledger arithmetic or old migrations.

**NOT VERIFIED on the existing live demo or hosted database.** Demo data/credentials were preserved. A real adoption must back up first and rehearse ownership changes on a restored copy. The script targets a dedicated FinLedger database; do not use it for a shared application database. Cluster-wide access to other databases and provider-specific role administration need an operator review.

## 5. TLS status

**VERIFIED locally:** certificate-verifying PostgreSQL connections, rejection of plaintext/untrusted/wrong-host connections, Secure-cookie attributes, and Caddy HTTPS/security headers. Production validates exact HTTPS origin and requires `rediss`, `amqps`, a database CA and separate secrets. Only the fixed Caddy address is trusted by the API. Caddy replaces untrusted forwarding headers.

**NOT VERIFIED:** real Redis/RabbitMQ TLS providers, public DNS/ACME, renewal across host restart, upstream load balancer/CDN topology and installed provider firewall policy. Staging overlay uses intentionally untrusted ACME staging certificates. A final real HTTPS smoke test remains a release gate.

## 6. Monitoring status

**VERIFIED:** metrics authorization, aggregate counters without tokens/account data, queue gauges and restricted worker readiness/delivery. Metrics cover server/client errors, rejected money requests, rate limiting, Redis fallback, broker publishing failures, delivery attempts and outbox backlog/dead events/age. Logs retain request correlation without raw URL paths, bodies or monetary values. Process counters reset on restart and delivery/publication counters include attempts, not unique financial effects.

**NOT VERIFIED:** end-to-end alert delivery, production Prometheus persistence, host/provider disk/network dashboards and an operational on-call response. Seven validated alert rules and a 15-day Prometheus retention configuration are supplied, but no external notification receiver has been configured. Production readiness requires those operational checks.

## 7. Backup and restore verification

**VERIFIED:** a fresh isolated database was migrated and populated through the API using the restricted role. A SELECT-only role produced an AES-256-GCM encrypted custom dump. Ciphertext did not contain fixture emails; tampering failed authentication before restore. A new random restore database received the archive transactionally. Application table digests matched, balance-corruption attempts failed, and global ledger total, negative user wallet count, unbalanced journals and cache inconsistencies were all zero. Generated databases remain for inspection; no existing database was overwritten.

**NOT VERIFIED:** offsite upload, object lock/retention enforcement, installed daily systemd schedule, failure notifications, production-size restore time, WAL/PITR and full cutover/reconciliation. The documented 24-hour logical-backup RPO is a planning target, not a measured SLA. Keep versioned encryption keys separately from archives and revoke restored sessions before public cutover.

## 8. Deployment blockers

- **NOT VERIFIED:** explicit deployment approval, target host/DNS and separate staging services.
- **NOT VERIFIED:** real secrets/CA bundles, migration/runtime/backup role adoption on hosted infrastructure and provider TLS/firewall checks.
- **NOT VERIFIED:** clean runtime/OS image scan, selected immutable release digests and remote CI execution.
- **NOT VERIFIED:** public certificate issuance/renewal and full HTTPS UI/API smoke tests on that host.
- **NOT VERIFIED:** offsite backup/retention, production restore drill, backup-age alerting and human alert receiver.
- **NOT VERIFIED:** representative load/soak, multi-node broker failure and capacity/resource sizing. Templates estimate 2–4 vCPU/4 GiB app hosting with managed infrastructure; these are not benchmark guarantees.

No claim is made that the project is already safely hosted. It is hardened and locally testable; release remains gated by the environment-specific items above. Password recovery/MFA, financial reversals and real email remain outside existing implemented scope.

## 9. Exact local startup and verification commands

From `D:\PROJECTS\finledger` (or the checkout root on Linux):

```sh
# First checkout only; skip this command when .env already exists:
node scripts/setup-env.mjs
docker compose up -d --build --wait
npm ci
npm run db:generate
docker compose --profile test up -d --wait postgres-test
npm run db:test
npm run verify
npm run test:hardening
node scripts/tls-check.mjs
node scripts/database-tls-check.mjs
```

The first two commands start the existing local reviewer stack when the user chooses; they were not used to replace the live demo during hardening. `setup-env.mjs` preserves an existing `.env`. The hardening/TLS checks require their documented ports and Docker images. Test source/restore databases stay on the isolated test server. There is no reset/volume-deletion command.

Additional commands actually used during this phase:

```sh
npm audit --json > docs/hardening-dependencies.json
npm view deepmerge version
npm view deepmerge versions --json
npm install dotenv@^17.2.3 --workspace @finledger/api --save --package-lock-only --ignore-scripts --no-audit
docker compose --env-file .env.production.example -f compose.production.yml config --quiet
docker compose --env-file .env.production.example -f compose.production.yml -f compose.staging.yml config --quiet
docker compose --env-file .env.production.example -f compose.production.yml --profile operations build
npm run verify > docs/hardening-verification.log 2>&1
npm run test:hardening > docs/hardening-check.log 2>&1
node scripts/tls-check.mjs > docs/tls-check.log 2>&1
node scripts/database-tls-check.mjs > docs/database-tls-check.log 2>&1
```

`caddy validate`, `promtool check config` and `promtool check rules` were run in disposable containers against mounted repository configuration. Generated dummy token files used only for config validation were placed under ignored `.hardening-test/`. Source formatting used Prettier; full verification expands to format, lint, typecheck, unit/integration tests, builds and E2E.

## 10. Exact staging commands — prepared, NOT EXECUTED

First follow [production deployment](docs/production-deployment.md) to install real secrets/CA files, configure private services, back up the target and populate `.env.staging` plus operator-only `.env.provision`. Provisioning URLs use host CA paths; the Compose migration URL uses container CA paths. Only after explicit deployment approval:

```sh
docker compose --env-file .env.staging -f compose.production.yml -f compose.staging.yml --profile operations build
node --env-file=.env.provision scripts/provision-db.mjs --apply
docker compose --env-file .env.staging -f compose.production.yml -f compose.staging.yml --profile operations run --rm migrate
node --env-file=.env.provision scripts/provision-db.mjs --apply
docker compose --env-file .env.staging -f compose.production.yml -f compose.staging.yml --profile monitoring up -d --wait api worker web edge prometheus
docker compose --env-file .env.staging -f compose.production.yml -f compose.staging.yml ps
```

The [backup/recovery runbook](docs/backup-recovery.md) contains backup, isolated restore, retention and scheduling procedures. Rollback is an approved compatible-image rollback or a new-database restore/cutover; no automatic destructive down migration is supplied.
