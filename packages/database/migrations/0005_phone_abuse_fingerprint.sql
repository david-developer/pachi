ALTER TABLE phone_otp_challenges ADD COLUMN IF NOT EXISTS request_fingerprint_hash bytea;
CREATE INDEX IF NOT EXISTS phone_otp_challenges_fingerprint_created_idx ON phone_otp_challenges (request_fingerprint_hash, created_at DESC) WHERE request_fingerprint_hash IS NOT NULL;
