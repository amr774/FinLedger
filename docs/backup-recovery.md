# Backup and recovery runbook

`scripts/backup.mjs` streams a PostgreSQL custom-format dump into AES-256-GCM authenticated encryption. Plaintext is not saved during backup. A unique random nonce is used per archive; keys and passwords never appear in command arguments or logs. Completed `.flbk` files are published only after pg_dump and encryption succeed. An incomplete `.partial` file is removed on failure. Local files use owner-only permissions where supported; enforce equivalent ACLs on Windows.

## Preparation and manual backup

Install PostgreSQL 17 client tools (`pg_dump`, `pg_restore`) on a controlled backup host, Node 24 and repository dependencies. Use the SELECT-only backup role from `provision-db.mjs`. Put `.env.backup.example` values in `/etc/finledger/backup.env`; set a private TLS endpoint and trusted CA. Generate an encryption key directly into a private file, never console output:

```sh
node -e "require('node:fs').writeFileSync('/etc/finledger/backup-key-v1',require('node:crypto').randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'})"
node --env-file=/etc/finledger/backup.env scripts/backup.mjs create
```

Keep the key in an independent secret manager/offline escrow, separate from archives. Losing the key makes backups unrecoverable. Retain old versioned keys for retained archives after rotation. Do not put production keys/archives together in this repository. `.env*`, `secrets/`, `backups/` and `.hardening-test/` are ignored; the last directory contains local test-only fixtures and keys.

## Schedule, retention and recovery targets

`ops/finledger-backup.service` and `.timer` are Linux systemd templates: daily at 02:00 UTC with up to 15 minutes jitter and missed-run catch-up. They use a dedicated OS user, private temporary directory, restricted filesystem access and an environment file outside Git. Install them only after setting paths, ownership, client tools, TLS credentials and failure notifications, then explicitly enable the timer in the approved environment. No timer has been installed on the user's Windows host.

After every successful backup, copy the encrypted archive to a private offsite bucket with encryption, versioning and immutable retention. Suggested policy: retain all daily archives for 30 days, retain a monthly archive for 12 months, and use at least seven days of object lock. Retention must be implemented in the storage provider; this tool never silently prunes archives. Monitor last-success age (alert after 26 hours), dump failure, upload failure and storage capacity. No offsite bucket, retention rule or alert receiver has been provisioned.

Daily logical dumps imply a target RPO of up to 24 hours plus schedule jitter; this is a planning target, not an SLA. For a smaller RPO, enable provider PostgreSQL WAL/PITR with independent restore drills. Measure RTO with real data volume and the entire cutover procedure; the small local fixture does not establish production RTO.

## Restore exclusively to a new isolated database

Use a separate controlled recovery host/cluster and an operator account allowed to create a database. Set `RESTORE_ADMIN_URL`, `BACKUP_KEY_FILE` and `BACKUP_FILE` in a private restore environment file, with `NODE_ENV=production` and a verify-full connection. The script first authenticates/decrypts the full archive into a temporary owner-only file. Only then does it create a fresh randomly named `finledger_restore_<uuid>_test` database. It has no target-overwrite or clean/drop option. pg_restore uses one transaction and exits on error. Temporary decrypted dump files are removed even on failure; an empty failed target may remain for investigation.

```sh
node --env-file=/etc/finledger/restore.env scripts/backup.mjs restore-isolated
```

Record the returned database name. Point a private operator environment's `DATABASE_URL` at that restored database and run `node scripts/check-integrity.mjs`. Compare source/restore table digests, balances and complete journals, verify immutable-record triggers, test role grants on the restored copy, and test application login/transfers against isolated infrastructure. Re-provision ownership/grants: dumps deliberately omit owners and ACLs. Revoke restored sessions before public cutover and reconcile outbox replay. Keep the original database untouched until an explicitly approved promotion and retention decision.

Only restore trusted archives. Encryption authenticates possession of the key; it is not a sandbox for arbitrary SQL from an untrusted database. Use a dedicated recovery cluster and least necessary operator permissions.

## Reproducible local drill

With test infrastructure running and application built:

```sh
npm run test:hardening
```

The drill creates a new source database and dedicated migration/runtime/backup roles on `TEST_DATABASE_URL`'s isolated server. It exercises financial concurrency, confirms forbidden permissions, runs the worker, encrypts a dump, rejects tampering, restores into another new database, compares application row digests, and checks ledger integrity/constraints. Existing databases are never reset or overwritten. Generated databases and roles remain for inspection; credentials/archives are test-only and stored under ignored `.hardening-test/`. The standalone local TLS check uses a separate temporary PostgreSQL container and does not alter either database server.

For local tests without host PostgreSQL client binaries, the backup helper supports `PG_CLIENT_CONTAINER`, `PG_CLIENT_HOST` and `PG_CLIENT_PORT`. The drill uses the existing test container's client binaries. Production scheduling should use installed host client tools and a private TLS route, not privileged Docker access.
