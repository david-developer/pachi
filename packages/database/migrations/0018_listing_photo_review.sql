ALTER TABLE listing_media
  ADD COLUMN review_status text NOT NULL DEFAULT 'NOT_REVIEWED'
    CHECK (review_status IN ('NOT_REVIEWED', 'APPROVED', 'CHANGES_REQUIRED', 'REJECTED')),
  ADD COLUMN review_version integer NOT NULL DEFAULT 1 CHECK (review_version > 0),
  ADD COLUMN review_reason_code text,
  ADD COLUMN reviewed_at timestamptz;

CREATE TABLE listing_photo_review_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_media_id uuid NOT NULL REFERENCES listing_media(id) ON DELETE RESTRICT,
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  prior_status text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('APPROVED', 'CHANGES_REQUIRED', 'REJECTED')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  prior_version integer NOT NULL,
  policy_version text NOT NULL DEFAULT 'listing-photo-review-v1',
  request_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_media_id, prior_version)
);
CREATE INDEX listing_photo_review_queue_idx ON listing_media (listing_id, attached_at)
  WHERE removed_at IS NULL AND review_status = 'NOT_REVIEWED';
CREATE FUNCTION listing_photo_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'photo review actions are append-only'; END $$;
CREATE TRIGGER listing_photo_review_immutable BEFORE UPDATE OR DELETE ON listing_photo_review_actions
FOR EACH ROW EXECUTE FUNCTION listing_photo_review_immutable();
