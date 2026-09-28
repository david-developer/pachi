ALTER TABLE phone_contacts DROP CONSTRAINT IF EXISTS phone_contacts_normalized_e164_check;
ALTER TABLE phone_contacts ADD CONSTRAINT phone_contacts_normalized_e164_check CHECK (normalized_e164 ~ '^\+[1-9][0-9]{7,14}$');
