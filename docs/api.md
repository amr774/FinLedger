# API contract

Production disables Swagger; development keeps the interactive contract below. Private `GET /api/v1/monitoring/metrics` returns Prometheus text and requires `Authorization: Bearer <MONITORING_TOKEN>`, not a user JWT. It is excluded from public Swagger and blocked at the production edge. Worker readiness and metrics use its private port 3001; see the production guide.

Base: `/api/v1`. Interactive documentation: `/api/docs`; JSON: `/api/docs-json`. JSON request bodies reject unknown properties. Protected endpoints require `Authorization: Bearer <access-token>`. No access token or refresh secret is logged. Access tokens are returned in authentication responses; refresh secrets are only sent as HTTP-only cookies.

| Method | Path                            | Access / purpose                                      |
| ------ | ------------------------------- | ----------------------------------------------------- |
| POST   | `/auth/register`                | Public: email, name, password (12–128 chars)          |
| POST   | `/auth/login`                   | Public: email, password                               |
| POST   | `/auth/refresh`                 | Refresh cookie; rotates it; detects replay            |
| POST   | `/auth/logout`                  | Refresh cookie; revokes session; clears cookie        |
| GET    | `/auth/me`, `/users/me`         | Profile, no hashes or token data                      |
| POST   | `/wallets`                      | Create own wallet; returns existing wallet if present |
| GET    | `/wallets/me`                   | Own wallet ID, balance, EGP, status                   |
| GET    | `/wallets/me/transactions`      | Own incoming/outgoing history                         |
| POST   | `/transfers`                    | Own source wallet; idempotency required               |
| GET    | `/transfers/:id`                | Sender or receiver only; includes journal/postings    |
| POST   | `/demo/fund`                    | Own wallet; idempotency and daily quota               |
| GET    | `/notifications`                | Own simulated delivery inbox                          |
| GET    | `/admin/stats`                  | ADMIN only; counts and process request metrics        |
| GET    | `/admin/jobs/failed`            | ADMIN only; publisher and consumer failures           |
| GET    | `/admin/audit`                  | ADMIN only; immutable financial audit                 |
| GET    | `/health/live`, `/health/ready` | Public; process / database                            |

Money-changing body examples:

```json
{
  "sourceId": "<own-wallet-uuid>",
  "destinationId": "<recipient-wallet-uuid>",
  "amount": "1234",
  "currency": "EGP"
}
```

```json
{ "amount": "100000", "currency": "EGP" }
```

Successful POSTs return HTTP 201, including idempotent replays. Transfer response fields: `id`, `sourceId`, `destinationId`, `amount`, `currency`, `kind`, `status: "COMPLETED"`, `journalId`, `createdAt`. Transaction details include `journal.postings`; each posting has `id`, `walletId`, `side`, `amount`, and `createdAt`. Wallet and transaction amounts are strings, not numbers.

History accepts `page` (default 1), `limit` (1–100, default 20), `order` (`asc`/`desc`), `kind` (`TRANSFER`/`DEMO_FUNDING`), `from` and `to` (ISO dates). It returns `{items,total,page,limit}`. Notifications and admin lists accept pagination/order. Ordering uses time and an ID tie-breaker for history. Invalid or inaccessible private transfer IDs return 404 to avoid revealing another user's records.

Errors use `{ "error": { "code": "HTTP_409", "message": "Insufficient funds", "requestId": "..." } }`. Validation messages can be an array. Typical statuses: 400 invalid input/self-transfer; 401 expired/revoked session; 403 unauthorized source/admin/origin; 404 absent/private record; 409 insufficient funds/frozen wallet/key conflict; 429 request/funding quota; 500 sanitized internal error; 503 database readiness failure. A request UUID is also returned in `X-Request-ID`.

Clients should single-flight refresh, retry the original request once after a successful refresh, and clear session state if refresh fails. Browser tabs coordinate refresh using Web Locks where available. Normal API failures must remain visible; the UI never substitutes mocked success or balances.
