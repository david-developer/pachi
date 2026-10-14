-- Original F3 claims, reports, cases and outcomes remain immutable history.
-- This companion workflow carries assigned staff decisions, never user confirmation.
CREATE TABLE attendance_case_workflows (
 case_id uuid PRIMARY KEY REFERENCES viewing_attendance_cases(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','TRIAGED','UNDER_REVIEW','RESOLVED')),
 assigned_staff_user_id uuid REFERENCES users(id),
 decision_id uuid,
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE attendance_adjudication_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES viewing_attendance_cases(id),
 command text NOT NULL CHECK(command IN ('ASSIGN','BEGIN_INVESTIGATION','DECIDE','RESOLVE_APPEAL')),
 purpose text NOT NULL DEFAULT 'ATTENDANCE_ADJUDICATION' CHECK(purpose='ATTENDANCE_ADJUDICATION'),
 actor_user_id uuid NOT NULL REFERENCES users(id), staff_session_id uuid NOT NULL REFERENCES staff_sessions(id),
 assigned_staff_user_id uuid NOT NULL REFERENCES users(id), case_version integer NOT NULL CHECK(case_version>1),
 before_state text NOT NULL, after_state text NOT NULL, before_case_state text NOT NULL, after_case_state text NOT NULL,
 outcome text CHECK(outcome IN ('COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW','CLAIM_INVALIDATED','INSUFFICIENT_EVIDENCE')),
 reason_code text NOT NULL CHECK(reason_code IN ('CASE_ASSIGNMENT','CASE_INVESTIGATION','ATTENDANCE_SUPPORTED','NO_SHOW_SUPPORTED','CONTRADICTORY_CLAIM','UNSUPPORTED_CLAIM','INSUFFICIENT_EVIDENCE')),
 reason_text text NOT NULL CHECK(char_length(reason_text) BETWEEN 10 AND 2000),
 evidence jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(evidence)='array' AND jsonb_array_length(evidence)<=5),
 original_action_id uuid REFERENCES attendance_adjudication_actions(id), appeal_id uuid,
 appeal_outcome text CHECK(appeal_outcome IN ('UPHELD','OVERTURNED','PARTIALLY_UPHELD')),
 review_mode text NOT NULL CHECK(review_mode IN ('INITIAL','INDEPENDENT_REVIEW','SOLE_OPERATOR_RECONSIDERATION')),
 policy_version text NOT NULL DEFAULT 'attendance-adjudication-v1' CHECK(policy_version='attendance-adjudication-v1'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(), appeal_deadline timestamptz,
 transaction_id bigint NOT NULL DEFAULT txid_current(), request_id uuid NOT NULL,
 idempotency_key uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
 UNIQUE(actor_user_id,idempotency_key), UNIQUE(case_id,case_version), UNIQUE(appeal_id),
 CHECK((command IN ('ASSIGN','BEGIN_INVESTIGATION'))=(outcome IS NULL)),
 CHECK((command='RESOLVE_APPEAL')=(appeal_id IS NOT NULL AND original_action_id IS NOT NULL AND appeal_outcome IS NOT NULL)),
 CHECK((command IN ('ASSIGN','BEGIN_INVESTIGATION'))=(appeal_deadline IS NULL)),
 CHECK(appeal_deadline IS NULL OR appeal_deadline=((created_at AT TIME ZONE 'UTC')+interval '30 days') AT TIME ZONE 'UTC')
);
ALTER TABLE attendance_case_workflows ADD CONSTRAINT attendance_workflow_decision_fk FOREIGN KEY(decision_id) REFERENCES attendance_adjudication_actions(id);
CREATE TABLE attendance_appeals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES viewing_attendance_cases(id),
 original_action_id uuid NOT NULL REFERENCES attendance_adjudication_actions(id),
 appellant_user_id uuid NOT NULL REFERENCES users(id), appellant_side text NOT NULL CHECK(appellant_side IN ('SEEKER','PROVIDER')),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 10 AND 2000),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array' AND jsonb_array_length(evidence)<=5),
 submitted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 idempotency_key uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
 UNIQUE(appellant_user_id,idempotency_key), UNIQUE(original_action_id,appellant_side)
);
ALTER TABLE attendance_adjudication_actions ADD CONSTRAINT attendance_action_appeal_fk FOREIGN KEY(appeal_id) REFERENCES attendance_appeals(id);
CREATE TRIGGER attendance_actions_immutable BEFORE UPDATE OR DELETE ON attendance_adjudication_actions FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE TRIGGER attendance_appeals_immutable BEFORE UPDATE OR DELETE ON attendance_appeals FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE FUNCTION attendance_workflow_prepare() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO attendance_case_workflows(case_id) VALUES(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER attendance_workflow_prepare AFTER INSERT ON viewing_attendance_cases FOR EACH ROW EXECUTE FUNCTION attendance_workflow_prepare();
INSERT INTO attendance_case_workflows(case_id) SELECT id FROM viewing_attendance_cases;
CREATE FUNCTION attendance_conflicted(actor uuid,target_case uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM viewing_attendance_cases c JOIN viewings v ON v.id=c.viewing_id
 JOIN listings l ON l.id=v.listing_id JOIN properties p ON p.id=l.property_id
 JOIN provider_accounts pa ON pa.id=v.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
 WHERE c.id=target_case AND (v.seeker_user_id=actor OR pp.user_id=actor OR l.created_by_user_id=actor OR p.created_by_user_id=actor
 OR EXISTS(SELECT 1 FROM organization_memberships m WHERE m.organization_id=pa.organization_id AND m.user_id=actor)
 OR EXISTS(SELECT 1 FROM viewing_attendance_claims cl WHERE cl.viewing_id=v.id AND cl.claimant_user_id=actor)
 OR EXISTS(SELECT 1 FROM viewing_attendance_reports r WHERE r.case_id=c.id AND r.reporter_user_id=actor)))
$$;
CREATE FUNCTION attendance_evidence_valid(target_case uuid,refs jsonb) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT jsonb_typeof(refs)='array' AND jsonb_array_length(refs)<=5 AND NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements(refs) item WHERE jsonb_typeof(item)<>'object' OR item-ARRAY['kind','reference']<>'{}'::jsonb
 OR item->>'kind' IS DISTINCT FROM 'MESSAGE' OR item->>'reference' IS NULL
 OR NOT EXISTS(SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
 JOIN viewings v ON v.interaction_id=cv.interaction_id JOIN viewing_attendance_cases c ON c.viewing_id=v.id
 WHERE c.id=target_case AND m.id::text=item->>'reference'))
