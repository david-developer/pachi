-- Extend the existing private review intake; no review/window/history rewrite.
ALTER TABLE review_moderation_cases DROP CONSTRAINT review_moderation_cases_state_check;
ALTER TABLE review_moderation_cases ADD CONSTRAINT review_case_state CHECK(state IN ('OPEN','TRIAGED','UNDER_REVIEW','ACTION_REQUIRED','RESOLVED','CLOSED'));
ALTER TABLE review_moderation_cases ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE review_moderation_cases ADD COLUMN assigned_staff_user_id uuid REFERENCES users(id);
ALTER TABLE review_moderation_cases ADD COLUMN updated_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE review_moderation_cases ADD COLUMN policy_version text NOT NULL DEFAULT 'review-moderation-v1' CHECK(policy_version='review-moderation-v1');
DROP TRIGGER review_cases_immutable ON review_moderation_cases;
CREATE TABLE review_moderation_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES review_moderation_cases(id),
 review_id uuid NOT NULL REFERENCES reviews(id),
 actor_user_id uuid NOT NULL REFERENCES users(id),
 staff_session_id uuid NOT NULL REFERENCES staff_sessions(id),
 assigned_staff_user_id uuid REFERENCES users(id),
 command text NOT NULL CHECK(command IN ('ASSIGN','BEGIN_INVESTIGATION','HOLD','HIDE','REMOVE','RESTORE','RESOLVE','CLOSE')),
 purpose text NOT NULL CHECK(purpose='REVIEW_MODERATION'),
 reason_code text NOT NULL CHECK(reason_code IN ('CASE_ASSIGNMENT','REVIEW_POLICY_VIOLATION','PRIVACY_PROTECTION','THREAT_PROTECTION','INVESTIGATION','NO_VIOLATION','ELIGIBILITY_RESTORED','CASE_COMPLETED')),
 reason_text text NOT NULL CHECK(char_length(reason_text) BETWEEN 10 AND 2000),
 before_case_state text NOT NULL,
 after_case_state text NOT NULL,
 before_review_state text NOT NULL,
 after_review_state text NOT NULL,
 case_version integer NOT NULL CHECK(case_version>1),
 review_version integer NOT NULL CHECK(review_version>0),
 reverses_action_id uuid REFERENCES review_moderation_actions(id),
 idempotency_key uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
 request_id uuid NOT NULL,
 policy_version text NOT NULL DEFAULT 'review-moderation-v1' CHECK(policy_version='review-moderation-v1'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 transaction_id bigint NOT NULL DEFAULT txid_current(),
 notice_available_at timestamptz,
 appeal_deadline timestamptz,
 UNIQUE(actor_user_id,idempotency_key),
 UNIQUE(case_id,case_version),
 CHECK((command='RESTORE')=(reverses_action_id IS NOT NULL)),
 CHECK((command IN ('HOLD','HIDE','REMOVE','RESTORE'))=(notice_available_at IS NOT NULL)),
 CHECK((notice_available_at IS NULL)=(appeal_deadline IS NULL)),
 CHECK(appeal_deadline IS NULL OR appeal_deadline=((notice_available_at AT TIME ZONE 'UTC')+interval '30 days') AT TIME ZONE 'UTC')
);
CREATE TRIGGER review_moderation_actions_immutable BEFORE UPDATE OR DELETE ON review_moderation_actions FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE FUNCTION review_moderation_conflicted(actor uuid, target_review uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM reviews r JOIN interactions i ON i.id=r.interaction_id JOIN listings l ON l.id=i.listing_id
  JOIN properties property ON property.id=l.property_id JOIN provider_accounts pa ON pa.id=i.provider_account_id
  LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
  WHERE r.id=target_review AND (r.author_user_id=actor OR i.seeker_user_id=actor OR pp.user_id=actor OR l.created_by_user_id=actor OR property.created_by_user_id=actor
   OR EXISTS(SELECT 1 FROM organization_memberships m WHERE m.organization_id=pa.organization_id AND m.user_id=actor)
   OR EXISTS(SELECT 1 FROM review_reports report WHERE report.review_id=r.id AND report.reporter_user_id=actor)))
