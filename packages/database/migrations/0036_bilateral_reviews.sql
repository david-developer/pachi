-- Expand the first validated attendance boundary. Prior SQL remains immutable.
ALTER TABLE viewing_review_eligibilities ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE TABLE reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 eligibility_id uuid NOT NULL UNIQUE REFERENCES viewing_review_eligibilities(id),
 interaction_id uuid NOT NULL REFERENCES interactions(id),
 viewing_id uuid NOT NULL REFERENCES viewings(id),
 direction text NOT NULL CHECK(direction IN ('SEEKER_TO_PROVIDER','PROVIDER_TO_SEEKER')),
 reviewer_subject_type text NOT NULL CHECK(reviewer_subject_type IN ('User','ProviderAccount')),
 reviewer_subject_id uuid NOT NULL,
 author_user_id uuid NOT NULL REFERENCES users(id),
 membership_id uuid REFERENCES organization_memberships(id),
 assignment_id uuid REFERENCES organization_resource_assignments(id),
 target_type text NOT NULL CHECK(target_type IN ('User','ProviderAccount')),
 target_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'SUBMITTED_HELD' CHECK(state IN ('SUBMITTED_HELD','PUBLISHED','UNDER_REVIEW','HIDDEN','REMOVED','WITHDRAWN')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5),
 text text CHECK(char_length(text)<=2000),
 criteria jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(criteria)='object'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 published_at timestamptz,
 withdrawn_at timestamptz,
 policy_version text NOT NULL DEFAULT 'bilateral-review-v1' CHECK(policy_version='bilateral-review-v1'),
 CHECK((state='WITHDRAWN')=(withdrawn_at IS NOT NULL)),
 CHECK(state<>'PUBLISHED' OR published_at IS NOT NULL)
);
CREATE INDEX reviews_target_page ON reviews(target_type,target_id,id DESC) WHERE state='PUBLISHED';
CREATE TABLE review_revisions (
 review_id uuid NOT NULL REFERENCES reviews(id),
 version integer NOT NULL CHECK(version>0),
 author_user_id uuid NOT NULL REFERENCES users(id),
 rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5),
 text text CHECK(char_length(text)<=2000),
 criteria jsonb NOT NULL CHECK(jsonb_typeof(criteria)='object'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(review_id,version)
);
CREATE TRIGGER review_revisions_immutable BEFORE UPDATE OR DELETE ON review_revisions FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE TABLE review_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 eligibility_id uuid NOT NULL REFERENCES viewing_review_eligibilities(id),
 review_id uuid REFERENCES reviews(id),
 interaction_id uuid NOT NULL REFERENCES interactions(id),
 viewing_id uuid NOT NULL REFERENCES viewings(id),
 direction text NOT NULL CHECK(direction IN ('SEEKER_TO_PROVIDER','PROVIDER_TO_SEEKER')),
 event_type text NOT NULL CHECK(event_type IN ('review_eligibility_created','review_submitted','review_edited','review_published','review_withdrawn','review_window_closed','review_reported')),
 version integer NOT NULL CHECK(version>0),
 actor_user_id uuid REFERENCES users(id),
 request_id uuid,
 policy_version text NOT NULL DEFAULT 'bilateral-review-v1' CHECK(policy_version='bilateral-review-v1'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(eligibility_id,event_type,version)
);
CREATE TRIGGER review_events_immutable BEFORE UPDATE OR DELETE ON review_events FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE TABLE review_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL UNIQUE REFERENCES review_events(id),
 event_type text NOT NULL,
 safe_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 published_at timestamptz,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0)
);
CREATE TABLE review_command_receipts (
 actor_user_id uuid NOT NULL REFERENCES users(id),
 idempotency_key uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('SUBMIT','EDIT','WITHDRAW','REPORT')),
 request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
 review_id uuid NOT NULL REFERENCES reviews(id),
 report_id uuid,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(actor_user_id,idempotency_key)
);
CREATE TRIGGER review_command_receipts_immutable BEFORE UPDATE OR DELETE ON review_command_receipts FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE TABLE review_scheduled_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 eligibility_id uuid NOT NULL REFERENCES viewing_review_eligibilities(id),
 action_type text NOT NULL CHECK(action_type IN ('REVEAL_DEADLINE','REMINDER_3D','REMINDER_1D')),
 expected_eligibility_version integer NOT NULL CHECK(expected_eligibility_version>0),
 due_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','LEASED','PROCESSED','SKIPPED')),
 lease_token uuid,
 lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_checked_at timestamptz,
 processed_at timestamptz,
 reason_code text,
 CHECK((state='LEASED')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 UNIQUE(eligibility_id,action_type)
);
CREATE INDEX review_actions_due ON review_scheduled_actions(state,last_checked_at,due_at,id);
CREATE TABLE review_reputation (
 target_type text NOT NULL CHECK(target_type IN ('User','ProviderAccount')),
 target_id uuid NOT NULL,
 published_count integer NOT NULL CHECK(published_count>=0),
 rating_sum integer NOT NULL CHECK(rating_sum>=published_count AND rating_sum<=published_count*5),
 reconciled_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(target_type,target_id)
);
-- Intake only: no moderator decision, report-count sanction or staff override.
CREATE TABLE review_moderation_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 review_id uuid NOT NULL UNIQUE REFERENCES reviews(id),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state='OPEN'),
 review_status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(review_status='PENDING_REVIEW'),
 opened_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE review_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES review_moderation_cases(id),
 review_id uuid NOT NULL REFERENCES reviews(id),
 reporter_user_id uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL CHECK(reason IN ('HARASSMENT','DISCRIMINATION','THREATS','PRIVACY_EXPOSURE','EXTORTION','IMPERSONATION','IRRELEVANT_CONTENT','OTHER')),
 details text CHECK(char_length(details)<=2000),
 request_id uuid,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE review_command_receipts ADD CONSTRAINT review_receipt_report_reference FOREIGN KEY(report_id) REFERENCES review_reports(id);