$$;
CREATE FUNCTION attendance_other_reviewer(target_case uuid,original_actor uuid,staff_issuer text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN auth_identities i ON i.user_id=u.id AND i.unlinked_at IS NULL AND i.issuer=staff_issuer
 WHERE u.id<>original_actor AND u.account_state IN ('ACTIVE','PENDING_PHONE') AND NOT attendance_conflicted(u.id,target_case)
 AND review_moderation_permission(u.id,target_case,'moderation:act') AND review_moderation_permission(u.id,target_case,'appeal:resolve')
 AND review_moderation_permission(u.id,target_case,'evidence:read'))
$$;
CREATE FUNCTION attendance_action_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w attendance_case_workflows; c viewing_attendance_cases; v viewings; original attendance_adjudication_actions;
BEGIN
 SELECT * INTO w FROM attendance_case_workflows WHERE case_id=NEW.case_id;
 SELECT * INTO c FROM viewing_attendance_cases WHERE id=NEW.case_id;
 SELECT * INTO v FROM viewings WHERE id=c.viewing_id;
 IF w.case_id IS NULL OR c.id IS NULL OR NEW.case_version<>w.version+1 OR NEW.before_state<>v.state OR NEW.before_case_state<>w.state
 OR NEW.transaction_id<>txid_current() OR NEW.created_at<>statement_timestamp()
 OR attendance_conflicted(NEW.actor_user_id,c.id) OR NOT attendance_evidence_valid(c.id,NEW.evidence)
 OR NOT EXISTS(SELECT 1 FROM staff_sessions s JOIN users u ON u.id=s.user_id JOIN auth_identities i ON i.id=s.identity_id
 WHERE s.id=NEW.staff_session_id AND s.user_id=NEW.actor_user_id AND s.revoked_at IS NULL
 AND s.absolute_expires_at>statement_timestamp() AND s.idle_expires_at>statement_timestamp() AND s.token_expires_at>statement_timestamp()
 AND s.mfa_method='COGNITO_REQUIRED_TOTP' AND s.authenticated_at<=statement_timestamp() AND s.authenticated_at>statement_timestamp()-interval '15 minutes'
 AND u.account_state IN ('ACTIVE','PENDING_PHONE') AND u.security_version=s.security_version
 AND i.user_id=s.user_id AND i.issuer=s.issuer AND i.unlinked_at IS NULL)
 THEN RAISE EXCEPTION 'unauthorized attendance action'; END IF;
 IF NEW.command='ASSIGN' THEN
 IF NOT review_moderation_permission(NEW.actor_user_id,c.id,'case:assign') OR NEW.after_state<>v.state OR NEW.after_case_state<>(CASE WHEN w.state='OPEN' THEN 'TRIAGED' ELSE w.state END)
 OR attendance_conflicted(NEW.assigned_staff_user_id,c.id)
 OR NOT EXISTS(SELECT 1 FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE u.id=NEW.assigned_staff_user_id AND u.account_state IN ('ACTIVE','PENDING_PHONE') AND i.unlinked_at IS NULL)
 OR NOT review_moderation_permission(NEW.assigned_staff_user_id,c.id,'moderation:act')
 THEN RAISE EXCEPTION 'invalid attendance assignment'; END IF;
 ELSE
 IF w.assigned_staff_user_id IS DISTINCT FROM NEW.actor_user_id OR NEW.assigned_staff_user_id<>NEW.actor_user_id
 OR NOT review_moderation_permission(NEW.actor_user_id,c.id,'moderation:act') OR NOT review_moderation_permission(NEW.actor_user_id,c.id,'evidence:read')
 OR (NEW.command='DECIDE' AND (w.decision_id IS NOT NULL OR w.state<>'UNDER_REVIEW' OR NEW.after_case_state<>'RESOLVED' OR NEW.review_mode<>'INITIAL'))
 OR (NEW.command='BEGIN_INVESTIGATION' AND (w.state<>'TRIAGED' OR NEW.after_case_state<>'UNDER_REVIEW' OR NEW.after_state<>v.state OR NEW.reason_code<>'CASE_INVESTIGATION'))
 OR (NEW.command='RESOLVE_APPEAL' AND NEW.after_case_state<>'RESOLVED')
 OR (NEW.command<>'BEGIN_INVESTIGATION' AND NEW.after_state<>(CASE WHEN NEW.outcome IN ('COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW') THEN NEW.outcome ELSE 'ATTENDANCE_UNCONFIRMED' END))
 OR (NEW.outcome='COMPLETED' AND NEW.reason_code<>'ATTENDANCE_SUPPORTED')
 OR (NEW.outcome IN ('SEEKER_NO_SHOW','PROVIDER_NO_SHOW') AND NEW.reason_code<>'NO_SHOW_SUPPORTED')
 OR (NEW.outcome='CLAIM_INVALIDATED' AND NEW.reason_code NOT IN ('UNSUPPORTED_CLAIM','CONTRADICTORY_CLAIM'))
 OR (NEW.outcome='INSUFFICIENT_EVIDENCE' AND NEW.reason_code<>'INSUFFICIENT_EVIDENCE')
 THEN RAISE EXCEPTION 'invalid attendance decision'; END IF;
 IF NEW.command='RESOLVE_APPEAL' THEN
 SELECT * INTO original FROM attendance_adjudication_actions WHERE id=NEW.original_action_id AND case_id=c.id AND command='DECIDE';
 IF original.id IS NULL OR NOT review_moderation_permission(NEW.actor_user_id,c.id,'appeal:resolve')
 OR NOT EXISTS(SELECT 1 FROM attendance_appeals ap WHERE ap.id=NEW.appeal_id AND ap.case_id=c.id AND ap.original_action_id=original.id)
 OR (NEW.appeal_outcome='UPHELD' AND NEW.outcome<>original.outcome)
 OR (NEW.appeal_outcome IN ('OVERTURNED','PARTIALLY_UPHELD') AND NEW.outcome=original.outcome)
 OR (NEW.review_mode='INDEPENDENT_REVIEW' AND NEW.actor_user_id=original.actor_user_id)
 OR (NEW.review_mode='SOLE_OPERATOR_RECONSIDERATION' AND (NEW.actor_user_id<>original.actor_user_id OR attendance_other_reviewer(c.id,original.actor_user_id,(SELECT issuer FROM staff_sessions WHERE id=NEW.staff_session_id))))
 OR NEW.review_mode='INITIAL'
 THEN RAISE EXCEPTION 'invalid attendance appeal decision'; END IF;
 END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attendance_action_guard BEFORE INSERT ON attendance_adjudication_actions FOR EACH ROW EXECUTE FUNCTION attendance_action_guard();
