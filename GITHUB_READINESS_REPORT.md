# FinLedger — GitHub portfolio readiness

Assessment date: **29 October 2026**. Scope: the existing local repository, its documentation, publication candidates, local Docker setup and executable test suites. No code was pushed, no remote repository was created, and no public deployment or screenshot publication was performed.

**Decision: ready for local portfolio review and an owner-reviewed first commit.** Public publishing still requires the owner's approval and repository/license decisions. This is a virtual-money simulator; the evidence below does not establish production certification, compliance or exhaustive security.

## Status definitions

- **VERIFIED**: executed successfully or directly inspected in this phase; scope is stated.
- **FAILED**: an executed check did not meet its stated criterion.
- **NOT VERIFIED**: not executed, unavailable, or outside the evidence collected.

## Completed portfolio improvements

- Expanded the README with engineering challenges, ledger/accounting details, concurrency and idempotency explanations, security boundaries, API links and local setup prerequisites.
- Added database and transfer-sequence Mermaid diagrams alongside the system diagram. Diagram source was reviewed; rendering in a remote GitHub repository is **NOT VERIFIED**.
- Added [portfolio material](docs/portfolio.md): suggested description/topics, an interview explanation, follow-up answers, a five-minute demo and exactly three ATS-friendly CV bullets.
- Reviewed actual desktop/mobile application screenshots containing fictional users and virtual balances. No tokens, passwords or real personal data were visible.
- Expanded Git/Docker exclusions for private keys, dumps and local rehearsal material; added a repeatable publication secret guard and a CI invocation.
- Rehearsed setup with a separate local Compose project, fresh random credentials, different host ports and separate volumes. Existing development data was preserved.
- No financial logic or existing tests were removed or changed in this phase.

## Actual verification results

| Check                                          | Status       | Actual result / boundary                                                                                         |
| ---------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| Full `npm run verify`                          | VERIFIED     | Exit 0; formatting, ESLint, TypeScript, tests and builds completed                                               |
| Unit tests                                     | VERIFIED     | 31 passed in 2 suites                                                                                            |
| Integration tests                              | VERIFIED     | 33 passed in 2 suites, using real local PostgreSQL/Redis/RabbitMQ                                                |
| Chromium browser tests                         | VERIFIED     | 3 passed, none skipped in the default isolated-server run                                                        |
| Total automated test cases                     | VERIFIED     | **67: 31 + 33 + 3**; helper checks are not added to this number                                                  |
| Shared/API/web builds                          | VERIFIED     | All three completed; web production bundle built                                                                 |
| Clean dependency installation                  | VERIFIED     | `npm ci` completed inside fresh Docker build stages                                                              |
| Fresh Docker startup                           | VERIFIED     | Separate project built API/migrate/worker/web and started successfully with `--wait`                             |
| Prisma generation and migration                | VERIFIED     | Client generated; four migrations applied during fresh startup; rerun found no pending migrations                |
| Test database migration                        | VERIFIED     | `npm run db:test` completed against the isolated test database                                                   |
| Demo seed                                      | VERIFIED     | Three fictional users authenticated, each holding 100000 minor units (EGP 1,000)                                 |
| Repeat seed                                    | VERIFIED     | Second seed retained the same balances and exactly three funding transfers                                       |
| Fresh demo integrity                           | VERIFIED     | Total balance 0; negative user wallets 0; unbalanced journals 0; inconsistent caches 0                           |
| API readiness / frontend route                 | VERIFIED     | Fresh demo readiness and `/register` returned HTTP 200                                                           |
| OpenAPI                                        | VERIFIED     | Fresh API returned a document with 18 public paths                                                               |
| Publication secret guard                       | VERIFIED     | No supported patterns or copied local `.env` credentials found; synthetic token/private-key probes were rejected |
| Runtime npm vulnerability audit                | VERIFIED     | 0 findings at audit time                                                                                         |
| Zero findings across all dependencies          | FAILED       | 6 low-severity development dependency findings remain; no moderate/high/critical findings                        |
| Remote GitHub Actions execution                | NOT VERIFIED | No remote repository or workflow run exists                                                                      |
| Public hosting / real certificate issuance     | NOT VERIFIED | No deployment performed                                                                                          |
| Percentage code coverage / production capacity | NOT VERIFIED | Neither was measured or claimed                                                                                  |

Fresh demo evidence is in [portfolio-demo-results.json](docs/portfolio-demo-results.json). Dependency evidence is in [portfolio-dependencies.json](docs/portfolio-dependencies.json) and [portfolio-runtime-dependencies.json](docs/portfolio-runtime-dependencies.json). Local command logs `docs/portfolio-verification.log` and `docs/portfolio-startup.log` are intentionally ignored by Git; the results above summarize them for publication.

The earlier restricted-role, backup, HTTPS and database-TLS experiments remain historical evidence in [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md); they were not rerun as part of this documentation-focused phase. They must not be presented as newly executed hosting checks.

## Test-count investigation: “8 versus 7”

The available evidence does **not** report an eight-test suite shrinking to seven:

| Evidence                                        | Unit | Integration | Browser | Total |
| ----------------------------------------------- | ---: | ----------: | ------: | ----: |
| `docs/verification.md` — initial implementation |   14 |          25 |       1 |    40 |
| `FINAL_AUDIT_REPORT.md` — final audit           |   14 |          31 |       3 |    48 |
| `PRODUCTION_READINESS_REPORT.md` — hardening    |   31 |          33 |       3 |    67 |
| This phase's actual full rerun                  |   31 |          33 |       3 |    67 |

The hardening report separately lists seven HTTPS helper groups; these are not the total application test count. The origin of the claimed “8 versus 7” is **NOT VERIFIED**. There is no evidence supporting an accidental test deletion, so no test was invented or restored merely to match that claim.

Inspection found no focused `.only` tests or pending TODO tests. One intentional browser skip applies only in `E2E_EXTERNAL` mode because that mode does not provision an admin directly in the target database. The default full run executed all three browser cases. Counts increased in the recorded reports, but counts alone do not prove non-regression of line or branch coverage. Historical source comparisons are unavailable because the repository has no commits.

## Verified functionality and engineering evidence

- **VERIFIED:** registration/login, session rotation/reuse revocation, logout, role checks, malformed tokens, cross-user authorization and ownership boundaries in the integration suite.
- **VERIFIED:** atomic financial writes, injected-failure rollback, balanced immutable journals, balance reconciliation, insufficient-funds protection, request fingerprint conflicts and durable idempotent replay.
- **VERIFIED:** 50 concurrent HTTP transfers with funds for only 10; 10 succeed and 40 are rejected. A separate case sends 20 copies of one idempotency key and checks one financial effect. These are correctness tests, not capacity benchmarks.
- **VERIFIED:** real RabbitMQ publication, retries, dead-letter behavior and duplicate handling; Redis failure fallback in integration tests.
- **VERIFIED:** browser registration, wallet creation, funding, transfer, ledger details, session renewal, login/logout, history controls, admin views, mobile overflow and recovery from uncertain funding/refresh failures.
- **NOT VERIFIED:** every possible UI state, browser engine, failure interleaving, external provider outage or adversarial scenario. Chromium is the tested browser engine.

## Git and sensitive-file audit

**VERIFIED:** `git ls-files`, refs and reflogs are empty; `git count-objects -v` reports zero loose/packed objects; `git fsck --full --no-reflogs` reports no default references and no recovered history. `git remote -v` is empty. All intended project files are currently untracked. No commit, staging, history rewrite or remote modification was performed.

There are no local historical Git objects to scan, so no accidentally committed `.env`, backup or private key was found in local history. This does not establish anything about copies outside this repository or previously deleted repositories.

**VERIFIED:** `.env`, `secrets/`, `backups/`, `.hardening-test/`, `.portfolio-check/`, dependencies, generated builds, browser traces, coverage and logs are excluded. Only the four placeholder `.env.*.example` files are publication candidates. Added exclusions cover common PEM/key containers, database dump/archive extensions, TypeScript build metadata and OS artifacts. SQL migrations remain included.

Credential-like source literals were reviewed in environment templates, Docker build placeholders, generated connection URLs, seed data and tests. They are placeholders, environment interpolation, deliberately public local simulator/test credentials or runtime-generated values. The seed's public password is documented and the seed rejects production mode. Do not reuse demo credentials in hosting.

The guard scans tracked/prospective working files for supported provider-token/private-key patterns, sensitive filenames and exact copies of long secrets from the local `.env`. It does not print matched values. It is a bounded heuristic, not a complete entropy scanner or proof that every possible secret is absent. Review the staged diff before the first commit and enable available GitHub secret protection after publication.

The six remaining low-severity findings are development-tooling entries in the Jest/ts-jest dependency chain involving `deepmerge`. The audit proposes incompatible major dependency changes; those were not applied blindly. Runtime audit results do not cover operating-system packages, container image vulnerabilities, or undisclosed vulnerabilities.

## Setup rehearsal and exact commands

Commands were run from the repository root in PowerShell. The README's default local setup was exercised with a Compose project/port override to preserve the already-running development installation. No existing database was reset or deleted.

Host tools observed: Node 24.14.0, npm 11.9.0 and Docker Compose v2.30.3. After the rehearsal, only `finledger-portfolio-check` was stopped; its volumes were retained. The original `finledger` services remained running, and its separate integrity check also returned zero imbalance, negative user wallets and inconsistent caches.

```powershell
New-Item -ItemType Directory -Force .portfolio-check
Copy-Item .env.example .portfolio-check/.env.example
Push-Location .portfolio-check
node ../scripts/setup-env.mjs
Pop-Location
```

The generated rehearsal `.env` used `WEB_ORIGIN=http://localhost:8280`; all passwords and JWT values came from the setup script. The ignored `.portfolio-check/compose.override.yml` contained:

```yaml
services:
  postgres:
    ports: !override ['127.0.0.1:55435:5432']
  redis:
    ports: !override ['127.0.0.1:56380:6379']
  rabbitmq:
    ports: !override ['127.0.0.1:5674:5672', '127.0.0.1:15674:15672']
  api:
    ports: !override ['127.0.0.1:3200:3000']
  web:
    ports: !override ['127.0.0.1:8280:80']
```

