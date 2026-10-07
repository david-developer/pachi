import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import { isUuid } from './conversation-access.js';
import type { OrganizationActor, OrganizationRole } from './organization-lifecycle.js';

export type OrganizationResource = { organizationId: string; resourceType: 'LISTING' | 'INTERACTION'; resourceId: string };
export type OrganizationResourcePurpose = 'LISTING_DRAFT' | 'INTERACTION_OPERATION' | 'ASSIGN_RESOURCE';
export type OrganizationResourceActorContext = {
  actorUserId: string; organizationId: string; providerAccountId: string;
  membershipId: string; membershipVersion: number; role: OrganizationRole;
  assignmentId: string | null; assignmentVersion: number | null;
  resourceType: 'LISTING' | 'INTERACTION'; resourceId: string; resourceState: string;
};
export const organizationResourceDenied = (code = 'RESOURCE_SCOPE_DENIED'): IdentityError => new IdentityError(code, code);

export async function requireOrganizationResourceSession(tx: postgres.TransactionSql, actor: OrganizationActor): Promise<void> {
  if (!isUuid(actor.userId) || !isUuid(actor.sessionId) || !Number.isSafeInteger(actor.securityVersion)) throw organizationResourceDenied('AUTH_REQUIRED');
  const sessions = await tx`SELECT s.id FROM security_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=${actor.sessionId} AND s.user_id=${actor.userId} AND s.revoked_at IS NULL
      AND s.expires_at>statement_timestamp() AND u.security_version=${actor.securityVersion} FOR SHARE OF s,u`;
  if (!sessions[0]) throw organizationResourceDenied('AUTH_REQUIRED');
  const eligible = await tx`SELECT u.id FROM users u WHERE u.id=${actor.userId} AND u.account_state='ACTIVE'
    AND EXISTS(SELECT 1 FROM phone_contacts p WHERE p.user_id=u.id AND p.verified_at IS NOT NULL AND p.replaced_at IS NULL AND p.verification_version>0)`;
  if (!eligible[0]) throw organizationResourceDenied('CAPABILITY_RESTRICTED');
  // Keep a replacement of the current phone behind the same authorization boundary.
  const phones = await tx`SELECT id FROM phone_contacts WHERE user_id=${actor.userId} AND verified_at IS NOT NULL AND replaced_at IS NULL AND verification_version>0 FOR SHARE`;
  if (!phones[0]) throw organizationResourceDenied('CAPABILITY_RESTRICTED');
}

/** Internal role/assignment foundation only. Consume inside this SAME transaction;
 * never cache the returned context or accept it back from clients. Callers must
 * additionally enforce action-specific verification, lifecycle, restrictions,
 * block/safety and step-up. This does not authorize messaging or viewings.
 * A future viewing uses its server-resolved INTERACTION with this same path. */
export async function requireOrganizationResourceActor(
  tx: postgres.TransactionSql, actor: OrganizationActor, resource: OrganizationResource, purpose: OrganizationResourcePurpose
): Promise<OrganizationResourceActorContext> {
  await requireOrganizationResourceSession(tx, actor);
  if (!isUuid(resource.organizationId) || !isUuid(resource.resourceId) || !['LISTING','INTERACTION'].includes(resource.resourceType)) throw organizationResourceDenied();
  if ((purpose === 'LISTING_DRAFT' && resource.resourceType !== 'LISTING') || (purpose === 'INTERACTION_OPERATION' && resource.resourceType !== 'INTERACTION')
    || !['LISTING_DRAFT','INTERACTION_OPERATION','ASSIGN_RESOURCE'].includes(purpose)) throw organizationResourceDenied();
  const organizations = await tx`SELECT id FROM organizations WHERE id=${resource.organizationId} AND state='ACTIVE' AND onboarding_completed_at IS NOT NULL FOR UPDATE`;
  if (!organizations[0]) throw organizationResourceDenied();
  const providers = await tx<{ id: string }[]>`SELECT id FROM provider_accounts WHERE organization_id=${resource.organizationId} AND kind='ORGANIZATION' AND state='ACTIVE' FOR SHARE`;
  if (!providers[0]) throw organizationResourceDenied();
  // Membership writes already serialize on the organization in migration0028.
  // Do not lock a child membership after the parent: direct writes can hold the
  // child while their trigger waits for the parent. Fresh statements see the
  // current committed membership after the parent lock is acquired.
  const members = await tx<{ id: string; role: OrganizationRole; version: number }[]>`SELECT id,role,version FROM organization_memberships
    WHERE organization_id=${resource.organizationId} AND user_id=${actor.userId} AND state='ACTIVE'`;
  const member = members[0];
  if (!member || member.role === 'ANALYST') throw organizationResourceDenied();
  const scoped = ['OWNER','ADMIN'].includes(member.role) || (member.role === 'LISTING_MANAGER' && purpose !== 'INTERACTION_OPERATION');
  if (purpose === 'ASSIGN_RESOURCE' && !scoped) throw organizationResourceDenied();
  const providerId = providers[0].id;
  // Read the assignment before the resource, then validate it again under the
  // resource lock: ownership-change triggers can revoke without the parent lock.
  let assignmentId: string | null = null;
  if (!scoped) {
    const assignments = await tx<{ id: string }[]>`SELECT id FROM organization_resource_assignments
      WHERE organization_id=${resource.organizationId} AND provider_account_id=${providerId} AND membership_id=${member.id}
        AND resource_type=${resource.resourceType} AND resource_id=${resource.resourceId} AND revoked_at IS NULL
        AND effective_at<=statement_timestamp() AND (valid_until IS NULL OR valid_until>statement_timestamp())`;
    assignmentId = assignments[0]?.id ?? null;
    if (!assignmentId) throw organizationResourceDenied();
  }
  const rows = resource.resourceType === 'LISTING'
    ? await tx<{ state: string }[]>`SELECT publication_status AS state FROM listings WHERE id=${resource.resourceId} AND provider_account_id=${providerId} FOR SHARE`
    : await tx<{ state: string }[]>`SELECT i.state FROM interactions i JOIN listings l ON l.id=i.listing_id
        WHERE i.id=${resource.resourceId} AND i.provider_account_id=${providerId} AND l.provider_account_id=${providerId} FOR SHARE OF i,l`;
  if (!rows[0]) throw organizationResourceDenied();
  let assignmentVersion: number | null = null;
  if (assignmentId) {
    const current = await tx<{ version: number }[]>`SELECT version FROM organization_resource_assignments WHERE id=${assignmentId}
      AND revoked_at IS NULL AND effective_at<=statement_timestamp() AND (valid_until IS NULL OR valid_until>statement_timestamp()) FOR SHARE`;
    if (!current[0]) throw organizationResourceDenied();
    assignmentVersion = current[0].version;
  }
  // A lock wait must not carry an expired session through this boundary.
  await requireOrganizationResourceSession(tx,actor);
  return { actorUserId: actor.userId.toLowerCase(), organizationId: resource.organizationId.toLowerCase(), providerAccountId: providerId,
    membershipId: member.id, membershipVersion: member.version, role: member.role, assignmentId, assignmentVersion,
    resourceType: resource.resourceType, resourceId: resource.resourceId.toLowerCase(), resourceState: rows[0].state };
}
