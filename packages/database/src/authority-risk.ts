import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import { requireStaffPermission, StaffAccessError, type StaffScope } from './staff-policy.js';
import type { StaffPrincipal } from './staff.js';

export const AUTHORITY_RISK_RULE = 'authority-risk-internal-v1';
type Sql = postgres.Sql | postgres.TransactionSql;
type Relationship = { id: string; property_id: string; provider_account_id: string; relationship_type: string; authorization_status: string; valid_from: Date | null; valid_until: Date | null; authority_version: number; authority_principal_version: number; owner_user_id: string | null; created_by_user_id: string; record_state: string };
type Case = { id: string; property_id: string; relationship_id: string | null; principal_id: string | null; subject_scope: string; trigger_kind: string; allegation_kind: string; state: string; version: number; assigned_staff_user_id: string | null; source_provenance: string; received_at: Date | null; reason_code: string; safe_remediation: string; evidence_ref_type: string | null; evidence_ref_id: string | null };
type Evaluation = { id: string; relationship_id: string; relationship_version: number; principal_id: string; principal_version: number; source_version: string; rule_version: string; outcome: 'CLEAR' | 'HOLD' | 'INCOMPLETE'; source_coverage: Record<string,unknown>; trigger_findings: Record<string,string>; applicable_case_ids: string[]; evaluated_at: Date };
export type AuthorityRiskStatus = { status: 'CLEAR' | 'HOLD' | 'INCOMPLETE' | 'STALE' | 'UNEVALUATED'; next_action: string };
export type AuthorityRiskCase = { id: string; property_id: string; relationship_id: string | null; principal_id: string | null; subject_scope: string; trigger_kind: string; allegation_kind: string; state: string; version: number; reason_code: string; safe_remediation: string; source_provenance: string; received_at: string | null; source_review_action_id: string | null };
export type AuthorityRiskCaseInput = { id: string; propertyId: string; relationshipId?: string | null; principalId?: string | null; subjectScope: 'PROPERTY' | 'RELATIONSHIP' | 'PRINCIPAL'; triggerKind: 'DISPUTE' | 'REPRESENTATION' | 'FRAUD'; allegationKind: 'REPORTED'; provenance: 'STAFF_OBSERVATION' | 'PROVIDER_REPORT' | 'THIRD_PARTY_REPORT'; reasonCode: string; evidenceRefType?: 'LISTING' | null; evidenceRefId?: string | null; requestId: string };
export type AuthorityRiskDecisionInput = { expectedVersion: number; outcome: 'REVIEW_SOURCE' | 'CONFIRM' | 'RESOLVE'; reasonCode: string; evidenceRefType: 'PROPERTY' | 'RELATIONSHIP' | 'CASE_ACTION' | 'MERGE' | 'LISTING'; evidenceRefId: string; requestId: string };
export type AuthorityRiskInternalSource = { kind: 'LISTING_RELATIONSHIP_PRINCIPAL'; case_id: string; case_version: number; listing_id: string; listing_version: number; listing_provider_account_id: string; relationship_id: string; relationship_version: number; relationship_provider_account_id: string; property_id: string; finding: 'PRESENT' | 'ABSENT' };
type DecisionAction = { id: string; case_id: string; actor_user_id: string | null; action: string; reason_code: string; evidence_ref_type: string | null; evidence_ref_id: string | null; prior_version: number | null; decision_outcome: string | null; source_snapshot: AuthorityRiskInternalSource | null; result_case: AuthorityRiskCase | null };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const reason = (value: unknown): value is string => typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(value);

