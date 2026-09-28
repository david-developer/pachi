DO $$ BEGIN
  CREATE TYPE phone_challenge_status AS ENUM ('PENDING_DELIVERY', 'SENT', 'DELIVERY_FAILED', 'CONSUMED', 'EXPIRED', 'SUPERSEDED', 'LOCKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS phone_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  normalized_e164 text NOT NULL CHECK (normalized_e164 ~ '^\\+237[1-9][0-9]{8}$'),
  purpose text NOT NULL CHECK (purpose = 'PHONE_OWNERSHIP'),
  code_digest bytea NOT NULL CHECK (octet_length(code_digest) = 32),
  status phone_challenge_status NOT NULL DEFAULT 'PENDING_DELIVERY',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts = 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  superseded_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phone_otp_challenges_user_phone_created_idx ON phone_otp_challenges (user_id, normalized_e164, created_at DESC);
CREATE INDEX IF NOT EXISTS phone_otp_challenges_expiry_idx ON phone_otp_challenges (expires_at) WHERE status IN ('PENDING_DELIVERY', 'SENT');

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason_code text,
  request_id text,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_target_idx ON audit_events (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events (actor_user_id, created_at DESC);
