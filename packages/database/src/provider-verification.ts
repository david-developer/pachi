import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import { requireStaffPermission, StaffAccessError, type StaffScope } from './staff-policy.js';
import type { StaffPrincipal } from './staff.js';

export const PROVIDER_IDENTITY_POLICY = 'provider-identity-synthetic-v1';
const SYNTHETIC: Record<string, string> = {
  GOVERNMENT_ID: 'PACHI_SYNTHETIC_GOVERNMENT_ID_V1',
  LIVE_SELFIE: 'PACHI_SYNTHETIC_LIVE_SELFIE_V1',
};
export type VerificationState = 'PENDING' | 'NEEDS_RESUBMISSION' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | 'REVOKED';
export type ProviderVerificationCase = { id: string; provider_profile_id: string; state: VerificationState; version: number; policy_version: string; submitted_at: string; decision_at: string | null; reason_code: string | null; valid_until: string | null; previous_case_id: string | null; next_action: 'WAIT_FOR_REVIEW' | 'SUBMIT_CORRECTION' | 'SUBMIT_NEW_CASE' | 'RENEW' | 'CONTACT_SUPPORT' | 'NONE' };
type CaseRow = { id: string; provider_profile_id: string; applicant_user_id: string; assigned_staff_user_id: string | null; state: VerificationState; version: number; policy_version: string; submitted_at: Date; decision_at: Date | null; reason_code: string | null; valid_until: Date | null; previous_case_id: string | null };
type Grant = { role: string; scope: StaffScope };
export class ProviderVerificationStore {
  constructor(private readonly client: postgres.Sql, private readonly evidenceSecret: string, private readonly clock: () => Date = () => new Date()) {}

