-- Attendance extends the retained exact-schedule Viewing aggregate. No legacy rows change.
CREATE TABLE viewing_attendance_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewing_id uuid NOT NULL REFERENCES viewings(id),
  schedule_version integer NOT NULL CHECK(schedule_version>0),
  state text NOT NULL DEFAULT 'AWAITING_VALIDATION' CHECK(state IN ('AWAITING_VALIDATION','COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW','DISPUTED')),
  claimed_outcome text NOT NULL CHECK(claimed_outcome IN ('COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW')),
  primary_claim_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  finalized_at timestamptz,
  validation_method text CHECK(validation_method IN ('COUNTERPARTY_CONFIRMED','UNCONTESTED_WINDOW')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  policy_version text NOT NULL DEFAULT 'viewing-attendance-v1' CHECK(policy_version='viewing-attendance-v1'),
  UNIQUE(viewing_id,schedule_version),
  CHECK((finalized_at IS NULL)=(validation_method IS NULL)),
  CHECK(state IN ('AWAITING_VALIDATION','DISPUTED') OR finalized_at IS NOT NULL),
  CHECK(state NOT IN ('COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW') OR state=claimed_outcome)
);
CREATE TABLE viewing_attendance_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewing_id uuid NOT NULL REFERENCES viewings(id),
  schedule_version integer NOT NULL CHECK(schedule_version>0),
  claimant_user_id uuid NOT NULL REFERENCES users(id),
  claimant_side text NOT NULL CHECK(claimant_side IN ('SEEKER','PROVIDER')),
  membership_id uuid REFERENCES organization_memberships(id),
  assignment_id uuid REFERENCES organization_resource_assignments(id),
  claim_type text NOT NULL CHECK(claim_type IN ('COMPLETION','NO_SHOW')),
  claimed_outcome text NOT NULL CHECK(claimed_outcome IN ('COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW')),
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','CONFIRMED','FINALIZED','DISPUTED')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  claimed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  counterparty_notice_id uuid NOT NULL UNIQUE REFERENCES viewing_notices(id),
  notice_available_at timestamptz NOT NULL,
  response_deadline timestamptz NOT NULL,
  responded_by_user_id uuid REFERENCES users(id),
  responded_by_side text CHECK(responded_by_side IN ('SEEKER','PROVIDER')),
  responded_at timestamptz,
  finalized_at timestamptz,
  policy_version text NOT NULL DEFAULT 'viewing-attendance-v1' CHECK(policy_version='viewing-attendance-v1'),
  UNIQUE(viewing_id,schedule_version,claimant_side,claimed_outcome),
  CHECK((claim_type='COMPLETION')=(claimed_outcome='COMPLETED')),
  CHECK(claim_type<>'NO_SHOW' OR claimed_outcome=CASE claimant_side WHEN 'SEEKER' THEN 'PROVIDER_NO_SHOW' ELSE 'SEEKER_NO_SHOW' END),
  CHECK(response_deadline=notice_available_at+interval '48 hours'),
  CHECK((responded_at IS NULL)=(responded_by_user_id IS NULL)),
  CHECK((responded_at IS NULL)=(responded_by_side IS NULL)),
  CHECK(state NOT IN ('CONFIRMED','FINALIZED') OR finalized_at IS NOT NULL),
  CHECK(state<>'CONFIRMED' OR (responded_by_side<>claimant_side AND responded_by_user_id<>claimant_user_id))
);
ALTER TABLE viewing_attendance_outcomes ADD CONSTRAINT attendance_primary_claim_fk FOREIGN KEY(primary_claim_id) REFERENCES viewing_attendance_claims(id);
CREATE INDEX viewing_attendance_claims_page ON viewing_attendance_claims(viewing_id,id DESC);
-- Bounded case/report foundation. Evidence stays private; no staff decision/override exists in F3.
CREATE TABLE viewing_attendance_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_outcome_id uuid NOT NULL UNIQUE REFERENCES viewing_attendance_outcomes(id),
  viewing_id uuid NOT NULL REFERENCES viewings(id),
  schedule_version integer NOT NULL,
  category text NOT NULL DEFAULT 'VIEWING_ATTENDANCE' CHECK(category='VIEWING_ATTENDANCE'),
  target_type text NOT NULL DEFAULT 'Viewing' CHECK(target_type='Viewing'),
  severity text NOT NULL DEFAULT 'LOW' CHECK(severity='LOW'),
  state text NOT NULL DEFAULT 'OPEN' CHECK(state='OPEN'),
  review_status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(review_status='PENDING_REVIEW'),
  opened_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  policy_version text NOT NULL DEFAULT 'viewing-attendance-v1' CHECK(policy_version='viewing-attendance-v1')
);
CREATE TABLE viewing_attendance_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES viewing_attendance_cases(id),
  claim_id uuid NOT NULL REFERENCES viewing_attendance_claims(id),
  reporter_user_id uuid NOT NULL REFERENCES users(id),
  reporter_side text NOT NULL CHECK(reporter_side IN ('SEEKER','PROVIDER')),
  reason_code text NOT NULL CHECK(reason_code IN ('COMPETING_CLAIMS','DID_NOT_ATTEND','OUTCOME_INCORRECT','SAFETY','OTHER')),
  state text NOT NULL DEFAULT 'SUBMITTED' CHECK(state='SUBMITTED'),
  -- Opaque metadata only. Attachment authorization and staff resolution are deferred.
  evidence_metadata jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(evidence_metadata)='array' AND jsonb_array_length(evidence_metadata)<=5),
  submitted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(case_id,claim_id,reporter_user_id)
);
CREATE TRIGGER attendance_cases_immutable BEFORE UPDATE OR DELETE ON viewing_attendance_cases FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE TRIGGER attendance_reports_immutable BEFORE UPDATE OR DELETE ON viewing_attendance_reports FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE TABLE viewing_no_show_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_outcome_id uuid NOT NULL UNIQUE REFERENCES viewing_attendance_outcomes(id),
  viewing_id uuid NOT NULL REFERENCES viewings(id),
  schedule_version integer NOT NULL,
  responsible_side text NOT NULL CHECK(responsible_side IN ('SEEKER','PROVIDER')),
  validation_method text NOT NULL CHECK(validation_method IN ('COUNTERPARTY_CONFIRMED','UNCONTESTED_WINDOW')),
  resolved_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  invalidated_at timestamptz,
  invalidation_case_id uuid REFERENCES viewing_attendance_cases(id),
  CHECK((invalidated_at IS NULL)=(invalidation_case_id IS NULL)),
  UNIQUE(viewing_id,schedule_version)
);
-- This is an eligibility boundary, not review submission or reputation implementation.
CREATE TABLE viewing_review_boundaries (
  interaction_id uuid PRIMARY KEY REFERENCES interactions(id),
  attendance_outcome_id uuid NOT NULL UNIQUE REFERENCES viewing_attendance_outcomes(id),
  viewing_id uuid NOT NULL UNIQUE REFERENCES viewings(id),
  seeker_user_id uuid NOT NULL REFERENCES users(id),
  provider_account_id uuid NOT NULL REFERENCES provider_accounts(id),
  organization_id uuid REFERENCES organizations(id),
  membership_snapshot jsonb NOT NULL CHECK(jsonb_typeof(membership_snapshot)='array'),
  eligibility_state text NOT NULL CHECK(eligibility_state IN ('OPEN','HELD')),
  eligibility_reason text NOT NULL CHECK(eligibility_reason IN ('FIRST_VALIDATED_COMPLETION','OWN_ORGANIZATION','MEMBERSHIP_EVIDENCE_INCOMPLETE')),
  opened_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  policy_version text NOT NULL DEFAULT 'bilateral-review-v1' CHECK(policy_version='bilateral-review-v1')
);
CREATE TABLE viewing_review_eligibilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id uuid NOT NULL REFERENCES viewing_review_boundaries(interaction_id),
  viewing_id uuid NOT NULL REFERENCES viewings(id),
  direction text NOT NULL CHECK(direction IN ('SEEKER_TO_PROVIDER','PROVIDER_TO_SEEKER')),
  reviewer_subject_type text NOT NULL CHECK(reviewer_subject_type IN ('User','ProviderAccount')),
  reviewer_subject_id uuid NOT NULL,
  target_type text NOT NULL CHECK(target_type IN ('User','ProviderAccount')),
  target_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','HELD','CONSUMED','EXPIRED','REVOKED')),
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  consumed_at timestamptz,
  policy_version text NOT NULL DEFAULT 'bilateral-review-v1' CHECK(policy_version='bilateral-review-v1'),
  CHECK(closes_at=opens_at+interval '14 days'),
  CHECK((direction='SEEKER_TO_PROVIDER')=(reviewer_subject_type='User' AND target_type='ProviderAccount')),
  CHECK((direction='PROVIDER_TO_SEEKER')=(reviewer_subject_type='ProviderAccount' AND target_type='User')),
  UNIQUE(interaction_id,direction),
  UNIQUE(viewing_id,reviewer_subject_type,reviewer_subject_id,target_type,target_id,direction)
);
CREATE TRIGGER review_boundaries_immutable BEFORE UPDATE OR DELETE ON viewing_review_boundaries FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
ALTER TABLE viewing_command_receipts ADD COLUMN attendance_claim_id uuid REFERENCES viewing_attendance_claims(id);
ALTER TABLE viewing_command_receipts DROP CONSTRAINT viewing_command_receipts_operation_check;
ALTER TABLE viewing_command_receipts ADD CONSTRAINT viewing_command_receipts_operation_check CHECK(operation IN
 ('CREATE','ACCEPT','DECLINE','CONFIRM','CANCEL','PROPOSE_RESCHEDULE','ACCEPT_RESCHEDULE','REJECT_RESCHEDULE','WITHDRAW_RESCHEDULE','CLAIM_ATTENDANCE','CONFIRM_ATTENDANCE','DISPUTE_ATTENDANCE'));