$$;
CREATE FUNCTION review_moderation_permission(actor uuid,target_case uuid,permission text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM staff_grants g WHERE g.user_id=actor AND g.role='TRUST_SAFETY_MODERATOR'
  AND g.revoked_at IS NULL AND g.active_from<=statement_timestamp() AND g.expires_at>statement_timestamp()
  AND g.permission_scope->>'kind'='case' AND g.permission_scope->>'id'=target_case::text
  AND jsonb_typeof(g.permission_scope->'permissions')='array' AND g.permission_scope->'permissions' ? permission)
$$;
CREATE FUNCTION review_moderation_action_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c review_moderation_cases; r reviews;
BEGIN
 SELECT * INTO c FROM review_moderation_cases WHERE id=NEW.case_id;
 SELECT * INTO r FROM reviews WHERE id=NEW.review_id;
 IF c.id IS NULL OR c.review_id<>r.id OR NEW.transaction_id<>txid_current() OR NEW.created_at<>statement_timestamp()
  OR NEW.case_version<>c.version+1 OR NEW.before_case_state<>c.state OR NEW.before_review_state<>r.state
  OR review_moderation_conflicted(NEW.actor_user_id,r.id)
  OR NOT EXISTS(SELECT 1 FROM staff_sessions s JOIN users u ON u.id=s.user_id JOIN auth_identities i ON i.id=s.identity_id
   WHERE s.id=NEW.staff_session_id AND s.user_id=NEW.actor_user_id AND s.revoked_at IS NULL
    AND s.absolute_expires_at>statement_timestamp() AND s.idle_expires_at>statement_timestamp() AND s.token_expires_at>statement_timestamp()
    AND s.mfa_method='COGNITO_REQUIRED_TOTP' AND s.authenticated_at<=statement_timestamp() AND s.authenticated_at>statement_timestamp()-interval '15 minutes'
    AND u.account_state IN ('ACTIVE','PENDING_PHONE') AND u.security_version=s.security_version
    AND i.user_id=s.user_id AND i.issuer=s.issuer AND i.unlinked_at IS NULL)
  THEN RAISE EXCEPTION 'unauthorized review moderation action'; END IF;
 IF NEW.command='ASSIGN' THEN
  IF (c.state IN ('RESOLVED','CLOSED') AND NOT EXISTS(SELECT 1 FROM review_reports report WHERE report.case_id=c.id AND report.created_at>c.updated_at)) OR NOT review_moderation_permission(NEW.actor_user_id,c.id,'case:assign')
   OR NEW.assigned_staff_user_id IS NULL OR review_moderation_conflicted(NEW.assigned_staff_user_id,r.id)
   OR NOT EXISTS(SELECT 1 FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE u.id=NEW.assigned_staff_user_id AND u.account_state IN ('ACTIVE','PENDING_PHONE') AND i.unlinked_at IS NULL)
   OR NOT (review_moderation_permission(NEW.assigned_staff_user_id,c.id,'report:triage') OR review_moderation_permission(NEW.assigned_staff_user_id,c.id,'review:moderate'))
   OR NEW.after_case_state<>(CASE WHEN c.state IN ('OPEN','RESOLVED','CLOSED') THEN 'TRIAGED' ELSE c.state END)
   OR NEW.after_review_state<>r.state OR NEW.review_version<>r.version
   THEN RAISE EXCEPTION 'invalid review case assignment'; END IF;
 ELSE
  IF c.assigned_staff_user_id IS DISTINCT FROM NEW.actor_user_id OR NEW.assigned_staff_user_id IS DISTINCT FROM c.assigned_staff_user_id
   OR NOT review_moderation_permission(NEW.actor_user_id,c.id,'review:moderate')
   OR NOT review_moderation_permission(NEW.actor_user_id,c.id,'moderation:act')
   THEN RAISE EXCEPTION 'review moderation outside assignment'; END IF;
  IF (NEW.command='BEGIN_INVESTIGATION' AND NOT((c.state IN ('TRIAGED','ACTION_REQUIRED') OR (c.state IN ('RESOLVED','CLOSED') AND EXISTS(SELECT 1 FROM review_reports report WHERE report.case_id=c.id AND report.created_at>c.updated_at))) AND NEW.after_case_state='UNDER_REVIEW'))
   OR (NEW.command IN ('HOLD','HIDE','REMOVE','RESTORE') AND NOT(c.state IN ('UNDER_REVIEW','ACTION_REQUIRED') AND NEW.after_case_state='ACTION_REQUIRED'))
   OR (NEW.command='RESOLVE' AND NOT(c.state IN ('UNDER_REVIEW','ACTION_REQUIRED') AND NEW.after_case_state='RESOLVED'))
   OR (NEW.command='CLOSE' AND NOT(c.state='RESOLVED' AND NEW.after_case_state='CLOSED'))
   THEN RAISE EXCEPTION 'invalid review case transition'; END IF;
  IF NEW.command IN ('HOLD','HIDE','REMOVE','RESTORE') THEN
   IF r.state='WITHDRAWN' OR NEW.review_version<>r.version+1 OR NEW.before_review_state=NEW.after_review_state
    OR (NEW.command='HOLD' AND NEW.after_review_state<>'UNDER_REVIEW')
    OR (NEW.command='HIDE' AND NEW.after_review_state<>'HIDDEN')
    OR (NEW.command='REMOVE' AND NEW.after_review_state<>'REMOVED')
    OR (r.state='REMOVED' AND NEW.command<>'RESTORE')
    OR NOT review_moderation_permission(NEW.actor_user_id,c.id,'evidence:read')
    THEN RAISE EXCEPTION 'invalid review content decision'; END IF;
   IF NEW.command='RESTORE' AND (r.state NOT IN ('UNDER_REVIEW','HIDDEN','REMOVED') OR NEW.after_review_state NOT IN ('SUBMITTED_HELD','PUBLISHED')
    OR NOT review_context_valid(r.interaction_id) OR NOT review_author_current(r.id)
    OR NOT EXISTS(SELECT 1 FROM viewing_review_eligibilities e WHERE e.id=r.eligibility_id AND e.state='CONSUMED')
    OR NOT EXISTS(SELECT 1 FROM review_moderation_actions a WHERE a.id=NEW.reverses_action_id AND a.case_id=c.id AND a.review_id=r.id
      AND a.command IN ('HOLD','HIDE','REMOVE') AND a.after_review_state=r.state AND a.review_version=r.version
      AND NOT EXISTS(SELECT 1 FROM review_moderation_actions reversal WHERE reversal.reverses_action_id=a.id))
    OR (NEW.after_review_state='PUBLISHED' AND r.published_at IS NULL))
    THEN RAISE EXCEPTION 'invalid review restoration'; END IF;
  ELSIF NEW.after_review_state<>r.state OR NEW.review_version<>r.version THEN RAISE EXCEPTION 'case action cannot change review'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_moderation_action_guard BEFORE INSERT ON review_moderation_actions FOR EACH ROW EXECUTE FUNCTION review_moderation_action_guard();
