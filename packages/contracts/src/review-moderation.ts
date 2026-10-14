import type { ReviewCriteria, ReviewReportReason, ReviewState } from './review.js';

export type ReviewModerationPurpose = 'REVIEW_MODERATION';
export type ReviewModerationCaseState = 'OPEN' | 'TRIAGED' | 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'RESOLVED' | 'CLOSED';
export type ReviewModerationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ReviewModerationCommand = 'BEGIN_INVESTIGATION' | 'HOLD' | 'HIDE' | 'REMOVE' | 'RESTORE' | 'RESOLVE' | 'CLOSE';
export type ReviewModerationReason = 'REVIEW_POLICY_VIOLATION' | 'PRIVACY_PROTECTION' | 'THREAT_PROTECTION' | 'INVESTIGATION' | 'NO_VIOLATION' | 'ELIGIBILITY_RESTORED' | 'CASE_COMPLETED';
/** Metadata only: excludes report details, review content and reporter identities. */
export type ReviewModerationQueueItem = {
  id: string;
  review_id: string;
  reason: ReviewReportReason;
  severity: ReviewModerationSeverity;
  state: ReviewModerationCaseState;
  version: number;
  review_state: ReviewState;
  review_version: number;
  opened_at: string;
  last_report_at: string;
  report_count: number;
  assigned_staff_user_id: string | null;
  age_seconds: number;
  due_at: string | null;
  overdue: boolean;
  next_action: 'ASSIGN' | 'BEGIN_INVESTIGATION' | 'RECORD_DECISION' | 'RESOLVE' | 'CLOSE' | 'COMPLETED';
};
export type ReviewModerationQueueResponse = { items: ReviewModerationQueueItem[] };
export type ReviewModerationAction = {
  id: string;
  case_id: string;
  review_id: string;
  actor_user_id: string;
  assigned_staff_user_id: string | null;
  command: ReviewModerationCommand | 'ASSIGN';
  reason_code: ReviewModerationReason | 'CASE_ASSIGNMENT';
  reason_text: string;
  before_case_state: ReviewModerationCaseState;
  after_case_state: ReviewModerationCaseState;
  before_review_state: ReviewState;
  after_review_state: ReviewState;
  case_version: number;
  review_version: number;
  reverses_action_id: string | null;
  policy_version: string;
  request_id: string;
  created_at: string;
  notice_available_at: string | null;
  appeal_deadline: string | null;
};
/** Only the exact assigned target and its immutable revisions; no counterpart slot. */
export type ReviewModerationDetailResponse = {
  case: ReviewModerationQueueItem;
  review: { id: string; state: ReviewState; version: number; rating: number; text: string | null; criteria: ReviewCriteria; published_at: string | null };
  revisions: { version: number; rating: number; text: string | null; criteria: ReviewCriteria; created_at: string }[];
  reports: { id: string; reason: ReviewReportReason; details: string | null; created_at: string }[];
  actions: ReviewModerationAction[];
};
export type ReviewModerationAssignRequest = {
  purpose: ReviewModerationPurpose;
  expected_version: number;
  assigned_staff_user_id: string;
  idempotency_key: string;
};
export type ReviewModerationDecisionRequest = {
  purpose: ReviewModerationPurpose;
  expected_version: number;
  expected_review_version: number;
  command: ReviewModerationCommand;
  reason_code: ReviewModerationReason;
  reason_text: string;
  reverses_action_id?: string;
  idempotency_key: string;
};
export type ReviewModerationCommandResponse = { case: ReviewModerationQueueItem; action: ReviewModerationAction; replayed: boolean };
export type ReviewModerationErrorResponse = { statusCode: number; code: string; message: string; request_id: string };