ALTER TABLE viewing_events DROP CONSTRAINT viewing_events_event_type_check;
ALTER TABLE viewing_events ADD CONSTRAINT viewing_events_event_type_check CHECK(event_type IN
 ('viewing_requested','viewing_accepted','viewing_declined','viewing_confirmed','viewing_scheduled','viewing_cancelled','viewing_expired',
 'viewing_reschedule_proposed','viewing_reschedule_accepted','viewing_reschedule_rejected','viewing_reschedule_withdrawn','viewing_reschedule_expired','viewing_reschedule_invalidated','viewing_rescheduled','viewing_reschedule_finalized',
 'viewing_completion_claimed','viewing_no_show_claimed','viewing_attendance_confirmed','viewing_attendance_disputed','viewing_attendance_finalized'));
ALTER TABLE viewing_notices DROP CONSTRAINT viewing_notices_event_type_check;
ALTER TABLE viewing_notices ADD CONSTRAINT viewing_notices_event_type_check CHECK(event_type IN
 ('viewing_requested','viewing_accepted','viewing_declined','viewing_confirmed','viewing_scheduled','viewing_cancelled','viewing_expired',
 'viewing_reschedule_proposed','viewing_reschedule_accepted','viewing_reschedule_rejected','viewing_reschedule_withdrawn','viewing_reschedule_expired','viewing_reschedule_invalidated','viewing_rescheduled','viewing_reschedule_finalized','viewing_reminder_24h','viewing_reminder_2h',
 'viewing_completion_claimed','viewing_no_show_claimed','viewing_attendance_confirmed','viewing_attendance_disputed','viewing_attendance_finalized'));