CREATE TRIGGER review_reports_immutable BEFORE UPDATE OR DELETE ON review_reports FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();
CREATE TRIGGER review_cases_immutable BEFORE UPDATE OR DELETE ON review_moderation_cases FOR EACH ROW EXECUTE FUNCTION viewing_history_immutable();

-- Reads filter the source now, rather than trusting a potentially stale sum.
CREATE FUNCTION review_context_valid(context_id uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM viewing_review_boundaries b
 JOIN viewing_attendance_outcomes a ON a.id=b.attendance_outcome_id
 JOIN viewings v ON v.id=b.viewing_id JOIN interactions i ON i.id=b.interaction_id
 JOIN listings l ON l.id=i.listing_id JOIN provider_accounts pa ON pa.id=i.provider_account_id
 JOIN users u ON u.id=b.seeker_user_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
 LEFT JOIN users pu ON pu.id=pp.user_id LEFT JOIN organizations org ON org.id=pa.organization_id
 WHERE b.interaction_id=context_id AND b.eligibility_state='OPEN' AND a.state='COMPLETED'
 AND v.state='COMPLETED' AND v.schedule_version=a.schedule_version AND v.attendance_validated_at=a.finalized_at
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
 AND NOT EXISTS(SELECT 1 FROM viewing_attendance_outcomes other WHERE other.viewing_id IN(SELECT id FROM viewings WHERE interaction_id=i.id) AND other.state='DISPUTED'))
$$;
CREATE VIEW eligible_published_reviews AS
 SELECT r.* FROM reviews r JOIN viewing_review_eligibilities e ON e.id=r.eligibility_id
 JOIN users u ON u.id=r.author_user_id WHERE r.state='PUBLISHED' AND e.state='CONSUMED'
 AND e.consumed_at IS NOT NULL AND u.account_state='ACTIVE' AND review_context_valid(r.interaction_id);

CREATE FUNCTION review_author_current(review_id uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM reviews r JOIN users u ON u.id=r.author_user_id
 JOIN interactions i ON i.id=r.interaction_id JOIN provider_accounts pa ON pa.id=i.provider_account_id
 LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
 WHERE r.id=review_id AND u.account_state='ACTIVE'
 AND EXISTS(SELECT 1 FROM phone_contacts p WHERE p.user_id=u.id AND p.verified_at IS NOT NULL AND p.replaced_at IS NULL AND p.verification_version>0)
 AND (r.direction='SEEKER_TO_PROVIDER' OR (pa.kind='INDIVIDUAL' AND pp.user_id=r.author_user_id) OR
  (pa.kind='ORGANIZATION' AND EXISTS(SELECT 1 FROM organization_memberships m JOIN organization_resource_assignments s ON s.membership_id=m.id JOIN users member_user ON member_user.id=m.user_id
   WHERE m.organization_id=pa.organization_id AND m.state='ACTIVE' AND m.role<>'ANALYST' AND member_user.account_state='ACTIVE'
    AND EXISTS(SELECT 1 FROM phone_contacts phone WHERE phone.user_id=m.user_id AND phone.verified_at IS NOT NULL AND phone.replaced_at IS NULL AND phone.verification_version>0)
    AND s.provider_account_id=pa.id AND s.resource_type='INTERACTION' AND s.resource_id=i.id AND s.revoked_at IS NULL
    AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp())))))
