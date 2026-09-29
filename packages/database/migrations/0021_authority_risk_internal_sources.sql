-- Internal authority-risk sources only. No real document intake or inferred clearance.
CREATE TABLE authority_risk_source_clock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);
INSERT INTO authority_risk_source_clock(singleton) VALUES (true);

ALTER TABLE provider_property_relationships ADD COLUMN authority_version integer NOT NULL DEFAULT 1;
ALTER TABLE provider_accounts ADD COLUMN authority_principal_version integer NOT NULL DEFAULT 1;

CREATE TABLE property_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_property_id uuid NOT NULL UNIQUE REFERENCES properties(id) ON DELETE RESTRICT,
  canonical_property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  recorded_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_property_id <> canonical_property_id)
);
CREATE INDEX property_merges_canonical_idx ON property_merges(canonical_property_id);

CREATE TABLE authority_risk_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  relationship_id uuid REFERENCES provider_property_relationships(id) ON DELETE RESTRICT,
  principal_id uuid REFERENCES provider_accounts(id) ON DELETE RESTRICT,
  subject_scope text NOT NULL CHECK (subject_scope IN ('PROPERTY','RELATIONSHIP','PRINCIPAL')),
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('DISPUTE','ADVERSE','REPRESENTATION','FRAUD')),
  allegation_kind text NOT NULL CHECK (allegation_kind IN ('REPORTED','ESTABLISHED','LEGACY')),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','RESOLVED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  assigned_staff_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  source_provenance text NOT NULL CHECK (source_provenance IN ('STAFF_OBSERVATION','PROVIDER_REPORT','THIRD_PARTY_REPORT','LEGACY_STATUS')),
  received_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  safe_remediation text NOT NULL CHECK (length(safe_remediation) BETWEEN 1 AND 240),
  evidence_ref_type text CHECK (evidence_ref_type IN ('PROPERTY','RELATIONSHIP','CASE_ACTION','MERGE')),
  evidence_ref_id uuid,
  resolved_at timestamptz,
  CHECK ((evidence_ref_type IS NULL) = (evidence_ref_id IS NULL)),
  CHECK ((subject_scope = 'PROPERTY') OR (subject_scope = 'RELATIONSHIP' AND relationship_id IS NOT NULL) OR (subject_scope = 'PRINCIPAL' AND principal_id IS NOT NULL)),
  CHECK (source_provenance = 'LEGACY_STATUS' OR (assigned_staff_user_id IS NOT NULL AND received_at IS NOT NULL)),
  CHECK ((state = 'RESOLVED') = (resolved_at IS NOT NULL))
);
CREATE INDEX authority_risk_cases_property_idx ON authority_risk_cases(property_id, state, subject_scope);
CREATE INDEX authority_risk_cases_assignee_idx ON authority_risk_cases(assigned_staff_user_id, state);

CREATE TABLE authority_risk_case_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES authority_risk_cases(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('OPENED','ASSIGNED','SOURCE_REVIEWED','FINDING_CONFIRMED','RESOLVED')),
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  evidence_ref_type text CHECK (evidence_ref_type IN ('PROPERTY','RELATIONSHIP','CASE_ACTION','MERGE')),
  evidence_ref_id uuid,
  policy_version text NOT NULL DEFAULT 'authority-risk-internal-v1',
  request_id uuid NOT NULL UNIQUE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((evidence_ref_type IS NULL) = (evidence_ref_id IS NULL))
);
CREATE INDEX authority_risk_actions_case_idx ON authority_risk_case_actions(case_id, recorded_at);

CREATE TABLE authority_risk_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES provider_property_relationships(id) ON DELETE RESTRICT,
  relationship_version integer NOT NULL,
  principal_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE RESTRICT,
  principal_version integer NOT NULL,
  source_version bigint NOT NULL,
  rule_version text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('CLEAR','HOLD','INCOMPLETE')),
  source_coverage jsonb NOT NULL CHECK (jsonb_typeof(source_coverage) = 'object'),
  trigger_findings jsonb NOT NULL CHECK (jsonb_typeof(trigger_findings) = 'object'),
  applicable_case_ids uuid[] NOT NULL DEFAULT '{}',
  evaluated_by text NOT NULL DEFAULT 'pachi-authority-risk-evaluator-v1',
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (relationship_id, relationship_version, principal_version, source_version, rule_version)
);
CREATE INDEX authority_risk_evaluations_latest_idx ON authority_risk_evaluations(relationship_id, evaluated_at DESC);

