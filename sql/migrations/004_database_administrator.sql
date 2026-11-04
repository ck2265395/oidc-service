BEGIN;

CREATE TABLE IF NOT EXISTS platform_admin (
  id uuid PRIMARY KEY,
  username text NOT NULL CHECK (char_length(username) BETWEEN 1 AND 128),
  username_normalized text NOT NULL UNIQUE CHECK (username_normalized = lower(btrim(username_normalized))),
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_session ADD COLUMN IF NOT EXISTS admin_id uuid REFERENCES platform_admin(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS admin_session_admin_idx ON admin_session (admin_id, last_activity DESC);

COMMIT;
