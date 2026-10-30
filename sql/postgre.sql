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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_account_uuid, display_name)
);

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

COMMIT;
