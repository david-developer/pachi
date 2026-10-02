CREATE TABLE interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  seeker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_account_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('OPEN','CLOSED','RESTRICTED')),
  initial_channel text NOT NULL CHECK (initial_channel IN ('MESSAGE')),
  opened_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK ((state = 'CLOSED') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX interactions_active_unique ON interactions(listing_id,seeker_user_id,provider_account_id) WHERE state IN ('OPEN','RESTRICTED');
CREATE INDEX interactions_seeker_idx ON interactions(seeker_user_id,created_at DESC);
CREATE INDEX interactions_provider_idx ON interactions(provider_account_id,created_at DESC);

CREATE TABLE interaction_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id uuid NOT NULL REFERENCES interactions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  side text NOT NULL CHECK (side IN ('SEEKER','PROVIDER')),
  joined_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  left_at timestamptz,
  UNIQUE (interaction_id,user_id,side)
);
CREATE INDEX interaction_participants_user_idx ON interaction_participants(user_id,interaction_id);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id uuid NOT NULL UNIQUE REFERENCES interactions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE interaction_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seeker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation='CREATE_INQUIRY'),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  interaction_id uuid NOT NULL REFERENCES interactions(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (seeker_user_id,operation,idempotency_key)
);

CREATE TABLE interaction_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id uuid NOT NULL REFERENCES interactions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type='interaction_created'),
  safe_payload jsonb NOT NULL CHECK (jsonb_typeof(safe_payload)='object'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  delivered_at timestamptz
);
CREATE UNIQUE INDEX interaction_outbox_created_unique ON interaction_outbox(interaction_id,event_type);
CREATE INDEX interaction_outbox_pending_idx ON interaction_outbox(created_at) WHERE delivered_at IS NULL;