$$;
CREATE FUNCTION review_actor_current(review_id uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS(SELECT 1 FROM reviews r JOIN users u ON u.id=r.author_user_id
 JOIN interactions i ON i.id=r.interaction_id JOIN provider_accounts pa ON pa.id=i.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
 WHERE r.id=review_id AND u.account_state='ACTIVE'
 AND EXISTS(SELECT 1 FROM phone_contacts p WHERE p.user_id=u.id AND p.verified_at IS NOT NULL AND p.replaced_at IS NULL AND p.verification_version>0)
 AND ((r.direction='SEEKER_TO_PROVIDER' AND r.author_user_id=i.seeker_user_id) OR
 (r.direction='PROVIDER_TO_SEEKER' AND ((pa.kind='INDIVIDUAL' AND pp.user_id=r.author_user_id) OR
  (pa.kind='ORGANIZATION' AND EXISTS(SELECT 1 FROM organization_memberships m JOIN organization_resource_assignments s ON s.membership_id=m.id
   WHERE m.organization_id=pa.organization_id AND m.user_id=r.author_user_id AND m.state='ACTIVE' AND m.role<>'ANALYST'
    AND s.provider_account_id=pa.id AND s.resource_type='INTERACTION' AND s.resource_id=i.id AND s.revoked_at IS NULL
    AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp())))))))
$$;

CREATE OR REPLACE FUNCTION viewing_review_eligibility_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'review eligibility is retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'OPEN' OR NEW.version<>1 OR NEW.consumed_at IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM viewing_review_boundaries b JOIN viewing_attendance_outcomes a ON a.id=b.attendance_outcome_id
    WHERE b.interaction_id=NEW.interaction_id AND b.viewing_id=NEW.viewing_id AND b.eligibility_state='OPEN' AND a.state='COMPLETED'
    AND ((NEW.direction='SEEKER_TO_PROVIDER' AND NEW.reviewer_subject_id=b.seeker_user_id AND NEW.target_id=b.provider_account_id)
      OR (NEW.direction='PROVIDER_TO_SEEKER' AND NEW.reviewer_subject_id=b.provider_account_id AND NEW.target_id=b.seeker_user_id)))
    THEN RAISE EXCEPTION 'invalid review eligibility context'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.interaction_id,NEW.viewing_id,NEW.direction,NEW.reviewer_subject_type,NEW.reviewer_subject_id,NEW.target_type,NEW.target_id,NEW.opens_at,NEW.closes_at,NEW.policy_version)
  IS DISTINCT FROM ROW(OLD.id,OLD.interaction_id,OLD.viewing_id,OLD.direction,OLD.reviewer_subject_type,OLD.reviewer_subject_id,OLD.target_type,OLD.target_id,OLD.opens_at,OLD.closes_at,OLD.policy_version)
  OR OLD.state<>'OPEN' OR (NEW.version<>OLD.version+1 AND NOT(NEW.state='HELD' AND NEW.version=OLD.version))
  OR NOT((NEW.state='HELD' AND NEW.consumed_at IS NULL AND EXISTS(SELECT 1 FROM viewing_attendance_outcomes a JOIN viewings v ON v.id=a.viewing_id WHERE v.interaction_id=NEW.interaction_id AND a.state='DISPUTED'))
    OR (NEW.state='CONSUMED' AND NEW.consumed_at IS NOT NULL AND NEW.opens_at<=NEW.consumed_at AND NEW.consumed_at<NEW.closes_at
      AND review_context_valid(NEW.interaction_id) AND EXISTS(SELECT 1 FROM reviews r WHERE r.eligibility_id=NEW.id AND r.state='SUBMITTED_HELD'))
    OR (NEW.state='EXPIRED' AND NEW.consumed_at IS NULL AND NEW.closes_at<=statement_timestamp()))
  THEN RAISE EXCEPTION 'invalid review eligibility transition'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e viewing_review_eligibilities; b viewing_review_boundaries; k text; value jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'reviews are retained'; END IF;
 SELECT * INTO e FROM viewing_review_eligibilities WHERE id=NEW.eligibility_id;
 PERFORM id FROM interactions WHERE id=e.interaction_id FOR NO KEY UPDATE;
 SELECT * INTO b FROM viewing_review_boundaries WHERE interaction_id=e.interaction_id;
 IF e.id IS NULL OR ROW(NEW.interaction_id,NEW.viewing_id,NEW.direction,NEW.reviewer_subject_type,NEW.reviewer_subject_id,NEW.target_type,NEW.target_id)
  IS DISTINCT FROM ROW(e.interaction_id,e.viewing_id,e.direction,e.reviewer_subject_type,e.reviewer_subject_id,e.target_type,e.target_id)
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
 IF OLD.state<>'SUBMITTED_HELD' OR e.state<>'CONSUMED' OR NOT review_context_valid(e.interaction_id) THEN RAISE EXCEPTION 'review is locked'; END IF;
 IF NEW.state='SUBMITTED_HELD' AND NEW.published_at IS NULL AND statement_timestamp()<e.closes_at AND review_actor_current(OLD.id) THEN RETURN NEW; END IF;
 IF NEW.state='PUBLISHED' AND NEW.published_at IS NOT NULL AND ROW(NEW.rating,NEW.text,NEW.criteria) IS NOT DISTINCT FROM ROW(OLD.rating,OLD.text,OLD.criteria)
  AND review_author_current(OLD.id)
  AND (e.closes_at<=statement_timestamp() OR (SELECT count(*) FROM reviews r JOIN viewing_review_eligibilities slot ON slot.id=r.eligibility_id
     WHERE r.interaction_id=NEW.interaction_id AND slot.state='CONSUMED' AND r.state IN ('SUBMITTED_HELD','PUBLISHED') AND review_author_current(r.id))=2) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'invalid review transition';