ALTER TABLE viewing_scheduled_actions ADD COLUMN attendance_claim_id uuid REFERENCES viewing_attendance_claims(id);
ALTER TABLE viewing_scheduled_actions DROP CONSTRAINT viewing_scheduled_actions_action_type_check;
ALTER TABLE viewing_scheduled_actions ADD CONSTRAINT viewing_scheduled_actions_action_type_check CHECK(action_type IN
 ('EXPIRE_REQUEST','EXPIRE_RESCHEDULE','REMINDER_24H','REMINDER_2H','FINALIZE_ATTENDANCE'));
ALTER TABLE viewing_scheduled_actions ADD CONSTRAINT viewing_action_attendance_target CHECK((action_type='FINALIZE_ATTENDANCE')=(attendance_claim_id IS NOT NULL));
CREATE UNIQUE INDEX viewing_attendance_finalization_unique ON viewing_scheduled_actions(attendance_claim_id) WHERE action_type='FINALIZE_ATTENDANCE';

CREATE FUNCTION viewing_attendance_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'attendance claims are retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'PENDING' OR NEW.version<>1 OR NOT EXISTS(
   SELECT 1 FROM viewings v JOIN viewing_notices n ON n.id=NEW.counterparty_notice_id
   JOIN provider_accounts pa ON pa.id=v.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
   WHERE v.id=NEW.viewing_id AND v.schedule_version=NEW.schedule_version AND v.state='SCHEDULED' AND v.seeker_confirmed AND v.provider_confirmed
   AND n.viewing_id=v.id AND n.schedule_version=v.schedule_version AND n.available_at=NEW.notice_available_at
   AND n.recipient_side<>NEW.claimant_side AND n.event_type=CASE NEW.claim_type WHEN 'COMPLETION' THEN 'viewing_completion_claimed' ELSE 'viewing_no_show_claimed' END
   AND ((NEW.claimant_side='SEEKER' AND NEW.claimant_user_id=v.seeker_user_id) OR
    (NEW.claimant_side='PROVIDER' AND ((pa.kind='INDIVIDUAL' AND pp.user_id=NEW.claimant_user_id) OR
     (pa.kind='ORGANIZATION' AND EXISTS(SELECT 1 FROM organization_memberships m WHERE m.id=NEW.membership_id AND m.organization_id=pa.organization_id AND m.user_id=NEW.claimant_user_id)))))
   AND CASE NEW.claim_type WHEN 'COMPLETION' THEN v.scheduled_end<=NEW.claimed_at ELSE v.scheduled_start+interval '30 minutes'<=NEW.claimed_at END)
   THEN RAISE EXCEPTION 'invalid attendance claim context'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.viewing_id,NEW.schedule_version,NEW.claimant_user_id,NEW.claimant_side,NEW.membership_id,NEW.assignment_id,NEW.claim_type,NEW.claimed_outcome,NEW.claimed_at,NEW.counterparty_notice_id,NEW.notice_available_at,NEW.response_deadline,NEW.policy_version)
  IS DISTINCT FROM ROW(OLD.id,OLD.viewing_id,OLD.schedule_version,OLD.claimant_user_id,OLD.claimant_side,OLD.membership_id,OLD.assignment_id,OLD.claim_type,OLD.claimed_outcome,OLD.claimed_at,OLD.counterparty_notice_id,OLD.notice_available_at,OLD.response_deadline,OLD.policy_version)
  OR NEW.version<>OLD.version+1 OR OLD.state='DISPUTED' OR NEW.state='PENDING'
  OR (OLD.state IN ('CONFIRMED','FINALIZED') AND NEW.state<>'DISPUTED')
  OR (OLD.responded_at IS NOT NULL AND ROW(NEW.responded_at,NEW.responded_by_user_id,NEW.responded_by_side) IS DISTINCT FROM ROW(OLD.responded_at,OLD.responded_by_user_id,OLD.responded_by_side))
  OR (OLD.finalized_at IS NOT NULL AND NEW.finalized_at IS DISTINCT FROM OLD.finalized_at)
  OR (NEW.state='FINALIZED' AND (NEW.response_deadline>statement_timestamp() OR NEW.finalized_at<NEW.response_deadline))
  OR (NEW.state IN ('CONFIRMED','FINALIZED') AND EXISTS(SELECT 1 FROM viewing_attendance_claims c WHERE c.viewing_id=NEW.viewing_id AND c.schedule_version=NEW.schedule_version AND c.id<>NEW.id AND c.claimed_outcome<>NEW.claimed_outcome))
  OR (NEW.state='CONFIRMED' AND NOT EXISTS(SELECT 1 FROM viewings v JOIN provider_accounts pa ON pa.id=v.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
    WHERE v.id=NEW.viewing_id AND v.schedule_version=NEW.schedule_version AND
    ((NEW.responded_by_side='SEEKER' AND NEW.responded_by_user_id=v.seeker_user_id) OR (NEW.responded_by_side='PROVIDER' AND
     ((pa.kind='INDIVIDUAL' AND pp.user_id=NEW.responded_by_user_id) OR (pa.kind='ORGANIZATION' AND EXISTS(SELECT 1 FROM organization_memberships m WHERE m.organization_id=pa.organization_id AND m.user_id=NEW.responded_by_user_id)))))))
  THEN RAISE EXCEPTION 'invalid attendance claim transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER viewing_attendance_claim_guard BEFORE INSERT OR UPDATE OR DELETE ON viewing_attendance_claims FOR EACH ROW EXECUTE FUNCTION viewing_attendance_claim_guard();
