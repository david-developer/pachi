import type { OrganizationRole, OrdinaryOrganizationRole } from './organization.js';
export type OrganizationOwnershipTransfer = {
  id: string; organization_id: string; source_membership_id: string; recipient_membership_id: string;
  source_membership_version: number; recipient_membership_version: number; source_role_after: OrdinaryOrganizationRole;
  state: 'PENDING_ACCEPTANCE' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED' | 'INVALIDATED';
  version: number; organization_version: number; created_at: string; accepted_at: string | null; completed_at: string | null;
};
export type OrganizationOwnershipTransferListResponse = { transfers: OrganizationOwnershipTransfer[]; next_cursor: string | null };
export type OrganizationPrivilegedMemberRequest = { expected_organization_version: number; expected_actor_membership_version: number; expected_membership_version: number };
export type OrganizationPrivilegedRoleRequest = OrganizationPrivilegedMemberRequest & { role: OrganizationRole };
export type OrganizationOwnershipTransferCreateRequest = { recipient_membership_id: string; source_role_after: OrdinaryOrganizationRole; expected_organization_version: number; expected_actor_membership_version: number; expected_recipient_membership_version: number };
export type OrganizationOwnershipTransferCommandRequest = { expected_organization_version: number; expected_actor_membership_version: number; expected_transfer_version: number; expected_source_membership_version: number; expected_recipient_membership_version: number };
