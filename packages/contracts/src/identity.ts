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