CREATE FUNCTION viewing_attendance_outcome_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'attendance outcomes are retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'AWAITING_VALIDATION' OR NEW.version<>1 OR NOT EXISTS(SELECT 1 FROM viewing_attendance_claims c WHERE c.id=NEW.primary_claim_id AND c.viewing_id=NEW.viewing_id AND c.schedule_version=NEW.schedule_version AND c.claimed_outcome=NEW.claimed_outcome AND c.state='PENDING')
   THEN RAISE EXCEPTION 'invalid attendance outcome context'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.viewing_id,NEW.schedule_version,NEW.claimed_outcome,NEW.primary_claim_id,NEW.created_at,NEW.policy_version)
  IS DISTINCT FROM ROW(OLD.id,OLD.viewing_id,OLD.schedule_version,OLD.claimed_outcome,OLD.primary_claim_id,OLD.created_at,OLD.policy_version)
  OR NEW.version<>OLD.version+1 OR OLD.state='DISPUTED'
  OR (OLD.state<>'AWAITING_VALIDATION' AND NEW.state<>'DISPUTED')
  OR (OLD.finalized_at IS NOT NULL AND ROW(NEW.finalized_at,NEW.validation_method) IS DISTINCT FROM ROW(OLD.finalized_at,OLD.validation_method))
  OR (NEW.state='DISPUTED' AND NOT EXISTS(SELECT 1 FROM viewing_attendance_cases c WHERE c.attendance_outcome_id=NEW.id))
  OR (NEW.state IN ('COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW') AND NOT EXISTS(
   SELECT 1 FROM viewing_attendance_claims c WHERE c.id=NEW.primary_claim_id AND c.claimed_outcome=NEW.state
    AND ((NEW.validation_method='COUNTERPARTY_CONFIRMED' AND c.state='CONFIRMED')
      OR (NEW.validation_method='UNCONTESTED_WINDOW' AND c.state='FINALIZED' AND c.response_deadline<=statement_timestamp()))))
  THEN RAISE EXCEPTION 'invalid attendance outcome transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER viewing_attendance_outcome_guard BEFORE INSERT OR UPDATE OR DELETE ON viewing_attendance_outcomes FOR EACH ROW EXECUTE FUNCTION viewing_attendance_outcome_guard();
