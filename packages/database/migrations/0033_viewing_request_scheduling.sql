-- Viewing episodes are children of the existing business Interaction.
CREATE TABLE viewings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id uuid NOT NULL REFERENCES interactions(id),
  listing_id uuid NOT NULL REFERENCES listings(id),
  provider_account_id uuid NOT NULL REFERENCES provider_accounts(id),
  seeker_user_id uuid NOT NULL REFERENCES users(id),
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  state text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED','ACCEPTED','SCHEDULED','RESCHEDULED','DECLINED','EXPIRED','CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER','SEEKER_NO_SHOW','PROVIDER_NO_SHOW','COMPLETED','DISPUTED')),
  proposed_start timestamptz NOT NULL,
  proposed_end timestamptz NOT NULL,
  display_timezone text NOT NULL,
  response_deadline timestamptz NOT NULL,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  schedule_version integer NOT NULL DEFAULT 1 CHECK (schedule_version>0),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  accepted_by_user_id uuid REFERENCES users(id),
  accepted_membership_id uuid REFERENCES organization_memberships(id),
  accepted_assignment_id uuid REFERENCES organization_resource_assignments(id),
  accepted_at timestamptz,
  seeker_confirmed boolean NOT NULL DEFAULT false,
  provider_confirmed boolean NOT NULL DEFAULT false,
  private_instructions text,
  reason text CHECK (reason IN ('UNAVAILABLE','TIME_UNSUITABLE','SAFETY','PLANS_CHANGED','OTHER','RESPONSE_DEADLINE_ELAPSED')),
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  policy_version text NOT NULL DEFAULT 'viewing-scheduling-v1' CHECK (policy_version='viewing-scheduling-v1'),
  CHECK (requested_by_user_id=seeker_user_id),
  CHECK (proposed_start>created_at AND proposed_end>proposed_start),
  CHECK (response_deadline=LEAST(created_at+interval '48 hours',proposed_start)),
  CHECK ((scheduled_start IS NULL)=(scheduled_end IS NULL)),
  CHECK (scheduled_start IS NULL OR scheduled_end>scheduled_start),
  CHECK (private_instructions IS NULL OR char_length(private_instructions) BETWEEN 1 AND 2000),
  CHECK (state NOT IN ('ACCEPTED','SCHEDULED') OR (accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL AND scheduled_start IS NOT NULL AND private_instructions IS NOT NULL)),
  CHECK (state<>'SCHEDULED' OR (seeker_confirmed AND provider_confirmed)),
  CHECK (state NOT IN ('DECLINED','EXPIRED','CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER') OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX viewings_one_active_interaction ON viewings(interaction_id)
  WHERE state IN ('REQUESTED','ACCEPTED','SCHEDULED','RESCHEDULED','DISPUTED');
CREATE INDEX viewings_interaction_page ON viewings(interaction_id,id DESC);
CREATE INDEX viewings_provider_page ON viewings(provider_account_id,id DESC);
CREATE INDEX viewings_seeker_page ON viewings(seeker_user_id,id DESC);

CREATE TABLE viewing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewing_id uuid NOT NULL REFERENCES viewings(id),
  interaction_id uuid NOT NULL REFERENCES interactions(id),
  sequence integer NOT NULL CHECK (sequence>0),
  event_type text NOT NULL CHECK (event_type IN ('viewing_requested','viewing_accepted','viewing_declined','viewing_confirmed','viewing_scheduled','viewing_cancelled','viewing_expired')),
  actor_user_id uuid REFERENCES users(id),
  actor_side text CHECK (actor_side IN ('SEEKER','PROVIDER')),
  membership_id uuid REFERENCES organization_memberships(id),
  assignment_id uuid REFERENCES organization_resource_assignments(id),
  prior_state text,
  new_state text NOT NULL,
  version integer NOT NULL,
  schedule_version integer NOT NULL,
  reason_code text,
  -- Protected lifecycle history; omitted from generic queues and analytics.
  scheduled_start timestamptz,
  request_id uuid,
  policy_version text NOT NULL DEFAULT 'viewing-scheduling-v1',
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(viewing_id,sequence),
  CHECK (sequence=version)
);
CREATE TABLE viewing_command_receipts (
  actor_user_id uuid NOT NULL REFERENCES users(id),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  viewing_id uuid NOT NULL REFERENCES viewings(id),
  operation text NOT NULL CHECK (operation IN ('CREATE','ACCEPT','DECLINE','CONFIRM','CANCEL')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(actor_user_id,idempotency_key)
);
CREATE TABLE viewing_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES viewing_events(id),
  viewing_id uuid NOT NULL REFERENCES viewings(id),
  event_type text NOT NULL,
  safe_payload jsonb NOT NULL CHECK (jsonb_typeof(safe_payload)='object'),
  notification_intent jsonb NOT NULL CHECK (jsonb_typeof(notification_intent)='object'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
-- Only unanswered-request expiry is activated in F1. Reminders remain deferred.
CREATE TABLE viewing_scheduled_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewing_id uuid NOT NULL UNIQUE REFERENCES viewings(id),
  action_type text NOT NULL DEFAULT 'EXPIRE_REQUEST' CHECK (action_type='EXPIRE_REQUEST'),
  expected_schedule_version integer NOT NULL CHECK (expected_schedule_version>0),
  due_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','LEASED','PROCESSED','SKIPPED')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  processed_at timestamptz,
  CHECK ((state='LEASED')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK ((state IN ('PROCESSED','SKIPPED'))=(processed_at IS NOT NULL))
);
CREATE INDEX viewing_actions_due ON viewing_scheduled_actions(due_at,id) WHERE state IN ('PENDING','LEASED');

CREATE FUNCTION viewing_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'viewing history is append-only'; END $$;
CREATE TRIGGER viewing_events_immutable BEFORE UPDATE OR DELETE ON viewing_events FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE TRIGGER viewing_receipts_immutable BEFORE UPDATE OR DELETE ON viewing_command_receipts FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE TRIGGER viewing_outbox_immutable BEFORE UPDATE OR DELETE ON viewing_outbox FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();

CREATE FUNCTION viewing_episode_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'viewing episodes are retained'; END IF;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM interactions i WHERE i.id=NEW.interaction_id AND i.listing_id=NEW.listing_id
      AND i.provider_account_id=NEW.provider_account_id AND i.seeker_user_id=NEW.seeker_user_id)
      OR NEW.state<>'REQUESTED' OR NEW.version<>1 OR NEW.schedule_version<>1
      OR NEW.accepted_at IS NOT NULL OR NEW.seeker_confirmed OR NEW.provider_confirmed
      THEN RAISE EXCEPTION 'invalid viewing context'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=NEW.display_timezone) THEN RAISE EXCEPTION 'invalid viewing timezone'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.interaction_id,NEW.listing_id,NEW.provider_account_id,NEW.seeker_user_id,NEW.requested_by_user_id,
    NEW.proposed_start,NEW.proposed_end,NEW.display_timezone,NEW.response_deadline,NEW.created_at,NEW.policy_version)
    IS DISTINCT FROM ROW(OLD.id,OLD.interaction_id,OLD.listing_id,OLD.provider_account_id,OLD.seeker_user_id,OLD.requested_by_user_id,
    OLD.proposed_start,OLD.proposed_end,OLD.display_timezone,OLD.response_deadline,OLD.created_at,OLD.policy_version)
    OR NEW.version<>OLD.version+1 OR NEW.schedule_version<>OLD.schedule_version
    OR OLD.state NOT IN ('REQUESTED','ACCEPTED','SCHEDULED')
    OR (OLD.state='REQUESTED' AND NEW.state NOT IN ('ACCEPTED','DECLINED','EXPIRED','CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER'))
    OR (OLD.state='ACCEPTED' AND NEW.state NOT IN ('ACCEPTED','SCHEDULED','CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER'))
    OR (OLD.state='SCHEDULED' AND NEW.state NOT IN ('CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER'))
    THEN RAISE EXCEPTION 'invalid viewing transition'; END IF;
  IF OLD.accepted_at IS NOT NULL AND ROW(NEW.accepted_by_user_id,NEW.accepted_membership_id,NEW.accepted_assignment_id,NEW.accepted_at,
    NEW.scheduled_start,NEW.scheduled_end,NEW.private_instructions) IS DISTINCT FROM ROW(OLD.accepted_by_user_id,OLD.accepted_membership_id,
    OLD.accepted_assignment_id,OLD.accepted_at,OLD.scheduled_start,OLD.scheduled_end,OLD.private_instructions)
    THEN RAISE EXCEPTION 'accepted schedule is immutable in F1'; END IF;
  IF (OLD.seeker_confirmed AND NOT NEW.seeker_confirmed) OR (OLD.provider_confirmed AND NOT NEW.provider_confirmed)
    THEN RAISE EXCEPTION 'confirmations are retained'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER viewing_episode_guard BEFORE INSERT OR UPDATE OR DELETE ON viewings FOR EACH ROW EXECUTE FUNCTION viewing_episode_guard();