END $$;
CREATE TRIGGER review_guard BEFORE INSERT OR UPDATE OR DELETE ON reviews FOR EACH ROW EXECUTE FUNCTION review_guard();
CREATE FUNCTION review_retain_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR ROW(NEW.rating,NEW.text,NEW.criteria) IS DISTINCT FROM ROW(OLD.rating,OLD.text,OLD.criteria) THEN
  INSERT INTO review_revisions(review_id,version,author_user_id,rating,text,criteria) VALUES(NEW.id,NEW.version,NEW.author_user_id,NEW.rating,NEW.text,NEW.criteria);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_retain_revision AFTER INSERT OR UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION review_retain_revision();

-- Existing inbox availability and per-user read receipts are reused. Reviews
-- introduce two source references, with exactly one durable source per notice.
ALTER TABLE viewing_notices ADD COLUMN source_review_event_id uuid REFERENCES review_events(id);
ALTER TABLE viewing_notices ADD COLUMN source_review_action_id uuid REFERENCES review_scheduled_actions(id);
ALTER TABLE viewing_notices DROP CONSTRAINT viewing_notices_check;
ALTER TABLE viewing_notices ADD CONSTRAINT viewing_notice_one_source CHECK(
 num_nonnulls(source_outbox_id,source_action_id,source_review_event_id,source_review_action_id)=1);
CREATE UNIQUE INDEX viewing_notice_review_event_unique ON viewing_notices(source_review_event_id,recipient_side) WHERE source_review_event_id IS NOT NULL;
CREATE UNIQUE INDEX viewing_notice_review_action_unique ON viewing_notices(source_review_action_id,recipient_side) WHERE source_review_action_id IS NOT NULL;
ALTER TABLE viewing_notices DROP CONSTRAINT viewing_notices_event_type_check;
ALTER TABLE viewing_notices ADD CONSTRAINT viewing_notices_event_type_check CHECK(event_type IN (
 'viewing_requested','viewing_accepted','viewing_declined','viewing_confirmed','viewing_scheduled','viewing_cancelled','viewing_expired',
 'viewing_reschedule_proposed','viewing_reschedule_accepted','viewing_reschedule_rejected','viewing_reschedule_withdrawn','viewing_reschedule_expired','viewing_reschedule_invalidated','viewing_rescheduled','viewing_reschedule_finalized',
 'viewing_reminder_24h','viewing_reminder_2h','viewing_completion_claimed','viewing_no_show_claimed','viewing_attendance_confirmed','viewing_attendance_disputed','viewing_attendance_finalized',
 'review_eligibility_created','review_submitted','review_published','review_withdrawn','review_window_closed','review_reminder_3d','review_reminder_1d'));
