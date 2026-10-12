-- Expand the existing Viewing aggregate; previous migrations remain immutable.
CREATE TABLE viewing_reschedule_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewing_id uuid NOT NULL REFERENCES viewings(id),
  base_schedule_version integer NOT NULL CHECK (base_schedule_version>0),
  base_scheduled_start timestamptz NOT NULL,
  proposed_start timestamptz NOT NULL,
  proposed_end timestamptz NOT NULL,
  display_timezone text NOT NULL,
  proposed_by_user_id uuid NOT NULL REFERENCES users(id),
  proposed_by_side text NOT NULL CHECK (proposed_by_side IN ('SEEKER','PROVIDER')),
  membership_id uuid REFERENCES organization_memberships(id),
  assignment_id uuid REFERENCES organization_resource_assignments(id),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','FINALIZED','REJECTED','WITHDRAWN','EXPIRED','INVALIDATED')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  seeker_approved boolean NOT NULL DEFAULT false,
  provider_approved boolean NOT NULL DEFAULT false,
  finalized_schedule_version integer,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  policy_version text NOT NULL DEFAULT 'viewing-rescheduling-v1' CHECK (policy_version='viewing-rescheduling-v1'),
  CHECK (proposed_start>created_at AND proposed_end>proposed_start AND base_scheduled_start>created_at),
  CHECK (expires_at=LEAST(created_at+interval '48 hours',base_scheduled_start,proposed_start)),
  CHECK ((state='FINALIZED')=(finalized_schedule_version IS NOT NULL)),
  CHECK (state<>'FINALIZED' OR (seeker_approved AND provider_approved AND finalized_schedule_version=base_schedule_version+1))
);
CREATE UNIQUE INDEX viewing_reschedule_one_pending ON viewing_reschedule_proposals(viewing_id) WHERE state='PENDING';
CREATE INDEX viewing_reschedule_page ON viewing_reschedule_proposals(viewing_id,id DESC);
CREATE TABLE viewing_schedule_history (
  viewing_id uuid NOT NULL REFERENCES viewings(id),
  schedule_version integer NOT NULL CHECK (schedule_version>0),
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL,
  display_timezone text NOT NULL,
  superseded_by_proposal_id uuid NOT NULL UNIQUE REFERENCES viewing_reschedule_proposals(id),
  superseded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(viewing_id,schedule_version),
  CHECK (scheduled_end>scheduled_start)
);
CREATE TRIGGER viewing_schedule_history_immutable BEFORE UPDATE OR DELETE ON viewing_schedule_history FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE FUNCTION viewing_proposal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'viewing proposals are retained'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'PENDING' OR NEW.version<>1 OR NEW.seeker_approved OR NEW.provider_approved
      OR NOT EXISTS (SELECT 1 FROM viewings v WHERE v.id=NEW.viewing_id AND v.state='SCHEDULED'
        AND v.schedule_version=NEW.base_schedule_version AND v.scheduled_start=NEW.base_scheduled_start
        AND v.display_timezone=NEW.display_timezone AND (NEW.proposed_by_side<>'SEEKER' OR NEW.proposed_by_user_id=v.seeker_user_id))
      THEN RAISE EXCEPTION 'invalid viewing proposal context'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.viewing_id,NEW.base_schedule_version,NEW.base_scheduled_start,NEW.proposed_start,NEW.proposed_end,
    NEW.display_timezone,NEW.proposed_by_user_id,NEW.proposed_by_side,NEW.membership_id,NEW.assignment_id,NEW.expires_at,NEW.created_at,NEW.policy_version)
    IS DISTINCT FROM ROW(OLD.id,OLD.viewing_id,OLD.base_schedule_version,OLD.base_scheduled_start,OLD.proposed_start,OLD.proposed_end,
    OLD.display_timezone,OLD.proposed_by_user_id,OLD.proposed_by_side,OLD.membership_id,OLD.assignment_id,OLD.expires_at,OLD.created_at,OLD.policy_version)
    OR OLD.state<>'PENDING' OR NEW.version<>OLD.version+1
    OR (OLD.seeker_approved AND NOT NEW.seeker_approved) OR (OLD.provider_approved AND NOT NEW.provider_approved)
    THEN RAISE EXCEPTION 'invalid viewing proposal transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER viewing_proposal_guard BEFORE INSERT OR UPDATE OR DELETE ON viewing_reschedule_proposals FOR EACH ROW EXECUTE FUNCTION viewing_proposal_guard();
