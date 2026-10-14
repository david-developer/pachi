import type postgres from 'postgres';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ReviewStore } from './review.js';
import { ViewingAttendanceStore } from './viewing-attendance.js';
import { actorNormalized, fail, instant, validId, type Context, type Row, type Tx, type Authority } from './viewing.js';
import { IdentityError } from './identity.js';
import { StaffAccessError, validStaffScope, type StaffScope } from './staff-policy.js';
import type { StaffPrincipal } from './staff.js';
import type { OrganizationActor } from './organization-lifecycle.js';
import type { AttendanceAdjudicationAction, AttendanceAdjudicationCommandResponse, AttendanceAppeal, AttendanceAppealCommandResponse,
  AttendanceAppealDecisionRequest, AttendanceAppealRequest, AttendanceAssignmentRequest, AttendanceCaseDetailResponse, AttendanceCaseQueueItem,
  AttendanceDecisionRequest, AttendanceInvestigationRequest, AttendanceEvidenceReference, AttendanceParticipantResolution } from './attendance-adjudication-types.js';

const outcomes=['COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW','CLAIM_INVALIDATED','INSUFFICIENT_EVIDENCE'] as const;
const reasons=['ATTENDANCE_SUPPORTED','NO_SHOW_SUPPORTED','CONTRADICTORY_CLAIM','UNSUPPORTED_CLAIM','INSUFFICIENT_EVIDENCE'] as const;
const evidence=z.array(z.object({kind:z.literal('MESSAGE'),reference:z.uuid()}).strict()).max(5).refine(v=>new Set(v.map(i=>i.reference)).size===v.length);
const common={purpose:z.literal('ATTENDANCE_ADJUDICATION'),expected_version:z.number().int().positive(),idempotency_key:z.uuid()};
const investigation=z.object({...common,reason_text:z.string().trim().min(10).max(2000)}).strict();
const assignment=z.object({...common,assigned_staff_user_id:z.uuid()}).strict();
const decision=z.object({...common,outcome:z.enum(outcomes),reason_code:z.enum(reasons),reason_text:z.string().trim().min(10).max(2000),evidence}).strict();
const appealDecision=decision.extend({appeal_id:z.uuid(),original_action_id:z.uuid(),appeal_outcome:z.enum(['UPHELD','OVERTURNED','PARTIALLY_UPHELD']),review_mode:z.enum(['INDEPENDENT_REVIEW','SOLE_OPERATOR_RECONSIDERATION'])}).strict();
const appeal=z.object({original_action_id:z.uuid(),reason:z.string().trim().min(10).max(2000),evidence,idempotency_key:z.uuid()}).strict();
type Grant={role:string;permission_scope:StaffScope};
type Case={id:string;viewing_id:string;schedule_version:number;attendance_outcome_id:string;opened_at:Date;version:number;assigned_staff_user_id:string|null;decision_id:string|null;state:AttendanceCaseQueueItem['state']};
type Action=Omit<AttendanceAdjudicationAction,'created_at'|'appeal_deadline'>&{created_at:Date;appeal_deadline:Date|null;request_hash:string};
type AppealRow=Omit<AttendanceAppeal,'submitted_at'>&{submitted_at:Date;appellant_user_id:string;appellant_side:string;request_hash:string};
const projectAction=(a:Action):AttendanceAdjudicationAction=>({id:a.id,case_id:a.case_id,command:a.command,actor_user_id:a.actor_user_id,assigned_staff_user_id:a.assigned_staff_user_id,case_version:a.case_version,before_state:a.before_state,after_state:a.after_state,before_case_state:a.before_case_state,after_case_state:a.after_case_state,outcome:a.outcome,reason_code:a.reason_code,reason_text:a.reason_text,evidence:a.evidence,policy_version:a.policy_version,original_action_id:a.original_action_id,appeal_id:a.appeal_id,appeal_outcome:a.appeal_outcome,review_mode:a.review_mode,created_at:instant(a.created_at)!,appeal_deadline:instant(a.appeal_deadline)});
const projectAppeal=(a:AppealRow):AttendanceAppeal=>({id:a.id,original_action_id:a.original_action_id,state:a.state,reason:a.reason,evidence:a.evidence,submitted_at:instant(a.submitted_at)!,outcome_action_id:a.outcome_action_id,review_mode:a.review_mode});
class AdjudicationReviewPolicy extends ReviewStore {
  protected override async lockContext(tx:Tx,c:Context):Promise<Context>{
    await tx`SELECT id FROM users WHERE id=ANY(${[c.seeker_user_id,c.provider_user_id].filter((id):id is string=>id!==null)}) ORDER BY id FOR SHARE`;
    if(c.provider_profile_id)await tx`SELECT id FROM provider_profiles WHERE id=${c.provider_profile_id} FOR SHARE`;
    await tx`SELECT id FROM provider_accounts WHERE id=${c.provider_account_id} FOR SHARE`;
    await tx`SELECT p.id FROM properties p JOIN listings l ON l.property_id=p.id WHERE l.id=${c.listing_id} FOR SHARE OF p`;
    return super.lockContext(tx,c);
  }
  lock(tx:Tx,id:string){return this.maintenanceContext(tx,id);}
  async prepareDecision(tx:Tx,c:Context){
    // Acquire mutable safety inputs and aggregate serialization before the
    // durable decision/notice timestamp, so it cannot start during a wait.
    await this.safe(tx,c);
    const subjects=[{type:'ProviderAccount',id:c.provider_account_id},{type:'User',id:c.seeker_user_id}].sort((a,b)=>`${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
    for(const subject of subjects)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`review-reputation:${subject.type}:${subject.id}`},0))`;
  }
  reconcileReviews(tx:Tx,c:Context){return this.reconcile(tx,c);}
  revealReviews(tx:Tx,c:Context){return this.reveal(tx,c);}
}
class AdjudicationAttendancePolicy extends ViewingAttendanceStore {
  async supportSession(tx:Tx,actor:OrganizationActor){
    const session=await tx`SELECT s.id FROM security_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=${actor.sessionId} AND s.user_id=${actor.userId} AND s.revoked_at IS NULL AND s.expires_at>statement_timestamp() AND u.security_version=${actor.securityVersion} AND u.account_state IN ('ACTIVE','PENDING_PHONE','LIMITED','SUSPENDED','DEACTIVATED','DELETION_PENDING') FOR SHARE OF s,u`;
    if(!session[0])fail('AUTH_REQUIRED');
  }
  async participant(tx:Tx,actor:OrganizationActor,id:string):Promise<Authority>{
    await this.supportSession(tx,actor);const initial=await this.context(tx,id);
    if(initial.organization_id)await tx`SELECT id FROM organizations WHERE id=${initial.organization_id} FOR UPDATE`;
    const context=await this.lockContext(tx,initial);
    if(context.seeker_user_id===actor.userId)return {context,side:'SEEKER',organization:null};
    if(context.kind==='INDIVIDUAL'&&context.provider_user_id===actor.userId)return {context,side:'PROVIDER',organization:null};
    if(context.organization_id){
      const member=(await tx<{id:string;version:number;role:'OWNER'|'ADMIN'|'LISTING_MANAGER'|'AGENT';assignment_id:string;assignment_version:number}[]>`SELECT m.id,m.version,m.role,s.id AS assignment_id,s.version AS assignment_version FROM organization_memberships m JOIN organization_resource_assignments s ON s.membership_id=m.id JOIN organizations org ON org.id=m.organization_id JOIN provider_accounts pa ON pa.organization_id=org.id
        WHERE m.organization_id=${context.organization_id} AND m.user_id=${actor.userId} AND m.state='ACTIVE' AND m.role<>'ANALYST' AND org.state='ACTIVE' AND pa.id=${context.provider_account_id} AND pa.state='ACTIVE'
        AND s.provider_account_id=pa.id AND s.resource_type='INTERACTION' AND s.resource_id=${context.id} AND s.revoked_at IS NULL AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp()) FOR SHARE OF s`)[0];
      if(member)return {context,side:'PROVIDER',organization:{actorUserId:actor.userId,organizationId:context.organization_id,providerAccountId:context.provider_account_id,membershipId:member.id,membershipVersion:member.version,role:member.role,assignmentId:member.assignment_id,assignmentVersion:member.assignment_version,resourceType:'INTERACTION',resourceId:context.id,resourceState:context.state}};
    }
    return fail('RESOURCE_SCOPE_DENIED');
  }
  async current(tx:Tx,actor:OrganizationActor,a:Authority){
    await this.supportSession(tx,actor);
    if(a.organization&&!(await tx`SELECT s.id FROM organization_resource_assignments s JOIN organization_memberships m ON m.id=s.membership_id JOIN organizations o ON o.id=m.organization_id WHERE s.id=${a.organization.assignmentId!} AND s.version=${a.organization.assignmentVersion!} AND s.revoked_at IS NULL AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp()) AND m.id=${a.organization.membershipId} AND m.version=${a.organization.membershipVersion} AND m.state='ACTIVE' AND o.state='ACTIVE'`)[0])fail('RESOURCE_SCOPE_DENIED');
  }
  boundary(tx:Tx,row:Row,outcomeId:string,c:Context){return this.reviewBoundary(tx,row,{id:outcomeId},c);}
}
/** All protected reads and writes re-resolve durable authority after waits. */
export class AttendanceAdjudicationStore {
  private readonly reviews:AdjudicationReviewPolicy;
  private readonly attendance:AdjudicationAttendancePolicy;
  constructor(private readonly client:postgres.Sql,allowSyntheticVerification=false){this.reviews=new AdjudicationReviewPolicy(client,allowSyntheticVerification);this.attendance=new AdjudicationAttendancePolicy(client,allowSyntheticVerification);}
  private async denied<T>(p:StaffPrincipal,id:string,requestId:string,work:()=>Promise<T>):Promise<T>{
    try{return await work();}catch(error){if(error instanceof IdentityError||error instanceof StaffAccessError)await this.client`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id) VALUES(${p.row.user_id},'ATTENDANCE_ADJUDICATION_DENIED','ViewingAttendanceCase',${id},${error.code},${requestId})`;throw error;}
  }
  private async staff(tx:Tx,p:StaffPrincipal,sensitive=true):Promise<Grant[]>{
    const s=(await tx<{fresh:boolean}[]>`SELECT s.authenticated_at>statement_timestamp()-interval '15 minutes' AS fresh FROM staff_sessions s JOIN users u ON u.id=s.user_id JOIN auth_identities i ON i.id=s.identity_id
      WHERE s.id=${p.row.id} AND s.user_id=${p.row.user_id} AND s.issuer=${p.row.issuer} AND s.app_client_id=${p.row.app_client_id} AND s.origin_jti=${p.row.origin_jti}
      AND s.revoked_at IS NULL AND s.absolute_expires_at>statement_timestamp() AND s.idle_expires_at>statement_timestamp() AND s.token_expires_at>statement_timestamp()
      AND s.mfa_method='COGNITO_REQUIRED_TOTP' AND s.authenticated_at<=statement_timestamp() AND u.account_state IN ('ACTIVE','PENDING_PHONE') AND u.security_version=s.security_version
      AND i.user_id=s.user_id AND i.issuer=s.issuer AND i.unlinked_at IS NULL FOR SHARE OF s,u,i`)[0];
    if(!s)throw new StaffAccessError('AUTH_REQUIRED');if(sensitive&&!s.fresh)throw new StaffAccessError('STEP_UP_REQUIRED');
    return (await tx<Grant[]>`SELECT role,permission_scope FROM staff_grants WHERE user_id=${p.row.user_id} AND revoked_at IS NULL AND active_from<=statement_timestamp() AND expires_at>statement_timestamp() ORDER BY id FOR SHARE`).filter(g=>validStaffScope(g.role,g.permission_scope));
  }
  private has(grants:Grant[],id:string,permission:string){return grants.some(g=>g.role==='TRUST_SAFETY_MODERATOR'&&g.permission_scope.kind==='case'&&g.permission_scope.id===id&&g.permission_scope.permissions.includes(permission));}
  private async nonconflicted(tx:Tx,userId:string,id:string){if((await tx<{conflict:boolean}[]>`SELECT attendance_conflicted(${userId},${id}) AS conflict`)[0]!.conflict)fail('RESOURCE_SCOPE_DENIED');}
  private async allowed(tx:Tx,p:StaffPrincipal,c:Case,kind:'queue'|'evidence'|'assign'|'decision'|'appeal'){
    const grants=await this.staff(tx,p,kind!=='queue');await this.nonconflicted(tx,p.row.user_id,c.id);
    if(kind==='assign'){if(!this.has(grants,c.id,'case:assign'))fail('RESOURCE_SCOPE_DENIED');return;}
    if(kind==='queue') {if(!this.has(grants,c.id,'case:assign')&&!this.has(grants,c.id,'report:triage')&&!(c.assigned_staff_user_id===p.row.user_id&&this.has(grants,c.id,'moderation:act')))fail('RESOURCE_SCOPE_DENIED');return;}
    if(c.assigned_staff_user_id!==p.row.user_id||!this.has(grants,c.id,'evidence:read')||!this.has(grants,c.id,'moderation:act')||(kind==='appeal'&&!this.has(grants,c.id,'appeal:resolve')))fail('RESOURCE_SCOPE_DENIED');
  }
  private async case(tx:Tx,id:string):Promise<Case>{
    const c=(await tx<Case[]>`SELECT c.*,w.version,w.state,w.assigned_staff_user_id,w.decision_id FROM viewing_attendance_cases c JOIN attendance_case_workflows w ON w.case_id=c.id WHERE c.id=${id}`)[0];if(!c)fail('RESOURCE_SCOPE_DENIED');return c;
  }
  private async locked(tx:Tx,id:string){
    const seed=(await tx<{interaction_id:string}[]>`SELECT v.interaction_id FROM viewing_attendance_cases c JOIN viewings v ON v.id=c.viewing_id WHERE c.id=${id}`)[0];if(!seed)fail('RESOURCE_SCOPE_DENIED');
    const context=await this.reviews.lock(tx,seed.interaction_id);
    await tx`SELECT id FROM viewings WHERE interaction_id=${context.id} ORDER BY id FOR UPDATE`;
    await tx`SELECT id FROM viewing_review_eligibilities WHERE interaction_id=${context.id} ORDER BY id FOR UPDATE`;
    await tx`SELECT id FROM reviews WHERE interaction_id=${context.id} ORDER BY id FOR UPDATE`;
    await tx`SELECT case_id FROM attendance_case_workflows WHERE case_id=${id} FOR UPDATE`;
    return {context,c:await this.case(tx,id)};
  }
  private async item(tx:Tx,c:Case):Promise<AttendanceCaseQueueItem>{
    const row=(await tx<{age_seconds:number;outcome:AttendanceCaseQueueItem['outcome'];pending_appeals:number}[]>`SELECT greatest(0,floor(extract(epoch FROM statement_timestamp()-${c.opened_at}::timestamptz)))::integer AS age_seconds,
      (SELECT outcome FROM attendance_adjudication_actions WHERE id=${c.decision_id}) AS outcome,
      (SELECT count(*)::integer FROM attendance_appeals a WHERE a.case_id=${c.id} AND NOT EXISTS(SELECT 1 FROM attendance_adjudication_actions d WHERE d.appeal_id=a.id)) AS pending_appeals`)[0]!;
    return {id:c.id,viewing_id:c.viewing_id,schedule_version:c.schedule_version,state:c.state,version:c.version,assigned_staff_user_id:c.assigned_staff_user_id,opened_at:instant(c.opened_at)!,severity:'LOW',...row};
  }
  async queue(p:StaffPrincipal,requestId:string):Promise<{items:AttendanceCaseQueueItem[]}>{
    validId(requestId,'INVALID_INPUT');return this.client.begin(async tx=>{
      const grants=await this.staff(tx,p,false),ids=[...new Set(grants.filter(g=>g.role==='TRUST_SAFETY_MODERATOR'&&g.permission_scope.kind==='case'&&g.permission_scope.permissions.some(v=>['case:assign','report:triage','moderation:act'].includes(v))).map(g=>g.permission_scope.id))];
      if(!ids.length)fail('RESOURCE_SCOPE_DENIED');
      const candidates=await tx<{id:string}[]>`SELECT c.id FROM viewing_attendance_cases c WHERE c.id::text=ANY(${ids}) AND NOT attendance_conflicted(${p.row.user_id},c.id) ORDER BY c.opened_at,c.id LIMIT 50`;
      const items:AttendanceCaseQueueItem[]=[];
      for(const row of candidates){await tx`SELECT case_id FROM attendance_case_workflows WHERE case_id=${row.id} FOR SHARE`;const c=await this.case(tx,row.id);
        const current=await this.staff(tx,p,false);if(!this.has(current,c.id,'case:assign')&&!this.has(current,c.id,'report:triage')&&!(c.assigned_staff_user_id===p.row.user_id&&this.has(current,c.id,'moderation:act')))continue;
        await this.nonconflicted(tx,p.row.user_id,c.id);items.push(await this.item(tx,c));}
      // A projection may itself wait. Last check covers every returned item.
      for(const item of items)await this.allowed(tx,p,await this.case(tx,item.id),'queue');return {items};
    });
  }
  private async appeals(tx:Tx,c:Case,userId?:string):Promise<AppealRow[]>{return tx<AppealRow[]>`SELECT ap.*,coalesce(d.appeal_outcome,'SUBMITTED') AS state,d.id AS outcome_action_id,d.review_mode FROM attendance_appeals ap LEFT JOIN attendance_adjudication_actions d ON d.appeal_id=ap.id WHERE ap.case_id=${c.id} ${userId?tx`AND ap.appellant_user_id=${userId}`:tx``} ORDER BY ap.submitted_at,ap.id`;}
  async get(p:StaffPrincipal,idInput:string,purpose:string,requestId:string):Promise<AttendanceCaseDetailResponse>{
    const id=validId(idInput);validId(requestId,'INVALID_INPUT');if(purpose!=='ATTENDANCE_ADJUDICATION')fail('RESOURCE_SCOPE_DENIED');
    return this.denied(p,id,requestId,()=>this.client.begin(async tx=>{await this.staff(tx,p);const {c}=await this.locked(tx,id);await this.allowed(tx,p,c,'evidence');
      const claims=await tx<{id:string;claimant_side:'SEEKER'|'PROVIDER';claim_type:'COMPLETION'|'NO_SHOW';claimed_outcome:string;state:string;claimed_at:Date;validation_method:string|null}[]>`SELECT cl.id,cl.claimant_side,cl.claim_type,cl.claimed_outcome,cl.state,cl.claimed_at,o.validation_method FROM viewing_attendance_claims cl JOIN viewing_attendance_outcomes o ON o.viewing_id=cl.viewing_id AND o.schedule_version=cl.schedule_version WHERE cl.viewing_id=${c.viewing_id} AND cl.schedule_version=${c.schedule_version} ORDER BY cl.claimed_at,cl.id`;
      const schedules=await tx<{schedule_version:number;scheduled_start:Date;scheduled_end:Date}[]>`SELECT schedule_version,scheduled_start,scheduled_end FROM viewing_schedule_history WHERE viewing_id=${c.viewing_id} UNION ALL SELECT schedule_version,scheduled_start,scheduled_end FROM viewings WHERE id=${c.viewing_id} ORDER BY schedule_version`;
      const reports=await tx<{id:string;reason_code:string;evidence:AttendanceEvidenceReference[];submitted_at:Date}[]>`SELECT id,reason_code,evidence_metadata AS evidence,submitted_at FROM viewing_attendance_reports WHERE case_id=${id} ORDER BY submitted_at,id`;
      const events=await tx<{id:string;event_type:string;version:number;created_at:Date}[]>`SELECT id,event_type,version,created_at FROM viewing_events WHERE viewing_id=${c.viewing_id} UNION ALL SELECT r.id,'attendance_appeal_review_started' AS event_type,a.case_version AS version,r.started_at AS created_at FROM attendance_appeal_reviews r JOIN attendance_adjudication_actions a ON a.id=r.decision_action_id WHERE a.case_id=${c.id} ORDER BY created_at,id`;
      const actions=await tx<Action[]>`SELECT * FROM attendance_adjudication_actions WHERE case_id=${id} ORDER BY case_version`,appeals=await this.appeals(tx,c);
      await tx`LOCK TABLE audit_events IN ROW EXCLUSIVE MODE`;await this.allowed(tx,p,c,'evidence');
      await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id) VALUES(${p.row.user_id},'ATTENDANCE_EVIDENCE_READ','ViewingAttendanceCase',${id},'ATTENDANCE_ADJUDICATION',${requestId})`;
      const summary=await this.item(tx,c);await this.allowed(tx,p,c,'evidence');
      return {case:summary,claims:claims.map(r=>({...r,claimed_at:instant(r.claimed_at)!})),schedules:schedules.map(r=>({...r,scheduled_start:instant(r.scheduled_start)!,scheduled_end:instant(r.scheduled_end)!})),reports:reports.map(r=>({...r,submitted_at:instant(r.submitted_at)!})),events:events.map(r=>({...r,created_at:instant(r.created_at)!})),actions:actions.map(projectAction),appeals:appeals.map(projectAppeal)};
    }));
  }
  async assign(p:StaffPrincipal,id:string,input:AttendanceAssignmentRequest,requestId:string){const parsed=assignment.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');return this.command(p,id,'ASSIGN',parsed.data,requestId);}
  async beginInvestigation(p:StaffPrincipal,id:string,input:AttendanceInvestigationRequest,requestId:string){const parsed=investigation.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');return this.command(p,id,'BEGIN_INVESTIGATION',parsed.data,requestId);}
  async decide(p:StaffPrincipal,id:string,input:AttendanceDecisionRequest,requestId:string){const parsed=decision.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');return this.command(p,id,'DECIDE',parsed.data,requestId);}
  async resolveAppeal(p:StaffPrincipal,id:string,input:AttendanceAppealDecisionRequest,requestId:string){const parsed=appealDecision.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');return this.command(p,id,'RESOLVE_APPEAL',parsed.data,requestId);}
  private async evidence(tx:Tx,id:string,refs:AttendanceEvidenceReference[]){if(!(await tx<{valid:boolean}[]>`SELECT attendance_evidence_valid(${id},${JSON.stringify(refs)}::text::jsonb) AS valid`)[0]!.valid)fail('RESOURCE_SCOPE_DENIED');}
  private async command(p:StaffPrincipal,idInput:string,command:AttendanceAdjudicationAction['command'],input:AttendanceAssignmentRequest|AttendanceInvestigationRequest|AttendanceDecisionRequest|AttendanceAppealDecisionRequest,requestId:string):Promise<AttendanceAdjudicationCommandResponse>{
    const id=validId(idInput);validId(requestId,'INVALID_INPUT');const hash=createHash('sha256').update(JSON.stringify({id,command,...input})).digest('hex');
    return this.denied(p,id,requestId,()=>this.client.begin(async tx=>{await this.staff(tx,p);await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance-adjudication:${p.row.user_id}:${input.idempotency_key}`},0))`;
      const {c,context}=await this.locked(tx,id),kind=command==='ASSIGN'?'assign':command==='RESOLVE_APPEAL'?'appeal':'decision';await this.allowed(tx,p,c,kind);
      const prior=(await tx<Action[]>`SELECT * FROM attendance_adjudication_actions WHERE actor_user_id=${p.row.user_id} AND idempotency_key=${input.idempotency_key}`)[0];
      if(prior){if(prior.request_hash!==hash)fail('IDEMPOTENCY_KEY_REUSED');const summary=await this.item(tx,c);await this.allowed(tx,p,c,kind);return {case:summary,action:projectAction(prior),replayed:true};}
      if(c.version!==input.expected_version)fail('STALE_VERSION');
      const v=(await tx<Row[]>`SELECT * FROM viewings WHERE id=${c.viewing_id}`)[0]!;
      let assignee=c.assigned_staff_user_id,outcome:AttendanceDecisionRequest['outcome']|null=null,reasonCode:AttendanceAdjudicationAction['reason_code']='CASE_ASSIGNMENT',reasonText='Explicit scoped attendance assignment',refs:AttendanceEvidenceReference[]=[],original:string|null=null,appealId:string|null=null,appealOutcome:AttendanceAdjudicationAction['appeal_outcome']=null,mode:AttendanceAdjudicationAction['review_mode']='INITIAL';
      if(command==='ASSIGN'){
        assignee=(input as AttendanceAssignmentRequest).assigned_staff_user_id;await this.nonconflicted(tx,assignee,id);
        if(!(await tx`SELECT u.id FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE u.id=${assignee} AND u.account_state IN ('ACTIVE','PENDING_PHONE') AND i.unlinked_at IS NULL FOR SHARE OF u,i`)[0])fail('RESOURCE_SCOPE_DENIED');
        const grants=(await tx<Grant[]>`SELECT role,permission_scope FROM staff_grants WHERE user_id=${assignee} AND revoked_at IS NULL AND active_from<=statement_timestamp() AND expires_at>statement_timestamp() FOR SHARE`).filter(g=>validStaffScope(g.role,g.permission_scope));
        if(!this.has(grants,id,'moderation:act'))fail('RESOURCE_SCOPE_DENIED');
      }else if(command==='BEGIN_INVESTIGATION'){
        if(c.state!=='TRIAGED')fail('INVALID_STATE');reasonCode='CASE_INVESTIGATION';reasonText=(input as AttendanceInvestigationRequest).reason_text;
      }else{
        const d=input as AttendanceDecisionRequest;outcome=d.outcome;reasonCode=d.reason_code;reasonText=d.reason_text;refs=d.evidence;await this.evidence(tx,id,refs);
        if((outcome==='COMPLETED'&&reasonCode!=='ATTENDANCE_SUPPORTED')||(['SEEKER_NO_SHOW','PROVIDER_NO_SHOW'].includes(outcome)&&reasonCode!=='NO_SHOW_SUPPORTED')||(outcome==='CLAIM_INVALIDATED'&&!['CONTRADICTORY_CLAIM','UNSUPPORTED_CLAIM'].includes(reasonCode))||(outcome==='INSUFFICIENT_EVIDENCE'&&reasonCode!=='INSUFFICIENT_EVIDENCE'))fail('INVALID_INPUT');
        if(command==='DECIDE'&&(c.decision_id||c.state!=='UNDER_REVIEW'))fail('INVALID_STATE');
        if(command==='RESOLVE_APPEAL'){
          const a=input as AttendanceAppealDecisionRequest;original=a.original_action_id;appealId=a.appeal_id;appealOutcome=a.appeal_outcome;mode=a.review_mode;
          const origin=(await tx<Action[]>`SELECT * FROM attendance_adjudication_actions WHERE id=${original} AND case_id=${id} AND command='DECIDE'`)[0];
          if(!origin||!(await tx`SELECT id FROM attendance_appeals WHERE id=${appealId} AND case_id=${id} AND original_action_id=${original}`)[0]||(await tx`SELECT id FROM attendance_adjudication_actions WHERE appeal_id=${appealId}`)[0])fail('INVALID_STATE');
          if((appealOutcome==='UPHELD')!==(origin.outcome===outcome))fail('INVALID_INPUT');
          if(mode==='INDEPENDENT_REVIEW'&&p.row.user_id===origin.actor_user_id)fail('RESOURCE_SCOPE_DENIED');
          if(mode==='SOLE_OPERATOR_RECONSIDERATION'&&(p.row.user_id!==origin.actor_user_id||(await tx<{available:boolean}[]>`SELECT attendance_other_reviewer(${id},${origin.actor_user_id},${p.row.issuer}) AS available`)[0]!.available))fail('RESOURCE_SCOPE_DENIED');
        }
      }
      if(outcome!==null)await this.reviews.prepareDecision(tx,context);
      // Pin relation locks before setting durable notice time; reauthorize after waits.
      await tx`LOCK TABLE attendance_adjudication_actions,attendance_decision_notices,attendance_adjudication_outbox,attendance_review_effects,attendance_appeal_reviews,viewing_notices,viewing_review_boundaries,viewing_review_eligibilities,review_scheduled_actions,review_events,review_outbox,review_reputation,audit_events IN ROW EXCLUSIVE MODE`;await this.allowed(tx,p,c,kind);
      const caseState=command==='ASSIGN'?(c.state==='OPEN'?'TRIAGED':c.state):command==='BEGIN_INVESTIGATION'?'UNDER_REVIEW':'RESOLVED';
      const after=outcome===null?v.state:['COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW'].includes(outcome)?outcome:'ATTENDANCE_UNCONFIRMED';
      const action=(await tx<Action[]>`INSERT INTO attendance_adjudication_actions(case_id,command,actor_user_id,staff_session_id,assigned_staff_user_id,case_version,before_state,after_state,before_case_state,after_case_state,outcome,reason_code,reason_text,evidence,original_action_id,appeal_id,appeal_outcome,review_mode,appeal_deadline,request_id,idempotency_key,request_hash)
        VALUES(${id},${command},${p.row.user_id},${p.row.id},${assignee!},${c.version+1},${v.state},${after},${c.state},${caseState},${outcome},${reasonCode},${reasonText},${JSON.stringify(refs)}::text::jsonb,${original},${appealId},${appealOutcome},${mode},${outcome===null?tx`NULL`:tx`((statement_timestamp() AT TIME ZONE 'UTC')+interval '30 days') AT TIME ZONE 'UTC'`},${requestId},${input.idempotency_key},${hash}) RETURNING *`)[0]!;
      await tx`UPDATE attendance_case_workflows SET assigned_staff_user_id=${assignee!},decision_id=${outcome===null?c.decision_id:action.id},state=${caseState},version=version+1,updated_at=statement_timestamp() WHERE case_id=${id}`;
      if(outcome!==null){
        await tx`UPDATE viewings SET state=${after},adjudication_action_id=${action.id},version=version+1,updated_at=statement_timestamp(),attendance_validated_at=coalesce(attendance_validated_at,CASE WHEN ${after} IN ('COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW') THEN attendance_completion_time(${c.attendance_outcome_id}) END) WHERE id=${v.id}`;
        if(outcome==='COMPLETED')await this.attendance.boundary(tx,v,c.attendance_outcome_id,context);
        // A historical dispute may hold a different first-completion boundary.
        // Only its own invalidation revokes that boundary; all other holds remain.
        const boundary=(await tx<{attendance_outcome_id:string;viewing_id:string}[]>`SELECT attendance_outcome_id,viewing_id FROM viewing_review_boundaries WHERE interaction_id=${context.id}`)[0];
        if(boundary){const valid=(await tx<{state:string}[]>`SELECT attendance_effective_state(${boundary.attendance_outcome_id}) AS state`)[0]!.state;
          const unresolved=!!(await tx`SELECT id FROM viewing_attendance_outcomes WHERE viewing_id IN(SELECT id FROM viewings WHERE interaction_id=${context.id}) AND attendance_effective_state(id)='DISPUTED'`)[0];
          const slots=await tx<{id:string;state:string;consumed_at:Date|null;unrevealed:boolean}[]>`SELECT e.id,e.state,e.consumed_at,EXISTS(SELECT 1 FROM reviews r WHERE r.eligibility_id=e.id AND r.published_at IS NULL AND r.state<>'WITHDRAWN') AS unrevealed FROM viewing_review_eligibilities e WHERE e.interaction_id=${context.id} ORDER BY e.id`;
          for(const e of slots){
            const revoke=valid!=='COMPLETED'&&boundary.attendance_outcome_id===c.attendance_outcome_id,restore=valid==='COMPLETED'&&!unresolved;
            if(!revoke&&!restore)continue;
            await tx`INSERT INTO attendance_review_effects(action_id,eligibility_id,policy_version,before_state,after_state,before_closes_at,after_closes_at)
              SELECT ${action.id},id,policy_version,state,${revoke?'REVOKED':e.consumed_at?'CONSUMED':'OPEN'},closes_at,
                CASE WHEN ${restore&&(!e.consumed_at||e.unrevealed)} THEN greatest((SELECT max(closes_at) FROM viewing_review_eligibilities WHERE interaction_id=${context.id}),(((SELECT created_at FROM attendance_adjudication_actions WHERE id=${action.id}) AT TIME ZONE 'UTC')+interval '7 days') AT TIME ZONE 'UTC') ELSE closes_at END
              FROM viewing_review_eligibilities WHERE id=${e.id}`;
            await tx`UPDATE viewing_review_eligibilities e SET state=effect.after_state,closes_at=effect.after_closes_at,restoration_action_id=${action.id},version=version+1 FROM attendance_review_effects effect WHERE effect.action_id=${action.id} AND effect.eligibility_id=e.id AND e.id=${e.id}`;
            await tx`UPDATE review_scheduled_actions job SET due_at=CASE job.action_type WHEN 'REVEAL_DEADLINE' THEN e.closes_at WHEN 'REMINDER_3D' THEN review_utc_days_before(e.closes_at,3) ELSE review_utc_days_before(e.closes_at,1) END,
              state=CASE WHEN ${revoke} THEN 'SKIPPED' ELSE 'PENDING' END,reason_code=CASE WHEN ${revoke} THEN 'ATTENDANCE_INVALIDATED' ELSE NULL END,expected_eligibility_version=e.version,lease_token=NULL,lease_until=NULL,processed_at=NULL,last_checked_at=NULL
              FROM viewing_review_eligibilities e WHERE job.eligibility_id=e.id AND e.id=${e.id}`;
          }
        }
        await this.reviews.revealReviews(tx,context);await this.reviews.reconcileReviews(tx,context);
      }
      const current=await this.case(tx,id),summary=await this.item(tx,current);
      if(mode==='SOLE_OPERATOR_RECONSIDERATION'&&(await tx<{available:boolean}[]>`SELECT attendance_other_reviewer(${id},(SELECT actor_user_id FROM attendance_adjudication_actions WHERE id=${original!}),${p.row.issuer}) AS available`)[0]!.available)fail('RESOURCE_SCOPE_DENIED');
      await this.allowed(tx,p,command==='ASSIGN'?c:current,kind);
      return {case:summary,action:projectAction(action),replayed:false};
    }));
  }
  private async participant(tx:Tx,actor:OrganizationActor,viewingId:string){
    await tx`LOCK TABLE block_relationships IN SHARE MODE`;
    const seed=(await tx<{interaction_id:string}[]>`SELECT interaction_id FROM viewings WHERE id=${viewingId}`)[0];if(!seed)fail('RESOURCE_SCOPE_DENIED');
    const a=await this.attendance.participant(tx,actor,seed.interaction_id);
    if(a.context.organization_id&&a.side==='PROVIDER'&&!(await tx`SELECT s.id FROM organization_resource_assignments s WHERE s.membership_id=${a.organization!.membershipId} AND s.provider_account_id=${a.context.provider_account_id} AND s.resource_type='INTERACTION' AND s.resource_id=${a.context.id} AND s.revoked_at IS NULL AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp()) FOR SHARE`)[0])fail('RESOURCE_SCOPE_DENIED');
    await tx`SELECT id FROM viewings WHERE id=${viewingId} FOR UPDATE`;
    const seedCase=(await tx<{id:string}[]>`SELECT id FROM viewing_attendance_cases WHERE viewing_id=${viewingId}`)[0];if(!seedCase)fail('RESOURCE_SCOPE_DENIED');
    await tx`SELECT case_id FROM attendance_case_workflows WHERE case_id=${seedCase.id} FOR UPDATE`;
    return {a,c:await this.case(tx,seedCase.id)};
  }
  private async resolution(tx:Tx,actor:OrganizationActor,a:Authority,c:Case):Promise<AttendanceParticipantResolution>{
    const current=c.decision_id?(await tx<Action[]>`SELECT * FROM attendance_adjudication_actions WHERE id=${c.decision_id}`)[0]:null;
    const own=await this.appeals(tx,c,actor.userId);
    const can=!!current&&current.command==='DECIDE'&&!(await tx`SELECT id FROM attendance_appeals WHERE original_action_id=${current.id} AND appellant_side=${a.side}`)[0]&&!!(await tx`SELECT id FROM attendance_adjudication_actions WHERE id=${current.id} AND statement_timestamp()<appeal_deadline`)[0];
    await this.attendance.current(tx,actor,a);
    return {case_id:c.id,current_decision:current?{id:current.id,outcome:current.outcome!,reason_code:current.reason_code as AttendanceDecisionRequest['reason_code'],decided_at:instant(current.created_at)!,appeal_deadline:instant(current.appeal_deadline)!,can_appeal:can,review_mode:current.review_mode,reviewer_label:current.review_mode==='SOLE_OPERATOR_RECONSIDERATION'?'Original operator reconsideration':current.review_mode==='INDEPENDENT_REVIEW'?'Different authorized reviewer':'Authorized staff adjudication'}:null,own_appeals:own.map(projectAppeal)};
  }
  async participantResolution(actorInput:OrganizationActor,viewingInput:string):Promise<AttendanceParticipantResolution>{const actor=actorNormalized(actorInput),id=validId(viewingInput);return this.client.begin(async tx=>{const {a,c}=await this.participant(tx,actor,id);return this.resolution(tx,actor,a,c);});}
  async submitAppeal(actorInput:OrganizationActor,viewingInput:string,input:AttendanceAppealRequest):Promise<AttendanceAppealCommandResponse>{
    const parsed=appeal.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');const data=parsed.data,actor=actorNormalized(actorInput),id=validId(viewingInput),hash=createHash('sha256').update(JSON.stringify({viewing_id:id,...data})).digest('hex');
    return this.client.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance-appeal:${actor.userId}:${data.idempotency_key}`},0))`;const {a,c}=await this.participant(tx,actor,id);
      const prior=(await tx<{id:string;request_hash:string}[]>`SELECT id,request_hash FROM attendance_appeals WHERE appellant_user_id=${actor.userId} AND idempotency_key=${data.idempotency_key}`)[0];
      if(prior){if(prior.request_hash!==hash)fail('IDEMPOTENCY_KEY_REUSED');const row=(await this.appeals(tx,c,actor.userId)).find(ap=>ap.id===prior.id);if(!row)fail('RESOURCE_SCOPE_DENIED');return {resolution:await this.resolution(tx,actor,a,c),appeal:projectAppeal(row),replayed:true};}
      if(c.decision_id!==data.original_action_id)fail('INVALID_STATE');
      if(!(await tx`SELECT id FROM attendance_adjudication_actions WHERE id=${data.original_action_id} AND command='DECIDE' AND statement_timestamp()<appeal_deadline`)[0]||(await tx`SELECT id FROM attendance_appeals WHERE original_action_id=${data.original_action_id} AND appellant_side=${a.side}`)[0])fail('INVALID_STATE');
      await this.evidence(tx,c.id,data.evidence);await tx`LOCK TABLE attendance_appeals,attendance_decision_notices,attendance_adjudication_outbox,audit_events IN ROW EXCLUSIVE MODE`;await this.attendance.current(tx,actor,a);
      // Compare at database precision after every potential lock wait.
      if(!(await tx`SELECT id FROM attendance_adjudication_actions WHERE id=${data.original_action_id} AND statement_timestamp()<appeal_deadline`)[0])fail('INVALID_STATE');
      const row=(await tx<{id:string}[]>`INSERT INTO attendance_appeals(case_id,original_action_id,appellant_user_id,appellant_side,reason,evidence,idempotency_key,request_hash) VALUES(${c.id},${data.original_action_id},${actor.userId},${a.side},${data.reason},${JSON.stringify(data.evidence)}::text::jsonb,${data.idempotency_key},${hash}) RETURNING id`)[0]!;
      const created=(await this.appeals(tx,c,actor.userId)).find(ap=>ap.id===row.id)!;
      return {resolution:await this.resolution(tx,actor,a,c),appeal:projectAppeal(created),replayed:false};
    });
  }
}
