CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sender_side text NOT NULL CHECK (sender_side IN ('SEEKER','PROVIDER')),
  client_message_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000 AND body ~ '[^[:space:]]'),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  sent_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  visibility_state text NOT NULL DEFAULT 'VISIBLE' CHECK (visibility_state IN ('VISIBLE','REMOVED')),
  UNIQUE (sender_user_id,client_message_id)
);
CREATE INDEX messages_history_idx ON messages(conversation_id,sequence DESC);

CREATE TABLE message_receipts (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  delivered_at timestamptz,
  read_at timestamptz,
  PRIMARY KEY (message_id,recipient_user_id),
  CHECK (read_at IS NULL OR (delivered_at IS NOT NULL AND read_at >= delivered_at))
);

CREATE TABLE block_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  blocked_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  blocked_provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  revoked_at timestamptz,
  CHECK (num_nonnulls(blocked_user_id,blocked_provider_account_id)=1),
  CHECK (blocked_user_id IS NULL OR blocked_user_id <> blocker_user_id),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE UNIQUE INDEX blocks_active_user_unique ON block_relationships(blocker_user_id,blocked_user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX blocks_active_provider_unique ON block_relationships(blocker_user_id,blocked_provider_account_id) WHERE revoked_at IS NULL;

-- One bounded row per scope; fixed-window counters update in the send transaction.
CREATE TABLE message_rate_limits (
  sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scope text NOT NULL,
  window_start timestamptz NOT NULL,
  message_count integer NOT NULL CHECK (message_count > 0),
  PRIMARY KEY (sender_user_id,scope)
);

CREATE TABLE communication_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id uuid NOT NULL REFERENCES interactions(id) ON DELETE RESTRICT,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('message_sent','provider_first_response')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  safe_payload jsonb NOT NULL CHECK (jsonb_typeof(safe_payload)='object'),
  occurred_at timestamptz NOT NULL,
  published_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  CHECK (
    (event_type='message_sent' AND safe_payload ?& ARRAY['message_id','interaction_id','conversation_id','sender_user_id','sender_side']
      AND safe_payload - ARRAY['message_id','interaction_id','conversation_id','sender_user_id','sender_side'] = '{}'::jsonb)
    OR
    (event_type='provider_first_response' AND safe_payload ?& ARRAY['interaction_id','response_time_bucket']
      AND safe_payload - ARRAY['interaction_id','response_time_bucket'] = '{}'::jsonb
      AND safe_payload->>'response_time_bucket' IN ('LT_5M','M5_TO_15M','M15_TO_60M','H1_TO_4H','H4_TO_24H','GT_24H'))
  )
);
CREATE UNIQUE INDEX communication_message_sent_unique ON communication_outbox(message_id) WHERE event_type='message_sent';
CREATE UNIQUE INDEX communication_first_response_unique ON communication_outbox(interaction_id) WHERE event_type='provider_first_response';
CREATE INDEX communication_outbox_pending_idx ON communication_outbox(occurred_at,id) WHERE published_at IS NULL;
