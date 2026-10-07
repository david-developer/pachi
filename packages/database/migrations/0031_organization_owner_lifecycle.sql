-- Privileged governance is separate from ordinary member/invitation commands.
-- The existing parent-write/deferred final-owner constraints remain authoritative.
ALTER TABLE security_sessions ADD CONSTRAINT security_sessions_user_identity UNIQUE(id,user_id);
CREATE TABLE organization_ownership_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  initiated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_membership_id uuid NOT NULL,
  source_membership_version integer NOT NULL CHECK (source_membership_version>0),
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_membership_id uuid NOT NULL,
  recipient_membership_version integer NOT NULL CHECK (recipient_membership_version>0),
  source_role_after text NOT NULL CHECK (source_role_after IN ('LISTING_MANAGER','AGENT','ANALYST')),
  state text NOT NULL DEFAULT 'PENDING_ACCEPTANCE' CHECK (state IN ('PENDING_ACCEPTANCE','ACCEPTED','COMPLETED','CANCELLED','INVALIDATED')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  accepted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  accepted_session_id uuid REFERENCES security_sessions(id) ON DELETE RESTRICT,
  accepted_security_version integer CHECK (accepted_security_version>=0),
  accepted_at timestamptz,
  completed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY(accepted_session_id,accepted_by) REFERENCES security_sessions(id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_membership_id,organization_id,initiated_by) REFERENCES organization_memberships(id,organization_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY(recipient_membership_id,organization_id,recipient_user_id) REFERENCES organization_memberships(id,organization_id,user_id) ON DELETE RESTRICT,
  CHECK (initiated_by<>recipient_user_id AND source_membership_id<>recipient_membership_id),
  CHECK ((accepted_at IS NULL AND accepted_by IS NULL AND accepted_session_id IS NULL AND accepted_security_version IS NULL)
    OR (accepted_at IS NOT NULL AND accepted_by IS NOT NULL AND accepted_by=recipient_user_id AND accepted_session_id IS NOT NULL AND accepted_security_version IS NOT NULL)),
  CHECK (state NOT IN ('ACCEPTED','COMPLETED') OR accepted_at IS NOT NULL),
  CHECK ((state='COMPLETED' AND completed_by IS NOT NULL AND completed_by=initiated_by AND completed_at IS NOT NULL)
    OR (state<>'COMPLETED' AND completed_by IS NULL AND completed_at IS NULL)),
  CHECK ((state='CANCELLED' AND cancelled_by IS NOT NULL AND cancelled_by=initiated_by) OR (state<>'CANCELLED' AND cancelled_by IS NULL)),
  CHECK ((state IN ('COMPLETED','CANCELLED','INVALIDATED') AND ended_at IS NOT NULL)
    OR (state IN ('PENDING_ACCEPTANCE','ACCEPTED') AND ended_at IS NULL))
);
CREATE UNIQUE INDEX organization_transfer_pending_source ON organization_ownership_transfers(organization_id,source_membership_id) WHERE state IN ('PENDING_ACCEPTANCE','ACCEPTED');
CREATE UNIQUE INDEX organization_transfer_pending_recipient ON organization_ownership_transfers(organization_id,recipient_membership_id) WHERE state IN ('PENDING_ACCEPTANCE','ACCEPTED');

CREATE TABLE organization_owner_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('PRIVILEGED_ROLE_CHANGED','PRIVILEGED_MEMBER_REVOKED','TRANSFER_INITIATED','TRANSFER_ACCEPTED','TRANSFER_COMPLETED','TRANSFER_CANCELLED','TRANSFER_INVALIDATED')),
  membership_id uuid REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  transfer_id uuid REFERENCES organization_ownership_transfers(id) ON DELETE RESTRICT,
  before_role text CHECK (before_role IN ('OWNER','ADMIN','LISTING_MANAGER','AGENT','ANALYST')),
  after_role text CHECK (after_role IN ('OWNER','ADMIN','LISTING_MANAGER','AGENT','ANALYST')),
  membership_version integer CHECK (membership_version>0),
  organization_version integer NOT NULL CHECK (organization_version>0),
  transfer_version integer CHECK (transfer_version>0),
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE organization_owner_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL UNIQUE REFERENCES organization_owner_actions(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('PRIVILEGED_ROLE_CHANGED','PRIVILEGED_MEMBER_REVOKED','TRANSFER_INITIATED','TRANSFER_ACCEPTED','TRANSFER_COMPLETED','TRANSFER_CANCELLED','TRANSFER_INVALIDATED')),
  safe_payload jsonb NOT NULL CHECK (jsonb_typeof(safe_payload)='object'
    AND safe_payload - ARRAY['action_id','organization_id','transfer_id','action','version','schema_version']='{}'::jsonb
    AND safe_payload->>'action_id'=action_id::text AND safe_payload->>'organization_id'=organization_id::text
    AND safe_payload->>'action'=event_type AND safe_payload->>'schema_version'='1'
    AND jsonb_typeof(safe_payload->'version')='number'
    AND (safe_payload->>'transfer_id' IS NULL OR safe_payload->>'transfer_id' ~ '^[0-9a-f-]{36}$')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  delivered_at timestamptz
);
CREATE TABLE organization_owner_denials (
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('OWNER_ROLE','OWNER_REVOKE','TRANSFER_INITIATE','TRANSFER_ACCEPT','TRANSFER_COMPLETE','TRANSFER_CANCEL')),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  reason_code text NOT NULL CHECK (reason_code IN ('STEP_UP_REQUIRED','RESOURCE_SCOPE_DENIED','STALE_VERSION','INVALID_STATE','FINAL_OWNER_PROTECTED')),
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(actor_user_id,operation,idempotency_key)
);
CREATE TRIGGER organization_owner_actions_immutable BEFORE UPDATE OR DELETE ON organization_owner_actions FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();
CREATE TRIGGER organization_owner_denials_immutable BEFORE UPDATE OR DELETE ON organization_owner_denials FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();
CREATE FUNCTION organization_owner_outbox_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'delivered_at') IS DISTINCT FROM (to_jsonb(OLD)-'delivered_at') THEN
    RAISE EXCEPTION 'owner outbox source is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_owner_outbox_guard BEFORE UPDATE OR DELETE ON organization_owner_outbox FOR EACH ROW EXECUTE FUNCTION organization_owner_outbox_guard();
