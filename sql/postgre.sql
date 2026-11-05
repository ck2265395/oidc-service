BEGIN;

CREATE TABLE IF NOT EXISTS developer_profile (
  account_uuid text PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  contact_email text NOT NULL CHECK (char_length(contact_email) <= 254),
  contact_email_verified boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS application_group (
  id uuid PRIMARY KEY,
  owner_account_uuid text NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'disabled')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  last_review jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_account_uuid, display_name)
);

ALTER TABLE application_group ADD COLUMN IF NOT EXISTS last_review jsonb;

CREATE TABLE IF NOT EXISTS application_group_review_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES application_group(id),
  owner_account_uuid text NOT NULL,
  reviewer_uuid text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve', 'reject', 'disable')),
  reason text,
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS application_group_review_history_group_created_idx
  ON application_group_review_history (group_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS oidc_application (
  id uuid PRIMARY KEY,
  owner_account_uuid text NOT NULL,
  client_id text NOT NULL UNIQUE,
  client_type text NOT NULL CHECK (client_type IN ('web', 'spa', 'native')),
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('draft', 'pending', 'rejected', 'approved', 'disabled')),
  draft_config jsonb NOT NULL,
  approved_config jsonb,
  approved_revision bigint,
  encrypted_client_secret text,
  group_id uuid REFERENCES application_group(id),
  last_review jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((approved_config IS NULL) = (approved_revision IS NULL)),
  CHECK (status <> 'approved' OR approved_config IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS oidc_application_owner_updated_idx
  ON oidc_application (owner_account_uuid, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS oidc_application_status_updated_idx
  ON oidc_application (status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS oidc_application_group_idx
  ON oidc_application (group_id) WHERE group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS application_review_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES oidc_application(id),
  revision bigint NOT NULL,
  submitted_by_account_uuid text NOT NULL,
  reviewed_by_account_uuid text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve', 'reject', 'disable')),
  reason text,
  submitted_config jsonb NOT NULL,
  previously_approved_config jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS application_review_history_app_created_idx
  ON application_review_history (application_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS oidc_document (
  model text NOT NULL,
  document_id text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz,
  grant_id text,
  account_uuid text,
  client_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (model, document_id)
);

CREATE INDEX IF NOT EXISTS oidc_document_expiry_idx
  ON oidc_document (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS oidc_document_grant_idx
  ON oidc_document (grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS oidc_document_account_idx
  ON oidc_document (account_uuid, client_id) WHERE account_uuid IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id text,
  actor_type text NOT NULL CHECK (actor_type IN ('account', 'admin', 'system')),
  actor_id text,
  action text NOT NULL,
  application_id uuid REFERENCES oidc_application(id),
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_audit_created_idx
  ON platform_audit (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS platform_audit_app_created_idx
  ON platform_audit (application_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS platform_admin (
  id uuid PRIMARY KEY,
  username text NOT NULL CHECK (char_length(username) BETWEEN 1 AND 128),
  username_normalized text NOT NULL UNIQUE CHECK (username_normalized = lower(btrim(username_normalized))),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'operator', 'auditor')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_admin_role_status_idx
  ON platform_admin (role, status);

CREATE TABLE IF NOT EXISTS admin_session (
  session_hash text PRIMARY KEY CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  admin_id uuid REFERENCES platform_admin(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_session_last_activity_idx
  ON admin_session (last_activity);
CREATE INDEX IF NOT EXISTS admin_session_admin_idx
  ON admin_session (admin_id, last_activity DESC);

CREATE TABLE IF NOT EXISTS admin_login_limit (
  ip_hash text PRIMARY KEY CHECK (ip_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  blocked_until timestamptz
);

-- Developer identity domain (kept in sync with migration 003).
CREATE TABLE IF NOT EXISTS developer_account (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('unsubmitted', 'pending', 'approved', 'rejected', 'disabled')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  last_review jsonb,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_password_credential (
  developer_id uuid PRIMARY KEY REFERENCES developer_account(id) ON DELETE CASCADE,
  email_normalized text NOT NULL UNIQUE CHECK (char_length(email_normalized) <= 254),
  email_display text NOT NULL CHECK (char_length(email_display) <= 254),
  password_digest jsonb NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_external_identity (
  id uuid PRIMARY KEY,
  developer_id uuid NOT NULL REFERENCES developer_account(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('moondrop')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject),
  UNIQUE (developer_id, provider)
);

CREATE TABLE IF NOT EXISTS developer_session (
  session_hash text PRIMARY KEY CHECK (session_hash ~ '^[a-f0-9]{64}
),
  developer_id uuid NOT NULL REFERENCES developer_account(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS developer_session_developer_activity_idx
  ON developer_session (developer_id, last_activity DESC);
CREATE INDEX IF NOT EXISTS developer_session_expiry_idx
  ON developer_session (absolute_expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS developer_review_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  developer_id uuid NOT NULL REFERENCES developer_account(id),
  action text NOT NULL CHECK (action IN ('submit', 'approve', 'reject', 'disable', 'restore')),
  from_status text NOT NULL CHECK (from_status IN ('unsubmitted', 'pending', 'approved', 'rejected', 'disabled')),
  to_status text NOT NULL CHECK (to_status IN ('unsubmitted', 'pending', 'approved', 'rejected', 'disabled')),
  reviewer_id text,
  reason text,
  profile_snapshot jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS developer_review_history_developer_created_idx
  ON developer_review_history (developer_id, created_at DESC, id DESC);

ALTER TABLE developer_profile ADD COLUMN IF NOT EXISTS developer_id uuid;
ALTER TABLE developer_profile ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE developer_profile ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT '';

WITH legacy_owner AS (
  SELECT account_uuid AS subject FROM developer_profile
  UNION SELECT owner_account_uuid FROM application_group
  UNION SELECT owner_account_uuid FROM oidc_application
), unmapped AS (
  SELECT DISTINCT subject
  FROM legacy_owner
  WHERE subject IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM developer_account WHERE id::text = subject)
    AND NOT EXISTS (
      SELECT 1 FROM developer_external_identity
      WHERE provider = 'moondrop' AND developer_external_identity.subject = legacy_owner.subject
    )
), mapped AS (
  SELECT subject,
    (substr(md5('moondrop-developer:' || subject), 1, 8) || '-' ||
     substr(md5('moondrop-developer:' || subject), 9, 4) || '-4' ||
     substr(md5('moondrop-developer:' || subject), 14, 3) || '-8' ||
     substr(md5('moondrop-developer:' || subject), 18, 3) || '-' ||
     substr(md5('moondrop-developer:' || subject), 21, 12))::uuid AS developer_id
  FROM unmapped
)
INSERT INTO developer_account (id, status, submitted_at, approved_at)
SELECT developer_id, 'approved', now(), now() FROM mapped
ON CONFLICT (id) DO NOTHING;

WITH legacy_owner AS (
  SELECT account_uuid AS subject FROM developer_profile
  UNION SELECT owner_account_uuid FROM application_group
  UNION SELECT owner_account_uuid FROM oidc_application
), candidates AS (
  SELECT DISTINCT subject,
    (substr(md5('moondrop-developer:' || subject), 1, 8) || '-' ||
     substr(md5('moondrop-developer:' || subject), 9, 4) || '-4' ||
     substr(md5('moondrop-developer:' || subject), 14, 3) || '-8' ||
     substr(md5('moondrop-developer:' || subject), 18, 3) || '-' ||
     substr(md5('moondrop-developer:' || subject), 21, 12))::uuid AS developer_id
  FROM legacy_owner
  WHERE subject IS NOT NULL
), mapped AS (
  SELECT candidates.* FROM candidates
  JOIN developer_account ON developer_account.id = candidates.developer_id
)
INSERT INTO developer_external_identity (id, developer_id, provider, subject)
SELECT gen_random_uuid(), developer_id, 'moondrop', subject FROM mapped
ON CONFLICT (provider, subject) DO NOTHING;

UPDATE developer_profile p
SET developer_id = e.developer_id
FROM developer_external_identity e
WHERE e.provider = 'moondrop' AND e.subject = p.account_uuid AND p.developer_id IS NULL;

UPDATE application_group g
SET owner_account_uuid = e.developer_id::text
FROM developer_external_identity e
WHERE e.provider = 'moondrop' AND e.subject = g.owner_account_uuid;

UPDATE oidc_application a
SET owner_account_uuid = e.developer_id::text
FROM developer_external_identity e
WHERE e.provider = 'moondrop' AND e.subject = a.owner_account_uuid;

CREATE UNIQUE INDEX IF NOT EXISTS developer_profile_developer_idx
  ON developer_profile (developer_id) WHERE developer_id IS NOT NULL;

COMMIT;
