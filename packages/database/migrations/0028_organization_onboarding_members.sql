-- Additive organization governance. Existing foundation records remain private;
-- only the immutable onboarding marker enables the new product workflow.
ALTER TABLE phone_contacts ADD CONSTRAINT phone_contacts_identity UNIQUE(id,user_id);
ALTER TABLE organizations
  ADD COLUMN legal_name text,
  ADD COLUMN public_name text,
  ADD COLUMN organization_type text,
  ADD COLUMN public_phone text,
  ADD COLUMN created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN onboarding_contact_id uuid REFERENCES phone_contacts(id) ON DELETE RESTRICT,
  ADD COLUMN onboarding_completed_at timestamptz,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT organizations_contact_creator FOREIGN KEY(onboarding_contact_id,created_by_user_id)
    REFERENCES phone_contacts(id,user_id) ON DELETE RESTRICT,
  ADD CONSTRAINT organizations_profile_complete CHECK (
    onboarding_completed_at IS NULL OR
    legal_name IS NOT NULL AND length(btrim(legal_name)) BETWEEN 2 AND 160
    AND public_name IS NOT NULL AND length(btrim(public_name)) BETWEEN 2 AND 120
    AND organization_type IS NOT NULL AND organization_type IN ('REAL_ESTATE_AGENCY','PROPERTY_MANAGEMENT_COMPANY','CORPORATE_PROPERTY_OWNER')
    AND created_by_user_id IS NOT NULL AND onboarding_contact_id IS NOT NULL
  ),
  ADD CONSTRAINT organizations_public_phone CHECK (public_phone IS NULL OR public_phone ~ '^[+][1-9][0-9]{7,14}$');

ALTER TABLE provider_accounts DROP CONSTRAINT provider_accounts_kind_check;
ALTER TABLE provider_accounts ALTER COLUMN provider_profile_id DROP NOT NULL;
ALTER TABLE provider_accounts ADD COLUMN organization_id uuid UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE provider_accounts ADD CONSTRAINT provider_accounts_subject_xor CHECK (
  (kind='INDIVIDUAL' AND provider_profile_id IS NOT NULL AND organization_id IS NULL)
  OR (kind='ORGANIZATION' AND organization_id IS NOT NULL AND provider_profile_id IS NULL)
);

ALTER TABLE organization_memberships
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN invited_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN invitation_expires_at timestamptz,
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN revoked_at timestamptz,
  ADD CONSTRAINT organization_membership_identity UNIQUE (id,organization_id,user_id);

CREATE TABLE organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_contact_id uuid NOT NULL REFERENCES phone_contacts(id) ON DELETE RESTRICT,
  recipient_contact_version integer NOT NULL CHECK (recipient_contact_version > 0),
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('LISTING_MANAGER','AGENT','ANALYST')),
  state text NOT NULL DEFAULT 'INVITED' CHECK (state IN ('INVITED','ACTIVE','DECLINED','REVOKED','EXPIRED')),
  token_digest text NOT NULL CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  token_consumed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  UNIQUE (membership_id),
  FOREIGN KEY (membership_id,organization_id,recipient_user_id)
    REFERENCES organization_memberships(id,organization_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY (recipient_contact_id,recipient_user_id) REFERENCES phone_contacts(id,user_id) ON DELETE RESTRICT,
  CHECK (expires_at=created_at+interval '168 hours'),
  CHECK ((state='INVITED' AND token_consumed_at IS NULL) OR (state<>'INVITED' AND token_consumed_at IS NOT NULL))
);
CREATE INDEX organization_invitations_recipient_idx ON organization_invitations(recipient_user_id,id);
CREATE INDEX organization_invitations_expiry_idx ON organization_invitations(expires_at) WHERE state='INVITED';

