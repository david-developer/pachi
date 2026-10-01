ALTER TABLE listings
  ADD COLUMN public_location_mode text NOT NULL DEFAULT 'NEIGHBORHOOD_ONLY';

ALTER TABLE listings
  ADD CONSTRAINT listings_public_location_mode_check
  CHECK (public_location_mode IN ('NEIGHBORHOOD_ONLY', 'APPROXIMATE', 'EXACT', 'HIDDEN'));