CREATE FUNCTION attendance_workflow_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.case_id<>OLD.case_id OR NEW.version<>OLD.version+1 OR NOT EXISTS(
 SELECT 1 FROM attendance_adjudication_actions a WHERE a.case_id=NEW.case_id AND a.case_version=NEW.version AND a.transaction_id=txid_current()
 AND a.assigned_staff_user_id=NEW.assigned_staff_user_id AND a.before_case_state=OLD.state AND a.after_case_state=NEW.state AND
 ((a.command IN ('ASSIGN','BEGIN_INVESTIGATION') AND NEW.decision_id IS NOT DISTINCT FROM OLD.decision_id) OR (a.command IN ('DECIDE','RESOLVE_APPEAL') AND NEW.decision_id=a.id)))
 THEN RAISE EXCEPTION 'attendance workflow requires immutable action'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attendance_workflow_guard BEFORE UPDATE OR DELETE ON attendance_case_workflows FOR EACH ROW EXECUTE FUNCTION attendance_workflow_guard();
CREATE FUNCTION attendance_appeal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT attendance_evidence_valid(NEW.case_id,NEW.evidence) OR NOT EXISTS(
 SELECT 1 FROM attendance_adjudication_actions a JOIN attendance_case_workflows w ON w.case_id=a.case_id
 JOIN viewing_attendance_cases c ON c.id=a.case_id JOIN viewings v ON v.id=c.viewing_id
 JOIN provider_accounts pa ON pa.id=v.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
 WHERE a.id=NEW.original_action_id AND a.case_id=NEW.case_id AND a.command='DECIDE' AND w.decision_id=a.id
 AND a.created_at<=NEW.submitted_at AND NEW.submitted_at<a.appeal_deadline AND NEW.submitted_at=statement_timestamp()
 AND (NEW.appellant_side='SEEKER' AND NEW.appellant_user_id=v.seeker_user_id OR NEW.appellant_side='PROVIDER' AND
 (pp.user_id=NEW.appellant_user_id OR EXISTS(SELECT 1 FROM organization_memberships m JOIN organization_resource_assignments s ON s.membership_id=m.id
 WHERE m.organization_id=pa.organization_id AND m.user_id=NEW.appellant_user_id AND m.state='ACTIVE' AND m.role<>'ANALYST'
 AND s.provider_account_id=pa.id AND s.resource_type='INTERACTION' AND s.resource_id=v.interaction_id AND s.revoked_at IS NULL
 AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp())))))
 THEN RAISE EXCEPTION 'invalid attendance appeal'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attendance_appeal_guard BEFORE INSERT ON attendance_appeals FOR EACH ROW EXECUTE FUNCTION attendance_appeal_guard();

CREATE FUNCTION attendance_effective_state(outcome_id uuid) RETURNS text LANGUAGE sql VOLATILE AS $$
 SELECT CASE WHEN d.id IS NULL THEN o.state WHEN d.outcome IN ('COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW') THEN d.outcome ELSE 'ATTENDANCE_UNCONFIRMED' END
 FROM viewing_attendance_outcomes o LEFT JOIN viewing_attendance_cases c ON c.attendance_outcome_id=o.id
 LEFT JOIN attendance_case_workflows w ON w.case_id=c.id LEFT JOIN attendance_adjudication_actions d ON d.id=w.decision_id WHERE o.id=outcome_id