CREATE TABLE organization_command_receipts (
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object' AND result ? 'id' AND result - 'id'='{}'::jsonb
    AND result->>'id' ~ '^[0-9a-f-]{36}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (actor_user_id,operation,idempotency_key)
);
CREATE TABLE organization_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL CHECK (actor_kind IN ('USER','SYSTEM')),
  action text NOT NULL CHECK(action IN ('ORGANIZATION_CREATED','INVITATION_CREATED','INVITATION_ACCEPTED','INVITATION_DECLINED','INVITATION_REVOKED','INVITATION_EXPIRED','MEMBER_ROLE_CHANGED','MEMBER_SUSPENDED','MEMBER_REACTIVATED','MEMBER_REVOKED')),
  membership_id uuid REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  invitation_id uuid REFERENCES organization_invitations(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  safe_metadata jsonb NOT NULL CHECK (jsonb_typeof(safe_metadata)='object'
    AND safe_metadata - ARRAY['before_state','after_state','before_role','after_role','version','organization_version','policy_version']='{}'::jsonb
    AND safe_metadata->>'policy_version'='organization-governance-v1'
    AND (NOT safe_metadata ? 'before_state' OR safe_metadata->>'before_state' IN ('INVITED','ACTIVE','SUSPENDED','REVOKED','DECLINED','EXPIRED'))
    AND (NOT safe_metadata ? 'after_state' OR safe_metadata->>'after_state' IN ('INVITED','ACTIVE','SUSPENDED','REVOKED','DECLINED','EXPIRED'))
    AND (NOT safe_metadata ? 'before_role' OR safe_metadata->>'before_role' IN ('OWNER','ADMIN','LISTING_MANAGER','AGENT','ANALYST'))
    AND (NOT safe_metadata ? 'after_role' OR safe_metadata->>'after_role' IN ('OWNER','ADMIN','LISTING_MANAGER','AGENT','ANALYST'))
    AND (NOT safe_metadata ? 'version' OR jsonb_typeof(safe_metadata->'version')='number')
    AND (NOT safe_metadata ? 'organization_version' OR jsonb_typeof(safe_metadata->'organization_version')='number')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK ((actor_kind='USER' AND actor_user_id IS NOT NULL) OR (actor_kind='SYSTEM' AND actor_user_id IS NULL))
);
CREATE TABLE organization_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL UNIQUE REFERENCES organization_actions(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN ('ORGANIZATION_CREATED','INVITATION_CREATED','INVITATION_ACCEPTED','INVITATION_DECLINED','INVITATION_REVOKED','INVITATION_EXPIRED','MEMBER_ROLE_CHANGED','MEMBER_SUSPENDED','MEMBER_REACTIVATED','MEMBER_REVOKED')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  safe_payload jsonb NOT NULL CHECK (jsonb_typeof(safe_payload)='object'
    AND safe_payload - ARRAY['organization_id','action_id','membership_id','invitation_id','action','version','schema_version']='{}'::jsonb
    AND safe_payload->>'action'=event_type AND safe_payload->>'organization_id'=organization_id::text
    AND safe_payload->>'action_id'=action_id::text AND safe_payload->>'schema_version'='1'
    AND jsonb_typeof(safe_payload->'version')='number'
    AND (safe_payload->>'membership_id' IS NULL OR safe_payload->>'membership_id' ~ '^[0-9a-f-]{36}$')
    AND (safe_payload->>'invitation_id' IS NULL OR safe_payload->>'invitation_id' ~ '^[0-9a-f-]{36}$')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  delivered_at timestamptz
);
CREATE TABLE organization_security_denials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  request_id uuid NOT NULL,
  reason_code text NOT NULL CHECK (reason_code='PRIVILEGED_GOVERNANCE_UNAVAILABLE'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(actor_user_id,operation,idempotency_key)
);
CREATE FUNCTION organization_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'organization history is append-only'; END $$;
CREATE TRIGGER organization_actions_immutable BEFORE UPDATE OR DELETE ON organization_actions
  FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();
CREATE TRIGGER organization_receipts_immutable BEFORE UPDATE OR DELETE ON organization_command_receipts
  FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();
CREATE TRIGGER organization_security_denials_immutable BEFORE UPDATE OR DELETE ON organization_security_denials
  FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();
CREATE FUNCTION organization_outbox_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'organization outbox is append-only'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.action_id IS DISTINCT FROM OLD.action_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version OR NEW.safe_payload IS DISTINCT FROM OLD.safe_payload
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN RAISE EXCEPTION 'organization outbox source is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_outbox_immutable BEFORE UPDATE OR DELETE ON organization_outbox
  FOR EACH ROW EXECUTE FUNCTION organization_outbox_immutable();

CREATE FUNCTION organization_onboarding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.onboarding_completed_at IS NOT NULL AND (
    NEW.onboarding_completed_at IS DISTINCT FROM OLD.onboarding_completed_at
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.onboarding_contact_id IS DISTINCT FROM OLD.onboarding_contact_id
  ) THEN RAISE EXCEPTION 'organization onboarding attribution is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_onboarding_immutable BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION organization_onboarding_immutable();

-- Serialize even direct membership writes before the deferred owner check.
-- A row lock alone permits repeatable-read transactions to retain an old
-- owner snapshot. A physical parent write makes stale-snapshot writers abort.
CREATE FUNCTION organization_membership_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.invited_by IS NOT NULL AND NEW.invited_by IS DISTINCT FROM OLD.invited_by) THEN
    RAISE EXCEPTION 'membership episode attribution is immutable';
  END IF;
  IF TG_OP='DELETE' THEN
    UPDATE organizations SET version=version WHERE id=OLD.organization_id;
    RETURN OLD;
  END IF;
  UPDATE organizations SET version=version WHERE id=NEW.organization_id;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_membership_lock BEFORE INSERT OR UPDATE OR DELETE ON organization_memberships
  FOR EACH ROW EXECUTE FUNCTION organization_membership_lock();

CREATE FUNCTION organization_final_owner_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid;
BEGIN
  IF TG_TABLE_NAME='organizations' THEN target_id:=NEW.id;
  ELSIF TG_OP='DELETE' THEN target_id:=OLD.organization_id;
  ELSE target_id:=NEW.organization_id; END IF;
  IF EXISTS(SELECT 1 FROM organizations WHERE id=target_id AND onboarding_completed_at IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM organization_memberships WHERE organization_id=target_id AND role='OWNER' AND state='ACTIVE')
  THEN RAISE EXCEPTION 'organization requires an active owner' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER organization_final_owner_membership AFTER INSERT OR UPDATE OR DELETE ON organization_memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_final_owner_check();
CREATE CONSTRAINT TRIGGER organization_final_owner_creation AFTER INSERT OR UPDATE ON organizations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_final_owner_check();
