export type ReviewDirection = 'SEEKER_TO_PROVIDER' | 'PROVIDER_TO_SEEKER';
export type ReviewState = 'SUBMITTED_HELD' | 'PUBLISHED' | 'UNDER_REVIEW' | 'HIDDEN' | 'REMOVED' | 'WITHDRAWN';
export type ReviewCriteria = {
  listing_accuracy?: number;
  communication?: number;
  reliability?: number;
  transparency?: number;
  overall_experience?: number;
  appointment_attendance?: number;
  respectful_conduct?: number;
  overall_interaction?: number;
};
export type ReviewContentRequest = { rating: number; text?: string; criteria?: ReviewCriteria };
export type ReviewSubmitRequest = ReviewContentRequest & { expected_version: number };
export type ReviewEditRequest = ReviewSubmitRequest;
export type ReviewWithdrawRequest = { expected_version: number };
export type ReviewEligibility = {
  id: string;
  direction: ReviewDirection;
  state: 'OPEN' | 'HELD' | 'CONSUMED' | 'EXPIRED' | 'REVOKED';
  opens_at: string;
  closes_at: string;
  policy_version: string;
  can_submit: boolean;
  version: number;
};
/** Private author projection. Never returned to another organization member. */
export type ReviewOwn = {
  id: string;
  eligibility_id: string;
  viewing_id: string;
  interaction_id: string;
  direction: ReviewDirection;
  target_type: 'PROVIDER_ACCOUNT' | 'USER';
  target_id: string;
  state: ReviewState;
  version: number;
  rating: number;
  text: string | null;
  criteria: ReviewCriteria;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_withdraw: boolean;
};
/** Contains only this actor's slot; the counterpart's submission state is omitted. */
export type ReviewEligibilityResponse = {
  viewing_id: string;
  interaction_id: string;
  actor_side: 'SEEKER' | 'PROVIDER';
  eligibility: ReviewEligibility | null;
  own_review: ReviewOwn | null;
};
export type ReviewCommandResponse = { review: ReviewOwn; replayed: boolean };
export type ReviewPublished = {
  id: string;
  direction: ReviewDirection;
  rating: number;
  text: string | null;
  criteria: ReviewCriteria;
  date: string;
  author_display_name: string;
  author_role: string;
  event_label: 'VALIDATED_COMPLETED_VIEWING';
  provider_identity_verified: boolean;
};
export type ReviewPublishedListResponse = {
  items: ReviewPublished[];
  next_cursor: string | null;
  reputation: { count: number; average: number | null };
};
export type ReviewReportReason = 'HARASSMENT' | 'DISCRIMINATION' | 'THREATS' | 'PRIVACY_EXPOSURE' | 'EXTORTION' | 'IMPERSONATION' | 'IRRELEVANT_CONTENT' | 'OTHER';
export type ReviewReportRequest = { reason: ReviewReportReason; details?: string };
export type ReviewReportResponse = {
  report: { id: string; review_id: string; state: 'OPEN'; review_status: 'PENDING_REVIEW'; created_at: string };
  replayed: boolean;
};
export type ReviewErrorResponse = { statusCode: number; code: string; message: string; request_id: string };
