export type StaffRole =
  | 'SUPER_ADMIN'
  | 'VERIFICATION_OFFICER'
  | 'LISTING_MODERATOR'
  | 'TRUST_SAFETY_MODERATOR'
  | 'SUPPORT_AGENT'
  | 'ANALYST';
export type StaffScope = {
  kind: 'platform' | 'region' | 'case';
  id: string;
  permissions: string[];
  property_id?: string;
};
export type AuthorityRiskStatus = {
  status: 'CLEAR' | 'HOLD' | 'INCOMPLETE' | 'STALE' | 'UNEVALUATED';
  next_action: string;
};
export type AuthorityRiskCase = {
  id: string;
  property_id: string;
  relationship_id: string | null;
  principal_id: string | null;
  subject_scope: string;
  trigger_kind: string;
  allegation_kind: string;
  state: string;
  version: number;
  reason_code: string;
  safe_remediation: string;
  source_provenance: string;
  received_at: string | null;
  source_review_action_id: string | null;
};
export type AuthorityRiskInternalSource = {
  kind: 'LISTING_RELATIONSHIP_PRINCIPAL';
  case_id: string;
  case_version: number;
  listing_id: string;
  listing_version: number;
  listing_provider_account_id: string;
  relationship_id: string;
  relationship_version: number;
  relationship_provider_account_id: string;
  property_id: string;
  finding: 'PRESENT' | 'ABSENT';
};
export type StaffSessionResponse = {
  display_name: string;
  grants: { role: StaffRole; scope: StaffScope; expires_at: string }[];
  absolute_expires_at: string;
  idle_expires_at: string;
  reauthentication_expires_at: string;
};
export type ListingPhotoReviewItem = {
  id: string;
  listing_id: string;
  media_asset_id: string;
  region: string;
  listing_title: string | null;
  status: 'NOT_REVIEWED' | 'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED';
  version: number;
  reason_code: string | null;
  is_cover: boolean;
  attached_at: string;
};
