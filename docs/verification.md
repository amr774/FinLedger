# Verification results

This file records the initial implementation verification. For the later audit and current results, see [FINAL_AUDIT_REPORT.md](../FINAL_AUDIT_REPORT.md).

Verified locally on **28 October 2026**. Host: Windows, Node 24.14.0, AMD Ryzen 9 4900HS (16 logical CPUs), approximately 15.4 GiB RAM. Docker Desktop Linux engine 27.3.1 exposes 16 CPUs and approximately 7.5 GiB RAM. PostgreSQL 17, Redis 7 and RabbitMQ 4 run in containers.

| Check                             | Actual result                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Clean npm install                 | Passed (`npm ci`)                                                                        |
| Prisma generation and migrations  | Passed on development and isolated test databases                                        |
| Development seed                  | Passed natively and inside Docker; rerunning preserved Alice's 100000-minor-unit balance |
| Development API start/watch       | Passed                                                                                   |
| Formatting, lint and TypeScript   | Passed                                                                                   |
| Jest unit                         | 14 passed                                                                                |
| PostgreSQL / RabbitMQ integration | 25 passed; final full verification run 11.298 seconds                                    |
| Browser E2E                       | 1 passed; full verification run 10.1 seconds including startup                           |
| Browser E2E against Docker        | 1 passed in 3.1 seconds                                                                  |
| Production builds                 | API, web and shared passed                                                               |
| Docker builds                     | API, worker, migration and nginx web images built successfully on Linux                  |
| Compose startup                   | Passed; all long-running services started and configured health checks passed            |
| Container notifications           | Verified Alice's notification through the running API                                    |
| Swagger                           | Available; 18 documented paths with request, response and error schemas                  |
| CI configuration                  | Compose validated; GitHub Actions YAML parsed with 17 steps                              |
| Runtime dependency audit          | 0 findings                                                                               |
| Full dependency audit             | 6 low findings in development-only Jest/deepmerge chain                                  |

`npm run verify` passed after a clean install. The 50-request concurrency test proved 10 successful transfers, 40 insufficient-funds rejections, zero final sender balance, no duplicate effects, conserved total money, balanced journals and reconciled caches. Another test submitted 20 concurrent copies of one idempotency key. Tests also cover rollback after an injected database write failure, immutable records, ownership checks, refresh reuse revocation, Redis failure fallback and real RabbitMQ retries/dead-letter routing.

## Measured load

The final `load-results.json` targets the **containerized API**, with the client on Windows/Node 24.14.0, PostgreSQL in Docker and the worker active. Image builds had finished. Other local services were running; this was not an isolated performance host. This short contention exercise is not a production capacity benchmark.

| Measurement                     | Observed value              |
| ------------------------------- | --------------------------- |
| Requests / concurrency          | 50 / 50                     |
| Starting funds / each transfer  | 1000 / 100 minor units      |
| Completed / insufficient funds  | 10 / 40                     |
| Unexpected errors               | 0                           |
| Batch elapsed                   | 704.07 ms                   |
| Throughput over the short batch | 71.02 requests/s            |
| p50 / p95 / maximum latency     | 582.81 / 685.78 / 693.27 ms |

Reproduce with `node scripts/load.mjs`. Reconcile financial state using `node scripts/check-integrity.mjs`.

Final reconciliation passed on the running development database: total minor units `0`, negative user wallets `0`, unbalanced journals `0`, inconsistent wallet caches `0`. Docker Desktop was recovered from a stale telemetry socket during the final resume by preserving its runtime socket directory under a backup name; the stack then restarted successfully and the dashboard returned HTTP 200.

Desktop and 390px mobile screenshots in `screenshots/` show a real account after funding and transferring 12.34 EGP against the Docker stack. The browser test checks zero page-level horizontal overflow.

## Limits and resolved issues

No public deployment or remote GitHub Actions run has occurred. Hosting-specific HTTPS, secrets, restricted database roles, backups, metrics export and broker replication remain deployment responsibilities described in `deployment.md`.

Six low-severity development-tool advisories have no compatible upstream fix. Forcing npm's suggested downgrade would replace current Jest with an obsolete major. Runtime transitive patches use explicit root Nest package pins plus overrides because workspace-only installation did not apply those overrides reliably.

Resolved during verification: a missing initial migration file, browser shared-package resolution, mobile overflow from an absolutely positioned accessibility label, omitted Linux optional dependencies in a Windows-generated lockfile, and a Docker npm registry connection reset. The lockfile was regenerated from clean manifests and tested with a clean install. Docker builds succeeded with cached downloads and retries. Tests were fixed and rerun rather than excluded.
