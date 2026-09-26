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
};
export type StaffSessionResponse = {
  display_name: string;
  grants: { role: StaffRole; scope: StaffScope; expires_at: string }[];
  absolute_expires_at: string;
  idle_expires_at: string;
  reauthentication_expires_at: string;
};
