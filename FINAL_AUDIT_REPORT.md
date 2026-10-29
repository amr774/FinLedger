# FinLedger final readiness audit

Final evidence review completed on 29 October 2026 (Africa/Cairo). The test and dependency-scan results below were produced on 28 October; the completed verification process returned exit code 0. The final integration run took 9.871 seconds and Chromium E2E took 12.3 seconds including startup.

Audit date: 28 October 2026. Scope: the existing local project in `D:\PROJECTS\finledger`, including Nest modules, React pages, shared money utilities, Prisma schema and all three migrations, workers, scripts, tests, Docker files, CI and documentation. No push or deployment was performed. Existing demo containers and financial records were preserved. Test fixtures were added only to the isolated test database during this audit.

## Verdict

Suitable for a **local backend engineering portfolio demonstration**, subject to the verified results and limitations below. **NOT READY for unrestricted public production hosting.** The supplied Compose stack is a local simulator, with a privileged bootstrap database account, development HTTP configuration, single-node services and shared proxy-IP throttling. Financial tests passing does not establish payment-system certification or production capacity.

## Verified features and results

The final verification output is retained locally in `docs/audit-verification.log`; Docker build output is in `docs/audit-docker-build.log`. These generated logs are ignored by Git. Dependency evidence is in `docs/audit-dependencies.json` and `docs/audit-runtime-dependencies.json`. Earlier `docs/verification.md` results are historical and are not substituted for this audit.

| Check                          | Result and evidence                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting, ESLint, TypeScript | PASS: formatting, lint and all workspace typechecks                                                                                                                                     |
| Unit tests                     | 14 money arithmetic, validation and formatting cases                                                                                                                                    |
| Integration tests              | 31 cases against real PostgreSQL, Redis and RabbitMQ; no mocked financial success path                                                                                                  |
| Browser tests                  | Three Chromium scenarios against the built API and real test database, with Vite serving the UI                                                                                         |
| Financial concurrency          | Integration test: 50 simultaneous transfers, only 10 funded; 10 successes and 40 insufficient-funds responses; no overdraft. Separate 20-request same-key test produces one effect      |
| Atomicity and rollback         | Injected outbox-write failure rolls back balances, transfer, journal, postings, audit and idempotency together; original request can then be retried                                    |
| Ledger                         | Equal debit/credit, mandatory complete journals, immutable financial records, wallet cache reconciliation, treasury rules and funding quota covered by SQL and integration checks       |
| Authentication                 | Registration/login, origin checks, HTTP-only cookie, refresh rotation/replay revocation, logout revocation, expired/tampered/malformed JWT rejection and current database role checks   |
| Authorization                  | All three admin routes reject ordinary users; transfer details, debit source and notification lists enforce ownership                                                                   |
| Workers                        | Publisher confirms, unroutable-message rejection, duplicate notification suppression, delayed retry, dead-letter routing, malformed retry header and broker-down financial independence |
| Migration status               | Three migrations found; isolated test database has no pending migrations; no destructive reset performed                                                                                |
| Compose                        | `docker compose config --quiet` succeeds; existing database, Redis, broker, API and web health checks pass; worker process running                                                      |
| Swagger/live endpoints         | Existing Docker API returns 200 for live, ready, docs and docs JSON; 18 documented paths. New API's docs JSON also exercised by integration tests                                       |
| Dependency scan                | Runtime: zero reported vulnerabilities. Full graph: six low-severity development-tool findings; zero moderate/high/critical                                                             |
| Existing demo ledger           | Read-only integrity check: total minor units 0, negative user wallets 0, unbalanced journals 0, mismatched wallet caches 0                                                              |

### Browser coverage

Registration, wallet creation, demo funding, sending 12.34 EGP, debit/credit details, reload/session renewal, expected resulting balance, wallet clipboard copy, transaction type/order filtering, disabled pagination boundary, profile, profile sign-out, protected-route redirect, invalid and valid login, and real admin statistics/audit rows are exercised. Dashboard desktop and 390px mobile screenshots are saved; mobile overflow is asserted and the mobile screenshot was visually inspected.

