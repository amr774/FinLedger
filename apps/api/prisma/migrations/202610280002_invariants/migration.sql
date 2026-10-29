-- Liability wallets: credits increase available funds; debits decrease them.
-- The treasury is a virtual issuer / contra-account, allowed to be negative.
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_identity CHECK (
  ("userId" IS NOT NULL AND "systemKey" IS NULL) OR
  ("userId" IS NULL AND "systemKey"='SIMULATOR_TREASURY' AND id='00000000-0000-4000-8000-000000000001'::uuid)
);
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_currency CHECK (currency='EGP');
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_nonnegative CHECK ("systemKey" IS NOT NULL OR balance>=0);
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_limit CHECK (balance BETWEEN -9000000000000000 AND 9000000000000000);
ALTER TABLE "Transfer" ADD CONSTRAINT transfer_valid CHECK (amount>0 AND amount<=10000000 AND "sourceId"<>"destinationId" AND currency='EGP');
ALTER TABLE "LedgerPosting" ADD CONSTRAINT posting_positive CHECK (amount>0);

CREATE FUNCTION deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Append-only financial or audit record' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER immutable_journal BEFORE UPDATE OR DELETE ON "LedgerJournal" FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_posting BEFORE UPDATE OR DELETE ON "LedgerPosting" FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_transfer BEFORE UPDATE OR DELETE ON "Transfer" FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_idempotency BEFORE UPDATE OR DELETE ON "IdempotencyRecord" FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE FUNCTION protect_wallet_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."systemKey" IS DISTINCT FROM OLD."systemKey" OR NEW.currency<>OLD.currency THEN
    RAISE EXCEPTION 'Wallet identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER wallet_identity_immutable BEFORE UPDATE ON "Wallet" FOR EACH ROW EXECUTE FUNCTION protect_wallet_identity();

CREATE FUNCTION apply_posting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Wallet" SET balance=balance+CASE WHEN NEW.side='CREDIT' THEN NEW.amount ELSE -NEW.amount END WHERE id=NEW."walletId";
  RETURN NEW;
END; $$;
CREATE TRIGGER posting_balance AFTER INSERT ON "LedgerPosting" FOR EACH ROW EXECUTE FUNCTION apply_posting();

CREATE FUNCTION check_wallet_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected numeric; actual bigint;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN side='CREDIT' THEN amount ELSE -amount END),0) INTO expected FROM "LedgerPosting" WHERE "walletId"=NEW.id;
  SELECT balance INTO actual FROM "Wallet" WHERE id=NEW.id;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Wallet cache differs from ledger' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER wallet_cache_consistent AFTER INSERT OR UPDATE ON "Wallet" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_wallet_balance();

CREATE FUNCTION check_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE journal_id uuid; movement "Transfer"%ROWTYPE; posting_count integer; matching_count integer;
BEGIN
  IF TG_TABLE_NAME='LedgerPosting' THEN journal_id=NEW."journalId";
  ELSIF TG_TABLE_NAME='Transfer' THEN SELECT id INTO journal_id FROM "LedgerJournal" WHERE "transferId"=NEW.id;
  ELSE journal_id=NEW.id;
  END IF;
  IF journal_id IS NULL THEN RAISE EXCEPTION 'Transfer must have a journal' USING ERRCODE='23514'; END IF;
  SELECT t.* INTO movement FROM "Transfer" t JOIN "LedgerJournal" j ON j."transferId"=t.id WHERE j.id=journal_id;
  SELECT COUNT(*),COUNT(*) FILTER(WHERE amount=movement.amount AND ((side='DEBIT' AND "walletId"=movement."sourceId") OR (side='CREDIT' AND "walletId"=movement."destinationId"))) INTO posting_count,matching_count FROM "LedgerPosting" WHERE "journalId"=journal_id;
  IF posting_count<>2 OR matching_count<>2 THEN RAISE EXCEPTION 'Journal must contain matching equal debit and credit' USING ERRCODE='23514'; END IF;
  IF (movement.kind='DEMO_FUNDING') <> (movement."sourceId"='00000000-0000-4000-8000-000000000001'::uuid) OR movement."destinationId"='00000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'Invalid treasury movement' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON "LedgerJournal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal();
CREATE CONSTRAINT TRIGGER postings_balanced AFTER INSERT ON "LedgerPosting" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal();
CREATE CONSTRAINT TRIGGER transfer_journal_required AFTER INSERT ON "Transfer" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal();

INSERT INTO "Wallet" (id,"systemKey",currency,status,balance,"createdAt") VALUES ('00000000-0000-4000-8000-000000000001','SIMULATOR_TREASURY','EGP','ACTIVE',0,now());
