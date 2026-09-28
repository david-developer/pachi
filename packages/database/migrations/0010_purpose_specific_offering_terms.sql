ALTER TABLE offering_versions
  ADD COLUMN IF NOT EXISTS negotiable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS utilities_included boolean,
  ADD COLUMN IF NOT EXISTS service_charge_amount_minor bigint CHECK (service_charge_amount_minor IS NULL OR service_charge_amount_minor >= 0),
  ADD COLUMN IF NOT EXISTS weekly_amount_minor bigint CHECK (weekly_amount_minor IS NULL OR weekly_amount_minor >= 0),
  ADD COLUMN IF NOT EXISTS minimum_nights integer CHECK (minimum_nights IS NULL OR minimum_nights > 0),
  ADD COLUMN IF NOT EXISTS guest_limit integer CHECK (guest_limit IS NULL OR guest_limit > 0),
  ADD COLUMN IF NOT EXISTS check_in_time time,
  ADD COLUMN IF NOT EXISTS check_out_time time,
  ADD COLUMN IF NOT EXISTS cleaning_fee_minor bigint CHECK (cleaning_fee_minor IS NULL OR cleaning_fee_minor >= 0);