CREATE FUNCTION review_event_effects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO review_outbox(event_id,event_type,safe_payload) VALUES(NEW.id,NEW.event_type,
  jsonb_build_object('event_id',NEW.id,'review_id',NEW.review_id,'eligibility_id',NEW.eligibility_id,'viewing_id',NEW.viewing_id,'interaction_id',NEW.interaction_id,
    'direction',NEW.direction,'subject_type',CASE WHEN NEW.direction='SEEKER_TO_PROVIDER' THEN 'ProviderAccount' ELSE 'User' END,'policy_version',NEW.policy_version,'reason_category','REVIEW_LIFECYCLE'));
 INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,safe_metadata)
  VALUES(NEW.actor_user_id,upper(NEW.event_type),'Review',coalesce(NEW.review_id,NEW.eligibility_id),'REVIEW_LIFECYCLE',jsonb_build_object('event_id',NEW.id,'version',NEW.version,'policy_version',NEW.policy_version));
 IF NEW.event_type IN ('review_eligibility_created','review_submitted','review_published','review_withdrawn','review_window_closed') THEN
  INSERT INTO viewing_notices(viewing_id,source_review_event_id,recipient_side,seeker_user_id,provider_account_id,event_type,schedule_version,event_at)
   SELECT v.id,NEW.id,s.side,CASE WHEN s.side='SEEKER' THEN v.seeker_user_id END,CASE WHEN s.side='PROVIDER' THEN v.provider_account_id END,NEW.event_type,v.schedule_version,NEW.created_at
   FROM viewings v CROSS JOIN(VALUES('SEEKER'),('PROVIDER')) s(side) WHERE v.id=NEW.viewing_id
   AND ((NEW.event_type='review_published') OR s.side=CASE WHEN NEW.direction='SEEKER_TO_PROVIDER' THEN 'SEEKER' ELSE 'PROVIDER' END);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_event_effects AFTER INSERT ON review_events FOR EACH ROW EXECUTE FUNCTION review_event_effects();
CREATE FUNCTION review_prepare_eligibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO review_events(eligibility_id,interaction_id,viewing_id,direction,event_type,version)
  VALUES(NEW.id,NEW.interaction_id,NEW.viewing_id,NEW.direction,'review_eligibility_created',NEW.version) ON CONFLICT DO NOTHING;
 INSERT INTO review_scheduled_actions(eligibility_id,action_type,expected_eligibility_version,due_at)
  VALUES(NEW.id,'REVEAL_DEADLINE',NEW.version,NEW.closes_at),
   (NEW.id,'REMINDER_3D',NEW.version,NEW.closes_at-interval '3 days'),(NEW.id,'REMINDER_1D',NEW.version,NEW.closes_at-interval '1 day') ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER review_prepare_eligibility AFTER INSERT ON viewing_review_eligibilities FOR EACH ROW EXECUTE FUNCTION review_prepare_eligibility();
-- Bounded by the existing eligibility set; replay-safe for pre-G1 boundaries.
INSERT INTO review_events(eligibility_id,interaction_id,viewing_id,direction,event_type,version)
 SELECT id,interaction_id,viewing_id,direction,'review_eligibility_created',version FROM viewing_review_eligibilities ON CONFLICT DO NOTHING;
INSERT INTO review_scheduled_actions(eligibility_id,action_type,expected_eligibility_version,due_at)
 SELECT e.id,s.kind,e.version,e.closes_at-s.delta FROM viewing_review_eligibilities e
 CROSS JOIN(VALUES('REVEAL_DEADLINE',interval '0 days'),('REMINDER_3D',interval '3 days'),('REMINDER_1D',interval '1 day')) s(kind,delta) ON CONFLICT DO NOTHING;