CREATE FUNCTION organization_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ownership transfer history is retained'; END IF;
  IF OLD.state IN ('COMPLETED','CANCELLED','INVALIDATED') OR NEW.version<>OLD.version+1
    OR (to_jsonb(NEW)-ARRAY['state','version','accepted_by','accepted_session_id','accepted_security_version','accepted_at','completed_by','completed_at','cancelled_by','ended_at','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','accepted_by','accepted_session_id','accepted_security_version','accepted_at','completed_by','completed_at','cancelled_by','ended_at','updated_at'])
    OR NOT ((OLD.state='PENDING_ACCEPTANCE' AND NEW.state IN ('ACCEPTED','CANCELLED','INVALIDATED'))
      OR (OLD.state='ACCEPTED' AND NEW.state IN ('COMPLETED','CANCELLED','INVALIDATED')))
    OR (OLD.accepted_at IS NOT NULL AND (NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
      OR NEW.accepted_session_id IS DISTINCT FROM OLD.accepted_session_id OR NEW.accepted_security_version IS DISTINCT FROM OLD.accepted_security_version))
  THEN RAISE EXCEPTION 'invalid ownership transfer transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_transfer_guard BEFORE UPDATE OR DELETE ON organization_ownership_transfers FOR EACH ROW EXECUTE FUNCTION organization_transfer_guard();

-- Membership episode/version changes invalidate pending grants even if the role
-- later changes back. Attribution and existing resource assignment history stay intact.
CREATE FUNCTION organization_transfer_membership_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE transfer_row record; action_id uuid; org_version integer; request_id uuid;
BEGIN
  IF NEW.version=OLD.version AND NEW.role=OLD.role AND NEW.state=OLD.state THEN RETURN NEW; END IF;
  SELECT version INTO org_version FROM organizations WHERE id=NEW.organization_id;
  FOR transfer_row IN UPDATE organization_ownership_transfers SET state='INVALIDATED',version=version+1,ended_at=statement_timestamp(),updated_at=statement_timestamp()
    WHERE state IN ('PENDING_ACCEPTANCE','ACCEPTED') AND (source_membership_id=NEW.id OR recipient_membership_id=NEW.id) RETURNING *
  LOOP
    request_id:=gen_random_uuid();
    INSERT INTO organization_owner_actions(organization_id,actor_user_id,action,membership_id,transfer_id,organization_version,transfer_version,request_id)
      VALUES(NEW.organization_id,NEW.changed_by,'TRANSFER_INVALIDATED',NEW.id,transfer_row.id,org_version,transfer_row.version,request_id) RETURNING id INTO action_id;
    INSERT INTO organization_owner_outbox(action_id,organization_id,event_type,safe_payload)
      VALUES(action_id,NEW.organization_id,'TRANSFER_INVALIDATED',jsonb_build_object('action_id',action_id,'organization_id',NEW.organization_id,'transfer_id',transfer_row.id,'action','TRANSFER_INVALIDATED','version',transfer_row.version,'schema_version',1));
    INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata)
      VALUES(NEW.changed_by,'TRANSFER_INVALIDATED','OrganizationOwnershipTransfer',transfer_row.id,'MEMBERSHIP_CHANGED',request_id,jsonb_build_object('policy_version','organization-owner-lifecycle-v1'));
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_transfer_membership_changed AFTER UPDATE ON organization_memberships FOR EACH ROW EXECUTE FUNCTION organization_transfer_membership_changed();
