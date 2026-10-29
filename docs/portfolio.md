# FinLedger portfolio material

Use these descriptions with the verified evidence in [GitHub readiness](../GITHUB_READINESS_REPORT.md). FinLedger is an educational simulator, not a live banking product.

## Suggested GitHub description

Ledger-backed wallet simulator with NestJS, PostgreSQL and React: atomic transfers, durable idempotency, concurrent-spend protection, and RabbitMQ transactional outbox delivery.

## Suggested GitHub topics

`typescript`, `nestjs`, `postgresql`, `prisma`, `react`, `redis`, `rabbitmq`, `docker`, `double-entry-ledger`, `idempotency`, `transactional-outbox`, `backend`, `full-stack`, `playwright`, `jwt`, `portfolio-project`

## Interview explanation (about one minute)

“I built FinLedger to explore correctness in a wallet system using virtual money. It is a NestJS modular monolith with a React client and PostgreSQL as the source of truth. Each transfer creates a journal with equal debit and credit postings inside one database transaction. The same transaction stores the audit record, idempotent response and outbox event.

“The main challenge was handling concurrent spending and retries. I lock wallets in a consistent order, check available funds under those locks, and enforce ledger constraints in PostgreSQL. A user-scoped idempotency key lets a client safely retry an uncertain response without moving money twice.

“Notifications are asynchronous. The outbox avoids losing the event between the database commit and publishing to RabbitMQ. Delivery can repeat, so the consumer uses a unique event-and-user key. I tested concurrency, rollback, authorization and refresh-token reuse against real local services, plus browser workflows. Production configuration is prepared, but I have not publicly deployed the system.”

## Follow-up discussion

| Question                            | Explain the actual implementation                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Why a modular monolith?             | One transaction boundary is easy to reason about for a small project. Modules separate responsibilities without introducing cross-service financial transactions.                                      |
| Why not just update two balances?   | Immutable postings provide an audit trail; deferred SQL constraints reconcile the cached balance and reject inconsistent commits.                                                                      |
| Why use both locks and constraints? | Locks coordinate competing requests; constraints remain a final invariant check even when application code is wrong.                                                                                   |
| What if the response is lost?       | Retry the same payload and idempotency key. The stored committed response is returned. Changing the payload with that key is rejected.                                                                 |
| What if RabbitMQ is unavailable?    | The committed outbox retains the work. The worker retries publication; notifications can be delayed while the financial transfer remains committed.                                                    |
| Is delivery exactly once?           | No. Broker delivery is at least once; database uniqueness deduplicates notification effects.                                                                                                           |
| What would you improve?             | Reversal journals, account recovery/MFA, retention jobs, cursor pagination and an operational replay interface. Public hosting also needs real certificate, monitoring, backup and recovery exercises. |
| What do the tests prove?            | Specific tested invariants under local workloads. They do not establish a coverage percentage, production capacity, compliance or general absence of vulnerabilities.                                  |

## Three CV bullets

- Built a full-stack wallet simulator with NestJS, TypeScript, React and PostgreSQL, implementing ledger-backed virtual transfers, transaction history and role-based administration.
- Implemented atomic double-entry transfers using PostgreSQL transactions, deterministic row locking and durable idempotency; validated concurrent spending, duplicate requests and rollback with integration tests.
- Developed JWT authentication with refresh-token rotation and a RabbitMQ transactional outbox with retries and deduplicated notifications; verified API behavior and browser workflows using Jest, Supertest and Playwright.

These bullets intentionally omit production deployment, throughput, coverage percentages and business impact that have not been established.

## Reviewer demo (about five minutes)

1. Follow the README Docker setup and seed command. Use fictional simulator accounts only.
2. Sign in as Bob (`bob@example.test`), open **My wallet**, and copy the wallet ID.
3. Sign in as Alice (`alice@example.test`), send Bob EGP 12.34, and inspect the transaction's equal debit and credit postings.
4. Reload, verify the balance/history, and inspect the notification inbox once the worker delivers the event.
5. Sign in as `admin@example.test` to inspect statistics and audit history.
6. Show the transfer service, SQL integrity migrations and concurrency tests. Explain that repeated seeding does not reset users or grant more virtual funds.

All three demo passwords are `FinLedger-Demo-2026!`. They are deliberately public local simulator credentials. Do not reuse them for a public deployment. Do not present a changing local balance or a single machine's elapsed test time as a performance achievement.
