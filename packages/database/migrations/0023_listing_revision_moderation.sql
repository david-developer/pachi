ALTER TABLE listings
  ADD COLUMN last_confirmed_at timestamptz,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN approved_revision_id uuid REFERENCES listing_revisions(id) ON DELETE RESTRICT,
  ADD COLUMN approved_submission_id uuid REFERENCES listing_submissions(id) ON DELETE RESTRICT,
  ADD COLUMN approved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN moderation_feedback text;

ALTER TABLE listings
  ADD CONSTRAINT listings_freshness_order CHECK (expires_at IS NULL OR last_confirmed_at IS NOT NULL AND expires_at > last_confirmed_at),
  ADD CONSTRAINT listings_approval_complete CHECK (
    (approved_revision_id IS NULL AND approved_submission_id IS NULL AND approved_by_user_id IS NULL AND approved_at IS NULL)
    OR (approved_revision_id IS NOT NULL AND approved_submission_id IS NOT NULL AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
  );

CREATE TABLE listing_revision_moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES listing_submissions(id) ON DELETE RESTRICT,
  listing_revision_id uuid NOT NULL REFERENCES listing_revisions(id) ON DELETE RESTRICT,
  offering_version_id uuid NOT NULL REFERENCES offering_versions(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  command text NOT NULL CHECK (command IN ('REQUEST_CHANGES', 'REJECT', 'APPROVE_AND_PUBLISH')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  reason_text text NOT NULL CHECK (length(btrim(reason_text)) BETWEEN 1 AND 2000),
  provider_message text CHECK (provider_message IS NULL OR length(btrim(provider_message)) BETWEEN 10 AND 1000),
  prior_publication_status text NOT NULL,
  publication_status text NOT NULL,
  prior_moderation_status text NOT NULL,
  moderation_status text NOT NULL,
  media_snapshot jsonb NOT NULL CHECK (jsonb_typeof(media_snapshot) = 'array' AND jsonb_array_length(media_snapshot) BETWEEN 1 AND 20),
  policy_version text NOT NULL DEFAULT 'listing-revision-moderation-v1',
  idempotency_key uuid NOT NULL UNIQUE,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK ((command = 'REQUEST_CHANGES' AND provider_message IS NOT NULL AND publication_status = 'DRAFT' AND moderation_status = 'CHANGES_REQUIRED') OR
         (command = 'REJECT' AND publication_status = 'REJECTED' AND moderation_status = 'REJECTED') OR
         (command = 'APPROVE_AND_PUBLISH' AND provider_message IS NULL AND publication_status = 'PUBLISHED' AND moderation_status = 'APPROVED'))
);
CREATE INDEX listing_revision_moderation_listing_idx ON listing_revision_moderation_actions(listing_id, created_at DESC);
CREATE FUNCTION listing_revision_moderation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'listing revision moderation actions are append-only'; END $$;
CREATE TRIGGER listing_revision_moderation_immutable BEFORE UPDATE OR DELETE ON listing_revision_moderation_actions
FOR EACH ROW EXECUTE FUNCTION listing_revision_moderation_immutable();

CREATE TABLE listing_revision_moderation_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL UNIQUE REFERENCES listing_revision_moderation_actions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('LISTING_CHANGES_REQUESTED', 'LISTING_REJECTED', 'LISTING_PUBLISHED')),
  safe_payload jsonb NOT NULL CHECK (jsonb_typeof(safe_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  delivered_at timestamptz
);
CREATE INDEX listing_revision_moderation_outbox_pending_idx ON listing_revision_moderation_outbox(created_at) WHERE delivered_at IS NULL;
CREATE INDEX listings_expiry_idx ON listings(expires_at) WHERE publication_status = 'PUBLISHED';
