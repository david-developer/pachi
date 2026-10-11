-- Additive post-publication lifecycle; earlier migrations remain immutable.
CREATE TABLE region_publication_controls (
  region text PRIMARY KEY CHECK (region IN ('Southwest','Littoral')),
  enabled boolean NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
INSERT INTO region_publication_controls(region,enabled) VALUES ('Southwest',true),('Littoral',true);
CREATE TABLE region_publication_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region text NOT NULL REFERENCES region_publication_controls(region),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  previous_enabled boolean NOT NULL,
  enabled boolean NOT NULL,
  version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(actor_user_id,idempotency_key)
);
ALTER TABLE listings ADD COLUMN lifecycle_version integer NOT NULL DEFAULT 1 CHECK (lifecycle_version>0);
ALTER TABLE listings ADD COLUMN initial_provider_account_id uuid REFERENCES provider_accounts(id), ADD COLUMN approved_material_snapshot jsonb;
UPDATE listings SET initial_provider_account_id=provider_account_id;
ALTER TABLE listings ALTER COLUMN initial_provider_account_id SET NOT NULL;
-- Explicit approval binds physical/location/media/terms/principal context as
-- well as immutable revision IDs. Missing historical snapshots fail closed;
-- migration cannot fabricate an earlier review of today's mutable property.
CREATE FUNCTION listing_current_material_snapshot(listing uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('provider',l.provider_account_id,'relationship',l.provider_property_relationship_id,'purpose',l.purpose,
    'revision',l.current_revision_id,'offering_version',o.current_version_id,
    'property',jsonb_build_array(p.id,p.property_type,p.region,p.city,p.neighborhood,p.bedrooms,p.bathrooms,p.size_sqm,p.furnishing),
    'media',COALESCE((SELECT jsonb_agg(jsonb_build_array(lm.id,lm.media_asset_id,lm.display_order,lm.is_cover) ORDER BY lm.id) FROM listing_media lm WHERE lm.listing_id=l.id AND lm.removed_at IS NULL),'[]'::jsonb))
  FROM listings l JOIN properties p ON p.id=l.property_id JOIN offerings o ON o.listing_id=l.id WHERE l.id=listing
$$;
CREATE FUNCTION listing_material_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN NEW.initial_provider_account_id:=NEW.provider_account_id; NEW.approved_material_snapshot:=NULL;
  ELSE
    IF NEW.initial_provider_account_id IS DISTINCT FROM OLD.initial_provider_account_id THEN RAISE EXCEPTION 'listing original principal is immutable'; END IF;
    IF OLD.publication_status='PENDING_REVIEW' AND NEW.publication_status='PUBLISHED' AND NEW.moderation_status='APPROVED'
    THEN NEW.approved_material_snapshot:=listing_current_material_snapshot(NEW.id);
    ELSE NEW.approved_material_snapshot:=OLD.approved_material_snapshot; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER listing_material_approval BEFORE INSERT OR UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION listing_material_approval();
CREATE TABLE listing_freshness_episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id),
  confirmed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at>confirmed_at),
  UNIQUE(listing_id,confirmed_at,expires_at)
);
ALTER TABLE listings ADD COLUMN freshness_episode_id uuid REFERENCES listing_freshness_episodes(id);
CREATE TABLE listing_freshness_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES listing_freshness_episodes(id),
  days_before integer NOT NULL CHECK (days_before IN (7,1)),
  intended_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','ELIGIBLE','SKIPPED')),
  processed_at timestamptz,
  UNIQUE(episode_id,days_before),
  CHECK ((state='PENDING')=(processed_at IS NULL))
);
CREATE TABLE listing_lifecycle_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id),
  provider_account_id uuid NOT NULL REFERENCES provider_accounts(id),
  actor_user_id uuid REFERENCES users(id),
  membership_id uuid REFERENCES organization_memberships(id),
  assignment_id uuid REFERENCES organization_resource_assignments(id),
  event_type text NOT NULL CHECK (event_type IN ('listing_market_status_changed','listing_freshness_confirmed','listing_expired','listing_freshness_reminder_scheduled','listing_renewal_review_required')),
  previous_market_status text NOT NULL,
  market_status text NOT NULL,
  previous_publication_status text NOT NULL,
  publication_status text NOT NULL,
  version integer NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('PROVIDER_MARKET_CHANGE','PROVIDER_FRESHNESS_CONFIRMATION','FRESHNESS_DEADLINE_ELAPSED','REMINDER_ELIGIBILITY','RENEWAL_REVIEW_REQUIRED')),
  episode_id uuid REFERENCES listing_freshness_episodes(id),
  reminder_id uuid UNIQUE REFERENCES listing_freshness_reminders(id),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE listing_lifecycle_receipts (
  actor_user_id uuid NOT NULL REFERENCES users(id),
  idempotency_key uuid NOT NULL,
  listing_id uuid NOT NULL REFERENCES listings(id),
  provider_account_id uuid NOT NULL REFERENCES provider_accounts(id),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(actor_user_id,idempotency_key)
);
CREATE TABLE listing_lifecycle_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL UNIQUE REFERENCES listing_lifecycle_actions(id),
  event_type text NOT NULL CHECK (event_type IN ('listing_market_status_changed','listing_freshness_confirmed','listing_expired','listing_freshness_reminder_scheduled','listing_renewal_review_required')),
  safe_payload jsonb NOT NULL CHECK (jsonb_typeof(safe_payload)='object'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX listing_reminders_pending_idx ON listing_freshness_reminders(intended_at,id) WHERE state='PENDING';
CREATE TRIGGER region_publication_actions_immutable BEFORE UPDATE OR DELETE ON region_publication_actions FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();
CREATE TRIGGER listing_lifecycle_actions_immutable BEFORE UPDATE OR DELETE ON listing_lifecycle_actions FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();
CREATE TRIGGER listing_lifecycle_receipts_immutable BEFORE UPDATE OR DELETE ON listing_lifecycle_receipts FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();
CREATE TRIGGER listing_lifecycle_outbox_immutable BEFORE UPDATE OR DELETE ON listing_lifecycle_outbox FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();
CREATE TRIGGER listing_freshness_episodes_immutable BEFORE UPDATE OR DELETE ON listing_freshness_episodes FOR EACH ROW EXECUTE FUNCTION organization_history_immutable();
CREATE FUNCTION listing_lifecycle_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.market_status,NEW.publication_status,NEW.moderation_status,NEW.current_revision_id,NEW.provider_account_id,NEW.provider_property_relationship_id,NEW.last_confirmed_at,NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.market_status,OLD.publication_status,OLD.moderation_status,OLD.current_revision_id,OLD.provider_account_id,OLD.provider_property_relationship_id,OLD.last_confirmed_at,OLD.expires_at)
  THEN NEW.lifecycle_version := OLD.lifecycle_version+1;
  ELSE NEW.lifecycle_version := OLD.lifecycle_version; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER listing_lifecycle_version BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION listing_lifecycle_version();