ALTER TABLE viewing_command_receipts ADD COLUMN proposal_id uuid REFERENCES viewing_reschedule_proposals(id);
ALTER TABLE viewing_command_receipts DROP CONSTRAINT viewing_command_receipts_operation_check;
ALTER TABLE viewing_command_receipts ADD CONSTRAINT viewing_command_receipts_operation_check CHECK (operation IN
  ('CREATE','ACCEPT','DECLINE','CONFIRM','CANCEL','PROPOSE_RESCHEDULE','ACCEPT_RESCHEDULE','REJECT_RESCHEDULE','WITHDRAW_RESCHEDULE'));
ALTER TABLE viewing_events DROP CONSTRAINT viewing_events_event_type_check;
ALTER TABLE viewing_events ADD CONSTRAINT viewing_events_event_type_check CHECK (event_type IN
  ('viewing_requested','viewing_accepted','viewing_declined','viewing_confirmed','viewing_scheduled','viewing_cancelled','viewing_expired',
   'viewing_reschedule_proposed','viewing_reschedule_accepted','viewing_reschedule_rejected','viewing_reschedule_withdrawn',
   'viewing_reschedule_expired','viewing_reschedule_invalidated','viewing_rescheduled','viewing_reschedule_finalized'));
ALTER TABLE viewing_scheduled_actions ADD COLUMN proposal_id uuid REFERENCES viewing_reschedule_proposals(id);
ALTER TABLE viewing_scheduled_actions ADD COLUMN reason_code text;
ALTER TABLE viewing_scheduled_actions ADD COLUMN last_checked_at timestamptz;
ALTER TABLE viewing_scheduled_actions DROP CONSTRAINT viewing_scheduled_actions_viewing_id_key;
ALTER TABLE viewing_scheduled_actions DROP CONSTRAINT viewing_scheduled_actions_action_type_check;
ALTER TABLE viewing_scheduled_actions ADD CONSTRAINT viewing_scheduled_actions_action_type_check CHECK
  (action_type IN ('EXPIRE_REQUEST','EXPIRE_RESCHEDULE','REMINDER_24H','REMINDER_2H'));
ALTER TABLE viewing_scheduled_actions ADD CONSTRAINT viewing_action_proposal_target CHECK
  ((action_type='EXPIRE_RESCHEDULE')=(proposal_id IS NOT NULL));
