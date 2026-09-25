DO $$ BEGIN
  CREATE TYPE provider_profile_state AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS provider_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  provider_types text[] NOT NULL CHECK (cardinality(provider_types) > 0 AND provider_types <@ ARRAY['OWNER', 'INDEPENDENT_AGENT', 'PROPERTY_MANAGER']::text[]),
  state provider_profile_state NOT NULL DEFAULT 'DRAFT',
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 120),
  bio text CHECK (bio IS NULL OR length(bio) <= 1000),
  service_area text CHECK (service_area IS NULL OR length(service_area) <= 240),
  verification_status text NOT NULL DEFAULT 'NOT_VERIFIED' CHECK (verification_status IN ('NOT_VERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'NEEDS_RESUBMISSION')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'INDIVIDUAL' CHECK (kind = 'INDIVIDUAL'),
  provider_profile_id uuid NOT NULL UNIQUE REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  state provider_profile_state NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
