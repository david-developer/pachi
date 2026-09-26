DO $$ BEGIN
  CREATE TYPE media_lifecycle AS ENUM ('UPLOAD_AUTHORIZED', 'UPLOADED_QUARANTINED', 'PROCESSING', 'READY', 'FAILED', 'REJECTED', 'DELETION_PENDING', 'DELETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_provider_account_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE RESTRICT,
  classification text NOT NULL DEFAULT 'PUBLIC_MARKETPLACE' CHECK (classification = 'PUBLIC_MARKETPLACE'),
  storage_reference uuid NOT NULL UNIQUE,
  original_sha256 text CHECK (original_sha256 IS NULL OR original_sha256 ~ '^[0-9a-f]{64}$'),
  original_mime text CHECK (original_mime IS NULL OR original_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  original_bytes bigint CHECK (original_bytes IS NULL OR original_bytes BETWEEN 1 AND 15728640),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  lifecycle media_lifecycle NOT NULL DEFAULT 'UPLOAD_AUTHORIZED',
  retryable boolean NOT NULL DEFAULT false,
  failure_code text CHECK (failure_code IS NULL OR failure_code IN ('SCAN_UNAVAILABLE', 'PROCESSING_UNAVAILABLE', 'SOURCE_MISSING', 'INVALID_IMAGE', 'IMAGE_TOO_LARGE', 'UNSUPPORTED_IMAGE', 'INFECTED_FILE', 'PROCESSING_FAILED', 'UPLOAD_FAILED', 'CHECKSUM_MISMATCH')),
  derivative_manifest jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(derivative_manifest) = 'object'),
  processor_version text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  upload_expires_at timestamptz,
  uploaded_at timestamptz,
  ready_at timestamptz,
  cleanup_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media_upload_intents (
  media_asset_id uuid PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_asset_id uuid NOT NULL UNIQUE REFERENCES media_assets(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  last_failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listing_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL UNIQUE REFERENCES media_assets(id) ON DELETE RESTRICT,
  display_order integer NOT NULL CHECK (display_order >= 0),
  is_cover boolean NOT NULL DEFAULT false,
  attached_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attached_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS listing_media_active_order_idx ON listing_media (listing_id, display_order) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS listing_media_one_cover_idx ON listing_media (listing_id) WHERE removed_at IS NULL AND is_cover;
CREATE INDEX IF NOT EXISTS media_assets_processing_idx ON media_assets (lifecycle, created_at) WHERE lifecycle IN ('UPLOADED_QUARANTINED', 'DELETION_PENDING');
CREATE INDEX IF NOT EXISTS media_upload_intents_expiry_idx ON media_upload_intents (expires_at);
CREATE INDEX IF NOT EXISTS media_processing_jobs_pending_idx ON media_processing_jobs (next_attempt_at, created_at) WHERE state = 'PENDING';
CREATE INDEX IF NOT EXISTS listing_media_listing_order_idx ON listing_media (listing_id, display_order) WHERE removed_at IS NULL;