CREATE UNIQUE INDEX viewing_request_expiry_unique ON viewing_scheduled_actions(viewing_id) WHERE action_type='EXPIRE_REQUEST';
CREATE UNIQUE INDEX viewing_proposal_expiry_unique ON viewing_scheduled_actions(proposal_id) WHERE action_type='EXPIRE_RESCHEDULE';
CREATE UNIQUE INDEX viewing_reminder_unique ON viewing_scheduled_actions(viewing_id,action_type,expected_schedule_version) WHERE action_type IN ('REMINDER_24H','REMINDER_2H');
CREATE TABLE viewing_reminder_plans (
  viewing_id uuid NOT NULL REFERENCES viewings(id),
  schedule_version integer NOT NULL CHECK (schedule_version>0),
  status text NOT NULL CHECK (status IN ('PLANNED','SUPPRESSED')),
  planned_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(viewing_id,schedule_version)
);
CREATE TRIGGER viewing_reminder_plans_immutable BEFORE UPDATE OR DELETE ON viewing_reminder_plans FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
-- A notice targets the stable business recipient, never an historical agent.
CREATE TABLE viewing_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewing_id uuid NOT NULL REFERENCES viewings(id),
  source_outbox_id uuid REFERENCES viewing_outbox(id),
  source_action_id uuid REFERENCES viewing_scheduled_actions(id),
  recipient_side text NOT NULL CHECK (recipient_side IN ('SEEKER','PROVIDER')),
  seeker_user_id uuid REFERENCES users(id),
  provider_account_id uuid REFERENCES provider_accounts(id),
  event_type text NOT NULL CHECK (event_type IN
    ('viewing_requested','viewing_accepted','viewing_declined','viewing_confirmed','viewing_scheduled','viewing_cancelled','viewing_expired',
     'viewing_reschedule_proposed','viewing_reschedule_accepted','viewing_reschedule_rejected','viewing_reschedule_withdrawn',
     'viewing_reschedule_expired','viewing_reschedule_invalidated','viewing_rescheduled','viewing_reschedule_finalized',
     'viewing_reminder_24h','viewing_reminder_2h')),
  schedule_version integer NOT NULL CHECK (schedule_version>0),
  event_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  inbox_state text NOT NULL DEFAULT 'AVAILABLE' CHECK (inbox_state='AVAILABLE'),
  external_state text NOT NULL DEFAULT 'NOT_ENABLED' CHECK (external_state='NOT_ENABLED'),
  CHECK ((source_outbox_id IS NULL)<>(source_action_id IS NULL)),
  CHECK ((recipient_side='SEEKER')=(seeker_user_id IS NOT NULL)),
  CHECK ((recipient_side='PROVIDER')=(provider_account_id IS NOT NULL)),
  UNIQUE(source_outbox_id,recipient_side),
  UNIQUE(source_action_id,recipient_side)
);
CREATE INDEX viewing_notices_page ON viewing_notices(viewing_id,id DESC);
CREATE INDEX viewing_notices_seeker_page ON viewing_notices(seeker_user_id,id DESC);
CREATE INDEX viewing_notices_provider_page ON viewing_notices(provider_account_id,id DESC);
CREATE TRIGGER viewing_notices_immutable BEFORE UPDATE OR DELETE ON viewing_notices FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE TABLE viewing_notice_reads (
  notice_id uuid NOT NULL REFERENCES viewing_notices(id),
  user_id uuid NOT NULL REFERENCES users(id),
  read_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(notice_id,user_id)
);
CREATE TRIGGER viewing_notice_reads_immutable BEFORE UPDATE OR DELETE ON viewing_notice_reads FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE FUNCTION viewing_outbox_notices() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO viewing_notices(viewing_id,source_outbox_id,recipient_side,seeker_user_id,provider_account_id,event_type,schedule_version,event_at)
    SELECT v.id,NEW.id,s.side,CASE WHEN s.side='SEEKER' THEN v.seeker_user_id END,
      CASE WHEN s.side='PROVIDER' THEN v.provider_account_id END,NEW.event_type,e.schedule_version,e.created_at
    FROM viewings v JOIN viewing_events e ON e.id=NEW.event_id CROSS JOIN (VALUES ('SEEKER'),('PROVIDER')) s(side)
    WHERE v.id=NEW.viewing_id;
  RETURN NEW;
