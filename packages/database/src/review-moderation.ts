import type postgres from 'postgres';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ReviewStore, type ReviewState, type ReviewReportInput, type ReviewContent } from './review.js';
import { fail, instant, validId, type Tx, type Context } from './viewing.js';
import { IdentityError } from './identity.js';
import { StaffAccessError, validStaffScope, type StaffScope } from './staff-policy.js';
import type { StaffPrincipal } from './staff.js';

export type ReviewCaseState = 'OPEN'|'TRIAGED'|'UNDER_REVIEW'|'ACTION_REQUIRED'|'RESOLVED'|'CLOSED';
export type ReviewModerationCommand = 'BEGIN_INVESTIGATION'|'HOLD'|'HIDE'|'REMOVE'|'RESTORE'|'RESOLVE'|'CLOSE';
export type ReviewModerationReason = 'REVIEW_POLICY_VIOLATION'|'PRIVACY_PROTECTION'|'THREAT_PROTECTION'|'INVESTIGATION'|'NO_VIOLATION'|'ELIGIBILITY_RESTORED'|'CASE_COMPLETED';
export type ReviewModerationQueueItem = {id:string;review_id:string;reason:ReviewReportInput['reason'];severity:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL';state:ReviewCaseState;version:number;review_state:ReviewState;review_version:number;opened_at:string;last_report_at:string;report_count:number;assigned_staff_user_id:string|null;age_seconds:number;due_at:string|null;overdue:boolean;next_action:'ASSIGN'|'BEGIN_INVESTIGATION'|'RECORD_DECISION'|'RESOLVE'|'CLOSE'|'COMPLETED'};
export type ReviewModerationAction = {id:string;case_id:string;review_id:string;actor_user_id:string;assigned_staff_user_id:string|null;command:'ASSIGN'|ReviewModerationCommand;reason_code:'CASE_ASSIGNMENT'|ReviewModerationReason;reason_text:string;before_case_state:ReviewCaseState;after_case_state:ReviewCaseState;before_review_state:ReviewState;after_review_state:ReviewState;case_version:number;review_version:number;reverses_action_id:string|null;policy_version:string;request_id:string;created_at:string;notice_available_at:string|null;appeal_deadline:string|null};
export type ReviewModerationDetail = {case:ReviewModerationQueueItem;review:{id:string;state:ReviewState;version:number;rating:number;text:string|null;criteria:NonNullable<ReviewContent['criteria']>;published_at:string|null};revisions:{version:number;rating:number;text:string|null;criteria:NonNullable<ReviewContent['criteria']>;created_at:string}[];reports:{id:string;reason:ReviewReportInput['reason'];details:string|null;created_at:string}[];actions:ReviewModerationAction[]};
export type ReviewModerationAssignmentInput={expected_version:number;assigned_staff_user_id:string;idempotency_key:string;purpose:'REVIEW_MODERATION'};
export type ReviewModerationDecisionInput={expected_version:number;expected_review_version:number;command:ReviewModerationCommand;reason_code:ReviewModerationReason;reason_text:string;reverses_action_id?:string|undefined;idempotency_key:string;purpose:'REVIEW_MODERATION'};
export type ReviewModerationResult={case:ReviewModerationQueueItem;action:ReviewModerationAction;replayed:boolean};
export type ReviewModerationFilters={status?:ReviewCaseState;severity?:ReviewModerationQueueItem['severity'];assigned?:'me'|'unassigned'|'all';limit?:number};
type Grant={role:string;permission_scope:StaffScope};
type CaseRow={id:string;review_id:string;state:ReviewCaseState;version:number;assigned_staff_user_id:string|null;updated_at:Date};
type ReviewRow={id:string;interaction_id:string;eligibility_id:string;state:ReviewState;version:number;rating:number;text:string|null;criteria:NonNullable<ReviewContent['criteria']>;published_at:Date|null};
type ActionRow=Omit<ReviewModerationAction,'created_at'|'notice_available_at'|'appeal_deadline'>&{created_at:Date;notice_available_at:Date|null;appeal_deadline:Date|null;request_hash:string};
const caseStates=['OPEN','TRIAGED','UNDER_REVIEW','ACTION_REQUIRED','RESOLVED','CLOSED'] as const;
const commands=['BEGIN_INVESTIGATION','HOLD','HIDE','REMOVE','RESTORE','RESOLVE','CLOSE'] as const;
const reasons=['REVIEW_POLICY_VIOLATION','PRIVACY_PROTECTION','THREAT_PROTECTION','INVESTIGATION','NO_VIOLATION','ELIGIBILITY_RESTORED','CASE_COMPLETED'] as const;
const assignment=z.object({expected_version:z.number().int().positive(),assigned_staff_user_id:z.uuid(),idempotency_key:z.uuid(),purpose:z.literal('REVIEW_MODERATION')}).strict();
const decision=z.object({expected_version:z.number().int().positive(),expected_review_version:z.number().int().positive(),command:z.enum(commands),reason_code:z.enum(reasons),reason_text:z.string().trim().min(10).max(2000),reverses_action_id:z.uuid().optional(),idempotency_key:z.uuid(),purpose:z.literal('REVIEW_MODERATION')}).strict();
const filters=z.object({status:z.enum(caseStates).optional(),severity:z.enum(['LOW','MEDIUM','HIGH','CRITICAL']).optional(),assigned:z.enum(['me','unassigned','all']).optional(),limit:z.number().int().min(1).max(50).optional()}).strict();
const actionProjection=(a:ActionRow):ReviewModerationAction=>({id:a.id,case_id:a.case_id,review_id:a.review_id,actor_user_id:a.actor_user_id,assigned_staff_user_id:a.assigned_staff_user_id,command:a.command,reason_code:a.reason_code,reason_text:a.reason_text,before_case_state:a.before_case_state,after_case_state:a.after_case_state,before_review_state:a.before_review_state,after_review_state:a.after_review_state,case_version:a.case_version,review_version:a.review_version,reverses_action_id:a.reverses_action_id,policy_version:a.policy_version,request_id:a.request_id,created_at:instant(a.created_at)!,notice_available_at:instant(a.notice_available_at),appeal_deadline:instant(a.appeal_deadline)});

/** Every operation re-resolves durable staff session/grants. Queue summaries do
 * not confer evidence access; detail requires assignment and explicit purpose. */
class ModerationReviewPolicy extends ReviewStore {
  protected override async lockContext(tx:Tx,initial:Context):Promise<Context>{
    // Creator attribution is part of the conflict predicate. Pin property before
    // Listing in the same participant/principal order as property writers.
    await tx`SELECT id FROM users WHERE id=ANY(${[initial.seeker_user_id,initial.provider_user_id].filter((id):id is string=>id!==null)}) ORDER BY id FOR SHARE`;
    if(initial.provider_profile_id)await tx`SELECT id FROM provider_profiles WHERE id=${initial.provider_profile_id} FOR SHARE`;
    await tx`SELECT id FROM provider_accounts WHERE id=${initial.provider_account_id} FOR SHARE`;
    await tx`SELECT p.id FROM properties p JOIN listings l ON l.property_id=p.id WHERE l.id=${initial.listing_id} FOR SHARE OF p`;
    return super.lockContext(tx,initial);
  }
  lockModerationContext(tx:Tx,id:string){return this.maintenanceContext(tx,id);}
  safeModerationContext(tx:Tx,c:Context){return this.safe(tx,c);}
  reconcileModerationContext(tx:Tx,c:Context){return this.reconcile(tx,c);}
  revealModerationContext(tx:Tx,c:Context){return this.reveal(tx,c);}
}
export class ReviewModerationStore {
  private readonly policy:ModerationReviewPolicy;
  constructor(private readonly client:postgres.Sql,allowSyntheticVerification=false){this.policy=new ModerationReviewPolicy(client,allowSyntheticVerification);}
  private async staff(tx:Tx,p:StaffPrincipal,sensitive:boolean):Promise<Grant[]> {
    const session=(await tx<{fresh:boolean}[]>`SELECT s.authenticated_at>statement_timestamp()-interval '15 minutes' AS fresh
      FROM staff_sessions s JOIN users u ON u.id=s.user_id JOIN auth_identities i ON i.id=s.identity_id
      WHERE s.id=${p.row.id} AND s.user_id=${p.row.user_id} AND s.issuer=${p.row.issuer} AND s.app_client_id=${p.row.app_client_id} AND s.origin_jti=${p.row.origin_jti}
        AND s.revoked_at IS NULL AND s.absolute_expires_at>statement_timestamp() AND s.idle_expires_at>statement_timestamp() AND s.token_expires_at>statement_timestamp()
        AND s.mfa_method='COGNITO_REQUIRED_TOTP' AND s.authenticated_at<=statement_timestamp() AND u.account_state IN ('ACTIVE','PENDING_PHONE')
        AND u.security_version=s.security_version AND i.unlinked_at IS NULL AND i.user_id=s.user_id AND i.issuer=s.issuer FOR SHARE OF s,u,i`)[0];
    if(!session)throw new StaffAccessError('AUTH_REQUIRED');
    const grants=(await tx<Grant[]>`SELECT role,permission_scope FROM staff_grants WHERE user_id=${p.row.user_id} AND revoked_at IS NULL AND active_from<=statement_timestamp() AND expires_at>statement_timestamp() ORDER BY id FOR SHARE`).filter(g=>validStaffScope(g.role,g.permission_scope));
    if(sensitive&&!session.fresh)throw new StaffAccessError('STEP_UP_REQUIRED');return grants;
  }
  private permission(grants:Grant[],caseId:string,permission:string):boolean{return grants.some(g=>g.role==='TRUST_SAFETY_MODERATOR'&&g.permission_scope.kind==='case'&&g.permission_scope.id===caseId&&g.permission_scope.permissions.includes(permission));}
  private async allowed(tx:Tx,p:StaffPrincipal,c:CaseRow,evidence=false,decision=false):Promise<void>{
    const grants=await this.staff(tx,p,evidence||decision);
    if(c.assigned_staff_user_id!==p.row.user_id||!(this.permission(grants,c.id,'review:moderate')||(!decision&&this.permission(grants,c.id,'report:triage')))
      ||(evidence&&!this.permission(grants,c.id,'evidence:read'))||(decision&&!this.permission(grants,c.id,'moderation:act')))fail('RESOURCE_SCOPE_DENIED');
    await this.noConflict(tx,p.row.user_id,c.review_id);
  }
  private async noConflict(tx:Tx,actor:string,reviewId:string){if((await tx<{conflict:boolean}[]>`SELECT review_moderation_conflicted(${actor},${reviewId}) AS conflict`)[0]!.conflict)fail('RESOURCE_SCOPE_DENIED');}
  private async denied(p:StaffPrincipal,id:string,requestId:string,work:()=>Promise<ReviewModerationResult|ReviewModerationDetail>):Promise<ReviewModerationResult|ReviewModerationDetail>{
    try{return await work();}catch(error){if(error instanceof IdentityError||error instanceof StaffAccessError)await this.client`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id) VALUES(${p.row.user_id},'REVIEW_MODERATION_DENIED','ReviewModerationCase',${id},${error.code},${requestId})`;throw error;}
  }
  private async item(tx:Tx,id:string):Promise<ReviewModerationQueueItem>{
    const row=(await tx<(Omit<ReviewModerationQueueItem,'opened_at'|'last_report_at'|'due_at'|'next_action'> & {opened_at:Date;last_report_at:Date;due_at:Date|null})[]>`WITH report_summary AS (
      SELECT case_id,(array_agg(reason ORDER BY CASE reason WHEN 'THREATS' THEN 4 WHEN 'PRIVACY_EXPOSURE' THEN 3 WHEN 'EXTORTION' THEN 3 WHEN 'HARASSMENT' THEN 2 WHEN 'DISCRIMINATION' THEN 2 WHEN 'IMPERSONATION' THEN 2 ELSE 1 END DESC,created_at,id))[1] AS reason,
        max(CASE reason WHEN 'THREATS' THEN 3 WHEN 'PRIVACY_EXPOSURE' THEN 3 WHEN 'EXTORTION' THEN 3 WHEN 'HARASSMENT' THEN 2 WHEN 'DISCRIMINATION' THEN 2 WHEN 'IMPERSONATION' THEN 2 ELSE 1 END) AS priority,max(created_at) AS last_report_at,count(*)::integer AS report_count FROM review_reports WHERE case_id=${id} GROUP BY case_id)
      SELECT c.id,c.review_id,s.reason,CASE s.priority WHEN 3 THEN 'HIGH' WHEN 2 THEN 'MEDIUM' ELSE 'LOW' END AS severity,c.state,c.version,r.state AS review_state,r.version AS review_version,c.opened_at,s.last_report_at,s.report_count,c.assigned_staff_user_id,
        greatest(0,floor(extract(epoch FROM statement_timestamp()-c.opened_at)))::integer AS age_seconds,
        CASE WHEN s.priority=3 THEN c.opened_at+interval '4 hours' END AS due_at,
        s.priority=3 AND c.opened_at+interval '4 hours'<=statement_timestamp() AND c.state NOT IN ('RESOLVED','CLOSED') AS overdue
      FROM review_moderation_cases c JOIN reviews r ON r.id=c.review_id JOIN report_summary s ON s.case_id=c.id WHERE c.id=${id}`)[0];
    if(!row)fail('RESOURCE_SCOPE_DENIED');
    const newlyReported=(await tx<{pending:boolean}[]>`SELECT EXISTS(SELECT 1 FROM review_reports r JOIN review_moderation_cases c ON c.id=r.case_id WHERE c.id=${id} AND c.state IN ('RESOLVED','CLOSED') AND r.created_at>c.updated_at) AS pending`)[0]!.pending;
    const next:ReviewModerationQueueItem['next_action']=newlyReported?'BEGIN_INVESTIGATION':!row.assigned_staff_user_id?'ASSIGN':row.state==='TRIAGED'?'BEGIN_INVESTIGATION':row.state==='ACTION_REQUIRED'?'RESOLVE':row.state==='RESOLVED'?'CLOSE':row.state==='CLOSED'?'COMPLETED':'RECORD_DECISION';
    return {...row,opened_at:instant(row.opened_at)!,last_report_at:instant(row.last_report_at)!,due_at:instant(row.due_at),next_action:next};
  }
  async queue(p:StaffPrincipal,input:ReviewModerationFilters={},requestId:string):Promise<{items:ReviewModerationQueueItem[]}>{
    validId(requestId,'INVALID_INPUT');const parsed=filters.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');
    return this.client.begin(async tx=>{const grants=await this.staff(tx,p,false);
      const ids=[...new Set(grants.filter(g=>g.role==='TRUST_SAFETY_MODERATOR'&&g.permission_scope.kind==='case'&&g.permission_scope.permissions.some(v=>['report:triage','case:assign','review:moderate'].includes(v))).map(g=>g.permission_scope.id))];
      if(!ids.length)fail('RESOURCE_SCOPE_DENIED');
      const cases=await tx<CaseRow[]>`SELECT c.* FROM review_moderation_cases c WHERE c.id::text=ANY(${ids}) AND NOT review_moderation_conflicted(${p.row.user_id},c.review_id) ORDER BY (SELECT coalesce(max(CASE report.reason WHEN 'THREATS' THEN 3 WHEN 'PRIVACY_EXPOSURE' THEN 3 WHEN 'EXTORTION' THEN 3 WHEN 'HARASSMENT' THEN 2 WHEN 'DISCRIMINATION' THEN 2 WHEN 'IMPERSONATION' THEN 2 ELSE 1 END),0) FROM review_reports report WHERE report.case_id=c.id) DESC,c.opened_at,c.id`;
      const items:ReviewModerationQueueItem[]=[];
      for(const c of cases){if(!this.permission(grants,c.id,'report:triage')&&!this.permission(grants,c.id,'case:assign')&&!(c.assigned_staff_user_id===p.row.user_id&&this.permission(grants,c.id,'review:moderate')))continue;
        if(input.status&&c.state!==input.status)continue;if(input.assigned==='me'&&c.assigned_staff_user_id!==p.row.user_id)continue;if(input.assigned==='unassigned'&&c.assigned_staff_user_id!==null)continue;
        const row=await this.item(tx,c.id);if(input.severity&&row.severity!==input.severity)continue;items.push(row);if(items.length>=(input.limit??50))break;}
      // Metadata is scoped too: pin the returned cases, then resolve grants
      // again after any lock wait. A cached assignment or expiry decision cannot
      // carry an assigned-only summary past its current authority boundary.
      const currentCases=items.length?await tx<CaseRow[]>`SELECT * FROM review_moderation_cases WHERE id=ANY(${items.map(item=>item.id)}) ORDER BY id FOR SHARE`:[];
      const currentGrants=await this.staff(tx,p,false);
      if(!currentGrants.some(g=>g.role==='TRUST_SAFETY_MODERATOR'&&g.permission_scope.kind==='case'&&g.permission_scope.permissions.some(permission=>['report:triage','case:assign','review:moderate'].includes(permission))))fail('RESOURCE_SCOPE_DENIED');
      const currentById=new Map(currentCases.map(c=>[c.id,c])),authorized:ReviewModerationQueueItem[]=[];
      for(const prior of items){const c=currentById.get(prior.id);if(!c)continue;
        if(!this.permission(currentGrants,c.id,'report:triage')&&!this.permission(currentGrants,c.id,'case:assign')&&!(c.assigned_staff_user_id===p.row.user_id&&this.permission(currentGrants,c.id,'review:moderate')))continue;
        if(input.status&&c.state!==input.status)continue;if(input.assigned==='me'&&c.assigned_staff_user_id!==p.row.user_id)continue;if(input.assigned==='unassigned'&&c.assigned_staff_user_id!==null)continue;
        if((await tx<{conflict:boolean}[]>`SELECT review_moderation_conflicted(${p.row.user_id},${c.review_id}) AS conflict`)[0]!.conflict)continue;
        const row=await this.item(tx,c.id);if(input.severity&&row.severity!==input.severity)continue;authorized.push(row);
      }
      // Item projection can itself wait on an intake table. Recheck conflicts
      // after projection, then keep the last grant check after every such wait.
      const nonconflicted=authorized.length?await tx<{id:string}[]>`SELECT id FROM review_moderation_cases WHERE id=ANY(${authorized.map(row=>row.id)}) AND NOT review_moderation_conflicted(${p.row.user_id},review_id)`:[];
      const nonconflictedIds=new Set(nonconflicted.map(row=>row.id));
      const finalGrants=await this.staff(tx,p,false);
      if(!finalGrants.some(g=>g.role==='TRUST_SAFETY_MODERATOR'&&g.permission_scope.kind==='case'&&g.permission_scope.permissions.some(permission=>['report:triage','case:assign','review:moderate'].includes(permission))))fail('RESOURCE_SCOPE_DENIED');
      return {items:authorized.filter(row=>nonconflictedIds.has(row.id)&&(this.permission(finalGrants,row.id,'report:triage')||this.permission(finalGrants,row.id,'case:assign')||(row.assigned_staff_user_id===p.row.user_id&&this.permission(finalGrants,row.id,'review:moderate'))))};});
  }
  async get(p:StaffPrincipal,idInput:string,purpose:string,requestId:string):Promise<ReviewModerationDetail>{
    const id=validId(idInput);validId(requestId,'INVALID_INPUT');if(purpose!=='REVIEW_MODERATION')fail('RESOURCE_SCOPE_DENIED');
    return this.denied(p,id,requestId,()=>this.client.begin(async tx=>{await this.staff(tx,p,true);const seed=(await tx<{interaction_id:string}[]>`SELECT r.interaction_id FROM review_moderation_cases c JOIN reviews r ON r.id=c.review_id WHERE c.id=${id}`)[0];if(!seed)fail('RESOURCE_SCOPE_DENIED');await this.policy.lockModerationContext(tx,seed.interaction_id);await tx`SELECT id FROM viewing_review_eligibilities WHERE interaction_id=${seed.interaction_id} ORDER BY id FOR SHARE`;await tx`SELECT id FROM reviews WHERE interaction_id=${seed.interaction_id} ORDER BY id FOR SHARE`;const c=(await tx<CaseRow[]>`SELECT * FROM review_moderation_cases WHERE id=${id} FOR SHARE`)[0];if(!c)fail('RESOURCE_SCOPE_DENIED');await this.allowed(tx,p,c,true);
      const r=(await tx<ReviewRow[]>`SELECT * FROM reviews WHERE id=${c.review_id}`)[0]!;
      const revisions=await tx<{version:number;rating:number;text:string|null;criteria:NonNullable<ReviewContent['criteria']>;created_at:Date}[]>`SELECT version,rating,text,criteria,created_at FROM review_revisions WHERE review_id=${r.id} ORDER BY version`;
      const reports=await tx<{id:string;reason:ReviewReportInput['reason'];details:string|null;created_at:Date}[]>`SELECT id,reason,details,created_at FROM review_reports WHERE case_id=${id} ORDER BY created_at,id`;
      const actions=await tx<ActionRow[]>`SELECT * FROM review_moderation_actions WHERE case_id=${id} ORDER BY case_version`;
      await tx`LOCK TABLE audit_events IN ROW EXCLUSIVE MODE`;await this.allowed(tx,p,c,true);await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata) VALUES(${p.row.user_id},'REVIEW_MODERATION_EVIDENCE_READ','ReviewModerationCase',${id},'REVIEW_MODERATION',${requestId},${JSON.stringify({purpose:'REVIEW_MODERATION',policy_version:'review-moderation-v1'})}::jsonb)`;const summary=await this.item(tx,id);await this.allowed(tx,p,c,true);
      return {case:summary,review:{id:r.id,state:r.state,version:r.version,rating:r.rating,text:r.text,criteria:r.criteria,published_at:instant(r.published_at)},revisions:revisions.map(v=>({...v,created_at:instant(v.created_at)!})),reports:reports.map(v=>({...v,created_at:instant(v.created_at)!})),actions:actions.map(actionProjection)};
    })) as Promise<ReviewModerationDetail>;
  }
  async assign(p:StaffPrincipal,idInput:string,input:ReviewModerationAssignmentInput,requestId:string):Promise<ReviewModerationResult>{const parsed=assignment.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');return this.command(p,validId(idInput),'ASSIGN',parsed.data,validId(requestId,'INVALID_INPUT'));}
  async decide(p:StaffPrincipal,idInput:string,input:ReviewModerationDecisionInput,requestId:string):Promise<ReviewModerationResult>{const parsed=decision.safeParse(input);if(!parsed.success||(parsed.data.command==='RESTORE')!==!!parsed.data.reverses_action_id||(parsed.data.command==='REMOVE'&&!['REVIEW_POLICY_VIOLATION','PRIVACY_PROTECTION','THREAT_PROTECTION'].includes(parsed.data.reason_code))||(parsed.data.command==='RESTORE'&&!['NO_VIOLATION','ELIGIBILITY_RESTORED'].includes(parsed.data.reason_code)))fail('INVALID_INPUT');return this.command(p,validId(idInput),parsed.data.command,parsed.data,validId(requestId,'INVALID_INPUT'));}
  private async command(p:StaffPrincipal,id:string,operation:'ASSIGN'|ReviewModerationCommand,input:ReviewModerationAssignmentInput|ReviewModerationDecisionInput,requestId:string):Promise<ReviewModerationResult>{
    const hash=createHash('sha256').update(JSON.stringify({case_id:id,operation,...input})).digest('hex');
    return this.denied(p,id,requestId,()=>this.client.begin(async tx=>{
      await this.staff(tx,p,true);await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`review-moderation-command:${p.row.user_id}:${input.idempotency_key}`},0))`;
      const seed=(await tx<{review_id:string;interaction_id:string}[]>`SELECT c.review_id,r.interaction_id FROM review_moderation_cases c JOIN reviews r ON r.id=c.review_id WHERE c.id=${id}`)[0];if(!seed)fail('RESOURCE_SCOPE_DENIED');
      const context=await this.policy.lockModerationContext(tx,seed.interaction_id);
      await tx`SELECT id FROM viewing_review_eligibilities WHERE interaction_id=${context.id} ORDER BY id FOR UPDATE`;
      await tx`SELECT id FROM reviews WHERE interaction_id=${context.id} ORDER BY id FOR UPDATE`;
      const c=(await tx<CaseRow[]>`SELECT * FROM review_moderation_cases WHERE id=${id} FOR UPDATE`)[0]!,r=(await tx<ReviewRow[]>`SELECT * FROM reviews WHERE id=${seed.review_id}`)[0]!;
      const authorize=async()=>{if(operation==='ASSIGN'){const grants=await this.staff(tx,p,true);if(!this.permission(grants,id,'case:assign'))fail('RESOURCE_SCOPE_DENIED');await this.noConflict(tx,p.row.user_id,r.id);}else await this.allowed(tx,p,c,true,true);};
      await authorize();const prior=(await tx<ActionRow[]>`SELECT * FROM review_moderation_actions WHERE actor_user_id=${p.row.user_id} AND idempotency_key=${input.idempotency_key}`)[0];
      if(prior){if(prior.request_hash!==hash)fail('IDEMPOTENCY_KEY_REUSED');const summary=await this.item(tx,id);await authorize();return {case:summary,action:actionProjection(prior),replayed:true};}
      if(c.version!==input.expected_version)fail('STALE_VERSION');
      let state:ReviewCaseState,reviewState=r.state;let assignee=c.assigned_staff_user_id,reasonCode:'CASE_ASSIGNMENT'|ReviewModerationReason,reasonText:string,reversal:string|null=null;
      const changes=['HOLD','HIDE','REMOVE','RESTORE'].includes(operation);
      if(operation==='ASSIGN'){
        const data=input as ReviewModerationAssignmentInput;assignee=data.assigned_staff_user_id;
        if(['RESOLVED','CLOSED'].includes(c.state)&&!(await tx`SELECT report.id FROM review_reports report JOIN review_moderation_cases current_case ON current_case.id=report.case_id WHERE current_case.id=${id} AND report.created_at>current_case.updated_at LIMIT 1`)[0])fail('INVALID_STATE');await this.noConflict(tx,assignee,r.id);
        const identity=await tx`SELECT u.id,i.id FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE u.id=${assignee} AND u.account_state IN ('ACTIVE','PENDING_PHONE') AND i.unlinked_at IS NULL FOR SHARE OF u,i`;
        if(!identity[0])fail('RESOURCE_SCOPE_DENIED');
        const recipient=(await tx<Grant[]>`SELECT role,permission_scope FROM staff_grants WHERE user_id=${assignee} AND revoked_at IS NULL AND active_from<=statement_timestamp() AND expires_at>statement_timestamp() FOR SHARE`).filter(g=>validStaffScope(g.role,g.permission_scope));
        if(!this.permission(recipient,id,'report:triage')&&!this.permission(recipient,id,'review:moderate'))fail('RESOURCE_SCOPE_DENIED');
        state=['OPEN','RESOLVED','CLOSED'].includes(c.state)?'TRIAGED':c.state;reasonCode='CASE_ASSIGNMENT';reasonText='Scoped case assignment';
      }else{
        const data=input as ReviewModerationDecisionInput;if(data.expected_review_version!==r.version)fail('STALE_VERSION');reasonCode=data.reason_code;reasonText=data.reason_text;
        if(operation==='BEGIN_INVESTIGATION'){if(!['TRIAGED','ACTION_REQUIRED'].includes(c.state)&&!(['RESOLVED','CLOSED'].includes(c.state)&&(await tx`SELECT report.id FROM review_reports report JOIN review_moderation_cases current_case ON current_case.id=report.case_id WHERE current_case.id=${id} AND report.created_at>current_case.updated_at LIMIT 1`)[0]))fail('INVALID_STATE');state='UNDER_REVIEW';}
        else if(operation==='RESOLVE'){if(!['UNDER_REVIEW','ACTION_REQUIRED'].includes(c.state))fail('INVALID_STATE');state='RESOLVED';}
        else if(operation==='CLOSE'){if(c.state!=='RESOLVED')fail('INVALID_STATE');state='CLOSED';}
        else{if(!['UNDER_REVIEW','ACTION_REQUIRED'].includes(c.state)||r.state==='WITHDRAWN'||(r.state==='REMOVED'&&operation!=='RESTORE'))fail('INVALID_STATE');state='ACTION_REQUIRED';
          if(operation==='RESTORE'){
            reversal=data.reverses_action_id!;const original=(await tx<ActionRow[]>`SELECT * FROM review_moderation_actions WHERE id=${reversal} AND case_id=${id} AND review_id=${r.id}`)[0];
            if(!['UNDER_REVIEW','HIDDEN','REMOVED'].includes(r.state)||!original||!['HOLD','HIDE','REMOVE'].includes(original.command)||original.after_review_state!==r.state||original.review_version!==r.version||(await tx`SELECT id FROM review_moderation_actions WHERE reverses_action_id=${reversal}`)[0])fail('INVALID_STATE');
            if(!(await this.policy.safeModerationContext(tx,context))||!(await tx<{valid:boolean}[]>`SELECT review_author_current(${r.id}) AS valid`)[0]!.valid||!(await tx`SELECT id FROM viewing_review_eligibilities WHERE id=${r.eligibility_id} AND state='CONSUMED'`)[0])fail('REVIEW_ELIGIBILITY_UNAVAILABLE');
            reviewState=r.published_at?'PUBLISHED':'SUBMITTED_HELD';
          }else reviewState=operation==='HOLD'?'UNDER_REVIEW':operation==='HIDE'?'HIDDEN':'REMOVED';
          if(reviewState===r.state)fail('INVALID_STATE');
        }
      }
      // Serialize inbox/audit writes before the final current-authority check;
      // time crossing a grant/session deadline while waiting fails closed.
      await tx`LOCK TABLE review_moderation_actions,viewing_notices,audit_events IN ROW EXCLUSIVE MODE`;await authorize();
      const action=(await tx<ActionRow[]>`INSERT INTO review_moderation_actions(case_id,review_id,actor_user_id,staff_session_id,assigned_staff_user_id,command,purpose,reason_code,reason_text,before_case_state,after_case_state,before_review_state,after_review_state,case_version,review_version,reverses_action_id,idempotency_key,request_hash,request_id,notice_available_at,appeal_deadline)
        VALUES(${id},${r.id},${p.row.user_id},${p.row.id},${assignee},${operation},'REVIEW_MODERATION',${reasonCode},${reasonText},${c.state},${state},${r.state},${reviewState},${c.version+1},${r.version+(changes?1:0)},${reversal},${input.idempotency_key},${hash},${requestId},${changes?tx`statement_timestamp()`:tx`NULL`},${changes?tx`((statement_timestamp() AT TIME ZONE 'UTC')+interval '30 days') AT TIME ZONE 'UTC'`:tx`NULL`}) RETURNING *`)[0]!;
      if(changes){await tx`UPDATE reviews SET state=${reviewState},version=version+1,updated_at=statement_timestamp() WHERE id=${r.id}`;await this.policy.reconcileModerationContext(tx,context);}
      await tx`UPDATE review_moderation_cases SET state=${state},assigned_staff_user_id=${assignee},version=version+1,updated_at=statement_timestamp() WHERE id=${id}`;
      if(operation==='RESTORE'){await this.policy.revealModerationContext(tx,context);await this.policy.reconcileModerationContext(tx,context);}
      // Recheck authority for the original assigned case even after assignment.
      const summary=await this.item(tx,id);await authorize();return {case:summary,action:actionProjection(action),replayed:false};
    })) as Promise<ReviewModerationResult>;
  }
}
