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
  session_hash text PRIMARY KEY CHECK (session_hash ~ '^[a-f0-9]{64}$'),
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