CREATE FUNCTION review_moderation_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.id,NEW.review_id,NEW.opened_at,NEW.review_status,NEW.policy_version) IS DISTINCT FROM ROW(OLD.id,OLD.review_id,OLD.opened_at,OLD.review_status,OLD.policy_version)
  OR NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM review_moderation_actions a WHERE a.case_id=NEW.id AND a.transaction_id=txid_current()
   AND a.case_version=NEW.version AND a.before_case_state=OLD.state AND a.after_case_state=NEW.state AND a.assigned_staff_user_id IS NOT DISTINCT FROM NEW.assigned_staff_user_id)
  THEN RAISE EXCEPTION 'case transition requires immutable action'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_cases_guard BEFORE UPDATE OR DELETE ON review_moderation_cases FOR EACH ROW EXECUTE FUNCTION review_moderation_case_guard();

CREATE OR REPLACE FUNCTION review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e viewing_review_eligibilities; b viewing_review_boundaries; k text; value jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'reviews are retained'; END IF;
 SELECT * INTO e FROM viewing_review_eligibilities WHERE id=NEW.eligibility_id;
 PERFORM id FROM interactions WHERE id=e.interaction_id FOR NO KEY UPDATE;
 SELECT * INTO b FROM viewing_review_boundaries WHERE interaction_id=e.interaction_id;
 IF e.id IS NULL OR ROW(NEW.interaction_id,NEW.viewing_id,NEW.direction,NEW.reviewer_subject_type,NEW.reviewer_subject_id,NEW.target_type,NEW.target_id,NEW.policy_version)
  IS DISTINCT FROM ROW(e.interaction_id,e.viewing_id,e.direction,e.reviewer_subject_type,e.reviewer_subject_id,e.target_type,e.target_id,e.policy_version)
  THEN RAISE EXCEPTION 'invalid review subject context'; END IF;
 FOR k,value IN SELECT * FROM jsonb_each(NEW.criteria) LOOP
  IF jsonb_typeof(value)<>'number' OR value::text !~ '^[1-5]$' OR
   (NEW.direction='SEEKER_TO_PROVIDER' AND k NOT IN ('listing_accuracy','communication','reliability','transparency','overall_experience')) OR
   (NEW.direction='PROVIDER_TO_SEEKER' AND k NOT IN ('communication','reliability','appointment_attendance','respectful_conduct','overall_interaction'))
   THEN RAISE EXCEPTION 'invalid review criteria'; END IF;
 END LOOP;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'SUBMITTED_HELD' OR NEW.version<>1 OR NEW.published_at IS NOT NULL OR NEW.withdrawn_at IS NOT NULL OR e.state<>'OPEN'
   OR NOT(e.opens_at<=statement_timestamp() AND statement_timestamp()<e.closes_at) OR NOT review_context_valid(e.interaction_id)
   OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.author_user_id AND u.account_state='ACTIVE'
      AND EXISTS(SELECT 1 FROM phone_contacts p WHERE p.user_id=u.id AND p.verified_at IS NOT NULL AND p.replaced_at IS NULL AND p.verification_version>0))
   OR (NEW.direction='SEEKER_TO_PROVIDER' AND (NEW.author_user_id<>b.seeker_user_id OR NEW.membership_id IS NOT NULL OR NEW.assignment_id IS NOT NULL))
   OR (NEW.direction='PROVIDER_TO_SEEKER' AND NOT EXISTS(SELECT 1 FROM provider_accounts pa LEFT JOIN provider_profiles p ON p.id=pa.provider_profile_id
    WHERE pa.id=b.provider_account_id AND ((pa.kind='INDIVIDUAL' AND p.user_id=NEW.author_user_id AND NEW.membership_id IS NULL AND NEW.assignment_id IS NULL)
      OR (pa.kind='ORGANIZATION' AND EXISTS(SELECT 1 FROM organization_memberships m JOIN organization_resource_assignments s ON s.membership_id=m.id
        WHERE m.id=NEW.membership_id AND m.user_id=NEW.author_user_id AND m.organization_id=pa.organization_id AND m.state='ACTIVE' AND m.role<>'ANALYST'
        AND s.id=NEW.assignment_id AND s.provider_account_id=pa.id AND s.resource_type='INTERACTION' AND s.resource_id=b.interaction_id
        AND s.revoked_at IS NULL AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp()))))))
   THEN RAISE EXCEPTION 'invalid review submission'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.eligibility_id,NEW.interaction_id,NEW.viewing_id,NEW.direction,NEW.reviewer_subject_type,NEW.reviewer_subject_id,NEW.author_user_id,NEW.membership_id,NEW.assignment_id,NEW.target_type,NEW.target_id,NEW.created_at,NEW.policy_version)
  IS DISTINCT FROM ROW(OLD.id,OLD.eligibility_id,OLD.interaction_id,OLD.viewing_id,OLD.direction,OLD.reviewer_subject_type,OLD.reviewer_subject_id,OLD.author_user_id,OLD.membership_id,OLD.assignment_id,OLD.target_type,OLD.target_id,OLD.created_at,OLD.policy_version)
  OR NEW.version<>OLD.version+1 OR (OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at)
  THEN RAISE EXCEPTION 'immutable review metadata'; END IF;
 IF NEW.state='WITHDRAWN' AND OLD.state<>'WITHDRAWN' AND NEW.withdrawn_at IS NOT NULL AND
  ROW(NEW.rating,NEW.text,NEW.criteria,NEW.published_at) IS NOT DISTINCT FROM ROW(OLD.rating,OLD.text,OLD.criteria,OLD.published_at) THEN RETURN NEW; END IF;
 -- Only a fresh immutable, scoped action may change moderation state.
 IF ROW(NEW.rating,NEW.text,NEW.criteria,NEW.withdrawn_at,NEW.published_at) IS NOT DISTINCT FROM ROW(OLD.rating,OLD.text,OLD.criteria,OLD.withdrawn_at,OLD.published_at)
  AND OLD.state<>'WITHDRAWN' AND EXISTS(SELECT 1 FROM review_moderation_actions a WHERE a.review_id=NEW.id AND a.transaction_id=txid_current()
   AND a.review_version=NEW.version AND a.before_review_state=OLD.state AND a.after_review_state=NEW.state AND a.command IN ('HOLD','HIDE','REMOVE','RESTORE'))
  AND (NEW.state<>'PUBLISHED' OR (e.state='CONSUMED' AND review_context_valid(e.interaction_id) AND review_author_current(NEW.id) AND OLD.published_at IS NOT NULL))
  THEN RETURN NEW; END IF;
 IF OLD.state<>'SUBMITTED_HELD' OR e.state<>'CONSUMED' OR NOT review_context_valid(e.interaction_id) THEN RAISE EXCEPTION 'review is locked'; END IF;
 IF NEW.state='SUBMITTED_HELD' AND NEW.published_at IS NULL AND statement_timestamp()<e.closes_at AND review_actor_current(OLD.id) THEN RETURN NEW; END IF;
 IF NEW.state='PUBLISHED' AND NEW.published_at IS NOT NULL AND ROW(NEW.rating,NEW.text,NEW.criteria) IS NOT DISTINCT FROM ROW(OLD.rating,OLD.text,OLD.criteria)
  AND review_author_current(OLD.id)
  AND (e.closes_at<=statement_timestamp() OR (SELECT count(*) FROM reviews r JOIN viewing_review_eligibilities slot ON slot.id=r.eligibility_id
     WHERE r.interaction_id=NEW.interaction_id AND slot.state='CONSUMED' AND r.state IN ('SUBMITTED_HELD','PUBLISHED') AND review_author_current(r.id))=2) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'invalid review transition';
