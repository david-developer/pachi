ALTER TABLE phone_otp_challenges DROP CONSTRAINT IF EXISTS phone_otp_challenges_normalized_e164_check;
ALTER TABLE phone_otp_challenges ADD CONSTRAINT phone_otp_challenges_normalized_e164_check CHECK (normalized_e164 ~ '^\+237[1-9][0-9]{8}$');
