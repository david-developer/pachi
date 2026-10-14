export type ViewingState =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'SCHEDULED'
  | 'RESCHEDULED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'CANCELLED_BY_SEEKER'
  | 'CANCELLED_BY_PROVIDER'
  | 'SEEKER_NO_SHOW'
  | 'PROVIDER_NO_SHOW'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'ATTENDANCE_UNCONFIRMED';

export type ViewingResponse = {
  id: string;
  interaction_id: string;
  listing_id: string;
  provider_account_id: string;
  seeker_user_id: string;
  state: ViewingState;
  proposed_start: string;
  proposed_end: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  display_timezone: string;
  response_deadline: string;
  version: number;
  schedule_version: number;
  seeker_confirmed: boolean;
  provider_confirmed: boolean;
  private_instructions: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
  actor_side: 'SEEKER' | 'PROVIDER';
  can_accept: boolean;
  can_decline: boolean;
  can_confirm: boolean;
  can_cancel: boolean;
};

export type ViewingListResponse = {
  items: ViewingResponse[];
  next_cursor: string | null;
  can_request: boolean | null;
};

export type ViewingCommandResponse = {
  viewing: ViewingResponse;
  replayed: boolean;
};

export type ViewingCreateRequest = {
  proposed_start: string;
  proposed_end: string;
  display_timezone: string;
};

export type ViewingConfirmRequest = {
  expected_version: number;
  expected_schedule_version: number;
};

export type ViewingAcceptRequest = ViewingConfirmRequest & {
  scheduled_start: string;
  scheduled_end: string;
  private_instructions: string;
};

export type ViewingReasonRequest = ViewingConfirmRequest & {
  reason: string;
};

export type ViewingErrorResponse = {
  statusCode: number;
  code: string;
  message: string;
  request_id: string;
};