CREATE FUNCTION viewing_no_show_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'no-show history is retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM viewing_attendance_outcomes a WHERE a.id=NEW.attendance_outcome_id AND a.viewing_id=NEW.viewing_id AND a.schedule_version=NEW.schedule_version AND a.state=NEW.responsible_side||'_NO_SHOW' AND a.validation_method=NEW.validation_method)
   THEN RAISE EXCEPTION 'invalid validated no-show'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.attendance_outcome_id,NEW.viewing_id,NEW.schedule_version,NEW.responsible_side,NEW.validation_method,NEW.resolved_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.attendance_outcome_id,OLD.viewing_id,OLD.schedule_version,OLD.responsible_side,OLD.validation_method,OLD.resolved_at)
  OR OLD.invalidated_at IS NOT NULL OR NEW.invalidated_at IS NULL
  OR NOT EXISTS(SELECT 1 FROM viewing_attendance_cases c WHERE c.id=NEW.invalidation_case_id AND c.attendance_outcome_id=NEW.attendance_outcome_id)
  THEN RAISE EXCEPTION 'invalid no-show invalidation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER viewing_no_show_guard BEFORE INSERT OR UPDATE OR DELETE ON viewing_no_show_events FOR EACH ROW EXECUTE FUNCTION viewing_no_show_guard();