async function sourceVersion(sql: Sql, lock: boolean): Promise<string | null> {
  const rows = lock
    ? await sql<{version:string}[]>`SELECT version::text AS version FROM authority_risk_source_clock WHERE singleton FOR SHARE`
    : await sql<{version:string}[]>`SELECT version::text AS version FROM authority_risk_source_clock WHERE singleton`;
  return rows[0]?.version ?? null;
}
async function relationship(sql: Sql, id: string, lock = false): Promise<Relationship | null> {
  const rows = lock
    ? await sql<Relationship[]>`SELECT r.id,r.property_id,r.provider_account_id,r.relationship_type,r.authorization_status,r.valid_from,r.valid_until,r.authority_version,a.authority_principal_version,p.created_by_user_id,p.record_state,pp.user_id AS owner_user_id FROM provider_property_relationships r JOIN properties p ON p.id=r.property_id JOIN provider_accounts a ON a.id=r.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=a.provider_profile_id WHERE r.id=${id} FOR SHARE OF r,a,p`
    : await sql<Relationship[]>`SELECT r.id,r.property_id,r.provider_account_id,r.relationship_type,r.authorization_status,r.valid_from,r.valid_until,r.authority_version,a.authority_principal_version,p.created_by_user_id,p.record_state,pp.user_id AS owner_user_id FROM provider_property_relationships r JOIN properties p ON p.id=r.property_id JOIN provider_accounts a ON a.id=r.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=a.provider_profile_id WHERE r.id=${id}`;
  return rows[0] ?? null;
}
async function applicableCases(sql: Sql, r: Relationship): Promise<Case[]> {
  return sql<Case[]>`WITH RECURSIVE ancestor(id) AS (
    SELECT ${r.property_id}::uuid
    UNION
    SELECT m.source_property_id FROM property_merges m JOIN ancestor a ON m.canonical_property_id=a.id
  ) SELECT c.* FROM authority_risk_cases c JOIN ancestor a ON a.id=c.property_id
  WHERE c.subject_scope='PROPERTY' OR (c.subject_scope='RELATIONSHIP' AND c.relationship_id=${r.id}) OR (c.subject_scope='PRINCIPAL' AND c.principal_id=${r.provider_account_id}) ORDER BY c.observed_at,c.id`;
}
async function ambiguousMerge(sql: Sql): Promise<boolean> {
  const rows = await sql<{missing:boolean}[]>`SELECT EXISTS(SELECT 1 FROM properties p WHERE p.record_state='MERGED' AND NOT EXISTS(SELECT 1 FROM property_merges m WHERE m.source_property_id=p.id)) OR EXISTS(SELECT 1 FROM property_merges m JOIN properties p ON p.id=m.source_property_id WHERE p.record_state<>'MERGED') AS missing`;
  return rows[0]?.missing ?? true;
}
async function uncertainAdverseHistory(sql: Sql, r: Relationship): Promise<boolean> {
  const rows = await sql<{uncertain:boolean}[]>`WITH RECURSIVE ancestor(id) AS (
    SELECT ${r.property_id}::uuid
    UNION
    SELECT m.source_property_id FROM property_merges m JOIN ancestor a ON m.canonical_property_id=a.id
  ) SELECT EXISTS(SELECT 1 FROM authority_risk_cases c JOIN ancestor a ON a.id=c.property_id
    WHERE c.state='OPEN' AND c.trigger_kind='ADVERSE' AND c.subject_scope='RELATIONSHIP'
      AND c.relationship_id<>${r.id} AND c.principal_id=${r.provider_account_id}) AS uncertain`;
  return rows[0]?.uncertain ?? true;
}
function safeNext(status: AuthorityRiskStatus['status']): string {
  if (status === 'CLEAR') return 'No authority risk action is required under the evaluated internal rules.';
  if (status === 'HOLD') return 'Contact support about the authority review. A declaration alone cannot remove this hold.';
  if (status === 'INCOMPLETE') return 'Authority review needs more information or an authorized case decision.';
  return 'Request a fresh authority risk evaluation for this draft.';
}
export async function readAuthorityRisk(sql: Sql, relationshipId: string, principalId: string, lock = false): Promise<AuthorityRiskStatus> {
  // The source-clock share lock is held through a guarded submission transaction.
  const r = await relationship(sql, relationshipId, false);
  if (!r || r.provider_account_id !== principalId) return {status:'INCOMPLETE',next_action:safeNext('INCOMPLETE')};
  const version = await sourceVersion(sql, lock);
  if (!version) return {status:'INCOMPLETE',next_action:safeNext('INCOMPLETE')};
  // A prior CLEAR is unusable if a required source has since become unreadable.
  await sql`SELECT 1 FROM authority_risk_cases LIMIT 1`;
  await sql`SELECT 1 FROM authority_risk_case_actions LIMIT 1`;
  await sql`SELECT 1 FROM property_merges LIMIT 1`;
  const rows = await sql<Evaluation[]>`SELECT * FROM authority_risk_evaluations WHERE relationship_id=${relationshipId} ORDER BY source_version DESC,evaluated_at DESC LIMIT 1`;
  const latest = rows[0];
  if (!latest) return {status:'UNEVALUATED',next_action:safeNext('UNEVALUATED')};
  if (latest.rule_version !== AUTHORITY_RISK_RULE || latest.relationship_version !== r.authority_version || latest.principal_id !== principalId || latest.principal_version !== r.authority_principal_version || String(latest.source_version) !== version) return {status:'STALE',next_action:safeNext('STALE')};
  return {status:latest.outcome,next_action:safeNext(latest.outcome)};
}
function safeCase(row: Case, sourceReviewActionId: string | null = null): AuthorityRiskCase {
  return {id:row.id,property_id:row.property_id,relationship_id:row.relationship_id,principal_id:row.principal_id,subject_scope:row.subject_scope,trigger_kind:row.trigger_kind,allegation_kind:row.allegation_kind,state:row.state,version:row.version,reason_code:row.reason_code,safe_remediation:row.safe_remediation,source_provenance:row.source_provenance,received_at:row.received_at ? new Date(row.received_at).toISOString() : null,source_review_action_id:sourceReviewActionId};
}
function supportsInternalRepresentation(row: Case): boolean {
  return row.subject_scope === 'RELATIONSHIP' && row.trigger_kind === 'REPRESENTATION'
    && row.reason_code === 'LISTING_RELATIONSHIP_PRINCIPAL_CONFLICT'
    && row.evidence_ref_type === 'LISTING' && uuid(row.evidence_ref_id) && uuid(row.relationship_id);
}
async function internalRepresentationSource(tx: Sql, row: Case): Promise<AuthorityRiskInternalSource> {
  if (!supportsInternalRepresentation(row)) throw new IdentityError('EVIDENCE_INCOMPLETE','This case has no supported internal representation source');
  const r=await relationship(tx,row.relationship_id!,true);
  const listings=await tx<{id:string;property_id:string;provider_account_id:string;provider_property_relationship_id:string;authority_source_version:number}[]>`SELECT id,property_id,provider_account_id,provider_property_relationship_id,authority_source_version FROM listings WHERE id=${row.evidence_ref_id!} FOR SHARE`;
  const listing=listings[0];
  const now=new Date();
  if (!r || !listing || r.property_id!==row.property_id || listing.property_id!==row.property_id || listing.provider_property_relationship_id!==r.id
    || r.record_state!=='ACTIVE' || !['DECLARED','PENDING','VERIFIED'].includes(r.authorization_status)
    || r.valid_from && new Date(r.valid_from)>now || r.valid_until && new Date(r.valid_until)<=now)
    throw new IdentityError('EVIDENCE_INCOMPLETE','Current internal representation source is unavailable');
  return {kind:'LISTING_RELATIONSHIP_PRINCIPAL',case_id:row.id,case_version:row.version,
    listing_id:listing.id,listing_version:listing.authority_source_version,
    listing_provider_account_id:listing.provider_account_id,relationship_id:r.id,
    relationship_version:r.authority_version,relationship_provider_account_id:r.provider_account_id,
    property_id:r.property_id,finding:listing.provider_account_id===r.provider_account_id?'ABSENT':'PRESENT'};
}
function sameSource(a: AuthorityRiskInternalSource, b: AuthorityRiskInternalSource): boolean {
  return a.kind===b.kind && a.case_id===b.case_id && a.listing_id===b.listing_id
    && a.listing_version===b.listing_version && a.listing_provider_account_id===b.listing_provider_account_id
    && a.relationship_id===b.relationship_id && a.relationship_version===b.relationship_version
    && a.relationship_provider_account_id===b.relationship_provider_account_id && a.property_id===b.property_id
    && a.finding===b.finding;
}
export class AuthorityRiskStore {
  constructor(private readonly client: postgres.Sql, private readonly clock: () => Date = () => new Date()) {}
  private async auditDenied(actor: string, caseId: string, action: string, error: unknown, requestId: string): Promise<void> {
    if (error instanceof IdentityError || error instanceof StaffAccessError) await this.client`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id) VALUES (${actor},${action},'AuthorityRiskCase',${uuid(caseId)?caseId:null},${error.code},${requestId})`.catch(()=>undefined);
  }

