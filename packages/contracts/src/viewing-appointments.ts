import type { ViewingConfirmRequest, ViewingResponse } from './viewing.js';
export type ViewingRescheduleState = 'PENDING'|'FINALIZED'|'REJECTED'|'WITHDRAWN'|'EXPIRED'|'INVALIDATED';
export type ViewingRescheduleResponse = {
  id:string;viewing_id:string;base_schedule_version:number;proposed_start:string;proposed_end:string;display_timezone:string;
  proposed_by_user_id:string;proposed_by_side:'SEEKER'|'PROVIDER';state:ViewingRescheduleState;version:number;
  seeker_approved:boolean;provider_approved:boolean;finalized_schedule_version:number|null;
  expires_at:string;created_at:string;updated_at:string;actor_side:'SEEKER'|'PROVIDER';can_accept:boolean;can_reject:boolean;can_withdraw:boolean;
};
export type ViewingRescheduleRequest = ViewingConfirmRequest & {proposed_start:string;proposed_end:string};
export type ViewingRescheduleActionRequest = ViewingConfirmRequest & {expected_proposal_version:number};
export type ViewingRescheduleCommandResponse = {viewing:ViewingResponse;proposal:ViewingRescheduleResponse;replayed:boolean};
export type ViewingRescheduleListResponse = {items:ViewingRescheduleResponse[];current_proposal:ViewingRescheduleResponse|null;next_cursor:string|null;can_propose:boolean;
  schedule_history:{schedule_version:number;scheduled_start:string;scheduled_end:string;display_timezone:string;superseded_at:string}[]};
export type ViewingNoticeResponse = {id:string;viewing_id:string;recipient_side:'SEEKER'|'PROVIDER';event_type:string;schedule_version:number;
  event_at:string;available_at:string;inbox_state:'AVAILABLE';external_state:'NOT_ENABLED';read_at:string|null;moderation_reason_code?:string;moderation_command?:'HOLD'|'HIDE'|'REMOVE'|'RESTORE';appeal_deadline?:string};
export type ViewingNoticeListResponse = {items:ViewingNoticeResponse[];next_cursor:string|null};
export type ViewingReminderResponse = {schedule_version:number;plan_status:'PLANNED'|'SUPPRESSED'|'NOT_PREPARED';planned_at:string|null;
  items:{id:string;action_type:'REMINDER_24H'|'REMINDER_2H';expected_schedule_version:number;due_at:string;state:'PENDING'|'LEASED'|'PROCESSED'|'SKIPPED';reason_code:string|null}[];external_state:'NOT_ENABLED'};