  private key(): Buffer {
    if (this.evidenceSecret.length < 32) throw new IdentityError('CONFIGURATION', 'Evidence encryption is unavailable');
    return createHash('sha256').update(this.evidenceSecret).digest();
  }
  private encrypt(content: string): Buffer {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    return Buffer.concat([iv, cipher.update(content), cipher.final(), cipher.getAuthTag()]);
  }
  private decrypt(content: Buffer): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key(), content.subarray(0, 12));
    decipher.setAuthTag(content.subarray(content.length - 16));
    return Buffer.concat([decipher.update(content.subarray(12, -16)), decipher.final()]).toString();
  }
  private map(row: CaseRow): ProviderVerificationCase {
    const state = row.state === 'VERIFIED' && row.valid_until && new Date(row.valid_until) <= this.clock() ? 'EXPIRED' : row.state;
    const renewalDue = state === 'VERIFIED' && row.valid_until && +new Date(row.valid_until) - +this.clock() <= 30 * 86400_000;
    return { id: row.id, provider_profile_id: row.provider_profile_id, state, version: row.version, policy_version: row.policy_version, submitted_at: new Date(row.submitted_at).toISOString(), decision_at: row.decision_at ? new Date(row.decision_at).toISOString() : null, reason_code: row.reason_code, valid_until: row.valid_until ? new Date(row.valid_until).toISOString() : null, previous_case_id: row.previous_case_id, next_action: state === 'PENDING' ? 'WAIT_FOR_REVIEW' : state === 'NEEDS_RESUBMISSION' ? 'SUBMIT_CORRECTION' : state === 'REJECTED' ? 'SUBMIT_NEW_CASE' : state === 'REVOKED' ? 'CONTACT_SUPPORT' : state === 'EXPIRED' || renewalDue ? 'RENEW' : 'NONE' };
  }
  async own(userId: string): Promise<ProviderVerificationCase | null> {
    const rows = await this.client<CaseRow[]>`SELECT c.* FROM verification_cases c JOIN provider_profiles p ON p.id=c.provider_profile_id WHERE p.user_id=${userId} ORDER BY c.submitted_at DESC,c.created_at DESC LIMIT 1`;
    return rows[0] ? this.map(rows[0]) : null;
  }
  async submit(userId: string, input: { idempotencyKey: string; capacity: string; governmentId: string; liveSelfie: string; requestId: string | null; syntheticEnabled: boolean }): Promise<ProviderVerificationCase> {
    if (!input.syntheticEnabled) throw new IdentityError('EVIDENCE_POLICY_UNAVAILABLE', 'Real identity evidence intake is unavailable pending E01');
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(input.idempotencyKey)) throw new IdentityError('INVALID_INPUT', 'Invalid request key');
    if (!['OWNER','INDEPENDENT_AGENT','PROPERTY_MANAGER'].includes(input.capacity)) throw new IdentityError('INVALID_INPUT', 'Invalid provider capacity');
    if (input.governmentId !== SYNTHETIC.GOVERNMENT_ID || input.liveSelfie !== SYNTHETIC.LIVE_SELFIE) throw new IdentityError('EVIDENCE_POLICY_UNAVAILABLE', 'Only synthetic evidence is accepted in this environment');
    return this.client.begin(async (tx) => {
      const profiles = await tx<{ id: string; provider_types: string[]; state: string; account_state: string; phone_verified: boolean }[]>`SELECT p.id,p.provider_types,p.state,u.account_state,EXISTS(SELECT 1 FROM phone_contacts pc WHERE pc.user_id=u.id AND pc.verified_at IS NOT NULL AND pc.replaced_at IS NULL) AS phone_verified FROM provider_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=${userId} FOR UPDATE OF p,u`;
      const profile = profiles[0];
      if (!profile || profile.account_state !== 'ACTIVE' || !profile.phone_verified || ['SUSPENDED','CLOSED','RESTRICTED'].includes(profile.state)) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Provider is not eligible');
      if (!profile.provider_types.includes(input.capacity)) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Capacity is not declared on this profile');
      const priorKey = await tx<CaseRow[]>`SELECT * FROM verification_cases WHERE applicant_user_id=${userId} AND idempotency_key=${input.idempotencyKey}`;
      if (priorKey[0]) {
        const recorded = await tx<{capacity:string}[]>`SELECT safe_metadata->>'capacity' AS capacity FROM audit_events WHERE action='PROVIDER_VERIFICATION_SUBMITTED' AND target_id=${priorKey[0].id} ORDER BY created_at DESC LIMIT 1`;
        if (recorded[0]?.capacity !== input.capacity) throw new IdentityError('IDEMPOTENCY_KEY_REUSED','Request key was reused with different provider information');
        return this.map(priorKey[0]);
      }
      const prior = await tx<CaseRow[]>`SELECT * FROM verification_cases WHERE provider_profile_id=${profile.id} ORDER BY submitted_at DESC,created_at DESC LIMIT 1`;
      if (prior[0]?.state === 'PENDING') throw new IdentityError('INVALID_STATE', 'A case is already pending');
      if (prior[0]?.state === 'REVOKED') throw new IdentityError('INVALID_STATE', 'Revoked verification requires case resolution before a new submission');
      if (prior[0]?.state === 'VERIFIED' && prior[0].valid_until && +new Date(prior[0].valid_until) - +this.clock() > 30 * 86400_000) throw new IdentityError('INVALID_STATE', 'Current verification does not need renewal');
      const rows = await tx<CaseRow[]>`INSERT INTO verification_cases(provider_profile_id,applicant_user_id,previous_case_id,verification_type,state,policy_version,idempotency_key,submitted_at) VALUES (${profile.id},${userId},${prior[0]?.id ?? null},'PROVIDER_IDENTITY','PENDING',${PROVIDER_IDENTITY_POLICY},${input.idempotencyKey},${this.clock().toISOString()}) RETURNING *`;
      const row = rows[0]!;
      for (const kind of ['GOVERNMENT_ID','LIVE_SELFIE'] as const) {
        const content = kind === 'GOVERNMENT_ID' ? input.governmentId : input.liveSelfie;
        await tx`INSERT INTO verification_evidence(case_id,evidence_type,mime_type,sha256,encrypted_content,retention_policy_id) VALUES (${row.id},${kind},'application/x-pachi-synthetic',${createHash('sha256').update(content).digest('hex')},${this.encrypt(content)},'synthetic-30-days-after-closure')`;
      }
      if (profile.state === 'DRAFT') await tx`UPDATE provider_profiles SET state='PENDING_VERIFICATION',verification_status='PENDING',updated_at=now() WHERE id=${profile.id}`;
      await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata) VALUES (${userId},'PROVIDER_VERIFICATION_SUBMITTED','VerificationCase',${row.id},'SYNTHETIC_EVIDENCE_SUBMITTED',${input.requestId},${JSON.stringify({policy_version:PROVIDER_IDENTITY_POLICY,capacity:input.capacity})}::jsonb)`;
      await tx`INSERT INTO verification_outbox(case_id,event_type,safe_payload) VALUES (${row.id},'PROVIDER_VERIFICATION_SUBMITTED',${JSON.stringify({case_id:row.id})}::jsonb)`;
      return this.map(row);
    });
  }
  private authorized(staff: StaffPrincipal, row: CaseRow, permission: string, sensitive: boolean) {
    if (row.assigned_staff_user_id !== staff.row.user_id || row.applicant_user_id === staff.row.user_id) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Case scope denied');
    requireStaffPermission(staff.grants as Grant[], permission, {kind:'case',id:row.id}, staff.row.authenticated_at, this.clock(), sensitive);
  }
  private async currentGrant(tx: postgres.TransactionSql, staff: StaffPrincipal, permission: string, scope: {kind:'platform'|'case';id:string}, sensitive: boolean): Promise<void> {
    const grants = await tx<{role:string;permission_scope:StaffScope}[]>`SELECT role,permission_scope FROM staff_grants WHERE user_id=${staff.row.user_id} AND revoked_at IS NULL AND active_from<=${this.clock().toISOString()} AND expires_at>${this.clock().toISOString()} FOR SHARE`;
    requireStaffPermission(grants.map(g => ({role:g.role,scope:g.permission_scope})),permission,scope,staff.row.authenticated_at,this.clock(),sensitive);
  }
  private async auditDenied(actor: string, caseId: string, action: string, error: unknown, requestId: string): Promise<void> {
    if (error instanceof IdentityError || error instanceof StaffAccessError) await this.client`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id) VALUES (${actor},${action},'VerificationCase',${caseId},${error.code},${requestId})`;
  }
  async assigned(staff: StaffPrincipal, caseId: string): Promise<ProviderVerificationCase> {
    return this.client.begin(async tx => {
      const rows = await tx<CaseRow[]>`SELECT * FROM verification_cases WHERE id=${caseId}`;
      if (!rows[0]) throw new IdentityError('RESOURCE_SCOPE_DENIED','Case scope denied');
      if (rows[0].assigned_staff_user_id === staff.row.user_id && rows[0].applicant_user_id !== staff.row.user_id) {
        this.authorized(staff,rows[0],'provider:verify',false);
        await this.currentGrant(tx,staff,'provider:verify',{kind:'case',id:caseId},false);
      } else {
        requireStaffPermission(staff.grants as Grant[], 'admin:permissions_manage', {kind:'platform',id:'pachi'}, staff.row.authenticated_at, this.clock(), false);
        await this.currentGrant(tx,staff,'admin:permissions_manage',{kind:'platform',id:'pachi'},false);
      }
      return this.map(rows[0]);
    });
  }
  async evidence(staff: StaffPrincipal, caseId: string, kind: 'GOVERNMENT_ID' | 'LIVE_SELFIE', requestId: string): Promise<{ content: string; mime_type: string }> {
    return this.client.begin(async tx => {
      const rows = await tx<CaseRow[]>`SELECT * FROM verification_cases WHERE id=${caseId}`;
      if (!rows[0]) throw new IdentityError('RESOURCE_SCOPE_DENIED','Case scope denied');
      this.authorized(staff,rows[0],'evidence:read',true);
      await this.currentGrant(tx,staff,'evidence:read',{kind:'case',id:caseId},true);
      const evidence = await tx<{ encrypted_content: Buffer | null; mime_type: string }[]>`SELECT encrypted_content,mime_type FROM verification_evidence WHERE case_id=${caseId} AND evidence_type=${kind} AND deleted_at IS NULL`;
      if (!evidence[0]?.encrypted_content) throw new IdentityError('INVALID_STATE','Evidence unavailable');
      await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata) VALUES (${staff.row.user_id},'VERIFICATION_EVIDENCE_ACCESSED','VerificationCase',${caseId},'ASSIGNED_REVIEW',${requestId},${JSON.stringify({kind})}::jsonb)`;
      return { content:this.decrypt(evidence[0].encrypted_content), mime_type:evidence[0].mime_type };
    }).catch(async error => { await this.auditDenied(staff.row.user_id,caseId,'VERIFICATION_EVIDENCE_ACCESS_DENIED',error,requestId); throw error; });
  }
  async decide(staff: StaffPrincipal, caseId: string, input: { expectedVersion: number; outcome: 'VERIFIED' | 'REJECTED' | 'NEEDS_RESUBMISSION'; reasonCode: string; requestId: string }): Promise<ProviderVerificationCase> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || !['VERIFIED','REJECTED','NEEDS_RESUBMISSION'].includes(input.outcome) || !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.reasonCode)) throw new IdentityError('INVALID_INPUT','Invalid decision');
    const allowedReasons = { VERIFIED: ['EVIDENCE_ACCEPTED'], REJECTED: ['SUBJECT_MISMATCH','POLICY_NOT_MET'], NEEDS_RESUBMISSION: ['DOCUMENT_UNREADABLE','EVIDENCE_INCOMPLETE'] };
    if (!allowedReasons[input.outcome].includes(input.reasonCode)) throw new IdentityError('INVALID_INPUT','Reason does not match outcome');
    return this.client.begin(async (tx) => {
      const rows = await tx<CaseRow[]>`SELECT * FROM verification_cases WHERE id=${caseId} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new IdentityError('RESOURCE_SCOPE_DENIED','Case scope denied');
      this.authorized(staff,row,'provider:verify',true);
      await this.currentGrant(tx,staff,'provider:verify',{kind:'case',id:caseId},true);
      if (row.state !== 'PENDING' || row.version !== input.expectedVersion) throw new IdentityError('STALE_VERSION','Case changed');
      const hashes = await tx<{ evidence_type: string; sha256: string; encrypted_content: Buffer | null }[]>`SELECT evidence_type,sha256,encrypted_content FROM verification_evidence WHERE case_id=${caseId} AND deleted_at IS NULL ORDER BY evidence_type FOR UPDATE`;
      if (hashes.length !== 2 || hashes.some(h => !h.encrypted_content)) throw new IdentityError('EVIDENCE_INCOMPLETE','Case evidence is incomplete');
      const reviewed = await tx<{ count: number }[]>`SELECT count(DISTINCT safe_metadata->>'kind')::int AS count FROM audit_events WHERE actor_user_id=${staff.row.user_id} AND action='VERIFICATION_EVIDENCE_ACCESSED' AND target_id=${caseId} AND created_at>=${row.submitted_at}`;
      if (reviewed[0]?.count !== 2) throw new IdentityError('EVIDENCE_REVIEW_REQUIRED','Review both evidence classes before deciding');
      const now = this.clock();
      const validUntil = input.outcome === 'VERIFIED' ? new Date(now) : null;
      if (validUntil) validUntil.setUTCMonth(validUntil.getUTCMonth() + 12);
      await tx`INSERT INTO verification_decisions(case_id,reviewer_user_id,outcome,reason_code,policy_version,evidence_hashes,valid_until,request_id,decided_at) VALUES (${caseId},${staff.row.user_id},${input.outcome},${input.reasonCode},${row.policy_version},${JSON.stringify(hashes.map(h => ({type:h.evidence_type,sha256:h.sha256})))}::jsonb,${validUntil?.toISOString() ?? null},${input.requestId},${now.toISOString()})`;
      const updated = await tx<CaseRow[]>`UPDATE verification_cases SET state=${input.outcome},version=version+1,reviewer_user_id=${staff.row.user_id},decision_at=${now.toISOString()},reason_code=${input.reasonCode},valid_until=${validUntil?.toISOString() ?? null} WHERE id=${caseId} RETURNING *`;
      await tx`UPDATE verification_evidence SET delete_after=${new Date(+now + 30 * 86400_000).toISOString()} WHERE case_id=${caseId}`;
      if (input.outcome === 'VERIFIED') {
        await tx`INSERT INTO verification_claims(provider_profile_id,claim_type,status,source_case_id,valid_from,valid_until) VALUES (${row.provider_profile_id},'PROVIDER_IDENTITY','VERIFIED',${caseId},${now.toISOString()},${validUntil!.toISOString()}) ON CONFLICT (provider_profile_id) DO UPDATE SET status='VERIFIED',source_case_id=EXCLUDED.source_case_id,valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until,revoked_at=NULL`;
        await tx`UPDATE provider_profiles SET state=CASE WHEN state='PENDING_VERIFICATION' THEN 'ACTIVE' ELSE state END,verification_status='VERIFIED',updated_at=now() WHERE id=${row.provider_profile_id}`;
        await tx`UPDATE provider_accounts SET state='ACTIVE',updated_at=now() WHERE provider_profile_id=${row.provider_profile_id} AND state IN ('DRAFT','PENDING_VERIFICATION')`;
      } else {
        await tx`UPDATE provider_profiles SET state=CASE WHEN state='PENDING_VERIFICATION' THEN 'DRAFT' ELSE state END,verification_status=CASE WHEN EXISTS(SELECT 1 FROM verification_claims WHERE provider_profile_id=${row.provider_profile_id} AND status='VERIFIED' AND valid_until>now() AND revoked_at IS NULL) THEN 'VERIFIED' ELSE ${input.outcome} END,updated_at=now() WHERE id=${row.provider_profile_id}`;
      }
      await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata) VALUES (${staff.row.user_id},'PROVIDER_VERIFICATION_DECIDED','VerificationCase',${caseId},${input.reasonCode},${input.requestId},${JSON.stringify({outcome:input.outcome,policy_version:row.policy_version})}::jsonb)`;
      await tx`INSERT INTO verification_outbox(case_id,event_type,safe_payload) VALUES (${caseId},'PROVIDER_VERIFICATION_DECIDED',${JSON.stringify({case_id:caseId,outcome:input.outcome})}::jsonb)`;
      return this.map(updated[0]!);
    }).catch(async error => { await this.auditDenied(staff.row.user_id,caseId,'PROVIDER_VERIFICATION_DECISION_DENIED',error,input.requestId); throw error; });
  }
  async assign(operator: StaffPrincipal, caseId: string, staffUserId: string, expectedVersion: number, requestId: string): Promise<ProviderVerificationCase> {
    try {
      requireStaffPermission(operator.grants as Grant[], 'admin:permissions_manage', {kind:'platform',id:'pachi'}, operator.row.authenticated_at, this.clock(), true);
      return await this.client.begin(async tx => {
      await this.currentGrant(tx,operator,'admin:permissions_manage',{kind:'platform',id:'pachi'},true);
      const rows = await tx<CaseRow[]>`SELECT * FROM verification_cases WHERE id=${caseId} FOR UPDATE`;
      const row = rows[0];
      if (!row || row.state !== 'PENDING' || row.applicant_user_id === staffUserId) throw new IdentityError('RESOURCE_SCOPE_DENIED','Case assignment denied');
      if (row.version !== expectedVersion) throw new IdentityError('STALE_VERSION','Case changed');
      const grants = await tx<{role:string;permission_scope:StaffScope}[]>`SELECT role,permission_scope FROM staff_grants WHERE user_id=${staffUserId} AND revoked_at IS NULL AND active_from<=${this.clock().toISOString()} AND expires_at>${this.clock().toISOString()}`;
      requireStaffPermission(grants.map(g => ({role:g.role,scope:g.permission_scope})), 'provider:verify', {kind:'case',id:caseId}, this.clock(), this.clock(), false);
      const updated = await tx<CaseRow[]>`UPDATE verification_cases SET assigned_staff_user_id=${staffUserId},version=version+1 WHERE id=${caseId} RETURNING *`;
      await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata) VALUES (${operator.row.user_id},'PROVIDER_VERIFICATION_ASSIGNED','VerificationCase',${caseId},'SCOPED_REVIEW_ASSIGNMENT',${requestId},${JSON.stringify({assigned_staff_user_id:staffUserId})}::jsonb)`;
      return this.map(updated[0]!);
      });
    } catch (error) { await this.auditDenied(operator.row.user_id,caseId,'PROVIDER_VERIFICATION_ASSIGNMENT_DENIED',error,requestId); throw error; }
  }
  async purgeExpiredEvidence(): Promise<number> {
    return this.client.begin(async tx => {
      const rows = await tx<{id:string;case_id:string}[]>`SELECT e.id,e.case_id FROM verification_evidence e LEFT JOIN verification_evidence_holds h ON h.id=e.legal_hold_id WHERE e.delete_after<=${this.clock().toISOString()} AND e.deleted_at IS NULL AND (e.legal_hold_id IS NULL OR h.released_at IS NOT NULL) FOR UPDATE OF e SKIP LOCKED LIMIT 100`;
      for (const row of rows) {
        await tx`UPDATE verification_evidence SET encrypted_content=NULL,deleted_at=${this.clock().toISOString()} WHERE id=${row.id}`;
        await tx`INSERT INTO audit_events(action,target_type,target_id,reason_code,safe_metadata) VALUES ('VERIFICATION_EVIDENCE_DELETED','VerificationCase',${row.case_id},'RETENTION_ELAPSED',${JSON.stringify({evidence_id:row.id})}::jsonb)`;
      }
      return rows.length;
    });
  }
  async expireClaims(): Promise<number> {
    return this.client.begin(async tx => {
      const claims = await tx<{provider_profile_id:string;source_case_id:string}[]>`SELECT provider_profile_id,source_case_id FROM verification_claims WHERE status='VERIFIED' AND valid_until<=${this.clock().toISOString()} FOR UPDATE SKIP LOCKED LIMIT 100`;
      for (const claim of claims) {
        await tx`UPDATE verification_claims SET status='EXPIRED' WHERE provider_profile_id=${claim.provider_profile_id} AND source_case_id=${claim.source_case_id}`;
        await tx`UPDATE verification_cases SET state='EXPIRED',version=version+1 WHERE id=${claim.source_case_id} AND state='VERIFIED'`;
        await tx`UPDATE provider_profiles SET verification_status='NOT_VERIFIED',updated_at=now() WHERE id=${claim.provider_profile_id}`;
        const paused = await tx<{id:string}[]>`UPDATE listings SET publication_status='PAUSED',updated_at=now() WHERE provider_account_id IN (SELECT id FROM provider_accounts WHERE provider_profile_id=${claim.provider_profile_id}) AND publication_status='PUBLISHED' RETURNING id`;
        for (const listing of paused) await tx`INSERT INTO audit_events(action,target_type,target_id,reason_code,safe_metadata) VALUES ('LISTING_PAUSED','Listing',${listing.id},'PROVIDER_IDENTITY_EXPIRED',${JSON.stringify({source_case_id:claim.source_case_id})}::jsonb)`;
        await tx`INSERT INTO audit_events(action,target_type,target_id,reason_code) VALUES ('PROVIDER_VERIFICATION_EXPIRED','VerificationCase',${claim.source_case_id},'CLAIM_VALIDITY_ENDED')`;
        await tx`INSERT INTO verification_outbox(case_id,event_type,safe_payload) VALUES (${claim.source_case_id},'PROVIDER_VERIFICATION_EXPIRED',${JSON.stringify({case_id:claim.source_case_id})}::jsonb)`;
      }
      return claims.length;
    });
  }
}
