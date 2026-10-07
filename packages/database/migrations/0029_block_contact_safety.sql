-- Existing 0026 episodes remain intact, without fabricated command provenance.
ALTER TABLE block_relationships ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version>0);
CREATE INDEX blocks_owned_page_idx ON block_relationships(blocker_user_id,id DESC);
CREATE TABLE block_command_receipts (
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK(operation IN ('BLOCK_INTERACTION','BLOCK_LISTING','UNBLOCK')),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  block_id uuid NOT NULL REFERENCES block_relationships(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(actor_user_id,operation,idempotency_key)
);
CREATE TABLE block_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES block_relationships(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK(operation IN ('BLOCK','UNBLOCK')),
  request_id uuid NOT NULL,
  prior_state text NOT NULL CHECK(prior_state IN ('ABSENT','ACTIVE')),
  new_state text NOT NULL CHECK(new_state IN ('ACTIVE','REVOKED')),
  version integer NOT NULL CHECK(version>0),
  policy_version text NOT NULL DEFAULT 'block-contact-v1' CHECK(policy_version='block-contact-v1'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(block_id,operation),
  CHECK((operation='BLOCK' AND prior_state='ABSENT' AND new_state='ACTIVE' AND version=1)
    OR (operation='UNBLOCK' AND prior_state='ACTIVE' AND new_state='REVOKED' AND version=2))
);
-- No pair, contact, body, free-form reason, or G2 analytics delivery surface.
CREATE TABLE block_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL UNIQUE REFERENCES block_actions(id) ON DELETE RESTRICT,
  block_id uuid NOT NULL REFERENCES block_relationships(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN ('BLOCK','UNBLOCK')),
  schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
  version integer NOT NULL CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE FUNCTION block_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'block command history is append-only'; END $$;
CREATE TRIGGER block_actions_immutable BEFORE UPDATE OR DELETE ON block_actions FOR EACH ROW EXECUTE FUNCTION block_history_immutable();
CREATE TRIGGER block_receipts_immutable BEFORE UPDATE OR DELETE ON block_command_receipts FOR EACH ROW EXECUTE FUNCTION block_history_immutable();
CREATE TRIGGER block_outbox_immutable BEFORE UPDATE OR DELETE ON block_outbox FOR EACH ROW EXECUTE FUNCTION block_history_immutable();
CREATE FUNCTION block_episode_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'block episodes are retained'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.blocker_user_id IS DISTINCT FROM OLD.blocker_user_id
    OR NEW.blocked_user_id IS DISTINCT FROM OLD.blocked_user_id OR NEW.blocked_provider_account_id IS DISTINCT FROM OLD.blocked_provider_account_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.revoked_at IS NOT NULL
    OR NEW.revoked_at IS NULL OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'block episode attribution is immutable'; END IF;
  RETURN NEW;
END $$;
-- Legacy clients revoke without a version field; assign it in the database.
CREATE FUNCTION block_episode_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND NEW.version=OLD.version THEN NEW.version=OLD.version+1; END IF; RETURN NEW; END $$;
CREATE TRIGGER block_0_episode_version BEFORE UPDATE ON block_relationships FOR EACH ROW EXECUTE FUNCTION block_episode_version();
CREATE TRIGGER block_1_episode_immutable BEFORE UPDATE OR DELETE ON block_relationships FOR EACH ROW EXECUTE FUNCTION block_episode_immutable();
