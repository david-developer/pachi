export type ProviderVerificationCase = {
  id: string;
  provider_profile_id: string;
  state: 'PENDING' | 'NEEDS_RESUBMISSION' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | 'REVOKED';
  version: number;
  policy_version: string;
  submitted_at: string;
  decision_at: string | null;
  reason_code: string | null;
  valid_until: string | null;
  previous_case_id: string | null;
  next_action: 'WAIT_FOR_REVIEW' | 'SUBMIT_CORRECTION' | 'SUBMIT_NEW_CASE' | 'RENEW' | 'CONTACT_SUPPORT' | 'NONE';
};
export type ProviderVerificationStatus = { case: ProviderVerificationCase | null; synthetic_intake_available: boolean };
