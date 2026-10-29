ALTER TABLE "Wallet" DROP CONSTRAINT wallet_identity;
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_identity CHECK (
  ("userId" IS NOT NULL AND "systemKey" IS NULL) OR
  ("userId" IS NULL AND "systemKey" IS NOT NULL AND "systemKey"='SIMULATOR_TREASURY' AND id='00000000-0000-4000-8000-000000000001'::uuid)
);
CREATE TRIGGER no_truncate_postings BEFORE TRUNCATE ON "LedgerPosting" FOR EACH STATEMENT EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER no_truncate_journals BEFORE TRUNCATE ON "LedgerJournal" FOR EACH STATEMENT EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER no_truncate_transfers BEFORE TRUNCATE ON "Transfer" FOR EACH STATEMENT EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER no_truncate_audits BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER no_truncate_idempotency BEFORE TRUNCATE ON "IdempotencyRecord" FOR EACH STATEMENT EXECUTE FUNCTION deny_mutation();
