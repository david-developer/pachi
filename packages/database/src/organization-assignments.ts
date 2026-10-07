import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import type { OrganizationActor } from './organization-lifecycle.js';
import { isUuid } from './conversation-access.js';
import { organizationResourceDenied as denied, requireOrganizationResourceActor, requireOrganizationResourceSession, type OrganizationResource, type OrganizationResourcePurpose, type OrganizationResourceActorContext } from './organization-resource-actor.js';

export type OrganizationAssignment = { id: string; membership_id: string; resource_type: 'LISTING' | 'INTERACTION'; resource_id: string;
  state: 'ACTIVE' | 'REVOKED'; version: number; created_at: string; effective_at: string; valid_until: string | null; revoked_at: string | null };
type Row = Omit<OrganizationAssignment,'state'|'created_at'|'effective_at'|'valid_until'|'revoked_at'> & {
  organization_id: string; provider_account_id: string; created_at: Date | string; effective_at: Date | string; valid_until: Date | string | null; revoked_at: Date | string | null;
};
type Command = { idempotencyKey: string; requestId: string; expectedVersion: number };
const project = (row: Row): OrganizationAssignment => ({ id: row.id, membership_id: row.membership_id, resource_type: row.resource_type,
  resource_id: row.resource_id, state: row.revoked_at ? 'REVOKED' : 'ACTIVE', version: row.version,
  created_at: new Date(row.created_at).toISOString(), effective_at: new Date(row.effective_at).toISOString(),
  valid_until: row.valid_until===null?null:new Date(row.valid_until).toISOString(), revoked_at: row.revoked_at===null?null:new Date(row.revoked_at).toISOString() });
const hash = (payload: unknown): string => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

