ALTER TABLE web_auth_sessions ADD COLUMN IF NOT EXISTS idle_expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days';
ALTER TABLE web_auth_sessions ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days';
CREATE INDEX IF NOT EXISTS web_auth_sessions_expiry_idx ON web_auth_sessions (idle_expires_at, absolute_expires_at) WHERE revoked_at IS NULL;