Fault injection sends a real funding request to the backend, then discards its response. Retrying after reload must leave the balance at EGP 1,000, not EGP 2,000. A separate injected HTML 503 refresh response must display a recoverable error; retry restores the workspace. These are explicit transport-failure tests, not mocked successful ledger responses.

## Bugs discovered and fixed

1. **Potential notification loss:** broker confirms alone did not prove routing. Publications now use `mandatory` and correlated return handling; unroutable messages reject. Real-broker regression added.
2. **Malformed retry metadata:** negative/fractional/string retry counts could address nonexistent retry queues. Invalid values now go to the dead-letter queue; event IDs require proper UUID structure.
3. **Worker recovery:** failed connection/setup now clears and closes partial state; old connection/channel close callbacks cannot clear newer handles. Consumer cancellation requests reconnection. Connect timeout is bounded, shutdown close is tolerant, and the publisher commits a failed attempt before another broker timeout can consume its transaction budget. These lifecycle branches were reviewed; not every network race was fault-injected.
4. **Registration partial success:** user creation could commit before session creation failed. Registration now creates both in one transaction; injected JWT-signing failure proves no orphaned user remains.
5. **Malformed signed JWT claims:** invalid session IDs could reach Prisma and return 500. UUID claims are checked first; regression expects 401, alongside expired and tampered tokens.
6. **Misleading session expiry:** refresh 429/5xx responses were treated like 401. Only 401 now clears the session; transient failures surface for retry. HTML proxy errors now produce a readable status instead of a JSON parse exception.
7. **Duplicate browser money intent after reload:** pending keys existed only in component memory. Same-tab sessionStorage now retains the key by wallet, endpoint and payload until a successful response. If storage cannot save the key, submission fails before the request. Account login also clears the query cache to avoid showing the previous account's data.
8. **History consistency:** list and count now share a repeatable-read snapshot; reversed date ranges return 400. Changing sort order resets the page.
9. **Admin job status:** successfully recovered publication attempts no longer appear as failed jobs. The UI distinguishes pending/unavailable job data from an empty successful response.
10. **Clipboard failure:** denied/unavailable clipboard access now shows manual-copy guidance instead of an unhandled promise rejection.
11. **Test isolation:** E2E uses ports 3100/8180 instead of conflicting with the demo's 3000/8080, with a fresh rate-limit namespace. Broker tests use unique test queue names and count retries for the intended event.
12. **CI verification gaps:** added runtime dependency audit and a post-load ledger integrity check. Remote execution remains unverified.

Initial reruns exposed a timing assertion contaminated by unrelated broker messages, a label selector mismatch, and an ambiguous sign-out selector after adding profile coverage. These test defects were corrected; failed runs were not counted as passes.

## Security findings and remaining issues

| Priority                | Finding / disposition                                                                                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High deployment blocker | Compose uses the bootstrap PostgreSQL role for the API and migration job. A database owner/superuser can disable constraints. Provision a non-owner runtime role and separate migration credentials before hosting; changing an existing installation's credentials/ownership was intentionally not done during audit |
| High deployment blocker | Public TLS, secure production configuration, removal of public demo accounts, infrastructure network isolation and secrets management must be supplied by the hosting environment                                                                                                                                     |
| Medium                  | nginx traffic shares a proxy IP in the current limiter. Configure trusted proxy CIDRs and edge throttling before multi-tenant exposure; do not blindly trust arbitrary forwarding headers                                                                                                                             |
| Medium                  | Single-node classic RabbitMQ queues do not provide replicated or guaranteed dead-letter recovery across node loss. Quorum/HA migration requires an operational plan preserving queued data                                                                                                                            |
| Medium                  | No worker health probe, external metrics/alerts, backup restore evidence, retention jobs, resource budgets or sustained capacity benchmark. API counters are process-local; Redis fallback throttles per process                                                                                                      |
| Medium                  | Wallet reconciliation scans historical postings at commit. Treasury locking serializes funding. These favor local correctness over high-volume throughput; production-scale latency is unverified                                                                                                                     |
| Low                     | Six development-only dependency findings remain in the Jest/deepmerge chain. No forced incompatible downgrade was applied. Runtime dependency audit is clean as of this run, not a guarantee against future disclosures                                                                                               |
| Functional limits       | No password reset/MFA, reversal workflow, admin replay UI, real email delivery or multi-currency support. They are not represented as implemented features                                                                                                                                                            |

