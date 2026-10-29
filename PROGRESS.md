# FinLedger progress

Plan: PostgreSQL-enforced append-only double-entry ledger; row-locked transfers and durable idempotency; rotating cookie sessions; transactional outbox; React client; real service integration tests; Docker and CI.

- Phase 1: verified — migrations, registration/login, refresh rotation, revocation, roles, wallets; type checks pass.
- Phase 2: verified — ledger invariants, atomic transfers, rollback, privacy, idempotency, 50-request concurrent spending; real PostgreSQL tests pass.
- Phase 3: verified — real RabbitMQ delivery, duplicate protection, transient retry, dead-letter handling, worker hardening and outage-independent financial writes pass.
- Phase 4: verified — API-connected React routes, production build and full browser workflow pass; desktop/mobile screenshots captured and inspected.
- Phase 5: 14 unit, 25 integration and 1 browser E2E test passed. PostgreSQL/RabbitMQ are real services; tests use isolated database, queue and rate-limit namespaces.
- Phase 6: verified locally — Linux Docker builds, full Compose startup, migration job, container seed, worker delivery, Swagger, browser workflow against nginx/API, load measurement and CI configuration.

`npm run verify` passed after a clean `npm ci`. Container browser verification passed separately. Final local load measurement: 50 parallel requests, 10 successes / 40 expected rejections, no unexpected errors; p95 685.78 ms and 71.02 requests/s. Runtime audit is clean; six low-severity development-only advisories remain upstream in Jest/deepmerge.

No implementation or verification blocker remains for the local simulator. Hosting-specific hardening and known design limits are documented. No public deployment or remote GitHub Actions run has occurred.