END $$;

ALTER TABLE viewing_notices ADD COLUMN source_review_moderation_action_id uuid REFERENCES review_moderation_actions(id);
ALTER TABLE viewing_notices ADD COLUMN moderation_reason_code text;
ALTER TABLE viewing_notices ADD COLUMN moderation_recipient_user_id uuid REFERENCES users(id);
ALTER TABLE viewing_notices ADD COLUMN appeal_deadline timestamptz;
ALTER TABLE viewing_notices DROP CONSTRAINT viewing_notice_one_source;
ALTER TABLE viewing_notices ADD CONSTRAINT viewing_notice_one_source CHECK(num_nonnulls(source_outbox_id,source_action_id,source_review_event_id,source_review_action_id,source_review_moderation_action_id)=1);
ALTER TABLE viewing_notices ADD CONSTRAINT review_moderation_notice_fields CHECK((source_review_moderation_action_id IS NOT NULL)=(moderation_reason_code IS NOT NULL AND appeal_deadline IS NOT NULL AND moderation_recipient_user_id IS NOT NULL));
CREATE UNIQUE INDEX review_moderation_notice_unique ON viewing_notices(source_review_moderation_action_id,recipient_side) WHERE source_review_moderation_action_id IS NOT NULL;
ALTER TABLE viewing_notices DROP CONSTRAINT viewing_notices_event_type_check;
ALTER TABLE viewing_notices ADD CONSTRAINT viewing_notices_event_type_check CHECK(event_type IN (
 'viewing_requested','viewing_accepted','viewing_declined','viewing_confirmed','viewing_scheduled','viewing_cancelled','viewing_expired',
 'viewing_reschedule_proposed','viewing_reschedule_accepted','viewing_reschedule_rejected','viewing_reschedule_withdrawn','viewing_reschedule_expired','viewing_reschedule_invalidated','viewing_rescheduled','viewing_reschedule_finalized',
 'viewing_reminder_24h','viewing_reminder_2h','viewing_completion_claimed','viewing_no_show_claimed','viewing_attendance_confirmed','viewing_attendance_disputed','viewing_attendance_finalized',
 'review_eligibility_created','review_submitted','review_published','review_withdrawn','review_window_closed','review_reminder_3d','review_reminder_1d','review_moderation_changed'));