CREATE FUNCTION authority_risk_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'authority risk history is append-only'; END $$;
CREATE TRIGGER authority_actions_immutable BEFORE UPDATE OR DELETE ON authority_risk_case_actions FOR EACH ROW EXECUTE FUNCTION authority_risk_immutable();
CREATE TRIGGER authority_evaluations_immutable BEFORE UPDATE OR DELETE ON authority_risk_evaluations FOR EACH ROW EXECUTE FUNCTION authority_risk_immutable();
CREATE TRIGGER property_merges_immutable BEFORE UPDATE OR DELETE ON property_merges FOR EACH ROW EXECUTE FUNCTION authority_risk_immutable();

CREATE FUNCTION authority_risk_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'authority risk cases cannot be deleted'; END IF;
  IF NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.relationship_id IS DISTINCT FROM OLD.relationship_id
    OR NEW.principal_id IS DISTINCT FROM OLD.principal_id OR NEW.subject_scope IS DISTINCT FROM OLD.subject_scope
    OR NEW.trigger_kind IS DISTINCT FROM OLD.trigger_kind OR NEW.source_provenance IS DISTINCT FROM OLD.source_provenance
    OR NEW.received_at IS DISTINCT FROM OLD.received_at OR NEW.observed_at IS DISTINCT FROM OLD.observed_at
    OR NEW.reason_code IS DISTINCT FROM OLD.reason_code OR NEW.safe_remediation IS DISTINCT FROM OLD.safe_remediation
    OR NEW.evidence_ref_type IS DISTINCT FROM OLD.evidence_ref_type OR NEW.evidence_ref_id IS DISTINCT FROM OLD.evidence_ref_id
    OR NEW.version <> OLD.version + 1 OR OLD.state = 'RESOLVED'
    OR (OLD.allegation_kind <> NEW.allegation_kind AND NOT (OLD.allegation_kind = 'REPORTED' AND NEW.allegation_kind = 'ESTABLISHED'))
    OR (OLD.state <> NEW.state AND NOT (OLD.state = 'OPEN' AND NEW.state = 'RESOLVED'))
    OR (OLD.assigned_staff_user_id IS NOT NULL AND NEW.assigned_staff_user_id IS DISTINCT FROM OLD.assigned_staff_user_id)
  THEN RAISE EXCEPTION 'authority risk case transition denied'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER authority_case_transition BEFORE UPDATE OR DELETE ON authority_risk_cases FOR EACH ROW EXECUTE FUNCTION authority_risk_case_guard();

CREATE FUNCTION authority_risk_bump_clock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE authority_risk_source_clock SET version = version + 1 WHERE singleton;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER authority_relationship_clock AFTER INSERT OR UPDATE OR DELETE ON provider_property_relationships FOR EACH ROW EXECUTE FUNCTION authority_risk_bump_clock();
CREATE TRIGGER authority_principal_clock AFTER UPDATE ON provider_accounts FOR EACH ROW EXECUTE FUNCTION authority_risk_bump_clock();
CREATE TRIGGER authority_profile_clock AFTER UPDATE OF provider_types,state ON provider_profiles FOR EACH ROW EXECUTE FUNCTION authority_risk_bump_clock();
CREATE TRIGGER authority_property_state_clock AFTER UPDATE OF record_state ON properties FOR EACH ROW EXECUTE FUNCTION authority_risk_bump_clock();
CREATE TRIGGER authority_cases_clock AFTER INSERT OR UPDATE OR DELETE ON authority_risk_cases FOR EACH ROW EXECUTE FUNCTION authority_risk_bump_clock();
CREATE TRIGGER authority_actions_clock AFTER INSERT ON authority_risk_case_actions FOR EACH ROW EXECUTE FUNCTION authority_risk_bump_clock();
CREATE TRIGGER authority_merges_clock AFTER INSERT ON property_merges FOR EACH ROW EXECUTE FUNCTION authority_risk_bump_clock();

