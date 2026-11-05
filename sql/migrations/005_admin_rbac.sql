ALTER TABLE platform_admin
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'super_admin';

ALTER TABLE platform_admin
  DROP CONSTRAINT IF EXISTS platform_admin_role_check;

ALTER TABLE platform_admin
  ADD CONSTRAINT platform_admin_role_check
  CHECK (role IN ('super_admin', 'operator', 'auditor'));

CREATE INDEX IF NOT EXISTS platform_admin_role_status_idx
  ON platform_admin (role, status);
