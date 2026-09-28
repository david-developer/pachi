CREATE TABLE verification_evidence_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES verification_evidence(id),
  reason_code text NOT NULL CHECK (length(reason_code) BETWEEN 3 AND 64),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  review_due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE UNIQUE INDEX verification_evidence_one_active_hold ON verification_evidence_holds(evidence_id) WHERE released_at IS NULL;
ALTER TABLE verification_evidence ADD CONSTRAINT verification_evidence_hold_fk FOREIGN KEY (legal_hold_id) REFERENCES verification_evidence_holds(id);

CREATE FUNCTION verification_case_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.provider_profile_id IS DISTINCT FROM NEW.provider_profile_id OR
     OLD.applicant_user_id IS DISTINCT FROM NEW.applicant_user_id OR
     OLD.previous_case_id IS DISTINCT FROM NEW.previous_case_id OR
     OLD.verification_type IS DISTINCT FROM NEW.verification_type OR
     OLD.policy_version IS DISTINCT FROM NEW.policy_version OR
     OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR
     OLD.submitted_at IS DISTINCT FROM NEW.submitted_at THEN
    RAISE EXCEPTION 'verification case snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_case_snapshot_guard BEFORE UPDATE ON verification_cases FOR EACH ROW EXECUTE FUNCTION verification_case_snapshot_immutable();

CREATE FUNCTION verification_evidence_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'verification evidence snapshot is immutable'; END IF;
  IF OLD.case_id IS DISTINCT FROM NEW.case_id OR
     OLD.evidence_type IS DISTINCT FROM NEW.evidence_type OR
     OLD.mime_type IS DISTINCT FROM NEW.mime_type OR
     OLD.sha256 IS DISTINCT FROM NEW.sha256 OR
     OLD.retention_policy_id IS DISTINCT FROM NEW.retention_policy_id OR
     OLD.created_at IS DISTINCT FROM NEW.created_at OR
     (OLD.encrypted_content IS DISTINCT FROM NEW.encrypted_content AND (NEW.encrypted_content IS NOT NULL OR NEW.deleted_at IS NULL)) OR
     (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'verification evidence snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_evidence_snapshot_guard BEFORE UPDATE OR DELETE ON verification_evidence FOR EACH ROW EXECUTE FUNCTION verification_evidence_snapshot_immutable();
