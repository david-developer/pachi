CREATE TABLE verification_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_profile_id uuid NOT NULL REFERENCES provider_profiles(id),
  applicant_user_id uuid NOT NULL REFERENCES users(id),
  previous_case_id uuid REFERENCES verification_cases(id),
  assigned_staff_user_id uuid REFERENCES users(id),
  verification_type text NOT NULL CHECK (verification_type = 'PROVIDER_IDENTITY'),
  state text NOT NULL CHECK (state IN ('NOT_STARTED','PENDING','NEEDS_RESUBMISSION','VERIFIED','REJECTED','EXPIRED','REVOKED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  policy_version text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  submitted_at timestamptz NOT NULL,
  decision_at timestamptz,
  reviewer_user_id uuid REFERENCES users(id),
  reason_code text,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (applicant_user_id,idempotency_key),
  CHECK (assigned_staff_user_id IS NULL OR assigned_staff_user_id <> applicant_user_id)
);
CREATE UNIQUE INDEX verification_cases_one_pending ON verification_cases(provider_profile_id) WHERE state = 'PENDING';
CREATE INDEX verification_cases_provider ON verification_cases(provider_profile_id, submitted_at DESC);
CREATE TABLE verification_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES verification_cases(id),
  evidence_type text NOT NULL CHECK (evidence_type IN ('GOVERNMENT_ID','LIVE_SELFIE')),
  mime_type text NOT NULL CHECK (mime_type = 'application/x-pachi-synthetic'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  encrypted_content bytea,
  retention_policy_id text NOT NULL,
  delete_after timestamptz,
  legal_hold_id uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id,evidence_type)
);
CREATE TABLE verification_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES verification_cases(id),
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  outcome text NOT NULL CHECK (outcome IN ('VERIFIED','REJECTED','NEEDS_RESUBMISSION')),
  reason_code text NOT NULL,
  policy_version text NOT NULL,
  evidence_hashes jsonb NOT NULL,
  valid_until timestamptz,
  request_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION verification_decision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'verification decision is append-only'; END $$;
CREATE TRIGGER verification_decision_immutable BEFORE UPDATE OR DELETE ON verification_decisions FOR EACH ROW EXECUTE FUNCTION verification_decision_immutable();
CREATE TABLE verification_claims (
  provider_profile_id uuid PRIMARY KEY REFERENCES provider_profiles(id),
  claim_type text NOT NULL CHECK (claim_type = 'PROVIDER_IDENTITY'),
  status text NOT NULL CHECK (status IN ('VERIFIED','EXPIRED','REVOKED')),
  source_case_id uuid NOT NULL REFERENCES verification_cases(id),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE verification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES verification_cases(id),
  event_type text NOT NULL,
  safe_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
