-- Audit log tamper protection
-- Revoke UPDATE and DELETE on audit_log from app_user so that
-- audit records are append-only at the database level.
-- The dbAdmin connection (owner role) retains full access.

REVOKE UPDATE, DELETE ON audit_log FROM app_user;

-- Also handle the alternate table name if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'auditlog') THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON auditlog FROM app_user';
  END IF;
END
$$;