```powershell
docker compose -p finledger-portfolio-check --env-file .portfolio-check/.env -f docker-compose.yml -f .portfolio-check/compose.override.yml up -d --build --wait
docker compose -p finledger-portfolio-check --env-file .portfolio-check/.env -f docker-compose.yml -f .portfolio-check/compose.override.yml exec -T api npm run db:seed
docker compose -p finledger-portfolio-check --env-file .portfolio-check/.env -f docker-compose.yml -f .portfolio-check/compose.override.yml exec -T api npm run db:migrate
node .portfolio-check/demo-check.mjs
```

The local-only demo helper authenticated all three seed accounts, checked wallet balances, counted transfers with `psql`, repeated `db:seed`, compared balances/counts, fetched readiness/frontend/OpenAPI and ran `node scripts/check-integrity.mjs` inside the fresh API container. It wrote the sanitized demo evidence JSON. It is an ignored one-off verification helper, not required for normal setup.

```powershell
npm run verify
npm run db:generate
npm run db:test
node scripts/check-integrity.mjs
node scripts/check-secrets.mjs
npm audit --json > docs/portfolio-dependencies.json
npm audit --omit=dev --json > docs/portfolio-runtime-dependencies.json
git status --short
git remote -v
git ls-files
git for-each-ref
git reflog --all
git fsck --full --no-reflogs
git count-objects -v
git check-ignore .env .hardening-test/private.key .portfolio-check/.env backups/demo.dump secrets/server.pem
docker compose -p finledger-portfolio-check --env-file .portfolio-check/.env -f docker-compose.yml -f .portfolio-check/compose.override.yml stop
```

The normal reviewer commands remain:

```sh
node scripts/setup-env.mjs  # first setup only; existing .env must not be overwritten
docker compose up -d --build --wait
docker compose exec api npm run db:seed
```

Host development uses `npm ci`, `npm run db:generate`, `npm run db:migrate`, `npm run db:test` and the README's development servers. Clean `npm ci`, generation and migration were executed in Linux Docker; host generation/test migration and the built API/Vite browser servers were also exercised. The full native interactive watch workflow was not separately rehearsed from a fresh host checkout. Production/staging commands are operator preparation instructions and remain **NOT VERIFIED on actual hosting**.

## Repository structure and missing requirements

The existing monorepo structure is appropriate; no rebuild or relocation is needed:

```text
README.md                       recruiter/reviewer entry point
GITHUB_READINESS_REPORT.md       current evidence and limitations
apps/api/                       Nest modules, Prisma migrations and tests
apps/web/                       React application
packages/shared/                exact monetary parsing/formatting
tests/e2e/                      browser workflows
scripts/                        setup, integrity, hardening and secret checks
docker/                         container/edge configuration
ops/                            monitoring and backup scheduling templates
docs/                           design, operations, portfolio notes and evidence
docs/screenshots/               fictional-data application captures
.github/workflows/              CI definition
```

Remaining owner decisions and boundaries:

- **NOT VERIFIED / owner decision:** repository URL, visibility and an explicit license. No license has been selected on the owner's behalf; do not advertise this as licensed open source yet.
- **NOT VERIFIED:** GitHub-rendered Mermaid, remote CI, branch protection and repository security settings, until a remote exists.
- **FAILED (zero-development-findings goal):** six low-severity tooling findings remain documented above.
- **NOT VERIFIED:** public TLS, provider networking, continuous alert delivery, offsite recovery, production resource sizing and container OS vulnerability scanning. See the production readiness report.
- Product limitations remain explicit: one currency, no reversal journals, MFA/account recovery or external payment rails; no retention job; local throttling fallback during Redis outages; single-node local infrastructure. Notification delivery creates inbox records, not real email.

## GitHub publishing instructions — not executed

Only perform these steps after the owner approves publishing and chooses the repository visibility/license. The existing local branch is `main`; do not reinitialize or fabricate a development history.

1. Rerun `npm run verify` and `node scripts/check-secrets.mjs`. Review `.gitignore`, environment examples, screenshots and the prospective files with `git status --short` and `git add --dry-run .`.
2. Stage deliberately, inspect `git diff --cached --stat` and `git diff --cached`, then create the first commit. Never force-add ignored environment files, archives or keys.
3. Create an empty repository on GitHub with the chosen visibility. Since this project already has a README and ignore file, do not initialize conflicting versions remotely.
4. Use the actual remote URL, then push only when approved:

```sh
git add .
git diff --cached --stat
git diff --cached
git commit -m "Add FinLedger wallet simulator and verification evidence"
git remote add origin https://github.com/YOUR_USERNAME/finledger.git
git remote -v
git push -u origin main
```

5. Add the description/topics from [portfolio material](docs/portfolio.md), inspect the rendered README/screenshots/diagrams, and confirm the first Actions run. Add a passing CI badge only after an actual successful remote run; configure available secret protection and branch rules.

This workflow follows [GitHub's existing-project publishing guidance](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github). The commands above are instructions for a future approved action, not evidence that publication occurred.