CREATE FUNCTION authority_relationship_version_and_legacy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.authority_version := OLD.authority_version + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER authority_relationship_version BEFORE UPDATE ON provider_property_relationships FOR EACH ROW EXECUTE FUNCTION authority_relationship_version_and_legacy();
CREATE FUNCTION authority_principal_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.authority_principal_version := OLD.authority_principal_version + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER authority_principal_version BEFORE UPDATE ON provider_accounts FOR EACH ROW EXECUTE FUNCTION authority_principal_version();

-- This observed state is not a fabricated historic decision, actor, reason or date.
INSERT INTO authority_risk_cases(property_id,relationship_id,principal_id,subject_scope,trigger_kind,allegation_kind,source_provenance,reason_code,safe_remediation)
SELECT property_id,id,provider_account_id,'RELATIONSHIP','ADVERSE','LEGACY','LEGACY_STATUS','LEGACY_ADVERSE_REVIEW_REQUIRED','Contact support for an authority review.'
FROM provider_property_relationships WHERE authorization_status IN ('REJECTED','REVOKED');
INSERT INTO authority_risk_case_actions(case_id,action,reason_code,request_id)
SELECT id,'OPENED','LEGACY_ADVERSE_REVIEW_REQUIRED',gen_random_uuid() FROM authority_risk_cases WHERE source_provenance='LEGACY_STATUS';

CREATE FUNCTION authority_capture_adverse_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_case_id uuid;
BEGIN
  IF NEW.authorization_status IN ('REJECTED','REVOKED') AND (TG_OP = 'INSERT' OR OLD.authorization_status IS DISTINCT FROM NEW.authorization_status) THEN
    INSERT INTO authority_risk_cases(property_id,relationship_id,principal_id,subject_scope,trigger_kind,allegation_kind,source_provenance,reason_code,safe_remediation)
    VALUES (NEW.property_id,NEW.id,NEW.provider_account_id,'RELATIONSHIP','ADVERSE','LEGACY','LEGACY_STATUS','ADVERSE_STATUS_REVIEW_REQUIRED','Contact support for an authority review.') RETURNING id INTO new_case_id;
    INSERT INTO authority_risk_case_actions(case_id,action,reason_code,request_id)
    VALUES (new_case_id,'OPENED','ADVERSE_STATUS_REVIEW_REQUIRED',gen_random_uuid());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER authority_adverse_capture AFTER INSERT OR UPDATE OF authorization_status ON provider_property_relationships FOR EACH ROW EXECUTE FUNCTION authority_capture_adverse_status();

CREATE FUNCTION property_merge_no_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_state property_record_state;
BEGIN
  -- Keep the source state stable while checking lineage. An unlinked MERGED
  -- property remains incomplete until an authorized merge is recorded.
  SELECT record_state INTO source_state FROM properties WHERE id=NEW.source_property_id FOR SHARE;
  IF source_state IS DISTINCT FROM 'MERGED' THEN
    RAISE EXCEPTION 'property merge source must be MERGED';
  END IF;
  -- Serialize lineage checks before insertion. Without this lock, reciprocal
  -- concurrent inserts could each miss the other's uncommitted edge.
  PERFORM 1 FROM authority_risk_source_clock WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'authority risk source clock unavailable'; END IF;
  IF EXISTS (
    WITH RECURSIVE successors(id) AS (
      SELECT NEW.canonical_property_id
      UNION
      SELECT m.canonical_property_id FROM property_merges m JOIN successors s ON m.source_property_id=s.id
    ) SELECT 1 FROM successors WHERE id=NEW.source_property_id
  ) THEN RAISE EXCEPTION 'property merge cycle'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER property_merge_cycle BEFORE INSERT ON property_merges FOR EACH ROW EXECUTE FUNCTION property_merge_no_cycle();

CREATE FUNCTION property_merge_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.record_state <> 'MERGED' AND EXISTS (
    SELECT 1 FROM property_merges WHERE source_property_id=NEW.id
  ) THEN RAISE EXCEPTION 'property merge source must remain MERGED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER property_merge_source_state BEFORE UPDATE OF record_state ON properties
FOR EACH ROW EXECUTE FUNCTION property_merge_state_guard();
