import { createHash, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import type { OrganizationActor, OrganizationMember, OrganizationRole, OrdinaryOrganizationRole } from './organization-lifecycle.js';
import { ORDINARY_ORGANIZATION_ROLES } from './organization-lifecycle.js';
import { requireOrganizationResourceSession } from './organization-resource-actor.js';
import type { LocalOrganizationOwnerStepUp } from './organization-owner-step-up.js';

type Tx = postgres.TransactionSql;
type Command = { idempotencyKey: string; requestId: string; expectedOrganizationVersion: number; expectedActorMembershipVersion: number };
type MemberCommand = Command & { expectedMembershipVersion: number };
type TransferCommand = Command & { expectedTransferVersion: number; expectedSourceMembershipVersion: number; expectedRecipientMembershipVersion: number };
type TransferState = 'PENDING_ACCEPTANCE' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED' | 'INVALIDATED';
export type OrganizationOwnershipTransfer = {
  id: string; organization_id: string; source_membership_id: string; recipient_membership_id: string;
  source_membership_version: number; recipient_membership_version: number; source_role_after: OrdinaryOrganizationRole;
  state: TransferState; version: number; organization_version: number; created_at: string; accepted_at: string | null; completed_at: string | null;
};
type TransferRow = OrganizationOwnershipTransfer & { initiated_by: string; recipient_user_id: string; accepted_session_id: string | null; accepted_security_version: number | null };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const denied = (code = 'RESOURCE_SCOPE_DENIED') => new IdentityError(code, code);
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const ordinary = (role: string): role is OrdinaryOrganizationRole => (ORDINARY_ORGANIZATION_ROLES as readonly string[]).includes(role);
const privileged = (role: string) => role === 'OWNER' || role === 'ADMIN';
const time = (value: string | null): string | null => value === null ? null : new Date(value).toISOString();

/** All mutations lock the organization before touching membership/transfer rows.
 * Current role, session, phone and step-up are checked again after lock waits.
 * No production owner MFA adapter or recovery fallback is installed. */
export class OrganizationOwnerStore {
  constructor(private readonly client: postgres.Sql, private readonly stepUp?: LocalOrganizationOwnerStepUp) {}
  private async actor(tx: Tx, actor: OrganizationActor, orgId: string): Promise<{ member: OrganizationMember; version: number }> {
    await requireOrganizationResourceSession(tx, actor);
    const organizations = await tx<{ version: number }[]>`SELECT version FROM organizations WHERE id=${orgId}
      AND state='ACTIVE' AND onboarding_completed_at IS NOT NULL FOR UPDATE`;
    const member = (await tx<OrganizationMember[]>`SELECT id,organization_id,user_id,role,state,version,activated_at,revoked_at
      FROM organization_memberships WHERE organization_id=${orgId} AND user_id=${actor.userId} AND state='ACTIVE'`)[0];
    await requireOrganizationResourceSession(tx, actor);
    if (!organizations[0] || !member) throw denied();
    return { member, version: organizations[0].version };
  }
  private async trusted(tx: Tx, actor: OrganizationActor, orgId: string): Promise<void> {
    if (!this.stepUp) throw denied('STEP_UP_REQUIRED');
    await this.stepUp.require(tx, actor, orgId);
  }
  private versions(context: { member: OrganizationMember; version: number }, input: Command): void {
    if (context.version !== input.expectedOrganizationVersion || context.member.version !== input.expectedActorMembershipVersion) throw denied('STALE_VERSION');
  }
  private async member(tx: Tx, orgId: string, id: string): Promise<OrganizationMember> {
    const row = (await tx<OrganizationMember[]>`SELECT id,organization_id,user_id,role,state,version,activated_at,revoked_at
      FROM organization_memberships WHERE id=${id} AND organization_id=${orgId}`)[0];
    if (!row) throw denied();
    return { ...row, activated_at: time(row.activated_at), revoked_at: time(row.revoked_at) };
  }
  private async eligible(tx: Tx, member: OrganizationMember): Promise<void> {
    if (member.state !== 'ACTIVE') throw denied();
    const users = await tx`SELECT id FROM users WHERE id=${member.user_id} AND account_state='ACTIVE' FOR SHARE`;
    const phones = await tx`SELECT id FROM phone_contacts WHERE user_id=${member.user_id} AND verified_at IS NOT NULL
      AND replaced_at IS NULL AND verification_version>0 FOR SHARE`;
    if (!users[0] || !phones[0]) throw denied();
  }
  private async transfer(tx: Tx, orgId: string, id: string): Promise<TransferRow> {
    const row = (await tx<TransferRow[]>`SELECT t.*,o.version AS organization_version FROM organization_ownership_transfers t
      JOIN organizations o ON o.id=t.organization_id WHERE t.id=${id} AND t.organization_id=${orgId}`)[0];
    if (!row) throw denied();
    return row;
  }
  private projection(row: TransferRow): OrganizationOwnershipTransfer {
    return { id: row.id, organization_id: row.organization_id, source_membership_id: row.source_membership_id,
      recipient_membership_id: row.recipient_membership_id, source_membership_version: row.source_membership_version,
      recipient_membership_version: row.recipient_membership_version, source_role_after: row.source_role_after, state: row.state,
      version: row.version, organization_version: row.organization_version, created_at: time(row.created_at)!, accepted_at: time(row.accepted_at), completed_at: time(row.completed_at) };
  }
  private async bump(tx: Tx, orgId: string): Promise<number> {
    return (await tx<{ version: number }[]>`UPDATE organizations SET version=version+1,updated_at=statement_timestamp() WHERE id=${orgId} RETURNING version`)[0]!.version;
  }
  private async event(tx: Tx, actor: OrganizationActor, orgId: string, action: string, input: { requestId: string }, details: {
    membershipId?: string; transferId?: string; beforeRole?: string; afterRole?: string; membershipVersion?: number; transferVersion?: number; organizationVersion: number;
  }): Promise<void> {
    const actionId = randomUUID();
    await tx`INSERT INTO organization_owner_actions(id,organization_id,actor_user_id,action,membership_id,transfer_id,before_role,after_role,membership_version,organization_version,transfer_version,request_id)
      VALUES(${actionId},${orgId},${actor.userId},${action},${details.membershipId ?? null},${details.transferId ?? null},${details.beforeRole ?? null},${details.afterRole ?? null},${details.membershipVersion ?? null},${details.organizationVersion},${details.transferVersion ?? null},${input.requestId})`;
    const payload = { action_id: actionId, organization_id: orgId, transfer_id: details.transferId ?? null, action, version: details.transferVersion ?? details.membershipVersion ?? 1, schema_version: 1 };
    await tx`INSERT INTO organization_owner_outbox(action_id,organization_id,event_type,safe_payload) VALUES(${actionId},${orgId},${action},${JSON.stringify(payload)}::text::jsonb)`;
    await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata)
      VALUES(${actor.userId},${action},'OrganizationOwnership',${details.transferId ?? orgId},'OWNER_GOVERNANCE',${input.requestId},${JSON.stringify({ policy_version: 'organization-owner-lifecycle-v1', organization_id: orgId, action_id: actionId })}::text::jsonb)`;
  }
  private async command<T>(actor: OrganizationActor, orgId: string, operation: string, input: Command, payload: Record<string, unknown>, work: (tx: Tx, context: { member: OrganizationMember; version: number }, prior: string | null) => Promise<T>): Promise<T> {
    if (!uuid(orgId) || !uuid(input.idempotencyKey) || !uuid(input.requestId) || !positive(input.expectedOrganizationVersion) || !positive(input.expectedActorMembershipVersion)) throw denied('INVALID_INPUT');
    const requestHash = digest(payload);
    const result = await this.client.begin(async tx => {
      await tx`SET LOCAL TIME ZONE 'UTC'`;
      const context = await this.actor(tx, actor, orgId);
      // Parent serialization also prevents differently-keyed conflicting mutations.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`org-command:${actor.userId.toLowerCase()}:${operation}:${input.idempotencyKey.toLowerCase()}`},0))`;
      const receipt = (await tx<{ request_hash: string; result: { id: string } }[]>`SELECT request_hash,result FROM organization_command_receipts
        WHERE actor_user_id=${actor.userId} AND operation=${operation} AND idempotency_key=${input.idempotencyKey}`)[0];
      const refusal = (await tx<{ request_hash: string }[]>`SELECT request_hash FROM organization_owner_denials WHERE actor_user_id=${actor.userId}
        AND operation=${operation} AND idempotency_key=${input.idempotencyKey}`)[0];
      if ((receipt && receipt.request_hash !== requestHash) || (refusal && refusal.request_hash !== requestHash)) throw denied('IDEMPOTENCY_KEY_REUSED');
      try {
        return await tx.savepoint(async tx => {
        if (operation !== 'TRANSFER_ACCEPT' && context.member.role !== 'OWNER' && !receipt) throw denied();
        if (operation === 'TRANSFER_ACCEPT') {
          const transfer = await this.transfer(tx, orgId, payload.transfer_id as string);
          if (transfer.recipient_user_id !== actor.userId.toLowerCase()) throw denied();
        }
        await this.trusted(tx, actor, orgId);
        const value = await work(tx, context, receipt?.result.id ?? null);
        await requireOrganizationResourceSession(tx, actor);
        await this.trusted(tx, actor, orgId);
        if (!receipt) await tx`INSERT INTO organization_command_receipts(actor_user_id,operation,idempotency_key,request_hash,organization_id,result)
          VALUES(${actor.userId},${operation},${input.idempotencyKey},${requestHash},${orgId},${JSON.stringify({ id: (value as { id: string }).id })}::text::jsonb)`;
        return value;
        });
      } catch (error) {
        if (!(error instanceof IdentityError) || !['STEP_UP_REQUIRED','RESOURCE_SCOPE_DENIED','STALE_VERSION','INVALID_STATE','FINAL_OWNER_PROTECTED'].includes(error.code)) throw error;
        // The savepoint rolls back all business effects on a late security/step-up
        // denial; only this bounded immutable denial commits.
        const rows = await tx`INSERT INTO organization_owner_denials(actor_user_id,organization_id,operation,idempotency_key,request_hash,reason_code,request_id)
          VALUES(${actor.userId},${orgId},${operation},${input.idempotencyKey},${requestHash},${error.code},${input.requestId}) ON CONFLICT DO NOTHING RETURNING actor_user_id`;
        if (rows[0]) await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata)
          VALUES(${actor.userId},'OWNER_COMMAND_DENIED','Organization',${orgId},${error.code},${input.requestId},${JSON.stringify({ operation, policy_version: 'organization-owner-lifecycle-v1' })}::text::jsonb)`;
        return error;
      }
    });
    if (result instanceof IdentityError) throw result;
    return result as T;
  }
  async mutateMember(actor: OrganizationActor, orgId: string, membershipId: string, input: MemberCommand & { command: 'ROLE' | 'REVOKE'; role?: OrganizationRole }): Promise<OrganizationMember> {
    if (!uuid(membershipId) || !positive(input.expectedMembershipVersion) || !['ROLE','REVOKE'].includes(input.command)
      || (input.command === 'ROLE' && !['OWNER','ADMIN',...ORDINARY_ORGANIZATION_ROLES].includes(input.role ?? ''))
      || (input.command === 'REVOKE' && input.role !== undefined)) throw denied('INVALID_INPUT');
    const operation = input.command === 'ROLE' ? 'OWNER_ROLE' : 'OWNER_REVOKE';
    const payload = { organization_id: orgId.toLowerCase(), membership_id: membershipId.toLowerCase(), command: input.command, role: input.role ?? null,
      organization_version: input.expectedOrganizationVersion, actor_version: input.expectedActorMembershipVersion, membership_version: input.expectedMembershipVersion };
    return this.command(actor, orgId.toLowerCase(), operation, input, payload, async (tx, context, prior) => {
      if (context.member.role !== 'OWNER') throw denied();
      const target = await this.member(tx, orgId, membershipId);
      if (prior) return target;
      this.versions(context, input);
      if (target.version !== input.expectedMembershipVersion) throw denied('STALE_VERSION');
      if ((input.command === 'ROLE' ? target.state !== 'ACTIVE' : !['ACTIVE','SUSPENDED'].includes(target.state)) || (!privileged(target.role) && !privileged(input.role ?? ''))) throw denied('INVALID_STATE');
      if (input.command === 'ROLE') { await this.eligible(tx, target); if (target.role === input.role) throw denied('INVALID_STATE'); }
      if (target.role === 'OWNER' && (input.command === 'REVOKE' || input.role !== 'OWNER')) {
        const owners = await tx`SELECT id FROM organization_memberships WHERE organization_id=${orgId} AND role='OWNER' AND state='ACTIVE' AND id<>${target.id}`;
        if (!owners[0]) throw denied('FINAL_OWNER_PROTECTED');
      }
      const role = input.role ?? target.role, state = input.command === 'REVOKE' ? 'REVOKED' : 'ACTIVE';
      const version = await this.bump(tx, orgId);
      await tx`UPDATE organization_memberships SET role=${role},state=${state},version=version+1,changed_by=${actor.userId},changed_at=statement_timestamp(),
        revoked_at=CASE WHEN ${state}='REVOKED' THEN statement_timestamp() ELSE revoked_at END WHERE id=${target.id}`;
      await this.event(tx, actor, orgId, input.command === 'ROLE' ? 'PRIVILEGED_ROLE_CHANGED' : 'PRIVILEGED_MEMBER_REVOKED', input,
        { membershipId: target.id, beforeRole: target.role, afterRole: role, membershipVersion: target.version + 1, organizationVersion: version });
      return this.member(tx, orgId, target.id);
    });
  }
  async initiate(actor: OrganizationActor, orgId: string, recipientMembershipId: string, input: Command & { expectedRecipientMembershipVersion: number; sourceRoleAfter: OrdinaryOrganizationRole }): Promise<OrganizationOwnershipTransfer> {
    if (!uuid(recipientMembershipId) || !positive(input.expectedRecipientMembershipVersion) || !ordinary(input.sourceRoleAfter)) throw denied('INVALID_INPUT');
    const payload = { organization_id: orgId.toLowerCase(), recipient_membership_id: recipientMembershipId.toLowerCase(), source_role_after: input.sourceRoleAfter,
      recipient_version: input.expectedRecipientMembershipVersion, actor_version: input.expectedActorMembershipVersion, organization_version: input.expectedOrganizationVersion };
    return this.command(actor, orgId.toLowerCase(), 'TRANSFER_INITIATE', input, payload, async (tx, context, prior) => {
      if (context.member.role !== 'OWNER') throw denied();
      if (prior) return this.projection(await this.transfer(tx, orgId, prior));
      this.versions(context, input);
      const recipient = await this.member(tx, orgId, recipientMembershipId); await this.eligible(tx, recipient);
      if (recipient.user_id === actor.userId.toLowerCase() || recipient.role === 'OWNER') throw denied('INVALID_STATE');
      if (recipient.version !== input.expectedRecipientMembershipVersion) throw denied('STALE_VERSION');
      const pending = await tx`SELECT id FROM organization_ownership_transfers WHERE organization_id=${orgId} AND state IN ('PENDING_ACCEPTANCE','ACCEPTED')
        AND (source_membership_id=${context.member.id} OR recipient_membership_id=${recipient.id})`;
      if (pending[0]) throw denied('INVALID_STATE');
      const id = randomUUID(), version = await this.bump(tx, orgId);
      await tx`INSERT INTO organization_ownership_transfers(id,organization_id,initiated_by,source_membership_id,source_membership_version,recipient_user_id,recipient_membership_id,recipient_membership_version,source_role_after)
        VALUES(${id},${orgId},${actor.userId},${context.member.id},${context.member.version},${recipient.user_id},${recipient.id},${recipient.version},${input.sourceRoleAfter})`;
      await this.event(tx, actor, orgId, 'TRANSFER_INITIATED', input, { transferId: id, transferVersion: 1, organizationVersion: version });
      return this.projection(await this.transfer(tx, orgId, id));
    });
  }
  async transferCommand(actor: OrganizationActor, orgId: string, transferId: string, input: TransferCommand & { command: 'ACCEPT' | 'COMPLETE' | 'CANCEL' }): Promise<OrganizationOwnershipTransfer> {
    if (!uuid(transferId) || !positive(input.expectedTransferVersion) || !positive(input.expectedSourceMembershipVersion) || !positive(input.expectedRecipientMembershipVersion)
      || !['ACCEPT','COMPLETE','CANCEL'].includes(input.command)) throw denied('INVALID_INPUT');
    const payload = { organization_id: orgId.toLowerCase(), transfer_id: transferId.toLowerCase(), command: input.command, organization_version: input.expectedOrganizationVersion,
      actor_version: input.expectedActorMembershipVersion, source_version: input.expectedSourceMembershipVersion, recipient_version: input.expectedRecipientMembershipVersion, transfer_version: input.expectedTransferVersion };
    return this.command(actor, orgId.toLowerCase(), `TRANSFER_${input.command}`, input, payload, async (tx, context, prior) => {
      const row = await this.transfer(tx, orgId, transferId);
      const intended = input.command === 'ACCEPT' ? row.recipient_user_id : row.initiated_by;
      if (intended !== actor.userId.toLowerCase()) throw denied();
      if (prior) {
        // A committed completion retry can read its own receipt under current
        // participation; historical ownership never authorizes another change.
        if (row.state === 'INVALIDATED' || row.state === 'CANCELLED') throw denied('INVALID_STATE');
        return this.projection(row);
      }
      if (input.command !== 'ACCEPT' && context.member.role !== 'OWNER') throw denied();
      this.versions(context, input);
      if (row.version !== input.expectedTransferVersion) throw denied('STALE_VERSION');
      if ((input.command === 'ACCEPT' && row.state !== 'PENDING_ACCEPTANCE') || (input.command === 'COMPLETE' && row.state !== 'ACCEPTED')
        || (input.command === 'CANCEL' && !['PENDING_ACCEPTANCE','ACCEPTED'].includes(row.state))) throw denied('INVALID_STATE');
      const source = await this.member(tx, orgId, row.source_membership_id), recipient = await this.member(tx, orgId, row.recipient_membership_id);
      if (source.version !== row.source_membership_version || recipient.version !== row.recipient_membership_version
        || source.version !== input.expectedSourceMembershipVersion || recipient.version !== input.expectedRecipientMembershipVersion) throw denied('STALE_VERSION');
      if (source.state !== 'ACTIVE' || source.role !== 'OWNER' || recipient.state !== 'ACTIVE' || recipient.role === 'OWNER') throw denied();
      await this.eligible(tx, source); await this.eligible(tx, recipient);
      if (input.command === 'COMPLETE') {
        const acceptingActor = { userId: recipient.user_id, sessionId: row.accepted_session_id!, securityVersion: row.accepted_security_version! };
        await requireOrganizationResourceSession(tx, acceptingActor); await this.trusted(tx, acceptingActor, orgId);
      }
      const version = await this.bump(tx, orgId), state = input.command === 'ACCEPT' ? 'ACCEPTED' : input.command === 'COMPLETE' ? 'COMPLETED' : 'CANCELLED';
      // Mark completion inside the same transaction before the two role writes,
      // so membership invalidation cannot invalidate this completed operation.
      await tx`UPDATE organization_ownership_transfers SET state=${state},version=version+1,updated_at=statement_timestamp(),
        accepted_by=CASE WHEN ${state}='ACCEPTED' THEN ${actor.userId}::uuid ELSE accepted_by END,
        accepted_session_id=CASE WHEN ${state}='ACCEPTED' THEN ${actor.sessionId}::uuid ELSE accepted_session_id END,
        accepted_security_version=CASE WHEN ${state}='ACCEPTED' THEN ${actor.securityVersion} ELSE accepted_security_version END,
        accepted_at=CASE WHEN ${state}='ACCEPTED' THEN statement_timestamp() ELSE accepted_at END,
        completed_by=CASE WHEN ${state}='COMPLETED' THEN ${actor.userId}::uuid ELSE NULL END,
        completed_at=CASE WHEN ${state}='COMPLETED' THEN statement_timestamp() ELSE NULL END,
        cancelled_by=CASE WHEN ${state}='CANCELLED' THEN ${actor.userId}::uuid ELSE NULL END,
        ended_at=CASE WHEN ${state} IN ('COMPLETED','CANCELLED') THEN statement_timestamp() ELSE NULL END WHERE id=${row.id}`;
      if (input.command === 'COMPLETE') {
        // Recipient becomes owner before source demotion, with a deferred DB
        // invariant as a second barrier. Neither intermediate state is visible.
        await tx`UPDATE organization_memberships SET role='OWNER',version=version+1,changed_by=${actor.userId},changed_at=statement_timestamp() WHERE id=${recipient.id}`;
        await tx`UPDATE organization_memberships SET role=${row.source_role_after},version=version+1,changed_by=${actor.userId},changed_at=statement_timestamp() WHERE id=${source.id}`;
        for (const [member, role] of [[recipient,'OWNER'],[source,row.source_role_after]] as const)
          await this.event(tx, actor, orgId, 'PRIVILEGED_ROLE_CHANGED', input, { membershipId: member.id, transferId: row.id, beforeRole: member.role, afterRole: role, membershipVersion: member.version + 1, organizationVersion: version });
      }
      await this.event(tx, actor, orgId, `TRANSFER_${state}`, input, { transferId: row.id, transferVersion: row.version + 1, organizationVersion: version });
      return this.projection(await this.transfer(tx, orgId, row.id));
    });
  }
  async list(actor: OrganizationActor, orgId: string, input: { cursor?: string; limit?: number } = {}): Promise<{ transfers: OrganizationOwnershipTransfer[]; next_cursor: string | null }> {
    const limit = input.limit ?? 20;
    if (!uuid(orgId) || !positive(limit) || limit > 50 || (input.cursor !== undefined && !uuid(input.cursor))) throw denied('INVALID_INPUT');
    return this.client.begin(async tx => {
      const context = await this.actor(tx, actor, orgId);
      const rows = await tx<TransferRow[]>`SELECT t.*,o.version AS organization_version FROM organization_ownership_transfers t JOIN organizations o ON o.id=t.organization_id
        WHERE t.organization_id=${orgId} AND (${context.member.role === 'OWNER'} OR t.initiated_by=${actor.userId} OR t.recipient_user_id=${actor.userId})
        AND (${input.cursor ?? null}::uuid IS NULL OR t.id>${input.cursor ?? null}::uuid) ORDER BY t.id LIMIT ${limit + 1}`;
      return { transfers: rows.slice(0, limit).map(row => this.projection(row)), next_cursor: rows.length > limit ? rows[limit - 1]!.id : null };
    }) as Promise<{ transfers: OrganizationOwnershipTransfer[]; next_cursor: string | null }>;
  }
}