CREATE FUNCTION viewing_review_eligibility_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'review eligibility is retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'OPEN' OR NOT EXISTS(SELECT 1 FROM viewing_review_boundaries b JOIN viewing_attendance_outcomes a ON a.id=b.attendance_outcome_id
    WHERE b.interaction_id=NEW.interaction_id AND b.viewing_id=NEW.viewing_id AND b.eligibility_state='OPEN' AND a.state='COMPLETED'
    AND ((NEW.direction='SEEKER_TO_PROVIDER' AND NEW.reviewer_subject_id=b.seeker_user_id AND NEW.target_id=b.provider_account_id)
      OR (NEW.direction='PROVIDER_TO_SEEKER' AND NEW.reviewer_subject_id=b.provider_account_id AND NEW.target_id=b.seeker_user_id)))
   THEN RAISE EXCEPTION 'invalid review eligibility context'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.interaction_id,NEW.viewing_id,NEW.direction,NEW.reviewer_subject_type,NEW.reviewer_subject_id,NEW.target_type,NEW.target_id,NEW.opens_at,NEW.closes_at,NEW.consumed_at,NEW.policy_version)
  IS DISTINCT FROM ROW(OLD.id,OLD.interaction_id,OLD.viewing_id,OLD.direction,OLD.reviewer_subject_type,OLD.reviewer_subject_id,OLD.target_type,OLD.target_id,OLD.opens_at,OLD.closes_at,OLD.consumed_at,OLD.policy_version)
  OR OLD.state<>'OPEN' OR NEW.state<>'HELD'
  OR NOT EXISTS(SELECT 1 FROM viewing_review_boundaries b JOIN viewing_attendance_outcomes a ON a.id=b.attendance_outcome_id WHERE b.interaction_id=NEW.interaction_id AND a.state='DISPUTED')
  THEN RAISE EXCEPTION 'review lifecycle beyond dispute hold is deferred'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER viewing_review_eligibility_guard BEFORE INSERT OR UPDATE OR DELETE ON viewing_review_eligibilities FOR EACH ROW EXECUTE FUNCTION viewing_review_eligibility_guard();

-- Only a persisted validated or disputed attendance outcome allows a terminal transition.
CREATE OR REPLACE FUNCTION viewing_episode_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE replacement boolean; attendance boolean;
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
  attendance := OLD.state IN ('SCHEDULED','COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW')
    AND NEW.schedule_version=OLD.schedule_version
    AND NEW.state IN ('COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW','DISPUTED')
    AND EXISTS(SELECT 1 FROM viewing_attendance_outcomes a WHERE a.viewing_id=OLD.id AND a.schedule_version=OLD.schedule_version AND a.state=NEW.state);
  IF EXISTS(SELECT 1 FROM viewing_attendance_claims c WHERE c.viewing_id=OLD.id AND c.schedule_version=OLD.schedule_version)
    AND (replacement OR NEW.state IN ('CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER')) THEN RAISE EXCEPTION 'attendance claim prevents cancellation or rescheduling'; END IF;
  IF ROW(NEW.id,NEW.interaction_id,NEW.listing_id,NEW.provider_account_id,NEW.seeker_user_id,NEW.requested_by_user_id,
    NEW.proposed_start,NEW.proposed_end,NEW.display_timezone,NEW.response_deadline,NEW.created_at,NEW.policy_version)
    IS DISTINCT FROM ROW(OLD.id,OLD.interaction_id,OLD.listing_id,OLD.provider_account_id,OLD.seeker_user_id,OLD.requested_by_user_id,
    OLD.proposed_start,OLD.proposed_end,OLD.display_timezone,OLD.response_deadline,OLD.created_at,OLD.policy_version)
    OR NEW.version<>OLD.version+1 OR (NEW.schedule_version<>OLD.schedule_version AND NOT replacement)
    OR (OLD.state NOT IN ('REQUESTED','ACCEPTED','SCHEDULED','RESCHEDULED') AND NOT attendance)
    OR (OLD.state='REQUESTED' AND NEW.state NOT IN ('ACCEPTED','DECLINED','EXPIRED','CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER'))
    OR (OLD.state='ACCEPTED' AND NEW.state NOT IN ('ACCEPTED','SCHEDULED','CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER'))
    OR (OLD.state='SCHEDULED' AND NEW.state NOT IN ('SCHEDULED','CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER') AND NOT replacement AND NOT attendance)
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