Searches found public demo/test passwords and placeholder/example connection strings, not a verified live credential embedded in tracked source. `.env` is ignored by Git and Docker; its contents were not copied into the report. The repository has no commits, so there is no Git history to audit. This was a targeted source scan, not a claim that every possible secret format was detected. User passwords use Argon2id; refresh secrets are hashed in storage; logs omit request bodies and credentials; raw SQL uses parameterized tagged templates for request data.

Pending browser keys are scoped to a tab and exact payload. Closing the tab, clearing storage, changing payload or moving to another browser cannot recover the same intent automatically. Two independently initiated requests with different keys are separate operations. The UI is not an offline payment queue.

## NOT VERIFIED

- Remote GitHub Actions execution: no push/remote run was requested. Local commands and workflow source were checked.
- Public deployment, HTTPS/Secure-cookie behavior through a real TLS ingress, restricted runtime database permissions, backup/PITR restore, HA failover, image OS vulnerability scanning and production observability: no such environment was supplied.
- Runtime of the final rebuilt images: images were built, but existing demo containers were not replaced. Native final-code integration/E2E is distinct from the older running Docker demo's health checks.
- Exhaustive UI combinations: Chromium desktop/mobile viewport coverage does not establish Firefox/WebKit, real mobile devices, screen-reader accessibility, every loading/error combination, populated multi-page navigation or every clipboard-denial path. A blanket claim that every possible button state works would be unsupported.
- Browser notification delivery after a continuously running final worker: the E2E harness starts API/web, not a worker. Worker delivery is separately verified against real RabbitMQ/PostgreSQL.
- Every shutdown, reconnect, broker loss and concurrent multi-worker interleaving; long-duration soak, distributed load and database failover. Small local concurrency tests are not capacity certification.
- Fresh empty-database migration replay and development seed rerun during this audit: existing migration status was verified; initial implementation evidence is documented separately. No existing database was reset.

## Commands and reproducibility

Commands were run from `D:\PROJECTS\finledger` in PowerShell. Source inspection used `rg --files`, `rg -n`, bounded `Get-Content` reads, and `git status --short`. A first brace-expansion read and two guessed migration paths failed; correct paths were then read. Relevant executable checks and fixes:

```powershell
git status --short
git check-ignore .env
docker compose --profile test ps
docker compose --profile test up -d --wait postgres-test
npm run db:test
node scripts/check-integrity.mjs
npm audit --json > docs/audit-dependencies.json
npm audit --omit=dev --json > docs/audit-runtime-dependencies.json
docker compose config --quiet
docker compose build > docs/audit-docker-build.log 2>&1
npm run verify > docs/audit-verification.log 2>&1
node scripts/test-load.mjs > docs/audit-load.log 2>&1
```

`npm run verify` executes exactly `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run build && npm run test:e2e`. Changed files were formatted with `npx prettier --write` using explicit file paths. Verification was repeated after fixes. No `git push`, public deploy, volume deletion, financial data deletion, or migration rewrite was performed.

Final result: **48 tests passed** (14 unit, 31 integration, 3 Chromium E2E); formatting, lint, typecheck, shared/API/web production builds and all four Compose image builds passed. The 50-request isolated load run at 2026-10-28T15:28:27Z produced 10 HTTP 201 and 40 HTTP 409 responses, with zero unexpected errors. Elapsed: 812.15 ms; throughput: 61.57 requests/second; p50: 633.16 ms; p95: 787.91 ms; maximum: 800.37 ms. Post-load test-database integrity: total 0, negative user balances 0, unbalanced journals 0, inconsistent wallet caches 0. See `docs/load-results.json` and `docs/audit-load.log`. This was a Windows native API with containerized infrastructure, not a production benchmark.