export class OrganizationAssignmentStore {
  constructor(private readonly client: postgres.Sql) {}
  /** Test/internal projection; future commands use the exported transaction helper. */
  async authorize(actor: OrganizationActor, resource: OrganizationResource, purpose: OrganizationResourcePurpose): Promise<OrganizationResourceActorContext> {
    return this.client.begin(tx => requireOrganizationResourceActor(tx,actor,resource,purpose)) as Promise<OrganizationResourceActorContext>;
  }
  async list(actor: OrganizationActor, resource: OrganizationResource, input: { membershipId?: string | undefined; cursor?: string | undefined; limit?: number | undefined } = {}): Promise<{ assignments: OrganizationAssignment[]; next_cursor: string | null }> {
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (input.cursor !== undefined && !isUuid(input.cursor)) || (input.membershipId !== undefined && !isUuid(input.membershipId))) throw denied('INVALID_INPUT');
    return this.client.begin(async tx => {
      // Assignment administrators only; no organization inventory enumeration by AGENT.
      await requireOrganizationResourceActor(tx,actor,resource,'ASSIGN_RESOURCE');
      const rows = await tx<Row[]>`SELECT * FROM organization_resource_assignments WHERE organization_id=${resource.organizationId}
        AND resource_type=${resource.resourceType} AND resource_id=${resource.resourceId}
        AND (${input.membershipId ?? null}::uuid IS NULL OR membership_id=${input.membershipId ?? null}::uuid)
        AND (${input.cursor ?? null}::uuid IS NULL OR id>${input.cursor ?? null}::uuid) ORDER BY id LIMIT ${limit+1}`;
      return { assignments: rows.slice(0,limit).map(project), next_cursor: rows.length>limit ? rows[limit-1]!.id : null };
    }) as Promise<{ assignments: OrganizationAssignment[]; next_cursor: string | null }>;
  }
  private async command(actor: OrganizationActor, resource: OrganizationResource, operation: 'ASSIGN' | 'REVOKE', input: Command,
    payload: unknown, work: (tx: postgres.TransactionSql, context: OrganizationResourceActorContext, priorId: string | null) => Promise<Row>): Promise<OrganizationAssignment> {
    if (!isUuid(input.idempotencyKey) || !isUuid(input.requestId) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion<0) throw denied('INVALID_INPUT');
    return this.client.begin(async tx => {
      const context = await requireOrganizationResourceActor(tx,actor,resource,'ASSIGN_RESOURCE');
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`org-assignment:${actor.userId.toLowerCase()}:${operation}:${input.idempotencyKey.toLowerCase()}`},0))`;
      const receipts = await tx<{ request_hash: string; assignment_id: string }[]>`SELECT request_hash,assignment_id FROM organization_assignment_receipts
        WHERE actor_user_id=${actor.userId} AND operation=${operation} AND idempotency_key=${input.idempotencyKey}`;
      if (receipts[0] && receipts[0].request_hash !== hash(payload)) throw denied('IDEMPOTENCY_KEY_REUSED');
      const row = await work(tx,context,receipts[0]?.assignment_id ?? null);
      if (!receipts[0]) await tx`INSERT INTO organization_assignment_receipts(actor_user_id,operation,idempotency_key,request_hash,assignment_id)
        VALUES(${actor.userId},${operation},${input.idempotencyKey},${hash(payload)},${row.id})`;
      await requireOrganizationResourceSession(tx,actor);
      return project(row);
    }) as Promise<OrganizationAssignment>;
  }
  async assign(actor: OrganizationActor, resource: OrganizationResource, membershipId: string, input: Command): Promise<OrganizationAssignment> {
    if (!isUuid(membershipId)) throw denied('INVALID_INPUT');
    const payload = { organization_id: resource.organizationId.toLowerCase(), resource_type: resource.resourceType, resource_id: resource.resourceId.toLowerCase(), membership_id: membershipId.toLowerCase(), expected_version: input.expectedVersion };
    return this.command(actor,resource,'ASSIGN',input,payload,async (tx,context,priorId) => {
      if (priorId) return this.row(tx,resource,priorId);
      const eligible = await tx`SELECT m.id FROM organization_memberships m JOIN users u ON u.id=m.user_id
        WHERE m.id=${membershipId} AND m.organization_id=${context.organizationId} AND m.state='ACTIVE'
          AND m.role IN ('OWNER','ADMIN','LISTING_MANAGER','AGENT') AND u.account_state='ACTIVE'`;
      if (!eligible[0]) throw denied();
      const rows = await tx<Row[]>`SELECT * FROM organization_resource_assignments WHERE membership_id=${membershipId}
        AND resource_type=${resource.resourceType} AND resource_id=${resource.resourceId} ORDER BY version DESC LIMIT 1 FOR UPDATE`;
      const latest = rows[0];
      if ((latest?.version ?? 0) !== input.expectedVersion) throw denied('STALE_VERSION');
      if (latest && !latest.revoked_at) return latest;
      const created = await tx<Row[]>`INSERT INTO organization_resource_assignments(organization_id,provider_account_id,membership_id,resource_type,listing_id,interaction_id,
        assigned_by_user_id,assigned_by_membership_id,grant_request_id,version)
        VALUES(${context.organizationId},${context.providerAccountId},${membershipId},${resource.resourceType},
          ${resource.resourceType==='LISTING'?resource.resourceId:null},${resource.resourceType==='INTERACTION'?resource.resourceId:null},
          ${actor.userId},${context.membershipId},${input.requestId},${input.expectedVersion+1}) RETURNING *`;
      return created[0]!;
    });
  }
  async revoke(actor: OrganizationActor, resource: OrganizationResource, assignmentId: string, input: Command): Promise<OrganizationAssignment> {
    if (!isUuid(assignmentId) || input.expectedVersion<1) throw denied('INVALID_INPUT');
    const payload = { organization_id: resource.organizationId.toLowerCase(), resource_type: resource.resourceType, resource_id: resource.resourceId.toLowerCase(), assignment_id: assignmentId.toLowerCase(), expected_version: input.expectedVersion };
    return this.command(actor,resource,'REVOKE',input,payload,async (tx,context,priorId) => {
      if (priorId) return this.row(tx,resource,priorId);
      const row = await this.row(tx,resource,assignmentId);
      if (row.version!==input.expectedVersion) throw denied('STALE_VERSION');
      if (row.revoked_at) throw denied('INVALID_STATE');
      const updated = await tx<Row[]>`UPDATE organization_resource_assignments SET revoked_at=statement_timestamp(),version=version+1,
        revoked_by_user_id=${actor.userId},revoked_by_membership_id=${context.membershipId},revoke_request_id=${input.requestId},revocation_reason='ACTOR_REVOKED'
        WHERE id=${row.id} RETURNING *`;
      return updated[0]!;
    });
  }
  private async row(tx: postgres.TransactionSql, resource: OrganizationResource, id: string): Promise<Row> {
    const rows = await tx<Row[]>`SELECT * FROM organization_resource_assignments WHERE id=${id} AND organization_id=${resource.organizationId}
      AND resource_type=${resource.resourceType} AND resource_id=${resource.resourceId} FOR UPDATE`;
    if (!rows[0]) throw denied();
    return rows[0];
  }
}