$$;
CREATE FUNCTION attendance_completion_time(outcome_id uuid) RETURNS timestamptz LANGUAGE sql VOLATILE AS $$
 SELECT CASE WHEN o.claimed_outcome='COMPLETED' THEN coalesce(o.finalized_at,d.created_at) ELSE coalesce(d.created_at,o.finalized_at) END FROM viewing_attendance_outcomes o
 LEFT JOIN viewing_attendance_cases c ON c.attendance_outcome_id=o.id LEFT JOIN attendance_case_workflows w ON w.case_id=c.id
 LEFT JOIN attendance_adjudication_actions d ON d.id=w.decision_id WHERE o.id=outcome_id
$$;
ALTER TABLE viewings ADD COLUMN adjudication_action_id uuid REFERENCES attendance_adjudication_actions(id);
ALTER TABLE viewings DROP CONSTRAINT viewings_state_check;
ALTER TABLE viewings ADD CONSTRAINT viewings_state_check CHECK(state IN ('REQUESTED','ACCEPTED','SCHEDULED','RESCHEDULED','DECLINED','EXPIRED','CANCELLED_BY_SEEKER','CANCELLED_BY_PROVIDER','SEEKER_NO_SHOW','PROVIDER_NO_SHOW','COMPLETED','DISPUTED','ATTENDANCE_UNCONFIRMED'));
ALTER TABLE viewings DROP CONSTRAINT viewing_validated_attendance_state;
ALTER TABLE viewings ADD CONSTRAINT viewing_validated_attendance_state CHECK(attendance_validated_at IS NULL OR state IN ('COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW','DISPUTED','ATTENDANCE_UNCONFIRMED'));

-- Deadline extension preserves original policy, opening instant and consumed identity.
ALTER TABLE viewing_review_eligibilities ADD COLUMN initial_closes_at timestamptz;
DROP TRIGGER viewing_review_eligibility_guard ON viewing_review_eligibilities;
UPDATE viewing_review_eligibilities SET initial_closes_at=closes_at;
ALTER TABLE viewing_review_eligibilities ADD COLUMN restoration_action_id uuid REFERENCES attendance_adjudication_actions(id);
ALTER TABLE viewing_review_eligibilities DROP CONSTRAINT review_policy_duration;
ALTER TABLE viewing_review_eligibilities ADD CONSTRAINT review_policy_duration CHECK(
 coalesce(initial_closes_at,closes_at)=((opens_at AT TIME ZONE 'UTC')+CASE policy_version WHEN 'bilateral-review-v1' THEN interval '14 days' ELSE interval '7 days' END) AT TIME ZONE 'UTC'
 AND closes_at>=coalesce(initial_closes_at,closes_at) AND (closes_at=coalesce(initial_closes_at,closes_at) OR restoration_action_id IS NOT NULL));
CREATE TABLE attendance_review_effects (
 action_id uuid NOT NULL REFERENCES attendance_adjudication_actions(id), eligibility_id uuid NOT NULL REFERENCES viewing_review_eligibilities(id),
 policy_version text NOT NULL CHECK(policy_version IN ('bilateral-review-v1','bilateral-review-v2')),
 before_state text NOT NULL, after_state text NOT NULL, before_closes_at timestamptz NOT NULL, after_closes_at timestamptz NOT NULL,
 transaction_id bigint NOT NULL DEFAULT txid_current(), created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(action_id,eligibility_id)
);
CREATE TRIGGER attendance_review_effects_immutable BEFORE UPDATE OR DELETE ON attendance_review_effects FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
-- Current operational no-show effects; originals remain retained and invalidated.
CREATE VIEW validated_viewing_no_shows AS
 SELECT n.viewing_id,n.responsible_side,n.resolved_at,n.validation_method,NULL::uuid AS decision_id FROM viewing_no_show_events n WHERE n.invalidated_at IS NULL
 UNION ALL
 SELECT c.viewing_id,CASE d.outcome WHEN 'SEEKER_NO_SHOW' THEN 'SEEKER' ELSE 'PROVIDER' END,d.created_at,'STAFF_ADJUDICATION',d.id
 FROM attendance_case_workflows w JOIN attendance_adjudication_actions d ON d.id=w.decision_id JOIN viewing_attendance_cases c ON c.id=w.case_id
 WHERE d.outcome IN ('SEEKER_NO_SHOW','PROVIDER_NO_SHOW');