-- Extend the existing safe review event stream. Prior bilateral policy and
-- event rows retain their original attribution and timestamps.
ALTER TABLE review_events DROP CONSTRAINT review_events_event_type_check;
ALTER TABLE review_events ADD CONSTRAINT review_events_event_type_check CHECK(event_type IN (
 'review_eligibility_created','review_submitted','review_edited','review_published','review_withdrawn','review_window_closed','review_reported','review_moderation_changed'));
ALTER TABLE review_events ADD COLUMN source_moderation_action_id uuid REFERENCES review_moderation_actions(id);
ALTER TABLE review_events ADD CONSTRAINT review_moderation_event_source CHECK((event_type='review_moderation_changed')=(source_moderation_action_id IS NOT NULL));
CREATE UNIQUE INDEX review_moderation_event_unique ON review_events(source_moderation_action_id) WHERE source_moderation_action_id IS NOT NULL;
CREATE OR REPLACE FUNCTION review_event_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM viewing_review_eligibilities e WHERE e.id=NEW.eligibility_id
  AND ROW(NEW.interaction_id,NEW.viewing_id,NEW.direction,NEW.policy_version)=ROW(e.interaction_id,e.viewing_id,e.direction,e.policy_version))
  OR (NEW.review_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reviews r WHERE r.id=NEW.review_id AND r.eligibility_id=NEW.eligibility_id))
  OR (NEW.source_moderation_action_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM review_moderation_actions a
   WHERE a.id=NEW.source_moderation_action_id AND a.review_id=NEW.review_id AND a.review_version=NEW.version
    AND a.actor_user_id=NEW.actor_user_id AND a.request_id=NEW.request_id AND a.command IN ('HOLD','HIDE','REMOVE','RESTORE')))
  THEN RAISE EXCEPTION 'invalid review event context'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION review_event_effects() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE moderation review_moderation_actions; payload jsonb;