  async evaluateOwned(userId: string, listingId: string): Promise<AuthorityRiskStatus> {
    if (!uuid(listingId)) throw new IdentityError('RESOURCE_SCOPE_DENIED','Draft is not available');
    return this.client.begin(async tx => {
      const rows = await tx<{relationship_id:string;provider_account_id:string}[]>`SELECT r.id AS relationship_id,a.id AS provider_account_id FROM listings l JOIN provider_accounts a ON a.id=l.provider_account_id JOIN provider_profiles p ON p.id=a.provider_profile_id JOIN provider_property_relationships r ON r.id=l.provider_property_relationship_id AND r.provider_account_id=a.id AND r.property_id=l.property_id WHERE l.id=${listingId} AND p.user_id=${userId} AND l.publication_status='DRAFT' FOR SHARE OF l,a,p,r`;
      const target=rows[0];
      if (!target) throw new IdentityError('RESOURCE_SCOPE_DENIED','Draft is not available');
      await this.evaluateInTransaction(tx,target.relationship_id);
      return readAuthorityRisk(tx,target.relationship_id,target.provider_account_id,true);
    });
  }
  async evaluate(relationshipId: string): Promise<Evaluation | {outcome:'INCOMPLETE'}> {
    if (!uuid(relationshipId)) throw new IdentityError('INVALID_INPUT','Invalid relationship');
    return this.client.begin(tx => this.evaluateInTransaction(tx,relationshipId));
  }
  private async evaluateInTransaction(tx: postgres.TransactionSql, relationshipId: string): Promise<Evaluation | {outcome:'INCOMPLETE'}> {
      const r = await relationship(tx,relationshipId,true);
      if (!r) throw new IdentityError('RESOURCE_SCOPE_DENIED','Relationship is unavailable');
      const version = await sourceVersion(tx,true);
      if (!version) return {outcome:'INCOMPLETE' as const};
      const cases = await applicableCases(tx,r);
      const openCases = cases.filter(c=>c.state==='OPEN');
      const caseIds = cases.map(c=>c.id);
      const actions = caseIds.length
        ? await tx<{id:string;case_id:string;action:string}[]>`SELECT id,case_id,action FROM authority_risk_case_actions WHERE case_id = ANY(${caseIds}::uuid[]) ORDER BY recorded_at,id`
        : await tx<{id:string;case_id:string;action:string}[]>`SELECT id,case_id,action FROM authority_risk_case_actions WHERE false`;
      const missingMerge = await ambiguousMerge(tx);
      const uncertainAdverse = await uncertainAdverseHistory(tx,r);
      const legacy = openCases.some(c=>c.source_provenance==='LEGACY_STATUS');
      const invalidHistory = cases.some(c=>!actions.some(a=>a.case_id===c.id && a.action==='OPENED') || (c.state==='RESOLVED' && !actions.some(a=>a.case_id===c.id && a.action==='RESOLVED')));
      const missingPrincipal = !r.provider_account_id || !r.property_id || !r.relationship_type || r.relationship_type!=='OWNER';
      const adverseWithoutOpenCase = ['REJECTED','REVOKED'].includes(r.authorization_status) && !openCases.some(c=>c.trigger_kind==='ADVERSE');
      const incomplete = missingMerge || missingPrincipal || legacy || adverseWithoutOpenCase || invalidHistory || uncertainAdverse || r.record_state==='MERGED';
      const outcome: Evaluation['outcome'] = openCases.length ? 'HOLD' : incomplete ? 'INCOMPLETE' : 'CLEAR';
      const sourceCoverage = {relationships:adverseWithoutOpenCase?'ADVERSE_REVIEW_REQUIRED':uncertainAdverse?'ADVERSE_APPLICABILITY_REVIEW_REQUIRED':'CHECKED',principals:missingPrincipal?'PRINCIPAL_REFERENCE_UNAVAILABLE':'CHECKED',cases:invalidHistory?'INCOMPLETE':legacy?'LEGACY_REVIEW_REQUIRED':'CHECKED',merges:missingMerge||r.record_state==='MERGED'?'INCOMPLETE':'CHECKED',representation:'NO_AUTOMATIC_COMPATIBILITY_RULE_V1',case_action_ids:actions.map(a=>a.id)};
      const finding = (kind: Case['trigger_kind']): 'PRESENT' | 'ABSENT' | 'UNAVAILABLE' => openCases.some(c=>c.trigger_kind===kind) ? 'PRESENT' : incomplete ? 'UNAVAILABLE' : 'ABSENT';
      const findings = {dispute:finding('DISPUTE'),adverse:finding('ADVERSE'),representation:finding('REPRESENTATION'),fraud:finding('FRAUD')};
      const ids = caseIds;
      const inserted = await tx<Evaluation[]>`INSERT INTO authority_risk_evaluations(relationship_id,relationship_version,principal_id,principal_version,source_version,rule_version,outcome,source_coverage,trigger_findings,applicable_case_ids) VALUES (${r.id},${r.authority_version},${r.provider_account_id},${r.authority_principal_version},${version},${AUTHORITY_RISK_RULE},${outcome},${JSON.stringify(sourceCoverage)}::jsonb,${JSON.stringify(findings)}::jsonb,${ids}::uuid[]) ON CONFLICT (relationship_id,relationship_version,principal_version,source_version,rule_version) DO NOTHING RETURNING *`;
      if (inserted[0]) {
        await tx`INSERT INTO audit_events(action,target_type,target_id,reason_code,safe_metadata) VALUES ('AUTHORITY_RISK_EVALUATED','ProviderPropertyRelationship',${r.id},${outcome},${JSON.stringify({evaluation_id:inserted[0].id,source_version:version,rule_version:AUTHORITY_RISK_RULE})}::jsonb)`;
        return inserted[0];
      }
      const existing = await tx<Evaluation[]>`SELECT * FROM authority_risk_evaluations WHERE relationship_id=${r.id} AND relationship_version=${r.authority_version} AND principal_version=${r.authority_principal_version} AND source_version=${version} AND rule_version=${AUTHORITY_RISK_RULE}`;
      return existing[0]!;
  }
  private async currentGrant(tx: postgres.TransactionSql, staff: StaffPrincipal, caseId: string, propertyId: string, permission = 'authority:risk_decide'): Promise<void> {
    // PostgreSQL grant timestamps have microsecond precision; an application
    // Date rounded to milliseconds can precede a grant committed just now.
    const nowRows=await tx<{current_time:Date|string}[]>`SELECT now() AS current_time`;
    const now=new Date(nowRows[0]!.current_time);
    const grants = await tx<{role:string;permission_scope:StaffScope}[]>`SELECT role,permission_scope FROM staff_grants WHERE user_id=${staff.row.user_id} AND revoked_at IS NULL AND active_from<=now() AND expires_at>now() FOR SHARE`;
    if (!uuid(staff.row.id)) throw new StaffAccessError('AUTH_REQUIRED');
    const sessions=await tx<{authenticated_at:Date}[]>`SELECT s.authenticated_at FROM staff_sessions s JOIN users u ON u.id=s.user_id JOIN auth_identities i ON i.id=s.identity_id WHERE s.id=${staff.row.id} AND s.user_id=${staff.row.user_id} AND s.revoked_at IS NULL AND s.absolute_expires_at>now() AND s.idle_expires_at>now() AND s.mfa_method='COGNITO_REQUIRED_TOTP' AND s.authenticated_at<=now() AND u.account_state IN ('ACTIVE','PENDING_PHONE') AND u.security_version=s.security_version AND i.unlinked_at IS NULL AND i.user_id=s.user_id AND i.issuer=s.issuer FOR SHARE OF s,u,i`;
    if (!sessions[0]) throw new StaffAccessError('AUTH_REQUIRED');
    requireStaffPermission(grants.map(g=>({role:g.role,scope:g.permission_scope})),permission,{kind:'case',id:caseId},new Date(sessions[0].authenticated_at),now,true);
    if (permission==='authority:risk_decide' && !grants.some(g=>g.role==='TRUST_SAFETY_MODERATOR' && g.permission_scope.id===caseId && g.permission_scope.property_id===propertyId && g.permission_scope.permissions.includes(permission))) throw new StaffAccessError('RESOURCE_SCOPE_DENIED');
    if (permission==='evidence:read' && !grants.some(g=>g.role==='TRUST_SAFETY_MODERATOR' && g.permission_scope.kind==='case' && g.permission_scope.id===caseId && g.permission_scope.property_id===propertyId && g.permission_scope.permissions.includes(permission))) throw new StaffAccessError('RESOURCE_SCOPE_DENIED');
  }
  private authorize(staff: StaffPrincipal, caseId: string, propertyId?: string): void {
    requireStaffPermission(staff.grants.map(g=>({role:g.role,scope:g.scope})), 'authority:risk_decide', {kind:'case',id:caseId}, staff.row.authenticated_at, this.clock(), true);
    if (propertyId && !staff.grants.some(g=>g.role==='TRUST_SAFETY_MODERATOR' && g.scope.id===caseId && g.scope.property_id===propertyId && g.scope.permissions.includes('authority:risk_decide'))) throw new StaffAccessError('RESOURCE_SCOPE_DENIED');
  }
  private async noSelfReview(tx: postgres.TransactionSql, staff: StaffPrincipal, propertyId: string, principalId: string | null, listingId: string | null = null): Promise<void> {
    const rows = await tx<{conflict:boolean}[]>`SELECT EXISTS(SELECT 1 FROM properties p WHERE p.id=${propertyId} AND p.created_by_user_id=${staff.row.user_id}) OR EXISTS(SELECT 1 FROM provider_property_relationships r JOIN provider_accounts a ON a.id=r.provider_account_id JOIN provider_profiles pp ON pp.id=a.provider_profile_id WHERE r.property_id=${propertyId} AND pp.user_id=${staff.row.user_id}) OR EXISTS(SELECT 1 FROM provider_accounts a JOIN provider_profiles pp ON pp.id=a.provider_profile_id WHERE a.id=${principalId} AND pp.user_id=${staff.row.user_id}) OR EXISTS(SELECT 1 FROM listings l JOIN provider_accounts a ON a.id=l.provider_account_id JOIN provider_profiles pp ON pp.id=a.provider_profile_id WHERE l.id=${listingId} AND pp.user_id=${staff.row.user_id}) AS conflict`;
    if (rows[0]?.conflict) throw new IdentityError('RESOURCE_SCOPE_DENIED','Self review is unavailable');
  }
  async openCase(staff: StaffPrincipal, input: AuthorityRiskCaseInput): Promise<AuthorityRiskCase> {
    try {
    if (!uuid(input.id) || !uuid(input.propertyId) || !uuid(input.requestId) || !['PROPERTY','RELATIONSHIP','PRINCIPAL'].includes(input.subjectScope) || !['DISPUTE','REPRESENTATION','FRAUD'].includes(input.triggerKind) || !['REPORTED','ESTABLISHED'].includes(input.allegationKind) || !['STAFF_OBSERVATION','PROVIDER_REPORT','THIRD_PARTY_REPORT'].includes(input.provenance) || !reason(input.reasonCode)) throw new IdentityError('INVALID_INPUT','Invalid authority risk case');
    if (input.subjectScope==='PROPERTY' && (input.relationshipId || input.principalId) || input.subjectScope==='RELATIONSHIP' && (!uuid(input.relationshipId) || input.principalId) || input.subjectScope==='PRINCIPAL' && (!uuid(input.principalId) || input.relationshipId)) throw new IdentityError('INVALID_INPUT','Case subject is incomplete or mismatched');
    const structuredReference=input.subjectScope==='RELATIONSHIP' && input.triggerKind==='REPRESENTATION'
      && input.reasonCode==='LISTING_RELATIONSHIP_PRINCIPAL_CONFLICT'
      && input.evidenceRefType==='LISTING' && uuid(input.evidenceRefId);
    if (input.allegationKind!=='REPORTED' || (input.evidenceRefId || input.evidenceRefType) && !structuredReference
      || input.reasonCode==='LISTING_RELATIONSHIP_PRINCIPAL_CONFLICT' && !structuredReference)
      throw new IdentityError('INVALID_INPUT','Case evidence reference is unsupported or incomplete');
    this.authorize(staff,input.id,input.propertyId);
    return await this.client.begin(async tx => {
      await this.currentGrant(tx,staff,input.id,input.propertyId);
      const props = await tx<{id:string}[]>`SELECT id FROM properties WHERE id=${input.propertyId} FOR SHARE`;
      if (!props[0]) throw new IdentityError('RESOURCE_SCOPE_DENIED','Property is unavailable');
      if (input.relationshipId) {
        const rel = await tx<{id:string;provider_account_id:string}[]>`SELECT id,provider_account_id FROM provider_property_relationships WHERE id=${input.relationshipId} AND property_id=${input.propertyId} FOR SHARE`;
        if (!rel[0] || (input.principalId && rel[0].provider_account_id!==input.principalId)) throw new IdentityError('RESOURCE_SCOPE_DENIED','Relationship is unavailable');
      }
      if (input.principalId) {
        const principals = await tx<{id:string}[]>`SELECT a.id FROM provider_accounts a JOIN provider_property_relationships r ON r.provider_account_id=a.id WHERE a.id=${input.principalId} AND r.property_id=${input.propertyId} FOR SHARE OF a,r`;
        if (!principals[0]) throw new IdentityError('RESOURCE_SCOPE_DENIED','Principal is unavailable for this property');
      }
      if (structuredReference) {
        const source=await tx<{id:string}[]>`SELECT id FROM listings WHERE id=${input.evidenceRefId!} AND property_id=${input.propertyId} AND provider_property_relationship_id=${input.relationshipId!} FOR SHARE`;
        if (!source[0]) throw new IdentityError('EVIDENCE_INCOMPLETE','Listing does not belong to the scoped authority relationship');
      }
      await this.noSelfReview(tx,staff,input.propertyId,input.principalId ?? null,structuredReference?input.evidenceRefId!:null);
      const rows = await tx<Case[]>`INSERT INTO authority_risk_cases(id,property_id,relationship_id,principal_id,subject_scope,trigger_kind,allegation_kind,assigned_staff_user_id,source_provenance,received_at,reason_code,safe_remediation,evidence_ref_type,evidence_ref_id) VALUES (${input.id},${input.propertyId},${input.relationshipId ?? null},${input.principalId ?? null},${input.subjectScope},${input.triggerKind},${input.allegationKind},${staff.row.user_id},${input.provenance},${this.clock().toISOString()},${input.reasonCode},'Contact support for authority review.',${input.evidenceRefType ?? null},${input.evidenceRefId ?? null}) RETURNING *`;
      await tx`INSERT INTO authority_risk_case_actions(case_id,action,actor_user_id,reason_code,evidence_ref_type,evidence_ref_id,request_id) VALUES (${input.id},'OPENED',${staff.row.user_id},${input.reasonCode},${input.evidenceRefType ?? null},${input.evidenceRefId ?? null},${input.requestId})`;
      await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata) VALUES (${staff.row.user_id},'AUTHORITY_RISK_CASE_OPENED','AuthorityRiskCase',${input.id},${input.reasonCode},${input.requestId},${JSON.stringify({property_id:input.propertyId,scope:input.subjectScope,trigger:input.triggerKind,allegation:input.allegationKind,rule_version:AUTHORITY_RISK_RULE})}::jsonb)`;
      return safeCase(rows[0]!);
    });
    } catch(error) { const failure=(error as {code?:string})?.code==='23505'?new IdentityError('STALE_VERSION','Case already exists'):error; await this.auditDenied(staff.row.user_id,input.id,'AUTHORITY_RISK_CASE_OPEN_DENIED',failure,uuid(input.requestId)?input.requestId:randomUUID()); throw failure; }
  }
  async case(staff: StaffPrincipal, id: string): Promise<AuthorityRiskCase> {
    try {
    if (!uuid(id)) throw new IdentityError('INVALID_INPUT','Invalid case');
    this.authorize(staff,id);
    return await this.client.begin(async tx => {
      await this.currentGrant(tx,staff,id,staff.grants.find(g=>g.scope.id===id && g.scope.permissions.includes('authority:risk_decide'))?.scope.property_id ?? '');
      const rows = await tx<Case[]>`SELECT * FROM authority_risk_cases WHERE id=${id}`;
      if (!rows[0] || rows[0].assigned_staff_user_id!==staff.row.user_id) throw new IdentityError('RESOURCE_SCOPE_DENIED','Case is unavailable');
      this.authorize(staff,id,rows[0].property_id);
      await this.noSelfReview(tx,staff,rows[0].property_id,rows[0].principal_id,rows[0].evidence_ref_type==='LISTING'?rows[0].evidence_ref_id:null);
      const source=await tx<{id:string}[]>`SELECT id FROM authority_risk_case_actions WHERE case_id=${id} AND action='SOURCE_REVIEWED' ORDER BY recorded_at DESC,id DESC LIMIT 1`;
      return safeCase(rows[0],source[0]?.id ?? null);
    });
    } catch(error) { await this.auditDenied(staff.row.user_id,id,'AUTHORITY_RISK_CASE_ACCESS_DENIED',error,randomUUID()); throw error; }
  }
  async claimLegacyCase(staff: StaffPrincipal, id: string, expectedVersion: number, requestId: string): Promise<AuthorityRiskCase> {
    try {
    if (!uuid(id) || !uuid(requestId) || expectedVersion!==1) throw new IdentityError('INVALID_INPUT','Invalid assignment');
    this.authorize(staff,id);
    return await this.client.begin(async tx => {
      await this.currentGrant(tx,staff,id,staff.grants.find(g=>g.scope.id===id && g.scope.permissions.includes('authority:risk_decide'))?.scope.property_id ?? '');
      const rows = await tx<Case[]>`SELECT * FROM authority_risk_cases WHERE id=${id} FOR UPDATE`;
      const row=rows[0];
      if (!row || row.source_provenance!=='LEGACY_STATUS' || row.assigned_staff_user_id || row.version!==expectedVersion) throw new IdentityError('STALE_VERSION','Case assignment changed');
      this.authorize(staff,id,row.property_id);
      await this.noSelfReview(tx,staff,row.property_id,row.principal_id,row.evidence_ref_type==='LISTING'?row.evidence_ref_id:null);
      const updated=await tx<Case[]>`UPDATE authority_risk_cases SET assigned_staff_user_id=${staff.row.user_id},version=version+1 WHERE id=${id} RETURNING *`;
      await tx`INSERT INTO authority_risk_case_actions(case_id,action,actor_user_id,reason_code,request_id) VALUES (${id},'ASSIGNED',${staff.row.user_id},'SCOPED_LEGACY_REVIEW',${requestId})`;
      await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id) VALUES (${staff.row.user_id},'AUTHORITY_RISK_CASE_ASSIGNED','AuthorityRiskCase',${id},'SCOPED_LEGACY_REVIEW',${requestId})`;
      return safeCase(updated[0]!);
    });
    } catch(error) { await this.auditDenied(staff.row.user_id,id,'AUTHORITY_RISK_CASE_ASSIGN_DENIED',error,uuid(requestId)?requestId:randomUUID()); throw error; }
  }
  async internalSource(staff: StaffPrincipal, id: string, requestId: string): Promise<AuthorityRiskInternalSource> {
    try {
      if (!uuid(id) || !uuid(requestId)) throw new IdentityError('INVALID_INPUT','Invalid source request');
      this.authorize(staff,id);
      return await this.client.begin(async tx => {
        await this.currentGrant(tx,staff,id,staff.grants.find(g=>g.scope.id===id && g.scope.permissions.includes('authority:risk_decide'))?.scope.property_id ?? '');
        const rows=await tx<Case[]>`SELECT * FROM authority_risk_cases WHERE id=${id} FOR SHARE`;
        const row=rows[0];
        if (!row || row.assigned_staff_user_id!==staff.row.user_id) throw new IdentityError('RESOURCE_SCOPE_DENIED','Case is unavailable');
        this.authorize(staff,id,row.property_id);
        await this.noSelfReview(tx,staff,row.property_id,row.principal_id,row.evidence_ref_type==='LISTING'?row.evidence_ref_id:null);
        await this.currentGrant(tx,staff,id,row.property_id,'evidence:read');
        const source=await internalRepresentationSource(tx,row);
        await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata) VALUES (${staff.row.user_id},'AUTHORITY_RISK_SOURCE_READ','AuthorityRiskCase',${id},'INTERNAL_REPRESENTATION_SOURCE',${requestId},${JSON.stringify({source_kind:source.kind,listing_id:source.listing_id,rule_version:AUTHORITY_RISK_RULE})}::jsonb)`;
        return source;
      });
    } catch(error) { await this.auditDenied(staff.row.user_id,id,'AUTHORITY_RISK_SOURCE_ACCESS_DENIED',error,uuid(requestId)?requestId:randomUUID()); throw error; }
  }
  async decide(staff: StaffPrincipal, id: string, input: AuthorityRiskDecisionInput): Promise<AuthorityRiskCase> {
    try {
      if (!uuid(id) || !uuid(input.requestId) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion<1
        || !['REVIEW_SOURCE','CONFIRM','RESOLVE'].includes(input.outcome) || !reason(input.reasonCode)
        || !['LISTING','CASE_ACTION','PROPERTY','RELATIONSHIP','MERGE'].includes(input.evidenceRefType) || !uuid(input.evidenceRefId))
        throw new IdentityError('INVALID_INPUT','Invalid case decision');
      this.authorize(staff,id);
      return await this.client.begin(async tx => {
        await this.currentGrant(tx,staff,id,staff.grants.find(g=>g.scope.id===id && g.scope.permissions.includes('authority:risk_decide'))?.scope.property_id ?? '');
        const rows=await tx<Case[]>`SELECT * FROM authority_risk_cases WHERE id=${id} FOR UPDATE`;
        const row=rows[0];
        if (!row || row.assigned_staff_user_id!==staff.row.user_id) throw new IdentityError('RESOURCE_SCOPE_DENIED','Case is unavailable');
        this.authorize(staff,id,row.property_id);
        await this.noSelfReview(tx,staff,row.property_id,row.principal_id,row.evidence_ref_type==='LISTING'?row.evidence_ref_id:null);
        await this.currentGrant(tx,staff,id,row.property_id,'evidence:read');
        const prior=await tx<DecisionAction[]>`SELECT * FROM authority_risk_case_actions WHERE request_id=${input.requestId}`;
        if (prior[0]) {
          const action=prior[0];
          if (action.case_id!==id || action.actor_user_id!==staff.row.user_id || action.prior_version!==input.expectedVersion
            || action.decision_outcome!==input.outcome || action.reason_code!==input.reasonCode
            || action.evidence_ref_type!==input.evidenceRefType || action.evidence_ref_id!==input.evidenceRefId || !action.result_case)
            throw new IdentityError('STALE_VERSION','Request ID was used for a different decision');
          return action.result_case;
        }
        if (row.version!==input.expectedVersion || row.state!=='OPEN') throw new IdentityError('STALE_VERSION','Case changed');
        if (!supportsInternalRepresentation(row))
          throw new IdentityError('EVIDENCE_INCOMPLETE','This trigger has no approved internal evidence decision path');
        const actionId=randomUUID();
        let source: AuthorityRiskInternalSource;
        let reviewActionId: string;
        if (input.outcome==='REVIEW_SOURCE') {
          if (input.evidenceRefType!=='LISTING' || input.evidenceRefId!==row.evidence_ref_id)
            throw new IdentityError('EVIDENCE_INCOMPLETE','Review the listing bound to this case');
          source=await internalRepresentationSource(tx,row);
          const requiredReason=source.finding==='PRESENT'?'SOURCE_SUPPORTS_FINDING':'SOURCE_SUPPORTS_DISPROOF';
          if (input.reasonCode!==requiredReason) throw new IdentityError('EVIDENCE_INCOMPLETE','Source conclusion does not match current structured records');
          reviewActionId=actionId;
        } else {
          if (input.evidenceRefType!=='CASE_ACTION') throw new IdentityError('EVIDENCE_INCOMPLETE','A reviewed internal source action is required');
          const reviews=await tx<DecisionAction[]>`SELECT * FROM authority_risk_case_actions WHERE id=${input.evidenceRefId} AND case_id=${id} AND action='SOURCE_REVIEWED'`;
          const review=reviews[0];
          const latest=await tx<{id:string}[]>`SELECT id FROM authority_risk_case_actions WHERE case_id=${id} AND action='SOURCE_REVIEWED' ORDER BY recorded_at DESC,id DESC LIMIT 1`;
          if (!review?.source_snapshot || latest[0]?.id!==review.id)
            throw new IdentityError('EVIDENCE_INCOMPLETE','A current reviewed internal source is required');
          source=await internalRepresentationSource(tx,row);
          if (!sameSource(source,review.source_snapshot)) throw new IdentityError('STALE_VERSION','Reviewed source changed');
          if (input.outcome==='CONFIRM') {
            if (row.allegation_kind!=='REPORTED' || source.finding!=='PRESENT' || review.reason_code!=='SOURCE_SUPPORTS_FINDING' || input.reasonCode!=='FINDING_CONFIRMED')
              throw new IdentityError('EVIDENCE_INCOMPLETE','Source does not support confirmation');
          } else if (source.finding!=='ABSENT' || review.reason_code!=='SOURCE_SUPPORTS_DISPROOF' || input.reasonCode!=='TRIGGER_DISPROVED') {
            throw new IdentityError('EVIDENCE_INCOMPLETE','Source does not disprove this specific trigger');
          }
          reviewActionId=review.id;
        }
        const action=input.outcome==='REVIEW_SOURCE'?'SOURCE_REVIEWED':input.outcome==='CONFIRM'?'FINDING_CONFIRMED':'RESOLVED';
        const updated=await tx<Case[]>`UPDATE authority_risk_cases SET allegation_kind=CASE WHEN ${input.outcome}='CONFIRM' THEN 'ESTABLISHED' ELSE allegation_kind END,state=CASE WHEN ${input.outcome}='RESOLVE' THEN 'RESOLVED' ELSE state END,resolved_at=CASE WHEN ${input.outcome}='RESOLVE' THEN ${this.clock().toISOString()}::timestamptz ELSE resolved_at END,version=version+1 WHERE id=${id} AND version=${input.expectedVersion} RETURNING *`;
        if (!updated[0]) throw new IdentityError('STALE_VERSION','Case changed');
        const result=safeCase(updated[0],reviewActionId);
        await tx`INSERT INTO authority_risk_case_actions(id,case_id,action,actor_user_id,reason_code,evidence_ref_type,evidence_ref_id,request_id,prior_version,decision_outcome,source_snapshot,result_case) VALUES (${actionId},${id},${action},${staff.row.user_id},${input.reasonCode},${input.evidenceRefType},${input.evidenceRefId},${input.requestId},${input.expectedVersion},${input.outcome},${input.outcome==='REVIEW_SOURCE'?JSON.stringify(source):null}::jsonb,${JSON.stringify(result)}::jsonb)`;
        await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata) VALUES (${staff.row.user_id},'AUTHORITY_RISK_CASE_DECIDED','AuthorityRiskCase',${id},${input.reasonCode},${input.requestId},${JSON.stringify({outcome:input.outcome,prior_version:input.expectedVersion,action_id:actionId,source_kind:source.kind,rule_version:AUTHORITY_RISK_RULE})}::jsonb)`;
        await this.evaluateInTransaction(tx,row.relationship_id!);
        return result;
      });
    } catch(error) { const failure=(error as {code?:string})?.code==='23505'?new IdentityError('STALE_VERSION','Case decision changed'):error; await this.auditDenied(staff.row.user_id,id,'AUTHORITY_RISK_CASE_DECISION_DENIED',failure,uuid(input.requestId)?input.requestId:randomUUID()); throw failure; }
  }
}