-- Dedicated private inbox/outbox. No unapproved external delivery is enabled.
CREATE TABLE attendance_decision_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES viewing_attendance_cases(id),
 action_id uuid REFERENCES attendance_adjudication_actions(id), appeal_id uuid REFERENCES attendance_appeals(id),
 recipient_side text NOT NULL CHECK(recipient_side IN ('SEEKER','PROVIDER')),
 available_at timestamptz NOT NULL DEFAULT statement_timestamp(), external_state text NOT NULL DEFAULT 'NOT_ENABLED' CHECK(external_state='NOT_ENABLED'),
 CHECK(num_nonnulls(action_id,appeal_id)=1), UNIQUE(action_id,recipient_side), UNIQUE(appeal_id,recipient_side)
);
CREATE TRIGGER attendance_decision_notices_immutable BEFORE UPDATE OR DELETE ON attendance_decision_notices FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE TABLE attendance_adjudication_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_id uuid UNIQUE REFERENCES attendance_adjudication_actions(id),
 appeal_id uuid UNIQUE REFERENCES attendance_appeals(id), event_type text NOT NULL,
 safe_payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 CHECK(num_nonnulls(action_id,appeal_id)=1)
);
CREATE TRIGGER attendance_adjudication_outbox_immutable BEFORE UPDATE OR DELETE ON attendance_adjudication_outbox FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
ALTER TABLE viewing_notices ADD COLUMN source_attendance_action_id uuid REFERENCES attendance_adjudication_actions(id);
ALTER TABLE viewing_notices DROP CONSTRAINT viewing_notice_one_source;
ALTER TABLE viewing_notices ADD CONSTRAINT viewing_notice_one_source CHECK(num_nonnulls(source_outbox_id,source_action_id,source_review_event_id,source_review_action_id,source_review_moderation_action_id,source_attendance_action_id)=1);
CREATE UNIQUE INDEX attendance_inbox_action_unique ON viewing_notices(source_attendance_action_id,recipient_side) WHERE source_attendance_action_id IS NOT NULL;
ALTER TABLE viewing_notices DROP CONSTRAINT viewing_notices_event_type_check;
ALTER TABLE viewing_notices ADD CONSTRAINT viewing_notices_event_type_check CHECK(event_type IN (
 'viewing_requested','viewing_accepted','viewing_declined','viewing_confirmed','viewing_scheduled','viewing_cancelled','viewing_expired',
 'viewing_reschedule_proposed','viewing_reschedule_accepted','viewing_reschedule_rejected','viewing_reschedule_withdrawn','viewing_reschedule_expired','viewing_reschedule_invalidated','viewing_rescheduled','viewing_reschedule_finalized',
 'viewing_reminder_24h','viewing_reminder_2h','viewing_completion_claimed','viewing_no_show_claimed','viewing_attendance_confirmed','viewing_attendance_disputed','viewing_attendance_finalized',
 'review_eligibility_created','review_submitted','review_published','review_withdrawn','review_window_closed','review_reminder_3d','review_reminder_1d','review_moderation_changed','attendance_adjudication_changed'));
-- Retain the required SUBMITTED -> UNDER_REVIEW phase even when review and
-- terminal resolution commit atomically through one reasoned decision command.
CREATE TABLE attendance_appeal_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), appeal_id uuid NOT NULL UNIQUE REFERENCES attendance_appeals(id),
 decision_action_id uuid NOT NULL UNIQUE REFERENCES attendance_adjudication_actions(id),
 actor_user_id uuid NOT NULL REFERENCES users(id), staff_session_id uuid NOT NULL REFERENCES staff_sessions(id),
 review_mode text NOT NULL CHECK(review_mode IN ('INDEPENDENT_REVIEW','SOLE_OPERATOR_RECONSIDERATION')),
 before_state text NOT NULL DEFAULT 'SUBMITTED' CHECK(before_state='SUBMITTED'),
 after_state text NOT NULL DEFAULT 'UNDER_REVIEW' CHECK(after_state='UNDER_REVIEW'),
 started_at timestamptz NOT NULL, transaction_id bigint NOT NULL DEFAULT txid_current()
);
CREATE TRIGGER attendance_appeal_reviews_immutable BEFORE UPDATE OR DELETE ON attendance_appeal_reviews FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE FUNCTION attendance_appeal_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.transaction_id<>txid_current() OR NOT EXISTS(SELECT 1 FROM attendance_adjudication_actions a
 WHERE a.id=NEW.decision_action_id AND a.command='RESOLVE_APPEAL' AND a.appeal_id=NEW.appeal_id
 AND a.transaction_id=txid_current() AND a.actor_user_id=NEW.actor_user_id AND a.staff_session_id=NEW.staff_session_id
 AND a.review_mode=NEW.review_mode AND a.created_at=NEW.started_at)
 THEN RAISE EXCEPTION 'appeal review requires scoped decision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attendance_appeal_review_guard BEFORE INSERT ON attendance_appeal_reviews FOR EACH ROW EXECUTE FUNCTION attendance_appeal_review_guard();
CREATE FUNCTION attendance_action_effects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.command='RESOLVE_APPEAL' THEN
 INSERT INTO attendance_appeal_reviews(appeal_id,decision_action_id,actor_user_id,staff_session_id,review_mode,started_at) VALUES(NEW.appeal_id,NEW.id,NEW.actor_user_id,NEW.staff_session_id,NEW.review_mode,NEW.created_at);
 END IF;
 INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata)
 VALUES(NEW.actor_user_id,'ATTENDANCE_'||NEW.command,'ViewingAttendanceCase',NEW.case_id,NEW.reason_code,NEW.request_id,
 jsonb_build_object('decision_id',NEW.id,'case_version',NEW.case_version,'policy_version',NEW.policy_version,'review_mode',NEW.review_mode));
 INSERT INTO attendance_adjudication_outbox(action_id,event_type,safe_payload) VALUES(NEW.id,'attendance_'||lower(NEW.command),
 jsonb_build_object('case_id',NEW.case_id,'action_id',NEW.id,'policy_version',NEW.policy_version));
 IF NEW.command IN ('DECIDE','RESOLVE_APPEAL') THEN
 INSERT INTO attendance_decision_notices(case_id,action_id,recipient_side,available_at)
 SELECT NEW.case_id,NEW.id,side,NEW.created_at FROM (VALUES('SEEKER'),('PROVIDER')) sides(side);
 INSERT INTO viewing_notices(viewing_id,source_attendance_action_id,recipient_side,seeker_user_id,provider_account_id,event_type,schedule_version,event_at,available_at)
 SELECT v.id,NEW.id,s.side,CASE WHEN s.side='SEEKER' THEN v.seeker_user_id END,CASE WHEN s.side='PROVIDER' THEN v.provider_account_id END,
 'attendance_adjudication_changed',c.schedule_version,NEW.created_at,NEW.created_at
 FROM viewing_attendance_cases c JOIN viewings v ON v.id=c.viewing_id CROSS JOIN (VALUES('SEEKER'),('PROVIDER')) s(side) WHERE c.id=NEW.case_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attendance_action_effects AFTER INSERT ON attendance_adjudication_actions FOR EACH ROW EXECUTE FUNCTION attendance_action_effects();
