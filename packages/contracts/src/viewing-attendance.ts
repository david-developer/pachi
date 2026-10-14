import type { ViewingConfirmRequest, ViewingResponse } from './viewing.js';

export type ViewingAttendanceOutcome = 'COMPLETED' | 'SEEKER_NO_SHOW' | 'PROVIDER_NO_SHOW';
export type ViewingAttendanceState = 'NONE' | 'AWAITING_VALIDATION' | ViewingAttendanceOutcome | 'DISPUTED' | 'ATTENDANCE_UNCONFIRMED';
export type ViewingAttendanceClaimState = 'PENDING' | 'CONFIRMED' | 'FINALIZED' | 'DISPUTED';

export type ViewingAttendanceCase = {
  id: string;
  state: 'OPEN' | 'RESOLVED';
  review_status: 'PENDING_REVIEW' | 'RESOLVED';
  opened_at: string;
};

export type ViewingAttendanceClaimResponse = {
  id: string;
  viewing_id: string;
  schedule_version: number;
  claimant_user_id: string;
  claimant_side: 'SEEKER' | 'PROVIDER';
  claim_type: 'COMPLETION' | 'NO_SHOW';
  claimed_outcome: ViewingAttendanceOutcome;
  state: ViewingAttendanceClaimState;
  version: number;
  claimed_at: string;
  notice_available_at: string;
  response_deadline: string;
  responded_at: string | null;
  finalized_at: string | null;
  can_confirm: boolean;
  can_dispute: boolean;
};

export type ViewingAttendanceResponse = {
  viewing_id: string;
  schedule_version: number;
  /** Current Viewing aggregate version, supplied as expected_version on commands. */
  version: number;
  state: ViewingAttendanceState;
  outcome: ViewingAttendanceOutcome | null;
  actor_side: 'SEEKER' | 'PROVIDER';
  can_claim_completion: boolean;
  can_claim_no_show: boolean;
  claims: ViewingAttendanceClaimResponse[];
  next_cursor: string | null;
  case: ViewingAttendanceCase | null;
  response_window_hours: 48;
  review_eligibility_created: boolean;
};

export type ViewingAttendanceCompletionRequest = ViewingConfirmRequest;
export type ViewingAttendanceNoShowRequest = ViewingConfirmRequest & { absent_side: 'SEEKER' | 'PROVIDER' };
export type ViewingAttendanceConfirmRequest = ViewingConfirmRequest & { expected_claim_version: number };
export type ViewingAttendanceDisputeRequest = ViewingAttendanceConfirmRequest & {
  reason: 'DID_NOT_ATTEND' | 'OUTCOME_INCORRECT' | 'SAFETY' | 'OTHER';
  evidence?: { reference: string; kind: 'MESSAGE' }[];
};
export type ViewingAttendanceCommandResponse = {
  viewing: ViewingResponse;
  attendance: ViewingAttendanceResponse;
  claim: ViewingAttendanceClaimResponse;
  replayed: boolean;
};
export type ViewingAttendanceCaseResponse = {
  viewing_id: string;
  schedule_version: number;
  case: ViewingAttendanceCase | null;
};
