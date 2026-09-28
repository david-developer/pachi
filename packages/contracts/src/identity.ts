export type ParticipationProjection =
  | { allowed: true }
  | { allowed: false; reason: 'PHONE_REQUIRED' };

export type AccountMeResponse = {
  id: string;
  account_state: 'PENDING_PHONE' | 'ACTIVE' | 'LIMITED' | 'SUSPENDED' | 'DEACTIVATED' | 'DELETION_PENDING' | 'DELETED';
  participation: ParticipationProjection;
};

export type AuthBootstrapResponse = {
  user_id: string;
  session_id: string;
  account_state: AccountMeResponse['account_state'];
  participation: ParticipationProjection;
};

export type SafeSessionResponse = {
  id: string;
  authenticated_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  current: boolean;
};

export type SessionListResponse = { sessions: SafeSessionResponse[] };
export type OperationStatusResponse = { status: 'ok' };
export type PhoneRequestResponse = { status: 'accepted'; challengeId: string };
export type PhoneConfirmResponse = { status: 'verified'; activated: boolean };
export type ProviderType = 'OWNER' | 'INDEPENDENT_AGENT' | 'PROPERTY_MANAGER';
export type ProviderOnboardingResponse = { profile_id: string; account_id: string; provider_types: ProviderType[]; state: 'DRAFT' | 'PENDING_VERIFICATION' | 'ACTIVE' | 'RESTRICTED' | 'SUSPENDED' | 'CLOSED'; verification_status: 'NOT_VERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'NEEDS_RESUBMISSION'; display_name: string; bio: string | null; service_area: string | null };