CREATE FUNCTION attendance_appeal_effects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,safe_metadata) VALUES(NEW.appellant_user_id,'ATTENDANCE_APPEAL_SUBMITTED','ViewingAttendanceCase',NEW.case_id,'ATTENDANCE_APPEAL',jsonb_build_object('appeal_id',NEW.id));
 INSERT INTO attendance_adjudication_outbox(appeal_id,event_type,safe_payload) VALUES(NEW.id,'attendance_appeal_submitted',jsonb_build_object('case_id',NEW.case_id,'appeal_id',NEW.id));
 INSERT INTO attendance_decision_notices(case_id,appeal_id,recipient_side) VALUES(NEW.case_id,NEW.id,NEW.appellant_side);
 RETURN NEW;
END $$;
CREATE TRIGGER attendance_appeal_effects AFTER INSERT ON attendance_appeals FOR EACH ROW EXECUTE FUNCTION attendance_appeal_effects();

-- Staff transitions require the exact same-transaction immutable decision.
CREATE OR REPLACE FUNCTION viewing_episode_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE replacement boolean; attendance boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'viewing episodes are retained'; END IF;
  IF TG_OP='INSERT' THEN
    -- Serialize request insertion with attendance commands on the parent. The
    -- uniqueness predicate alone cannot enforce the historical dispute hold.
    PERFORM id FROM interactions WHERE id=NEW.interaction_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM interactions i WHERE i.id=NEW.interaction_id AND i.listing_id=NEW.listing_id
      AND i.provider_account_id=NEW.provider_account_id AND i.seeker_user_id=NEW.seeker_user_id)
      OR NEW.state<>'REQUESTED' OR NEW.version<>1 OR NEW.schedule_version<>1
      OR NEW.accepted_at IS NOT NULL OR NEW.seeker_confirmed OR NEW.provider_confirmed OR NEW.attendance_validated_at IS NOT NULL OR NEW.adjudication_action_id IS NOT NULL
      THEN RAISE EXCEPTION 'invalid viewing context'; END IF;
    IF EXISTS(SELECT 1 FROM viewings v WHERE v.interaction_id=NEW.interaction_id AND v.state='DISPUTED')
      THEN RAISE EXCEPTION 'attendance dispute prevents new appointment'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=NEW.display_timezone) THEN RAISE EXCEPTION 'invalid viewing timezone'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.adjudication_action_id IS DISTINCT FROM OLD.adjudication_action_id THEN
    IF NOT EXISTS(SELECT 1 FROM attendance_adjudication_actions d JOIN viewing_attendance_cases c ON c.id=d.case_id
      JOIN attendance_case_workflows w ON w.case_id=c.id
      WHERE d.id=NEW.adjudication_action_id AND d.command IN ('DECIDE','RESOLVE_APPEAL') AND d.transaction_id=txid_current()
      AND w.decision_id=d.id AND c.viewing_id=OLD.id AND c.schedule_version=OLD.schedule_version
      AND d.before_state=OLD.state AND d.after_state=NEW.state)
      OR to_jsonb(NEW)-ARRAY['state','version','updated_at','adjudication_action_id','attendance_validated_at']
         IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','version','updated_at','adjudication_action_id','attendance_validated_at']
      OR NEW.version<>OLD.version+1
      OR (OLD.attendance_validated_at IS NOT NULL AND NEW.attendance_validated_at IS DISTINCT FROM OLD.attendance_validated_at)
      OR (OLD.attendance_validated_at IS NULL AND NEW.attendance_validated_at IS DISTINCT FROM
        CASE WHEN NEW.state IN ('COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW') THEN
          (SELECT attendance_completion_time(c.attendance_outcome_id) FROM viewing_attendance_cases c WHERE c.viewing_id=OLD.id AND c.schedule_version=OLD.schedule_version)
          ELSE NULL END)
      THEN RAISE EXCEPTION 'invalid staff attendance transition'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.attendance_validated_at IS DISTINCT FROM OLD.attendance_validated_at
    THEN RAISE EXCEPTION 'validated attendance provenance is immutable'; END IF;
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
  IF attendance AND OLD.state='SCHEDULED' AND NEW.state IN ('COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW') THEN
    SELECT a.finalized_at INTO NEW.attendance_validated_at FROM viewing_attendance_outcomes a
      WHERE a.viewing_id=OLD.id AND a.schedule_version=OLD.schedule_version AND a.state=NEW.state;
    IF NEW.attendance_validated_at IS NULL THEN RAISE EXCEPTION 'validated attendance provenance required'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION review_context_valid(context_id uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM viewing_review_boundaries b
 JOIN viewing_attendance_outcomes a ON a.id=b.attendance_outcome_id
 JOIN viewings v ON v.id=b.viewing_id JOIN interactions i ON i.id=b.interaction_id
 JOIN listings l ON l.id=i.listing_id JOIN provider_accounts pa ON pa.id=i.provider_account_id
 JOIN users u ON u.id=b.seeker_user_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
 LEFT JOIN users pu ON pu.id=pp.user_id LEFT JOIN organizations org ON org.id=pa.organization_id
 WHERE b.interaction_id=context_id AND b.eligibility_state='OPEN' AND attendance_effective_state(a.id)='COMPLETED'
 AND v.state='COMPLETED' AND v.schedule_version=a.schedule_version AND (v.attendance_validated_at=attendance_completion_time(a.id) OR v.adjudication_action_id IS NOT NULL AND v.attendance_validated_at IS NOT NULL)
 AND v.interaction_id=i.id AND v.listing_id=i.listing_id AND v.provider_account_id=i.provider_account_id
 AND b.seeker_user_id=i.seeker_user_id AND b.provider_account_id=i.provider_account_id AND l.provider_account_id=pa.id
 AND i.state<>'RESTRICTED' AND pa.state='ACTIVE' AND u.account_state='ACTIVE'
 AND EXISTS(SELECT 1 FROM phone_contacts p WHERE p.user_id=u.id AND p.verified_at IS NOT NULL AND p.replaced_at IS NULL AND p.verification_version>0)
 AND l.publication_status NOT IN ('HIDDEN','REMOVED') AND l.moderation_status NOT IN ('ESCALATED','REMOVED')
 AND ((pa.kind='INDIVIDUAL' AND pp.state='ACTIVE' AND pu.account_state='ACTIVE' AND pu.id<>u.id
   AND EXISTS(SELECT 1 FROM phone_contacts p WHERE p.user_id=pu.id AND p.verified_at IS NOT NULL AND p.replaced_at IS NULL AND p.verification_version>0)
   AND EXISTS(SELECT 1 FROM verification_claims vc WHERE vc.provider_profile_id=pp.id AND vc.status='VERIFIED'
      AND vc.valid_from<=statement_timestamp() AND vc.valid_until>statement_timestamp() AND vc.revoked_at IS NULL))
  OR (pa.kind='ORGANIZATION' AND org.state='ACTIVE' AND org.onboarding_completed_at IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM organization_memberships m WHERE m.organization_id=org.id AND m.user_id=u.id AND m.state='ACTIVE')
   AND EXISTS(SELECT 1 FROM organization_memberships m JOIN users member_user ON member_user.id=m.user_id
     JOIN organization_resource_assignments s ON s.membership_id=m.id
     WHERE m.organization_id=org.id AND m.state='ACTIVE' AND m.role<>'ANALYST' AND member_user.account_state='ACTIVE'
      AND EXISTS(SELECT 1 FROM phone_contacts phone WHERE phone.user_id=m.user_id AND phone.verified_at IS NOT NULL AND phone.replaced_at IS NULL AND phone.verification_version>0)
      AND s.provider_account_id=pa.id AND s.resource_type='INTERACTION' AND s.resource_id=i.id AND s.revoked_at IS NULL
      AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp()))))
 AND NOT EXISTS(SELECT 1 FROM viewing_attendance_outcomes other WHERE other.viewing_id IN(SELECT id FROM viewings WHERE interaction_id=i.id) AND attendance_effective_state(other.id)='DISPUTED'))
