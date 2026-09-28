ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_publication_status_check;

ALTER TABLE listing_revisions ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

CREATE TABLE IF NOT EXISTS listing_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  listing_revision_id uuid NOT NULL REFERENCES listing_revisions(id) ON DELETE RESTRICT,
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE RESTRICT,
  offering_version_id uuid NOT NULL REFERENCES offering_versions(id) ON DELETE RESTRICT,
  provider_property_relationship_id uuid NOT NULL REFERENCES provider_property_relationships(id) ON DELETE RESTRICT,
  submitted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  media_snapshot jsonb NOT NULL CHECK (jsonb_typeof(media_snapshot) = 'array' AND jsonb_array_length(media_snapshot) BETWEEN 1 AND 20),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, listing_revision_id),
  UNIQUE (submitted_by_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS listing_submissions_listing_idx ON listing_submissions (listing_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS listing_submissions_actor_idx ON listing_submissions (submitted_by_user_id, submitted_at DESC);