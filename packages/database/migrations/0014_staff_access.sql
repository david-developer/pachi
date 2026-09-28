CREATE TABLE staff_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('SUPER_ADMIN','VERIFICATION_OFFICER','LISTING_MODERATOR','TRUST_SAFETY_MODERATOR','SUPPORT_AGENT','ANALYST')),
  permission_scope jsonb NOT NULL CHECK (jsonb_typeof(permission_scope) = 'object'),
  active_from timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  granted_by text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK (expires_at > active_from)
);
CREATE INDEX staff_grants_user ON staff_grants(user_id);
CREATE TABLE staff_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  identity_id uuid NOT NULL REFERENCES auth_identities(id),
  issuer text NOT NULL,
  app_client_id text NOT NULL,
  origin_jti text NOT NULL,
  security_version integer NOT NULL,
  authenticated_at timestamptz NOT NULL,
  mfa_method text NOT NULL CHECK (mfa_method = 'COGNITO_REQUIRED_TOTP'),
  last_seen_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  token_expires_at timestamptz NOT NULL,
  access_token_ciphertext bytea NOT NULL,
  refresh_token_ciphertext bytea NOT NULL,
  revoked_at timestamptz,
  UNIQUE (issuer, app_client_id, origin_jti),
  CHECK (absolute_expires_at <= authenticated_at + interval '8 hours'),
  CHECK (idle_expires_at <= absolute_expires_at)
);
CREATE TABLE staff_auth_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  consumed_at timestamptz
);
CREATE TABLE staff_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL,
  target_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  reason text NOT NULL,
  role text,
  permission_scope jsonb,
  outcome text NOT NULL,
  request_id uuid NOT NULL,
  policy_version text NOT NULL DEFAULT 'staff-v1',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION staff_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'staff audit is append-only'; END $$;
CREATE TRIGGER staff_audit_immutable BEFORE UPDATE OR DELETE ON staff_access_audit
FOR EACH ROW EXECUTE FUNCTION staff_audit_immutable();