BEGIN
 IF NEW.source_moderation_action_id IS NOT NULL THEN SELECT * INTO moderation FROM review_moderation_actions WHERE id=NEW.source_moderation_action_id; END IF;
 payload=jsonb_build_object('event_id',NEW.id,'review_id',NEW.review_id,'eligibility_id',NEW.eligibility_id,'viewing_id',NEW.viewing_id,'interaction_id',NEW.interaction_id,
  'direction',NEW.direction,'subject_type',CASE WHEN NEW.direction='SEEKER_TO_PROVIDER' THEN 'ProviderAccount' ELSE 'User' END,
  'policy_version',NEW.policy_version,'reason_category',coalesce(moderation.reason_code,'REVIEW_LIFECYCLE'));
 IF moderation.id IS NOT NULL THEN
  payload=payload||jsonb_build_object('action_id',moderation.id,'case_id',moderation.case_id,'command',moderation.command,
   'moderation_policy_version',moderation.policy_version,'request_id',NEW.request_id);
 END IF;
 INSERT INTO review_outbox(event_id,event_type,safe_payload) VALUES(NEW.id,NEW.event_type,payload);
 INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata)
  VALUES(NEW.actor_user_id,upper(NEW.event_type),'Review',coalesce(NEW.review_id,NEW.eligibility_id),coalesce(moderation.reason_code,'REVIEW_LIFECYCLE'),NEW.request_id,
   jsonb_build_object('event_id',NEW.id,'version',NEW.version,'policy_version',NEW.policy_version));
 -- Moderation's author-only outcome notice is produced from the action once.
 -- All original lifecycle notice behavior remains exactly the same.
 IF NEW.event_type IN ('review_eligibility_created','review_submitted','review_published','review_withdrawn','review_window_closed') THEN
  INSERT INTO viewing_notices(viewing_id,source_review_event_id,recipient_side,seeker_user_id,provider_account_id,event_type,schedule_version,event_at)
   SELECT v.id,NEW.id,s.side,CASE WHEN s.side='SEEKER' THEN v.seeker_user_id END,CASE WHEN s.side='PROVIDER' THEN v.provider_account_id END,NEW.event_type,v.schedule_version,NEW.created_at
   FROM viewings v CROSS JOIN(VALUES('SEEKER'),('PROVIDER')) s(side) WHERE v.id=NEW.viewing_id
   AND ((NEW.event_type='review_published') OR s.side=CASE WHEN NEW.direction='SEEKER_TO_PROVIDER' THEN 'SEEKER' ELSE 'PROVIDER' END);
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION review_moderation_action_effects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata)
  VALUES(NEW.actor_user_id,'REVIEW_MODERATION_'||NEW.command,'ReviewModerationCase',NEW.case_id,NEW.reason_code,NEW.request_id,
   jsonb_build_object('action_id',NEW.id,'review_id',NEW.review_id,'case_version',NEW.case_version,'review_version',NEW.review_version,'policy_version',NEW.policy_version));
 IF NEW.notice_available_at IS NOT NULL THEN
  INSERT INTO review_events(eligibility_id,review_id,interaction_id,viewing_id,direction,event_type,version,actor_user_id,request_id,policy_version,source_moderation_action_id)
   SELECT e.id,r.id,e.interaction_id,e.viewing_id,e.direction,'review_moderation_changed',NEW.review_version,NEW.actor_user_id,NEW.request_id,e.policy_version,NEW.id
   FROM reviews r JOIN viewing_review_eligibilities e ON e.id=r.eligibility_id WHERE r.id=NEW.review_id;
  INSERT INTO viewing_notices(viewing_id,source_review_moderation_action_id,recipient_side,seeker_user_id,provider_account_id,event_type,schedule_version,event_at,available_at,moderation_reason_code,appeal_deadline,moderation_recipient_user_id)
   SELECT r.viewing_id,NEW.id,CASE WHEN r.direction='SEEKER_TO_PROVIDER' THEN 'SEEKER' ELSE 'PROVIDER' END,
    CASE WHEN r.direction='SEEKER_TO_PROVIDER' THEN i.seeker_user_id END,CASE WHEN r.direction='PROVIDER_TO_SEEKER' THEN i.provider_account_id END,
    'review_moderation_changed',v.schedule_version,NEW.created_at,NEW.notice_available_at,NEW.reason_code,NEW.appeal_deadline,r.author_user_id
   FROM reviews r JOIN interactions i ON i.id=r.interaction_id JOIN viewings v ON v.id=r.viewing_id WHERE r.id=NEW.review_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_moderation_action_effects AFTER INSERT ON review_moderation_actions FOR EACH ROW EXECUTE FUNCTION review_moderation_action_effects();