-- Independent foreign keys cannot establish cross-row business context.
CREATE FUNCTION viewing_attendance_case_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM viewing_attendance_outcomes a WHERE a.id=NEW.attendance_outcome_id AND a.viewing_id=NEW.viewing_id AND a.schedule_version=NEW.schedule_version)
  THEN RAISE EXCEPTION 'invalid attendance case context'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER viewing_attendance_case_context BEFORE INSERT ON viewing_attendance_cases FOR EACH ROW EXECUTE FUNCTION viewing_attendance_case_context();
CREATE FUNCTION viewing_attendance_report_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM viewing_attendance_cases k JOIN viewing_attendance_claims c ON c.viewing_id=k.viewing_id AND c.schedule_version=k.schedule_version
  JOIN viewings v ON v.id=k.viewing_id JOIN provider_accounts pa ON pa.id=v.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
  WHERE k.id=NEW.case_id AND c.id=NEW.claim_id AND
   ((NEW.reporter_side='SEEKER' AND NEW.reporter_user_id=v.seeker_user_id) OR (NEW.reporter_side='PROVIDER' AND
     ((pa.kind='INDIVIDUAL' AND pp.user_id=NEW.reporter_user_id) OR (pa.kind='ORGANIZATION' AND EXISTS(SELECT 1 FROM organization_memberships m WHERE m.organization_id=pa.organization_id AND m.user_id=NEW.reporter_user_id))))))
  THEN RAISE EXCEPTION 'invalid attendance report context'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.evidence_metadata) item WHERE jsonb_typeof(item)<>'object'
   OR item - ARRAY['kind','reference']<>'{}'::jsonb OR item->>'kind' IS DISTINCT FROM 'MESSAGE' OR item->>'reference' IS NULL
   OR NOT EXISTS(SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id JOIN viewing_attendance_cases k ON k.id=NEW.case_id JOIN viewings v ON v.id=k.viewing_id
     WHERE m.id::text=item->>'reference' AND cv.interaction_id=v.interaction_id))
  THEN RAISE EXCEPTION 'invalid attendance evidence context'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER viewing_attendance_report_context BEFORE INSERT ON viewing_attendance_reports FOR EACH ROW EXECUTE FUNCTION viewing_attendance_report_context();
CREATE FUNCTION viewing_review_boundary_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM viewing_attendance_outcomes a JOIN viewings v ON v.id=a.viewing_id JOIN interactions i ON i.id=v.interaction_id JOIN provider_accounts pa ON pa.id=v.provider_account_id
  WHERE a.id=NEW.attendance_outcome_id AND a.state='COMPLETED' AND v.state='COMPLETED' AND a.schedule_version=v.schedule_version
   AND v.id=NEW.viewing_id AND i.id=NEW.interaction_id AND v.seeker_user_id=NEW.seeker_user_id AND v.provider_account_id=NEW.provider_account_id
   AND i.seeker_user_id=v.seeker_user_id AND i.listing_id=v.listing_id AND i.provider_account_id=v.provider_account_id
   AND pa.organization_id IS NOT DISTINCT FROM NEW.organization_id)
  THEN RAISE EXCEPTION 'invalid review boundary context'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER viewing_review_boundary_context BEFORE INSERT ON viewing_review_boundaries FOR EACH ROW EXECUTE FUNCTION viewing_review_boundary_context();

-- Attendance availability uses fresh database time after relation lock waits.
-- F2 event timestamps keep their established behavior.
CREATE OR REPLACE FUNCTION viewing_outbox_notices() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 LOCK TABLE viewing_notices IN ROW EXCLUSIVE MODE;
 INSERT INTO viewing_notices(viewing_id,source_outbox_id,recipient_side,seeker_user_id,provider_account_id,event_type,schedule_version,event_at,available_at)
  SELECT v.id,NEW.id,s.side,CASE WHEN s.side='SEEKER' THEN v.seeker_user_id END,
   CASE WHEN s.side='PROVIDER' THEN v.provider_account_id END,NEW.event_type,e.schedule_version,e.created_at,
   CASE WHEN NEW.event_type IN ('viewing_completion_claimed','viewing_no_show_claimed') THEN clock_timestamp() ELSE statement_timestamp() END
  FROM viewings v JOIN viewing_events e ON e.id=NEW.event_id CROSS JOIN (VALUES ('SEEKER'),('PROVIDER')) s(side)
  WHERE v.id=NEW.viewing_id;
 RETURN NEW;
END $$;