CREATE FUNCTION listing_freshness_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode uuid;
BEGIN
  IF NEW.publication_status='PUBLISHED' AND NEW.last_confirmed_at IS NOT NULL AND NEW.expires_at IS NOT NULL
    AND (TG_OP='INSERT' OR NEW.last_confirmed_at IS DISTINCT FROM OLD.last_confirmed_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.freshness_episode_id IS NULL)
  THEN
    INSERT INTO listing_freshness_episodes(listing_id,confirmed_at,expires_at) VALUES(NEW.id,NEW.last_confirmed_at,NEW.expires_at)
      ON CONFLICT(listing_id,confirmed_at,expires_at) DO NOTHING RETURNING id INTO episode;
    IF episode IS NULL THEN SELECT id INTO episode FROM listing_freshness_episodes WHERE listing_id=NEW.id AND confirmed_at=NEW.last_confirmed_at AND expires_at=NEW.expires_at; END IF;
    UPDATE listings SET freshness_episode_id=episode WHERE id=NEW.id;
    INSERT INTO listing_freshness_reminders(episode_id,days_before,intended_at)
      VALUES(episode,7,NEW.expires_at-interval '7 days'),(episode,1,NEW.expires_at-interval '1 day') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER listing_freshness_schedule AFTER INSERT OR UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION listing_freshness_schedule();
-- Backfill schedules without fabricating confirmation events or changing G2 sources.
UPDATE listings SET updated_at=updated_at WHERE publication_status='PUBLISHED' AND last_confirmed_at IS NOT NULL AND expires_at IS NOT NULL;
ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_event_name_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_event_name_check CHECK (event_name IN ('listing_published','interaction_created','message_sent','provider_first_response','listing_freshness_confirmed','listing_expired'));
ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_source_stream_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_source_stream_check CHECK (source_stream IN ('listing_revision_moderation_outbox','interaction_outbox','communication_outbox','listing_lifecycle_outbox'));
ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_check1;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_check1 CHECK (
  (event_name='listing_published' AND source_stream='listing_revision_moderation_outbox' AND interaction_id IS NULL AND contact_event_id IS NULL AND message_id IS NULL AND submission_id IS NOT NULL AND revision_id IS NOT NULL)
  OR (event_name='interaction_created' AND source_stream='interaction_outbox' AND interaction_id IS NOT NULL AND contact_event_id IS NULL AND message_id IS NULL)
  OR (event_name IN ('message_sent','provider_first_response') AND source_stream='communication_outbox' AND interaction_id IS NOT NULL AND contact_event_id IS NOT NULL AND message_id IS NOT NULL)
  OR (event_name IN ('listing_freshness_confirmed','listing_expired') AND source_stream='listing_lifecycle_outbox' AND interaction_id IS NULL AND contact_event_id IS NULL AND message_id IS NULL AND submission_id IS NULL AND revision_id IS NULL));
