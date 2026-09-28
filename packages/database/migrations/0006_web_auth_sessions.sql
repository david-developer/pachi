CREATE TABLE IF NOT EXISTS web_auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_ciphertext bytea NOT NULL,
  refresh_token_ciphertext bytea,
  token_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS web_auth_sessions_user_idx ON web_auth_sessions (user_id, revoked_at);
