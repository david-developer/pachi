export type AttendanceDecisionOutcome = 'COMPLETED' | 'SEEKER_NO_SHOW' | 'PROVIDER_NO_SHOW' | 'CLAIM_INVALIDATED' | 'INSUFFICIENT_EVIDENCE';
export type AttendanceDecisionReason = 'ATTENDANCE_SUPPORTED' | 'NO_SHOW_SUPPORTED' | 'CONTRADICTORY_CLAIM' | 'UNSUPPORTED_CLAIM' | 'INSUFFICIENT_EVIDENCE';
export type AttendanceEvidenceReference = { kind: 'MESSAGE'; reference: string };
export type AttendanceCaseQueueItem = {
  id: string; viewing_id: string; schedule_version: number; state: 'OPEN' | 'TRIAGED' | 'UNDER_REVIEW' | 'RESOLVED'; version: number;
  assigned_staff_user_id: string | null; opened_at: string; age_seconds: number;
  severity: 'LOW'; outcome: AttendanceDecisionOutcome | null; pending_appeals: number;
};
export type AttendanceCaseQueueResponse = { items: AttendanceCaseQueueItem[] };
export type AttendanceAdjudicationAction = {
  id: string; case_id: string; command: 'ASSIGN' | 'BEGIN_INVESTIGATION' | 'DECIDE' | 'RESOLVE_APPEAL'; actor_user_id: string;
  assigned_staff_user_id: string; case_version: number; before_state: string; after_state: string; before_case_state: string; after_case_state: string;
  outcome: AttendanceDecisionOutcome | null; reason_code: AttendanceDecisionReason | 'CASE_ASSIGNMENT' | 'CASE_INVESTIGATION';
  reason_text: string; evidence: AttendanceEvidenceReference[]; policy_version: 'attendance-adjudication-v1';
  original_action_id: string | null; appeal_id: string | null;
  appeal_outcome: 'UPHELD' | 'OVERTURNED' | 'PARTIALLY_UPHELD' | null;
  review_mode: 'INITIAL' | 'INDEPENDENT_REVIEW' | 'SOLE_OPERATOR_RECONSIDERATION';
  created_at: string; appeal_deadline: string | null;
};
export type AttendanceAppeal = {
  id: string; original_action_id: string; state: 'SUBMITTED' | 'UNDER_REVIEW' | 'UPHELD' | 'OVERTURNED' | 'PARTIALLY_UPHELD';
  reason: string; evidence: AttendanceEvidenceReference[]; submitted_at: string;
  outcome_action_id: string | null; review_mode: 'INDEPENDENT_REVIEW' | 'SOLE_OPERATOR_RECONSIDERATION' | null;
};
export type AttendanceCaseDetailResponse = {
  case: AttendanceCaseQueueItem;
  claims: { id: string; claimant_side: 'SEEKER' | 'PROVIDER'; claim_type: 'COMPLETION' | 'NO_SHOW'; claimed_outcome: string; state: string; claimed_at: string; validation_method: string | null }[];
  schedules: { schedule_version: number; scheduled_start: string; scheduled_end: string }[];
  reports: { id: string; reason_code: string; evidence: AttendanceEvidenceReference[]; submitted_at: string }[];
  events: { id: string; event_type: string; version: number; created_at: string }[];
  actions: AttendanceAdjudicationAction[]; appeals: AttendanceAppeal[];
};
export type AttendanceAssignmentRequest = { purpose: 'ATTENDANCE_ADJUDICATION'; expected_version: number; assigned_staff_user_id: string; idempotency_key: string };
export type AttendanceDecisionRequest = {
  purpose: 'ATTENDANCE_ADJUDICATION'; expected_version: number; outcome: AttendanceDecisionOutcome;
  reason_code: AttendanceDecisionReason; reason_text: string; evidence: AttendanceEvidenceReference[]; idempotency_key: string;
};
export type AttendanceAppealDecisionRequest = AttendanceDecisionRequest & {
  appeal_id: string; original_action_id: string; appeal_outcome: 'UPHELD' | 'OVERTURNED' | 'PARTIALLY_UPHELD';
  review_mode: 'INDEPENDENT_REVIEW' | 'SOLE_OPERATOR_RECONSIDERATION';
};
export type AttendanceAdjudicationCommandResponse = { case: AttendanceCaseQueueItem; action: AttendanceAdjudicationAction; replayed: boolean };
export type AttendanceAppealRequest = { original_action_id: string; reason: string; evidence: AttendanceEvidenceReference[]; idempotency_key: string };
export type AttendanceParticipantResolution = {
  case_id: string; current_decision: { id: string; outcome: AttendanceDecisionOutcome; reason_code: AttendanceDecisionReason;
    decided_at: string; appeal_deadline: string; can_appeal: boolean;
    review_mode: 'INITIAL' | 'INDEPENDENT_REVIEW' | 'SOLE_OPERATOR_RECONSIDERATION'; reviewer_label: string } | null;
  own_appeals: AttendanceAppeal[];
};
export type AttendanceAppealCommandResponse = { resolution: AttendanceParticipantResolution; appeal: AttendanceAppeal; replayed: boolean };

export type AttendanceInvestigationRequest = { purpose: 'ATTENDANCE_ADJUDICATION'; expected_version: number; reason_text: string; idempotency_key: string };
