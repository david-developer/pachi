-- Membership episodes and the stable organization principal own assignments.
ALTER TABLE organization_memberships ADD CONSTRAINT membership_assignment_identity UNIQUE(id,organization_id);
ALTER TABLE provider_accounts ADD CONSTRAINT provider_assignment_identity UNIQUE(id,organization_id);
CREATE TABLE organization_resource_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  provider_account_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  resource_type text NOT NULL CHECK(resource_type IN ('LISTING','INTERACTION')),
  listing_id uuid REFERENCES listings(id) ON DELETE RESTRICT,
  interaction_id uuid REFERENCES interactions(id) ON DELETE RESTRICT,
  resource_id uuid GENERATED ALWAYS AS (coalesce(listing_id,interaction_id)) STORED,
  assigned_by_user_id uuid NOT NULL,
  assigned_by_membership_id uuid NOT NULL,
  grant_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  effective_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  valid_until timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  revoked_by_membership_id uuid,
  revoke_request_id uuid,
  revocation_reason text CHECK(revocation_reason IN ('ACTOR_REVOKED','RESOURCE_CHANGED')),
  version integer NOT NULL CHECK(version>0),
  policy_version text NOT NULL DEFAULT 'organization-resource-v1' CHECK(policy_version='organization-resource-v1'),
  FOREIGN KEY(membership_id,organization_id) REFERENCES organization_memberships(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(provider_account_id,organization_id) REFERENCES provider_accounts(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(assigned_by_membership_id,organization_id,assigned_by_user_id) REFERENCES organization_memberships(id,organization_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY(revoked_by_membership_id,organization_id,revoked_by_user_id) REFERENCES organization_memberships(id,organization_id,user_id) ON DELETE RESTRICT,
  CHECK((resource_type='LISTING' AND listing_id IS NOT NULL AND interaction_id IS NULL)
    OR (resource_type='INTERACTION' AND interaction_id IS NOT NULL AND listing_id IS NULL)),
  CHECK(effective_at>=created_at AND (valid_until IS NULL OR valid_until>effective_at)),
  CHECK((revoked_at IS NULL AND revocation_reason IS NULL AND revoke_request_id IS NULL AND revoked_by_user_id IS NULL AND revoked_by_membership_id IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_at>=effective_at AND revoke_request_id IS NOT NULL AND
      ((revocation_reason='ACTOR_REVOKED' AND revoked_by_user_id IS NOT NULL AND revoked_by_membership_id IS NOT NULL)
        OR (revocation_reason='RESOURCE_CHANGED' AND revoked_by_user_id IS NULL AND revoked_by_membership_id IS NULL))))
);
CREATE UNIQUE INDEX organization_assignment_active_unique ON organization_resource_assignments(membership_id,resource_type,resource_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX organization_assignment_version_unique ON organization_resource_assignments(membership_id,resource_type,resource_id,version);
CREATE INDEX organization_assignment_page_idx ON organization_resource_assignments(organization_id,resource_type,resource_id,id);

CREATE TABLE organization_assignment_receipts (
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK(operation IN ('ASSIGN','REVOKE')),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  assignment_id uuid NOT NULL REFERENCES organization_resource_assignments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(actor_user_id,operation,idempotency_key)
);
CREATE TABLE organization_assignment_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES organization_resource_assignments(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  actor_membership_id uuid REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN ('ASSIGNED','REVOKED')),
  reason_code text NOT NULL CHECK(reason_code IN ('ASSIGNED','ACTOR_REVOKED','RESOURCE_CHANGED')),
  request_id uuid NOT NULL,
  version integer NOT NULL CHECK(version>0),
  policy_version text NOT NULL CHECK(policy_version='organization-resource-v1'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(assignment_id,action),
  CHECK((reason_code='RESOURCE_CHANGED' AND actor_user_id IS NULL AND actor_membership_id IS NULL)
    OR (reason_code<>'RESOURCE_CHANGED' AND actor_user_id IS NOT NULL AND actor_membership_id IS NOT NULL))
);
-- Private change facts only; no delivery worker, notification, or G2 event.
CREATE TABLE organization_assignment_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL UNIQUE REFERENCES organization_assignment_actions(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL REFERENCES organization_resource_assignments(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN ('ASSIGNED','REVOKED')),
  schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
  version integer NOT NULL CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TRIGGER organization_assignment_receipts_immutable BEFORE UPDATE OR DELETE ON organization_assignment_receipts FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();
CREATE TRIGGER organization_assignment_actions_immutable BEFORE UPDATE OR DELETE ON organization_assignment_actions FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();
CREATE TRIGGER organization_assignment_outbox_immutable BEFORE UPDATE OR DELETE ON organization_assignment_outbox FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();

CREATE FUNCTION organization_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_version integer; actor_membership uuid; actor_user uuid;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'assignment history is retained'; END IF;
  IF TG_OP='UPDATE' THEN
    -- Stored generated columns are unset in NEW during a BEFORE trigger. The
    -- two source IDs/type remain immutable and determine resource_id exactly.
    IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.version<>OLD.version+1
      OR (to_jsonb(NEW)-ARRAY['resource_id','revoked_at','revoked_by_user_id','revoked_by_membership_id','revoke_request_id','revocation_reason','version'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['resource_id','revoked_at','revoked_by_user_id','revoked_by_membership_id','revoke_request_id','revocation_reason','version'])
    THEN RAISE EXCEPTION 'assignment attribution is immutable'; END IF;
    -- Resource updates already hold the resource row; never acquire the parent
    -- organization in reverse order. USER commands hold the parent first.
    IF NEW.revocation_reason='RESOURCE_CHANGED' THEN RETURN NEW; END IF;
    actor_membership:=NEW.revoked_by_membership_id; actor_user:=NEW.revoked_by_user_id;
  ELSE
    IF NEW.revoked_at IS NOT NULL OR NEW.effective_at>statement_timestamp() THEN RAISE EXCEPTION 'invalid assignment grant'; END IF;
    actor_membership:=NEW.assigned_by_membership_id; actor_user:=NEW.assigned_by_user_id;
  END IF;
  PERFORM id FROM organizations WHERE id=NEW.organization_id AND state='ACTIVE' AND onboarding_completed_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization unavailable'; END IF;
  PERFORM id FROM provider_accounts WHERE id=NEW.provider_account_id AND organization_id=NEW.organization_id AND kind='ORGANIZATION' AND state='ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'principal unavailable'; END IF;
  PERFORM id FROM organization_memberships WHERE id=actor_membership AND organization_id=NEW.organization_id AND user_id=actor_user
    AND state='ACTIVE' AND role IN ('OWNER','ADMIN','LISTING_MANAGER');
  IF NOT FOUND THEN RAISE EXCEPTION 'assigner unavailable'; END IF;
  IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
  PERFORM id FROM organization_memberships WHERE id=NEW.membership_id AND organization_id=NEW.organization_id AND state='ACTIVE' AND role IN ('OWNER','ADMIN','LISTING_MANAGER','AGENT');
  IF NOT FOUND THEN RAISE EXCEPTION 'recipient unavailable'; END IF;
  IF NEW.resource_type='LISTING' THEN
    PERFORM id FROM listings WHERE id=NEW.listing_id AND provider_account_id=NEW.provider_account_id FOR SHARE;
  ELSE
    PERFORM i.id FROM interactions i JOIN listings l ON l.id=i.listing_id
      WHERE i.id=NEW.interaction_id AND i.provider_account_id=NEW.provider_account_id AND l.provider_account_id=NEW.provider_account_id FOR SHARE OF i,l;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'resource unavailable'; END IF;
  SELECT coalesce(max(version),0) INTO current_version FROM organization_resource_assignments
    WHERE membership_id=NEW.membership_id AND resource_type=NEW.resource_type AND resource_id=coalesce(NEW.listing_id,NEW.interaction_id);
  IF NEW.version<>current_version+1 THEN RAISE EXCEPTION 'stale assignment version'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON organization_resource_assignments FOR EACH ROW EXECUTE FUNCTION organization_assignment_guard();

CREATE FUNCTION organization_assignment_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action_id uuid; action_name text; actor_id uuid; membership_id uuid; request_id uuid; reason text; event_time timestamptz;
BEGIN
  IF TG_OP='INSERT' THEN action_name:='ASSIGNED'; actor_id:=NEW.assigned_by_user_id; membership_id:=NEW.assigned_by_membership_id; request_id:=NEW.grant_request_id; reason:='ASSIGNED';
  ELSE action_name:='REVOKED'; actor_id:=NEW.revoked_by_user_id; membership_id:=NEW.revoked_by_membership_id; request_id:=NEW.revoke_request_id; reason:=NEW.revocation_reason; END IF;
  event_time:=coalesce(NEW.revoked_at,NEW.created_at);
  INSERT INTO organization_assignment_actions(assignment_id,actor_user_id,actor_membership_id,action,reason_code,request_id,version,policy_version,created_at)
    VALUES(NEW.id,actor_id,membership_id,action_name,reason,request_id,NEW.version,NEW.policy_version,event_time) RETURNING id INTO action_id;
  INSERT INTO organization_assignment_outbox(action_id,assignment_id,event_type,version,created_at) VALUES(action_id,NEW.id,action_name,NEW.version,event_time);
  INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,created_at,safe_metadata)
    VALUES(actor_id,'ORGANIZATION_RESOURCE_'||action_name,'ResourceAssignment',NEW.id,reason,request_id,event_time,
      jsonb_build_object('policy_version',NEW.policy_version,'version',NEW.version));
  RETURN NULL;
END $$;
CREATE TRIGGER organization_assignment_event AFTER INSERT OR UPDATE ON organization_resource_assignments FOR EACH ROW EXECUTE FUNCTION organization_assignment_event();

-- A moved resource invalidates old grants permanently, including when it later
-- returns to the old principal. History/participants are never rewritten.
CREATE FUNCTION organization_assignment_resource_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='listings' THEN
    IF NEW.provider_account_id IS NOT DISTINCT FROM OLD.provider_account_id THEN RETURN NULL; END IF;
    -- The ownership statement may have queued BEFORE a concurrent grant was
    -- created. Record the actual revocation time, not that earlier statement.
    UPDATE organization_resource_assignments SET revoked_at=clock_timestamp(),version=version+1,
      revoke_request_id=gen_random_uuid(),revocation_reason='RESOURCE_CHANGED'
      WHERE revoked_at IS NULL AND (listing_id=NEW.id OR interaction_id IN (SELECT id FROM interactions WHERE listing_id=NEW.id));
  ELSE
    IF NEW.provider_account_id IS NOT DISTINCT FROM OLD.provider_account_id AND NEW.listing_id IS NOT DISTINCT FROM OLD.listing_id THEN RETURN NULL; END IF;
    UPDATE organization_resource_assignments SET revoked_at=clock_timestamp(),version=version+1,
      revoke_request_id=gen_random_uuid(),revocation_reason='RESOURCE_CHANGED' WHERE revoked_at IS NULL AND interaction_id=NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER organization_assignment_listing_changed AFTER UPDATE OF provider_account_id ON listings FOR EACH ROW EXECUTE FUNCTION organization_assignment_resource_changed();
CREATE TRIGGER organization_assignment_interaction_changed AFTER UPDATE OF provider_account_id,listing_id ON interactions FOR EACH ROW EXECUTE FUNCTION organization_assignment_resource_changed();