$$;

CREATE OR REPLACE FUNCTION viewing_review_boundary_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM viewing_attendance_outcomes a JOIN viewings v ON v.id=a.viewing_id JOIN interactions i ON i.id=v.interaction_id JOIN provider_accounts pa ON pa.id=v.provider_account_id
  WHERE a.id=NEW.attendance_outcome_id AND attendance_effective_state(a.id)='COMPLETED' AND v.state='COMPLETED' AND a.schedule_version=v.schedule_version
   AND v.id=NEW.viewing_id AND i.id=NEW.interaction_id AND v.seeker_user_id=NEW.seeker_user_id AND v.provider_account_id=NEW.provider_account_id
   AND i.seeker_user_id=v.seeker_user_id AND i.listing_id=v.listing_id AND i.provider_account_id=v.provider_account_id
   AND pa.organization_id IS NOT DISTINCT FROM NEW.organization_id
   AND (NEW.policy_version='bilateral-review-v1' OR NEW.opened_at=attendance_completion_time(a.id)))
  THEN RAISE EXCEPTION 'invalid review boundary context'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION viewing_review_eligibility_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'review eligibility is retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'OPEN' OR NEW.version<>1 OR NEW.consumed_at IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM viewing_review_boundaries b JOIN viewing_attendance_outcomes a ON a.id=b.attendance_outcome_id
    WHERE b.interaction_id=NEW.interaction_id AND b.viewing_id=NEW.viewing_id AND b.eligibility_state='OPEN' AND attendance_effective_state(a.id)='COMPLETED' AND NEW.policy_version=b.policy_version AND NEW.opens_at=b.opened_at
    AND ((NEW.direction='SEEKER_TO_PROVIDER' AND NEW.reviewer_subject_id=b.seeker_user_id AND NEW.target_id=b.provider_account_id)
      OR (NEW.direction='PROVIDER_TO_SEEKER' AND NEW.reviewer_subject_id=b.provider_account_id AND NEW.target_id=b.seeker_user_id)))
    THEN RAISE EXCEPTION 'invalid review eligibility context'; END IF;
  NEW.initial_closes_at:=NEW.closes_at;
  RETURN NEW;
 END IF;
 -- Every restoration/revocation is an exact immutable per-slot effect.
 IF EXISTS(SELECT 1 FROM attendance_review_effects effect JOIN attendance_adjudication_actions action ON action.id=effect.action_id
   JOIN attendance_case_workflows workflow ON workflow.decision_id=action.id
   JOIN viewing_attendance_cases action_case ON action_case.id=action.case_id JOIN viewings action_viewing ON action_viewing.id=action_case.viewing_id
   WHERE action_viewing.interaction_id=OLD.interaction_id AND effect.eligibility_id=OLD.id AND effect.transaction_id=txid_current() AND action.transaction_id=txid_current()
   AND effect.before_state=OLD.state AND effect.after_state=NEW.state AND effect.before_closes_at=OLD.closes_at AND effect.after_closes_at=NEW.closes_at
   AND ((attendance_effective_state((SELECT attendance_outcome_id FROM viewing_review_boundaries WHERE interaction_id=OLD.interaction_id))='COMPLETED'
     AND NOT EXISTS(SELECT 1 FROM viewing_attendance_outcomes o JOIN viewings v ON v.id=o.viewing_id WHERE v.interaction_id=OLD.interaction_id AND attendance_effective_state(o.id)='DISPUTED')
     AND NEW.state=CASE WHEN OLD.consumed_at IS NOT NULL THEN 'CONSUMED' ELSE 'OPEN' END
     AND NEW.closes_at>=OLD.closes_at
     AND (OLD.consumed_at IS NOT NULL OR NEW.closes_at>=((action.created_at AT TIME ZONE 'UTC')+interval '7 days') AT TIME ZONE 'UTC'))
    OR (action.outcome<>'COMPLETED' AND EXISTS(SELECT 1 FROM viewing_review_boundaries b JOIN viewing_attendance_cases c ON c.attendance_outcome_id=b.attendance_outcome_id WHERE c.id=action.case_id AND b.interaction_id=OLD.interaction_id) AND NEW.state='REVOKED' AND NEW.closes_at=OLD.closes_at))) THEN
   IF to_jsonb(NEW)-ARRAY['state','version','closes_at','restoration_action_id'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','version','closes_at','restoration_action_id']
     OR NEW.version<>OLD.version+1 OR NEW.restoration_action_id IS DISTINCT FROM (SELECT action_id FROM attendance_review_effects WHERE eligibility_id=OLD.id AND transaction_id=txid_current() ORDER BY created_at DESC LIMIT 1)
     THEN RAISE EXCEPTION 'invalid attendance eligibility effect'; END IF;
   RETURN NEW;
 END IF;
 IF ROW(NEW.initial_closes_at,NEW.restoration_action_id) IS DISTINCT FROM ROW(OLD.initial_closes_at,OLD.restoration_action_id)
   THEN RAISE EXCEPTION 'immutable original review deadline'; END IF;
 IF ROW(NEW.id,NEW.interaction_id,NEW.viewing_id,NEW.direction,NEW.reviewer_subject_type,NEW.reviewer_subject_id,NEW.target_type,NEW.target_id,NEW.opens_at,NEW.closes_at,NEW.policy_version)
  IS DISTINCT FROM ROW(OLD.id,OLD.interaction_id,OLD.viewing_id,OLD.direction,OLD.reviewer_subject_type,OLD.reviewer_subject_id,OLD.target_type,OLD.target_id,OLD.opens_at,OLD.closes_at,OLD.policy_version)
  OR OLD.state<>'OPEN' OR (NEW.version<>OLD.version+1 AND NOT(NEW.state='HELD' AND NEW.version=OLD.version))
  OR NOT((NEW.state='HELD' AND NEW.consumed_at IS NULL AND EXISTS(SELECT 1 FROM viewing_attendance_outcomes a JOIN viewings v ON v.id=a.viewing_id WHERE v.interaction_id=NEW.interaction_id AND attendance_effective_state(a.id)='DISPUTED'))
    OR (NEW.state='CONSUMED' AND NEW.consumed_at IS NOT NULL AND NEW.opens_at<=NEW.consumed_at AND NEW.consumed_at<NEW.closes_at
      AND review_context_valid(NEW.interaction_id) AND EXISTS(SELECT 1 FROM reviews r WHERE r.eligibility_id=NEW.id AND r.state='SUBMITTED_HELD'))
    OR (NEW.state='EXPIRED' AND NEW.consumed_at IS NULL AND NEW.closes_at<=statement_timestamp()))
  THEN RAISE EXCEPTION 'invalid review eligibility transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER viewing_review_eligibility_guard BEFORE INSERT OR UPDATE OR DELETE ON viewing_review_eligibilities FOR EACH ROW EXECUTE FUNCTION viewing_review_eligibility_guard();

CREATE FUNCTION attendance_review_effect_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.transaction_id<>txid_current() OR NOT EXISTS(
 SELECT 1 FROM attendance_adjudication_actions a JOIN attendance_case_workflows w ON w.decision_id=a.id
 JOIN viewing_attendance_cases c ON c.id=a.case_id JOIN viewings v ON v.id=c.viewing_id
 JOIN viewing_review_eligibilities e ON e.id=NEW.eligibility_id AND e.interaction_id=v.interaction_id
 WHERE a.id=NEW.action_id AND a.transaction_id=txid_current() AND a.command IN ('DECIDE','RESOLVE_APPEAL')
 AND e.state=NEW.before_state AND e.closes_at=NEW.before_closes_at AND e.policy_version=NEW.policy_version)
 THEN RAISE EXCEPTION 'invalid attendance review effect context'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attendance_review_effect_guard BEFORE INSERT ON attendance_review_effects FOR EACH ROW EXECUTE FUNCTION attendance_review_effect_guard();
