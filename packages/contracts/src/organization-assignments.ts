export type OrganizationAssignment = {
  id: string; membership_id: string; resource_type: 'LISTING' | 'INTERACTION'; resource_id: string;
  state: 'ACTIVE' | 'REVOKED'; version: number; created_at: string; effective_at: string; valid_until: string | null; revoked_at: string | null;
};
export type OrganizationAssignmentListResponse = { assignments: OrganizationAssignment[]; next_cursor: string | null };
export type OrganizationAssignmentCreateRequest = { membership_id: string; expected_version: number };
export type OrganizationAssignmentRevokeRequest = { expected_version: number };
