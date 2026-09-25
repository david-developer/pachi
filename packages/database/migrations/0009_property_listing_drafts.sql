DO $$ BEGIN
  CREATE TYPE property_record_state AS ENUM ('ACTIVE', 'POSSIBLE_DUPLICATE', 'MERGED', 'ARCHIVED', 'REMOVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE relationship_type AS ENUM ('OWNER', 'AUTHORIZED_AGENT', 'PROPERTY_MANAGER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE relationship_status AS ENUM ('DECLARED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE listing_purpose AS ENUM ('RENT', 'SALE', 'SHORT_LET');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE listing_publication_status AS ENUM ('DRAFT', 'PENDING_REVIEW', 'REJECTED', 'PUBLISHED', 'PAUSED', 'EXPIRED', 'ARCHIVED', 'HIDDEN', 'REMOVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  property_type text NOT NULL CHECK (property_type IN ('HOUSE', 'APARTMENT', 'ROOM', 'LAND', 'COMMERCIAL')),
  record_state property_record_state NOT NULL DEFAULT 'ACTIVE',
  bedrooms integer CHECK (bedrooms IS NULL OR bedrooms >= 0),
  bathrooms integer CHECK (bathrooms IS NULL OR bathrooms >= 0),
  size_sqm numeric CHECK (size_sqm IS NULL OR size_sqm > 0),
  furnishing text CHECK (furnishing IS NULL OR furnishing IN ('FURNISHED', 'UNFURNISHED', 'PARTLY_FURNISHED')),
  region text NOT NULL CHECK (region IN ('Southwest', 'Littoral')),
  city text NOT NULL CHECK (length(btrim(city)) BETWEEN 1 AND 120),
  neighborhood text NOT NULL CHECK (length(btrim(neighborhood)) BETWEEN 1 AND 160),
  landmark text,
  private_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_property_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  provider_account_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE RESTRICT,
  relationship_type relationship_type NOT NULL,
  authorization_status relationship_status NOT NULL DEFAULT 'DECLARED',
  declared_at timestamptz NOT NULL DEFAULT now(),
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, provider_account_id)
);

CREATE TABLE IF NOT EXISTS listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  provider_account_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE RESTRICT,
  provider_property_relationship_id uuid NOT NULL REFERENCES provider_property_relationships(id) ON DELETE RESTRICT,
  purpose listing_purpose NOT NULL,
  publication_status listing_publication_status NOT NULL DEFAULT 'DRAFT',
  market_status text NOT NULL DEFAULT 'AVAILABLE',
  moderation_status text NOT NULL DEFAULT 'NOT_REVIEWED',
  current_revision_id uuid,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (publication_status = 'DRAFT')
);

CREATE TABLE IF NOT EXISTS listing_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  title text CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 160),
  description text CHECK (description IS NULL OR length(description) <= 5000),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, version)
);
ALTER TABLE listings ADD CONSTRAINT listings_current_revision_fk FOREIGN KEY (current_revision_id) REFERENCES listing_revisions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL UNIQUE REFERENCES listings(id) ON DELETE CASCADE,
  purpose listing_purpose NOT NULL,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS offering_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  currency text NOT NULL DEFAULT 'XAF' CHECK (currency = 'XAF'),
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  pricing_period text NOT NULL CHECK (pricing_period IN ('MONTHLY', 'TOTAL', 'NIGHTLY')),
  deposit_amount_minor bigint CHECK (deposit_amount_minor IS NULL OR deposit_amount_minor >= 0),
  advance_months integer CHECK (advance_months IS NULL OR advance_months >= 0),
  minimum_lease_months integer CHECK (minimum_lease_months IS NULL OR minimum_lease_months > 0),
  available_from date,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offering_id, version)
);
ALTER TABLE offerings ADD CONSTRAINT offerings_current_version_fk FOREIGN KEY (current_version_id) REFERENCES offering_versions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS properties_creator_idx ON properties (created_by_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS relationships_provider_idx ON provider_property_relationships (provider_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS listings_provider_idx ON listings (provider_account_id, updated_at DESC);
