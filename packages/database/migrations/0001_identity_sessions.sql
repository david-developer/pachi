DO $$ BEGIN
  CREATE TYPE account_state AS ENUM ('PENDING_PHONE', 'ACTIVE', 'LIMITED', 'SUSPENDED', 'DEACTIVATED', 'DELETION_PENDING', 'DELETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_state account_state NOT NULL DEFAULT 'PENDING_PHONE',
  display_name text,
  preferred_locale text NOT NULL DEFAULT 'en' CHECK (preferred_locale IN ('en', 'fr')),
  security_version integer NOT NULL DEFAULT 0 CHECK (security_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  provider text NOT NULL CHECK (provider IN ('COGNITO', 'LOCAL_TEST')),
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  UNIQUE (issuer, subject)
);

CREATE TABLE IF NOT EXISTS phone_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  normalized_e164 text NOT NULL CHECK (normalized_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  verified_at timestamptz,
  verification_version integer NOT NULL DEFAULT 0 CHECK (verification_version >= 0),
  replaced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS phone_contacts_active_unique ON phone_contacts (normalized_e164) WHERE replaced_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS phone_contacts_user_active_unique ON phone_contacts (user_id) WHERE replaced_at IS NULL;

CREATE TABLE IF NOT EXISTS email_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  normalized_email text NOT NULL CHECK (length(normalized_email) BETWEEN 3 AND 320),
  verified_at timestamptz,
  delivery_state text NOT NULL DEFAULT 'ACTIVE' CHECK (delivery_state IN ('ACTIVE', 'SUPPRESSED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_contacts_active_unique ON email_contacts (normalized_email);
CREATE UNIQUE INDEX IF NOT EXISTS email_contacts_user_unique ON email_contacts (user_id);

CREATE TABLE IF NOT EXISTS security_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  app_client_id text NOT NULL CHECK (length(app_client_id) BETWEEN 1 AND 256),
  origin_jti text NOT NULL CHECK (length(origin_jti) BETWEEN 1 AND 512),
  current_jti text NOT NULL CHECK (length(current_jti) BETWEEN 1 AND 512),
  device_label text,
  authenticated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  UNIQUE (issuer, app_client_id, origin_jti)
);
CREATE INDEX IF NOT EXISTS security_sessions_user_active_idx ON security_sessions (user_id, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS auth_identities_user_idx ON auth_identities (user_id);
CREATE INDEX IF NOT EXISTS email_contacts_user_idx ON email_contacts (user_id);
CREATE INDEX IF NOT EXISTS phone_contacts_user_idx ON phone_contacts (user_id);
