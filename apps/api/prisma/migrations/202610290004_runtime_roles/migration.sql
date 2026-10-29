-- Only the table owner (migration role) may provision administrators.
-- Runtime role has INSERT for registration but cannot escalate through a new account.
CREATE FUNCTION protect_user_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'ADMIN' AND NOT pg_has_role(current_user,
    (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'USAGE') THEN
    RAISE EXCEPTION 'Administrator provisioning requires migration role' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER user_role_boundary BEFORE INSERT OR UPDATE OF role ON "User"
FOR EACH ROW EXECUTE FUNCTION protect_user_role();
