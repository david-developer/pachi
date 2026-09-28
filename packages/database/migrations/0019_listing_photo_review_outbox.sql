ALTER TABLE listing_photo_review_actions
  ADD COLUMN idempotency_key uuid;
CREATE UNIQUE INDEX listing_photo_review_idempotency_idx ON listing_photo_review_actions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE TABLE listing_photo_review_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_action_id uuid NOT NULL UNIQUE REFERENCES listing_photo_review_actions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type = 'LISTING_PHOTO_REVIEW_DECIDED'),
  safe_payload jsonb NOT NULL CHECK (jsonb_typeof(safe_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
