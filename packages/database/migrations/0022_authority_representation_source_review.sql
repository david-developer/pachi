-- Internal structured representation evidence only. No document intake.
ALTER TABLE authority_risk_cases DROP CONSTRAINT authority_risk_cases_evidence_ref_type_check;
ALTER TABLE authority_risk_cases ADD CONSTRAINT authority_risk_cases_evidence_ref_type_check
  CHECK (evidence_ref_type IN ('PROPERTY','RELATIONSHIP','CASE_ACTION','MERGE','LISTING'));
ALTER TABLE authority_risk_cases ADD CONSTRAINT authority_representation_listing_reference
  CHECK (evidence_ref_type IS DISTINCT FROM 'LISTING' OR
    (subject_scope='RELATIONSHIP' AND trigger_kind='REPRESENTATION' AND relationship_id IS NOT NULL));

ALTER TABLE authority_risk_case_actions DROP CONSTRAINT authority_risk_case_actions_evidence_ref_type_check;
ALTER TABLE authority_risk_case_actions ADD CONSTRAINT authority_risk_case_actions_evidence_ref_type_check
  CHECK (evidence_ref_type IN ('PROPERTY','RELATIONSHIP','CASE_ACTION','MERGE','LISTING'));
ALTER TABLE authority_risk_case_actions ADD COLUMN prior_version integer CHECK (prior_version > 0);
ALTER TABLE authority_risk_case_actions ADD COLUMN decision_outcome text
  CHECK (decision_outcome IN ('REVIEW_SOURCE','CONFIRM','RESOLVE'));
ALTER TABLE authority_risk_case_actions ADD COLUMN source_snapshot jsonb
  CHECK (source_snapshot IS NULL OR jsonb_typeof(source_snapshot)='object');
ALTER TABLE authority_risk_case_actions ADD COLUMN result_case jsonb
  CHECK (result_case IS NULL OR jsonb_typeof(result_case)='object');

ALTER TABLE listings ADD COLUMN authority_source_version integer NOT NULL DEFAULT 1
  CHECK (authority_source_version > 0);
CREATE FUNCTION listing_authority_source_version_bump() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.authority_source_version := OLD.authority_source_version + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER listing_authority_source_version BEFORE UPDATE OF
  property_id,provider_account_id,provider_property_relationship_id ON listings
  FOR EACH ROW EXECUTE FUNCTION listing_authority_source_version_bump();
CREATE TRIGGER listing_authority_source_clock AFTER INSERT OR UPDATE OF
  property_id,provider_account_id,provider_property_relationship_id OR DELETE ON listings
  FOR EACH ROW EXECUTE FUNCTION authority_risk_bump_clock();