END $$;
CREATE TRIGGER viewing_outbox_notices AFTER INSERT ON viewing_outbox FOR EACH ROW EXECUTE FUNCTION viewing_outbox_notices();
-- The only new schedule mutation is a jointly approved, retained replacement.
CREATE OR REPLACE FUNCTION viewing_episode_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE replacement boolean;
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
  replacement := OLD.state='SCHEDULED' AND NEW.state='RESCHEDULED' AND NEW.schedule_version=OLD.schedule_version+1
    AND EXISTS (SELECT 1 FROM viewing_schedule_history h JOIN viewing_reschedule_proposals p ON p.id=h.superseded_by_proposal_id
      WHERE h.viewing_id=OLD.id AND h.schedule_version=OLD.schedule_version AND h.scheduled_start=OLD.scheduled_start
        AND h.scheduled_end=OLD.scheduled_end AND h.display_timezone=OLD.display_timezone
        AND p.viewing_id=OLD.id AND p.base_schedule_version=OLD.schedule_version AND p.state='FINALIZED'
        AND p.seeker_approved AND p.provider_approved AND p.proposed_start=NEW.scheduled_start AND p.proposed_end=NEW.scheduled_end
        AND p.expires_at>statement_timestamp() AND p.base_scheduled_start>statement_timestamp() AND p.proposed_start>statement_timestamp());
  IF ROW(NEW.id,NEW.interaction_id,NEW.listing_id,NEW.provider_account_id,NEW.seeker_user_id,NEW.requested_by_user_id,
    NEW.proposed_start,NEW.proposed_end,NEW.display_timezone,NEW.response_deadline,NEW.created_at,NEW.policy_version)
    IS DISTINCT FROM ROW(OLD.id,OLD.interaction_id,OLD.listing_id,OLD.provider_account_id,OLD.seeker_user_id,OLD.requested_by_user_id,
    OLD.proposed_start,OLD.proposed_end,OLD.display_timezone,OLD.response_deadline,OLD.created_at,OLD.policy_version)
    OR NEW.version<>OLD.version+1 OR (NEW.schedule_version<>OLD.schedule_version AND NOT replacement)
    OR OLD.state NOT IN ('REQUESTED','ACCEPTED','SCHEDULED','RESCHEDULED')
    OR (OLD.state='REQUESTED' AND NEW.state NOT IN ('ACCEPTED','DECLINED','EXPIRED','CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER'))
    OR (OLD.state='ACCEPTED' AND NEW.state NOT IN ('ACCEPTED','SCHEDULED','CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER'))
    OR (OLD.state='SCHEDULED' AND NEW.state NOT IN ('SCHEDULED','CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER') AND NOT replacement)
    OR (OLD.state='RESCHEDULED' AND NEW.state<>'SCHEDULED')
    THEN RAISE EXCEPTION 'invalid viewing transition'; END IF;
  IF OLD.accepted_at IS NOT NULL AND ROW(NEW.accepted_by_user_id,NEW.accepted_membership_id,NEW.accepted_assignment_id,NEW.accepted_at,NEW.private_instructions)
    IS DISTINCT FROM ROW(OLD.accepted_by_user_id,OLD.accepted_membership_id,OLD.accepted_assignment_id,OLD.accepted_at,OLD.private_instructions)
    THEN RAISE EXCEPTION 'accepted attribution and instructions are immutable'; END IF;
  IF OLD.accepted_at IS NOT NULL AND ROW(NEW.scheduled_start,NEW.scheduled_end) IS DISTINCT FROM ROW(OLD.scheduled_start,OLD.scheduled_end) AND NOT replacement
    THEN RAISE EXCEPTION 'schedule replacement requires joint approval'; END IF;
  IF (OLD.seeker_confirmed AND NOT NEW.seeker_confirmed) OR (OLD.provider_confirmed AND NOT NEW.provider_confirmed)
    THEN RAISE EXCEPTION 'confirmations are retained'; END IF;
  RETURN NEW;
END $$;
-- Keep cancellation/schedule invariants even when a compatible F1 writer is used.
CREATE FUNCTION viewing_appointment_work_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state NOT IN ('SCHEDULED','RESCHEDULED') OR NEW.schedule_version<>OLD.schedule_version THEN
    UPDATE viewing_scheduled_actions SET state='SKIPPED',reason_code='AGGREGATE_CHANGED',lease_token=NULL,lease_until=NULL,processed_at=statement_timestamp()
      WHERE viewing_id=NEW.id AND state IN ('PENDING','LEASED')
        AND (NEW.state NOT IN ('SCHEDULED','RESCHEDULED') OR expected_schedule_version<>NEW.schedule_version);
    UPDATE viewing_reschedule_proposals SET state='INVALIDATED',version=version+1,updated_at=statement_timestamp()
      WHERE viewing_id=NEW.id AND state='PENDING'
        AND (NEW.state NOT IN ('SCHEDULED','RESCHEDULED') OR base_schedule_version<>NEW.schedule_version);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER viewing_appointment_work_invalidation AFTER UPDATE ON viewings FOR EACH ROW EXECUTE FUNCTION viewing_appointment_work_invalidation();
