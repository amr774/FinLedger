# Double-entry ledger

Wallets represent liabilities to simulator users. A **credit increases** a user wallet's available virtual balance; a **debit decreases** it. Each successful movement owns one immutable journal with exactly two positive postings.

| Event                               | Debit                  | Credit              |
| ----------------------------------- | ---------------------- | ------------------- |
| Alice sends EGP 12.34 to Bob        | Alice: 1234 minor      | Bob: 1234 minor     |
| Alice receives EGP 1,000 demo funds | Treasury: 100000 minor | Alice: 100000 minor |

The simulator treasury is an issuance contra-account. It starts at zero and may become negative; it is not a prefunded bank account. Its negative balance offsets virtual user liabilities, so the sum of all wallet balances stays zero. No real-world asset or money supply is claimed.

`balance(wallet) = SUM(credits) − SUM(debits)`.

The cached BIGINT balance is updated only by the posting insert trigger. TransferService never issues an independent balance increment/decrement. A deferred trigger verifies the cached value equals the signed ledger sum before commit. Nonnegative balance checks reject overspending of user wallets. Both accounts are locked in sorted UUID order before any balance decision.

SQL requires every transfer to have a journal, each journal to have two equal postings matching its source/destination, and every posting amount to be positive. This is stronger than checking only the global sum: a zero-sum journal against the wrong wallet is also rejected. Incomplete writes, direct balance changes, journal amendments, posting edits/deletes and truncation fail.

## Idempotency

Every money-changing endpoint requires an 8–128 character `Idempotency-Key` using letters, digits, `_` or `-`. The namespace is the authenticated user across all money endpoints. The fingerprint includes operation kind, source, destination, exact amount and currency. Equivalent committed requests return the stored JSON result; changed parameters return 409. Keys have no automatic expiry, avoiding late duplicate financial effects.

A transaction-level advisory lock serializes the key before lookup; a unique database constraint is the durable backstop. Wallet locks then protect the balance. The response record commits with the transfer, ledger, audit and outbox. A crash before commit leaves no successful record or financial effects, so a retry can proceed. A crash after commit returns the stored result on retry. Validation failures and rolled-back transactions do not reserve the key; they may be retried after fixing the cause. HTTP transport uncertainty is resolved by retrying the original key, never by inventing a new one.

Corrections would require compensating journals. This version exposes no reversal API and never edits old entries.
