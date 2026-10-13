import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ViewingAppointmentStore } from './viewing-appointments.js';
import { actorNormalized, fail, instant, validId, type Authority, type Context, type Row, type Side, type Tx, type ViewingCommandOptions, type ViewingResponse, type ViewingVersionInput } from './viewing.js';
import { requireOrganizationResourceSession } from './organization-resource-actor.js';
import { lockListingRegion } from './region-publication.js';
import { IdentityError } from './identity.js';
import { contactProhibited } from './contact-safety.js';
import type { OrganizationActor } from './organization-lifecycle.js';

export type AttendanceOutcome = 'COMPLETED'|'SEEKER_NO_SHOW'|'PROVIDER_NO_SHOW';
export type AttendanceClaimInput = ViewingVersionInput & {claim_type:'COMPLETION'|'NO_SHOW';absent_side?:Side};
export type AttendanceResponseInput = ViewingVersionInput & {expected_claim_version:number;reason?:'DID_NOT_ATTEND'|'OUTCOME_INCORRECT'|'SAFETY'|'OTHER';evidence?:{reference:string;kind:'MESSAGE'}[]};
type Claim = {
  id:string;viewing_id:string;schedule_version:number;claimant_user_id:string;claimant_side:Side;membership_id:string|null;assignment_id:string|null;
  claim_type:'COMPLETION'|'NO_SHOW';claimed_outcome:AttendanceOutcome;state:'PENDING'|'CONFIRMED'|'FINALIZED'|'DISPUTED';version:number;
  claimed_at:Date;counterparty_notice_id:string;notice_available_at:Date;response_deadline:Date;responded_at:Date|null;finalized_at:Date|null;
};
type Outcome = {id:string;viewing_id:string;schedule_version:number;state:'AWAITING_VALIDATION'|AttendanceOutcome|'DISPUTED';claimed_outcome:AttendanceOutcome;primary_claim_id:string;version:number;finalized_at:Date|null};
export type AttendanceClaimRead = {
  id:string;viewing_id:string;schedule_version:number;claimant_user_id:string;claimant_side:Side;claim_type:'COMPLETION'|'NO_SHOW';claimed_outcome:AttendanceOutcome;
  state:Claim['state'];version:number;claimed_at:string;notice_available_at:string;response_deadline:string;responded_at:string|null;finalized_at:string|null;can_confirm:boolean;can_dispute:boolean;
};
export type AttendanceRead = {
  viewing_id:string;schedule_version:number;version:number;state:'NONE'|Outcome['state'];outcome:AttendanceOutcome|null;actor_side:Side;
  can_claim_completion:boolean;can_claim_no_show:boolean;claims:AttendanceClaimRead[];next_cursor:string|null;
  case:{id:string;state:'OPEN';review_status:'PENDING_REVIEW';opened_at:string}|null;response_window_hours:48;review_eligibility_created:boolean;
};
export type AttendanceCommandRead = {viewing:ViewingResponse;attendance:AttendanceRead;claim:AttendanceClaimRead;replayed:boolean};
const versions={expected_version:z.number().int().positive(),expected_schedule_version:z.number().int().positive()};
const claimSchema=z.discriminatedUnion('claim_type',[
  z.object({...versions,claim_type:z.literal('COMPLETION')}).strict(),
  z.object({...versions,claim_type:z.literal('NO_SHOW'),absent_side:z.enum(['SEEKER','PROVIDER'])}).strict(),
]);
const confirmSchema=z.object({...versions,expected_claim_version:z.number().int().positive()}).strict();
const disputeSchema=confirmSchema.extend({reason:z.enum(['DID_NOT_ATTEND','OUTCOME_INCORRECT','SAFETY','OTHER']),evidence:z.array(z.object({reference:z.uuid(),kind:z.literal('MESSAGE')}).strict()).max(5).optional()}).strict();

/** Current F1/F2 authority, immutable receipts and exact schedule locks apply to
 * attendance too. Claims never confer authority or authorize staff resolution. */
export class ViewingAttendanceStore extends ViewingAppointmentStore {
  private async attendanceAuthorizedViewing(tx:Tx,actor:OrganizationActor,id:string) {
    const seed=(await tx<{interaction_id:string}[]>`SELECT interaction_id FROM viewings WHERE id=${id}`)[0];if(!seed)fail('RESOURCE_SCOPE_DENIED');
    const initial=await this.context(tx,seed.interaction_id);
    if(initial.organization_id) {await lockListingRegion(tx,initial.listing_id);await tx`SELECT id FROM organizations WHERE id=${initial.organization_id} FOR UPDATE`;}
    return this.authorizedViewing(tx,actor,id);
  }
  private async attendanceContextEligible(tx:Tx,c:Context,actorUserId=c.seeker_user_id):Promise<boolean> {
    if(c.state==='RESTRICTED'||!(await this.participantEligible(tx,actorUserId))||!(await this.participantEligible(tx,c.seeker_user_id)))return false;
    if(await contactProhibited(tx,c.seeker_user_id,c.provider_account_id,c.provider_user_id))return false;
    // Advertisement closure, freshness and region availability govern new
    // appointments. Existing attendance remains usable unless a safety hold or
    // current participant/principal restriction prevents validation.
    if(!(await tx`SELECT l.id FROM listings l JOIN provider_accounts pa ON pa.id=l.provider_account_id
      WHERE l.id=${c.listing_id} AND pa.id=${c.provider_account_id} AND pa.state='ACTIVE'
        AND l.publication_status NOT IN ('HIDDEN','REMOVED') AND l.moderation_status NOT IN ('ESCALATED','REMOVED')`)[0])return false;
    if(c.kind==='INDIVIDUAL')return c.provider_user_id!==c.seeker_user_id&&!!c.provider_user_id&&await this.participantEligible(tx,c.provider_user_id)
      &&!!(await tx`SELECT id FROM provider_profiles WHERE id=${c.provider_profile_id} AND state='ACTIVE'`)[0];
    const org=(await tx`SELECT id FROM organizations WHERE id=${c.organization_id} AND state='ACTIVE' AND onboarding_completed_at IS NOT NULL`)[0];
    if(!org)return false;
    const members=await tx<{user_id:string}[]>`SELECT m.user_id FROM organization_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.organization_id=${c.organization_id} AND m.state='ACTIVE' AND u.account_state='ACTIVE'
        AND EXISTS(SELECT 1 FROM phone_contacts p WHERE p.user_id=u.id AND p.verified_at IS NOT NULL AND p.replaced_at IS NULL AND p.verification_version>0)
        AND (m.role IN ('OWNER','ADMIN') OR (m.role IN ('LISTING_MANAGER','AGENT') AND EXISTS(SELECT 1 FROM organization_resource_assignments s
          WHERE s.membership_id=m.id AND s.provider_account_id=${c.provider_account_id} AND s.resource_type='INTERACTION' AND s.resource_id=${c.id}
            AND s.revoked_at IS NULL AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp())))) FOR SHARE OF u`;
    for(const m of members)if(await this.participantEligible(tx,m.user_id))return true;
    return false;
  }
  private async attendanceEligible(tx:Tx,actor:OrganizationActor,a:Authority) {return this.attendanceContextEligible(tx,a.context,actor.userId);}
  protected override async maintenanceViewing(tx:Tx,id:string) {
    await tx`LOCK TABLE block_relationships IN SHARE MODE`;
    const seed=(await tx<{interaction_id:string}[]>`SELECT interaction_id FROM viewings WHERE id=${id}`)[0];if(!seed)fail('RESOURCE_SCOPE_DENIED');
    const initial=await this.context(tx,seed.interaction_id);
    await lockListingRegion(tx,initial.listing_id);
    if(initial.organization_id) {
      // Match participant commands: region, organization, principal/listing,
      // Interaction, Viewing, then action. Never acquire org after its child.
      await tx`SELECT id FROM organizations WHERE id=${initial.organization_id} FOR UPDATE`;
    }
    const context=await this.lockContext(tx,initial);
    if(initial.organization_id)await tx`SELECT s.id FROM organization_resource_assignments s JOIN viewing_attendance_claims c ON c.membership_id=s.membership_id
      WHERE c.viewing_id=${id} AND s.resource_type='INTERACTION' AND s.resource_id=${initial.id} FOR SHARE OF s`;
    const row=(await tx<Row[]>`SELECT * FROM viewings WHERE id=${id} FOR UPDATE SKIP LOCKED`)[0];
    if(!row)return null;
    if(row.interaction_id!==context.id||row.listing_id!==context.listing_id||row.provider_account_id!==context.provider_account_id||row.seeker_user_id!==context.seeker_user_id)fail('RESOURCE_SCOPE_DENIED');
    return {row,context,eligible:await this.contextEligible(tx,context)};
  }
  private async outcome(tx:Tx,row:Row):Promise<Outcome|null> {
    return (await tx<Outcome[]>`SELECT * FROM viewing_attendance_outcomes WHERE viewing_id=${row.id} AND schedule_version=${row.schedule_version} FOR UPDATE`)[0]??null;
  }
  private async claim(tx:Tx,id:string,viewingId:string):Promise<Claim> {
    const c=(await tx<Claim[]>`SELECT * FROM viewing_attendance_claims WHERE id=${id} AND viewing_id=${viewingId} FOR UPDATE`)[0];
    if(!c)fail('RESOURCE_SCOPE_DENIED');return c;
  }
  private claimProjection(c:Claim,a:Authority,row:Row,o:Outcome|null,eligible:boolean):AttendanceClaimRead {
    const counterparty=a.side!==c.claimant_side,current=c.schedule_version===row.schedule_version&&o!==null&&o.state!=='DISPUTED';
    return {id:c.id,viewing_id:c.viewing_id,schedule_version:c.schedule_version,claimant_user_id:c.claimant_user_id,claimant_side:c.claimant_side,claim_type:c.claim_type,claimed_outcome:c.claimed_outcome,
      state:c.state,version:c.version,claimed_at:instant(c.claimed_at)!,notice_available_at:instant(c.notice_available_at)!,response_deadline:instant(c.response_deadline)!,responded_at:instant(c.responded_at),finalized_at:instant(c.finalized_at),
      can_confirm:current&&counterparty&&eligible&&c.state==='PENDING'&&row.state==='SCHEDULED'&&o.state==='AWAITING_VALIDATION',
      can_dispute:current&&counterparty&&c.state!=='DISPUTED'&&['SCHEDULED','COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW'].includes(row.state)};
  }
  private async attendanceProjection(tx:Tx,actor:OrganizationActor,a:Authority,row:Row,input:{cursor?:string;limit?:number}={}):Promise<AttendanceRead> {
    const o=await this.outcome(tx,row),eligible=await this.attendanceEligible(tx,actor,a),limit=input.limit??20;
    const claims=await tx<Claim[]>`SELECT * FROM viewing_attendance_claims WHERE viewing_id=${row.id} ${input.cursor?tx`AND id<${input.cursor}`:tx``} ORDER BY id DESC LIMIT ${limit+1}`;
    const c=o?(await tx<{id:string;state:'OPEN';review_status:'PENDING_REVIEW';opened_at:Date}[]>`SELECT id,state,review_status,opened_at FROM viewing_attendance_cases WHERE attendance_outcome_id=${o.id}`)[0]:undefined;
    const timing=(await tx<{completed:boolean;no_show:boolean}[]>`SELECT ${row.scheduled_end}::timestamptz<=statement_timestamp() AS completed,${row.scheduled_start}::timestamptz+interval '30 minutes'<=statement_timestamp() AS no_show`)[0]!;
    // A fresh incompatible claim may establish a dispute. Matching claims must
    // use exact counterparty confirmation, never manufacture another outcome.
    const canClaim=row.state==='SCHEDULED'&&eligible&&(!o||o.state==='AWAITING_VALIDATION');
    const own=claims.filter(c=>c.schedule_version===row.schedule_version&&c.claimant_side===a.side);
    const noShowOutcome=a.side==='SEEKER'?'PROVIDER_NO_SHOW':'SEEKER_NO_SHOW';
    // Eligibility creation is historical event information. Consumption of
    // either direction must never disclose the counterparty's blind submission.
    const review=(await tx`SELECT b.interaction_id FROM viewing_review_boundaries b
      JOIN viewing_attendance_outcomes o ON o.id=b.attendance_outcome_id
      WHERE b.viewing_id=${row.id} AND b.eligibility_state='OPEN' AND o.state='COMPLETED'`)[0];
    await this.currentScope(tx,actor,a);
    return {viewing_id:row.id,schedule_version:row.schedule_version,version:row.version,state:o?.state??'NONE',
      outcome:o&&['COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW'].includes(o.state)?o.state as AttendanceOutcome:null,actor_side:a.side,
      can_claim_completion:canClaim&&!!timing.completed&&!own.some(c=>c.claimed_outcome==='COMPLETED')&&(!o||o.claimed_outcome!=='COMPLETED'),
      can_claim_no_show:canClaim&&!!timing.no_show&&!own.some(c=>c.claimed_outcome===noShowOutcome)&&(!o||o.claimed_outcome!==noShowOutcome),
      claims:claims.slice(0,limit).map(c=>this.claimProjection(c,a,row,o,eligible)),next_cursor:claims.length>limit?claims[limit-1]!.id:null,
      case:c?{...c,opened_at:instant(c.opened_at)!}:null,response_window_hours:48,review_eligibility_created:!!review};
  }
  async attendance(actorInput:OrganizationActor,idInput:string,input:{cursor?:string;limit?:number}={}):Promise<AttendanceRead> {
    const actor=actorNormalized(actorInput),id=validId(idInput),limit=input.limit??20;
    if(!Number.isSafeInteger(limit)||limit<1||limit>50||Object.keys(input).some(k=>!['cursor','limit'].includes(k)))fail('INVALID_INPUT');
    if(input.cursor)validId(input.cursor,'INVALID_INPUT');
    return this.client.begin(async tx=>{await tx`LOCK TABLE block_relationships IN SHARE MODE`;const {a,row}=await this.attendanceAuthorizedViewing(tx,actor,id);return this.attendanceProjection(tx,actor,a,row,input);});
  }
  private async attendanceCommand(actorInput:OrganizationActor,idInput:string,claimInput:string|null,operation:string,input:Record<string,unknown>,options:ViewingCommandOptions,
    work:(tx:Tx,actor:OrganizationActor,a:Authority,row:Row)=>Promise<Claim>):Promise<AttendanceCommandRead> {
    const actor=actorNormalized(actorInput),id=validId(idInput),claimId=claimInput===null?null:validId(claimInput),key=validId(options.idempotencyKey,'INVALID_INPUT');
    if(options.requestId!==undefined)validId(options.requestId,'INVALID_INPUT');
    const hash=createHash('sha256').update(JSON.stringify({operation,resource:id,claim_id:claimId,...input})).digest('hex');
    return this.client.begin(async tx=>{
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;
      await requireOrganizationResourceSession(tx,actor,false);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`viewing-command:${actor.userId}:${key}`},0))`;
      const prior=(await tx<{request_hash:string;viewing_id:string;attendance_claim_id:string|null}[]>`SELECT request_hash,viewing_id,attendance_claim_id FROM viewing_command_receipts WHERE actor_user_id=${actor.userId} AND idempotency_key=${key}`)[0];
      if(prior&&prior.request_hash!==hash)fail('IDEMPOTENCY_KEY_REUSED');
      const {a,row}=await this.attendanceAuthorizedViewing(tx,actor,id);
      let c:Claim;
      if(prior){if(prior.viewing_id!==id||!prior.attendance_claim_id)fail('RESOURCE_SCOPE_DENIED');c=await this.claim(tx,prior.attendance_claim_id,id);}
      else {
        if(row.schedule_version!==input.expected_schedule_version)fail('STALE_SCHEDULE_VERSION');
        if(row.version!==input.expected_version)fail('STALE_VERSION');
        c=await work(tx,actor,a,row);
        await this.currentScope(tx,actor,a);
        await tx`INSERT INTO viewing_command_receipts(actor_user_id,idempotency_key,request_hash,viewing_id,operation,attendance_claim_id)
          VALUES(${actor.userId},${key},${hash},${id},${operation},${c.id})`;
      }
      const current=await this.row(tx,id),attendance=await this.attendanceProjection(tx,actor,a,current);
      if(!prior&&operation!=='DISPUTE_ATTENDANCE'&&!(await this.attendanceEligible(tx,actor,a)))fail('CAPABILITY_RESTRICTED');
      await this.currentScope(tx,actor,a);
      return {viewing:await this.projection(tx,actor,a,current),attendance,claim:this.claimProjection(c,a,current,await this.outcome(tx,current),await this.attendanceEligible(tx,actor,a)),replayed:!!prior};
    });
  }
  async claimAttendance(actor:OrganizationActor,id:string,input:AttendanceClaimInput,options:ViewingCommandOptions):Promise<AttendanceCommandRead> {
    const parsed=claimSchema.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');
    return this.attendanceCommand(actor,id,null,'CLAIM_ATTENDANCE',parsed.data,options,async(tx,current,a,row)=>{
      if(row.state!=='SCHEDULED')fail('INVALID_STATE');
      if(!(await this.attendanceEligible(tx,current,a)))fail('CAPABILITY_RESTRICTED');
      const outcome:AttendanceOutcome=parsed.data.claim_type==='COMPLETION'?'COMPLETED':parsed.data.absent_side==='SEEKER'?'SEEKER_NO_SHOW':'PROVIDER_NO_SHOW';
      if(parsed.data.claim_type==='NO_SHOW'&&parsed.data.absent_side===a.side)fail('INVALID_INPUT');
      const timing=(await tx`SELECT 1 WHERE CASE ${parsed.data.claim_type} WHEN 'COMPLETION' THEN ${row.scheduled_end}::timestamptz<=statement_timestamp() ELSE ${row.scheduled_start}::timestamptz+interval '30 minutes'<=statement_timestamp() END`)[0];
      if(!timing)fail('CLAIM_TOO_EARLY');
      const prior=await this.outcome(tx,row);
      if(prior&&prior.state!=='AWAITING_VALIDATION')fail('INVALID_STATE');
      if(prior?.claimed_outcome===outcome||(await tx`SELECT id FROM viewing_attendance_claims WHERE viewing_id=${row.id} AND schedule_version=${row.schedule_version} AND claimant_side=${a.side} AND claimed_outcome=${outcome}`)[0])fail('ATTENDANCE_CLAIM_EXISTS');
      // Acquire relation/policy locks before recording notice availability. A
      // blocked insert must not begin a response window while still waiting.
      await this.eligible(tx,current,a);
      await tx`LOCK TABLE viewing_events,viewing_outbox,viewing_notices,audit_events,viewing_attendance_claims,viewing_attendance_outcomes,viewing_scheduled_actions IN ROW EXCLUSIVE MODE`;
      await this.currentScope(tx,current,a);
      const updated=(await tx<Row[]>`UPDATE viewings SET version=version+1,updated_at=statement_timestamp() WHERE id=${row.id} RETURNING *`)[0]!;
      await this.record(tx,updated,a,current,parsed.data.claim_type==='COMPLETION'?'viewing_completion_claimed':'viewing_no_show_claimed',row.state,options.requestId);
      const notice=(await tx<{id:string;available_at:Date}[]>`SELECT n.id,n.available_at FROM viewing_notices n JOIN viewing_outbox o ON o.id=n.source_outbox_id JOIN viewing_events e ON e.id=o.event_id
        WHERE e.viewing_id=${row.id} AND e.version=${updated.version} AND n.recipient_side<>${a.side}`)[0];
      if(!notice)fail('NOTICE_UNAVAILABLE');
      let c=(await tx<Claim[]>`INSERT INTO viewing_attendance_claims(viewing_id,schedule_version,claimant_user_id,claimant_side,membership_id,assignment_id,claim_type,claimed_outcome,counterparty_notice_id,notice_available_at,response_deadline)
        VALUES(${row.id},${row.schedule_version},${current.userId},${a.side},${a.organization?.membershipId??null},${a.organization?.assignmentId??null},${parsed.data.claim_type},${outcome},${notice.id},${notice.available_at},${notice.available_at}::timestamptz+interval '48 hours') RETURNING *`)[0]!;
      if(!prior) {
        await tx`INSERT INTO viewing_attendance_outcomes(viewing_id,schedule_version,claimed_outcome,primary_claim_id) VALUES(${row.id},${row.schedule_version},${outcome},${c.id})`;
        await tx`INSERT INTO viewing_scheduled_actions(viewing_id,action_type,attendance_claim_id,expected_schedule_version,due_at) VALUES(${row.id},'FINALIZE_ATTENDANCE',${c.id},${row.schedule_version},${c.response_deadline})`;
      } else {
        await this.dispute(tx,current,a,updated,prior,c,'COMPETING_CLAIMS',[],options.requestId);
        c=await this.claim(tx,c.id,row.id);
      }
      return c;
    });
  }
  async respondAttendance(actor:OrganizationActor,id:string,claimId:string,action:'confirm'|'dispute',input:AttendanceResponseInput,options:ViewingCommandOptions):Promise<AttendanceCommandRead> {
    if(!['confirm','dispute'].includes(action))fail('INVALID_INPUT');
    const parsed=(action==='confirm'?confirmSchema:disputeSchema).safeParse(input);if(!parsed.success)fail('INVALID_INPUT');
    return this.attendanceCommand(actor,id,claimId,action==='confirm'?'CONFIRM_ATTENDANCE':'DISPUTE_ATTENDANCE',parsed.data,options,async(tx,current,a,row)=>{
      const c=await this.claim(tx,validId(claimId),row.id);
      if(c.schedule_version!==row.schedule_version)fail('STALE_SCHEDULE_VERSION');
      if(c.version!==parsed.data.expected_claim_version)fail('STALE_CLAIM_VERSION');
      if(c.claimant_side===a.side||c.claimant_user_id===current.userId)fail('SELF_CONFIRMATION_DENIED');
      const o=await this.outcome(tx,row);
      if(!o||o.state==='DISPUTED'||c.state==='DISPUTED')fail('INVALID_STATE');
      if(action==='confirm') {
        if(c.state!=='PENDING'||o.state!=='AWAITING_VALIDATION'||row.state!=='SCHEDULED')fail('INVALID_STATE');
        if(!(await this.attendanceEligible(tx,current,a)))fail('CAPABILITY_RESTRICTED');
        await this.finalize(tx,row,o,c,'COUNTERPARTY_CONFIRMED',current,a,options.requestId);
      } else {
        if(!['SCHEDULED','COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW'].includes(row.state))fail('INVALID_STATE');
        const data=disputeSchema.parse(parsed.data),evidence=data.evidence??[];
        for(const item of evidence) {
          if(!(await tx`SELECT m.id FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE m.id=${item.reference} AND cv.interaction_id=${row.interaction_id}`)[0])fail('RESOURCE_SCOPE_DENIED');
        }
        await this.dispute(tx,current,a,row,o,c,data.reason,evidence,options.requestId);
      }
      return this.claim(tx,c.id,row.id);
    });
  }
  private async dispute(tx:Tx,actor:OrganizationActor,a:Authority,row:Row,o:Outcome,c:Claim,reason:string,evidence:{reference:string;kind:'MESSAGE'}[],requestId?:string) {
    const support=(await tx<{id:string}[]>`INSERT INTO viewing_attendance_cases(attendance_outcome_id,viewing_id,schedule_version) VALUES(${o.id},${row.id},${row.schedule_version}) RETURNING id`)[0]!;
    await tx`INSERT INTO viewing_attendance_reports(case_id,claim_id,reporter_user_id,reporter_side,reason_code,evidence_metadata)
      VALUES(${support.id},${c.id},${actor.userId},${a.side},${reason},${JSON.stringify(evidence)}::jsonb)`;
    await tx`UPDATE viewing_attendance_claims SET state='DISPUTED',version=version+1,
      responded_by_user_id=CASE WHEN responded_at IS NULL AND id=${c.id} THEN ${actor.userId}::uuid ELSE responded_by_user_id END,
      responded_by_side=CASE WHEN responded_at IS NULL AND id=${c.id} THEN ${a.side} ELSE responded_by_side END,
      responded_at=CASE WHEN responded_at IS NULL AND id=${c.id} THEN statement_timestamp() ELSE responded_at END
      WHERE viewing_id=${row.id} AND schedule_version=${row.schedule_version} AND state<>'DISPUTED'`;
    await tx`UPDATE viewing_attendance_outcomes SET state='DISPUTED',version=version+1,updated_at=statement_timestamp() WHERE id=${o.id}`;
    await tx`UPDATE viewing_review_eligibilities SET state='HELD' WHERE viewing_id=${row.id} AND state='OPEN'`;
    await tx`UPDATE viewing_no_show_events SET invalidated_at=statement_timestamp(),invalidation_case_id=${support.id} WHERE attendance_outcome_id=${o.id} AND invalidated_at IS NULL`;
    const updated=(await tx<Row[]>`UPDATE viewings SET state='DISPUTED',version=version+1,updated_at=statement_timestamp() WHERE id=${row.id} RETURNING *`)[0]!;
    await this.record(tx,updated,a,actor,'viewing_attendance_disputed',row.state,requestId);
    await this.closeAction(tx,row.id);
  }
  private async reviewBoundary(tx:Tx,row:Row,o:Outcome,context:Context) {
    // Retain only the seeker's relevant membership episodes. Immutable member
    // actions qualify state at Interaction creation; activation/revocation times
    // qualify older episodes when a current action is unavailable.
    const memberships=context.organization_id?await tx<{id:string;state:string;role:string;activated_at:Date|null;revoked_at:Date|null;interaction_state:string|null;at_interaction:boolean;at_completion:boolean;ambiguous:boolean}[]>`
      SELECT m.id,m.state,m.role,m.activated_at,m.revoked_at,history.after_state AS interaction_state,
        CASE WHEN history.after_state IS NOT NULL THEN history.after_state IN ('ACTIVE','SUSPENDED')
          ELSE m.activated_at<=i.created_at AND (m.revoked_at IS NULL OR m.revoked_at>i.created_at) END AS at_interaction,
        m.state IN ('ACTIVE','SUSPENDED') AS at_completion,
        history.after_state IS NULL AND m.activated_at IS NULL AND m.state='REVOKED' AND m.created_at<=i.created_at AS ambiguous
      FROM organization_memberships m JOIN interactions i ON i.id=${row.interaction_id}
      LEFT JOIN LATERAL(SELECT safe_metadata->>'after_state' AS after_state FROM organization_actions
        WHERE membership_id=m.id AND created_at<=i.created_at ORDER BY created_at DESC,id DESC LIMIT 1) history ON true
      WHERE m.organization_id=${context.organization_id} AND m.user_id=${row.seeker_user_id} ORDER BY m.created_at,m.id`:[];
    const snapshot=memberships.map(m=>({membership_id:m.id,state:m.state,role:m.role,activated_at:instant(m.activated_at),revoked_at:instant(m.revoked_at),interaction_state:m.interaction_state,
      at_interaction:!!m.at_interaction,at_completion:m.at_completion,evidence_incomplete:m.ambiguous}));
    const ownOrganization=memberships.some(m=>m.at_interaction||m.at_completion),incomplete=memberships.some(m=>m.ambiguous);
    const held=ownOrganization||incomplete;
    const b=(await tx<{interaction_id:string}[]>`INSERT INTO viewing_review_boundaries(interaction_id,attendance_outcome_id,viewing_id,seeker_user_id,provider_account_id,organization_id,membership_snapshot,eligibility_state,eligibility_reason,opened_at,policy_version)
      VALUES(${row.interaction_id},${o.id},${row.id},${row.seeker_user_id},${row.provider_account_id},${context.organization_id},${JSON.stringify(snapshot)}::jsonb,${held?'HELD':'OPEN'},${ownOrganization?'OWN_ORGANIZATION':incomplete?'MEMBERSHIP_EVIDENCE_INCOMPLETE':'FIRST_VALIDATED_COMPLETION'},(SELECT finalized_at FROM viewing_attendance_outcomes WHERE id=${o.id}),'bilateral-review-v2') ON CONFLICT DO NOTHING RETURNING interaction_id`)[0];
    if(!b||held)return;
    await tx`INSERT INTO viewing_review_eligibilities(interaction_id,viewing_id,direction,reviewer_subject_type,reviewer_subject_id,target_type,target_id,opens_at,closes_at,policy_version)
      SELECT b.interaction_id,b.viewing_id,s.direction,s.reviewer_type,
        CASE WHEN s.direction='SEEKER_TO_PROVIDER' THEN b.seeker_user_id ELSE b.provider_account_id END,s.target_type,
        CASE WHEN s.direction='SEEKER_TO_PROVIDER' THEN b.provider_account_id ELSE b.seeker_user_id END,
        b.opened_at,((b.opened_at AT TIME ZONE 'UTC')+interval '7 days') AT TIME ZONE 'UTC',b.policy_version
      FROM viewing_review_boundaries b CROSS JOIN(VALUES('SEEKER_TO_PROVIDER','User','ProviderAccount'),('PROVIDER_TO_SEEKER','ProviderAccount','User')) s(direction,reviewer_type,target_type)
      WHERE b.interaction_id=${b.interaction_id} ON CONFLICT DO NOTHING`;
  }
  private async finalize(tx:Tx,row:Row,o:Outcome,c:Claim,method:'COUNTERPARTY_CONFIRMED'|'UNCONTESTED_WINDOW',actor:OrganizationActor|null,a:Authority|null,requestId?:string) {
    const context=a?.context??await this.context(tx,row.interaction_id);
    const confirmed=method==='COUNTERPARTY_CONFIRMED';
    if(!(await this.attendanceContextEligible(tx,context,actor?.userId??context.seeker_user_id)))fail('CAPABILITY_RESTRICTED');
    if(!confirmed&&!(await this.claimantCurrent(tx,c,context)))fail('CAPABILITY_RESTRICTED');
    const updatedClaim=(await tx<Claim[]>`UPDATE viewing_attendance_claims SET state=${confirmed?'CONFIRMED':'FINALIZED'},version=version+1,finalized_at=statement_timestamp(),
      responded_by_user_id=${actor?.userId??null},responded_by_side=${a?.side??null},responded_at=${confirmed?tx`statement_timestamp()`:tx`NULL`}
      WHERE id=${c.id} AND state='PENDING' AND (${confirmed} OR response_deadline<=statement_timestamp()) RETURNING *`)[0];
    if(!updatedClaim)fail('CLAIM_TOO_EARLY');
    await tx`UPDATE viewing_attendance_outcomes SET state=claimed_outcome,version=version+1,finalized_at=statement_timestamp(),validation_method=${method},updated_at=statement_timestamp() WHERE id=${o.id}`;
    const updated=(await tx<Row[]>`UPDATE viewings SET state=${c.claimed_outcome},version=version+1,updated_at=statement_timestamp() WHERE id=${row.id} AND state='SCHEDULED' AND schedule_version=${c.schedule_version} RETURNING *`)[0];
    if(!updated)fail('STALE_SCHEDULE_VERSION');
    await this.record(tx,updated,a,actor,confirmed?'viewing_attendance_confirmed':'viewing_attendance_finalized',row.state,requestId);
    if(c.claimed_outcome==='COMPLETED')await this.reviewBoundary(tx,row,o,context);
    else await tx`INSERT INTO viewing_no_show_events(attendance_outcome_id,viewing_id,schedule_version,responsible_side,validation_method)
      VALUES(${o.id},${row.id},${row.schedule_version},${c.claimed_outcome==='SEEKER_NO_SHOW'?'SEEKER':'PROVIDER'},${method}) ON CONFLICT DO NOTHING`;
    await tx`UPDATE viewing_scheduled_actions SET state='PROCESSED',reason_code=NULL,lease_token=NULL,lease_until=NULL,processed_at=statement_timestamp(),last_checked_at=statement_timestamp() WHERE attendance_claim_id=${c.id}`;
    // Fresh post-effect evaluation closes lock-wait time-of-check gaps.
    if(!(await this.attendanceContextEligible(tx,context,actor?.userId??context.seeker_user_id)))fail('CAPABILITY_RESTRICTED');
    if(!confirmed&&!(await this.claimantCurrent(tx,c,context)))fail('CAPABILITY_RESTRICTED');
  }
  private async claimantCurrent(tx:Tx,c:Claim,context:Context):Promise<boolean> {
    if(!(await this.participantEligible(tx,c.claimant_user_id)))return false;
    if(c.claimant_side==='SEEKER')return c.claimant_user_id===context.seeker_user_id;
    if(context.kind==='INDIVIDUAL')return c.claimant_user_id===context.provider_user_id;
    // Background work has no old session grant: require a current member and
    // exact assignment/delegation for the provider claim, at database time.
    return !!(await tx`SELECT m.id FROM organization_memberships m JOIN organizations org ON org.id=m.organization_id JOIN provider_accounts pa ON pa.organization_id=org.id
      WHERE m.id=${c.membership_id} AND m.user_id=${c.claimant_user_id} AND m.state='ACTIVE' AND org.id=${context.organization_id} AND org.state='ACTIVE'
      AND org.onboarding_completed_at IS NOT NULL AND pa.id=${context.provider_account_id} AND pa.state='ACTIVE'
      AND (m.role IN ('OWNER','ADMIN') OR (m.role IN ('AGENT','LISTING_MANAGER') AND EXISTS(SELECT 1 FROM organization_resource_assignments s
        WHERE s.membership_id=m.id AND s.provider_account_id=pa.id AND s.resource_type='INTERACTION' AND s.resource_id=${context.id}
          AND s.revoked_at IS NULL AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp()))))`)[0];
  }
  async attendanceOnce(limit=50):Promise<{processed:number;skipped:number;pending:number}> {
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_INPUT');
    const token=randomUUID();
    const jobs=await this.client.begin(async tx=>tx<{id:string;viewing_id:string}[]>`UPDATE viewing_scheduled_actions SET state='LEASED',lease_token=${token},lease_until=statement_timestamp()+interval '1 minute',attempts=attempts+1
      WHERE id IN(SELECT id FROM viewing_scheduled_actions WHERE action_type='FINALIZE_ATTENDANCE' AND due_at<=statement_timestamp()
        AND (state='PENDING' OR (state='LEASED' AND lease_until<=statement_timestamp())) ORDER BY last_checked_at NULLS FIRST,due_at,id LIMIT ${limit} FOR UPDATE SKIP LOCKED) RETURNING id,viewing_id`);
    let processed=0,skipped=0,pending=0;
    for(const job of jobs) {
      let result:string;
      try { result=await this.client.begin(async tx=>{
        const current=await this.maintenanceViewing(tx,job.viewing_id);
        const action=(await tx<{attendance_claim_id:string;expected_schedule_version:number}[]>`SELECT attendance_claim_id,expected_schedule_version FROM viewing_scheduled_actions WHERE id=${job.id} AND state='LEASED' AND lease_token=${token} FOR UPDATE`)[0];
        if(!action)return 'busy';
        const release=async()=>{await tx`UPDATE viewing_scheduled_actions SET state='PENDING',lease_token=NULL,lease_until=NULL,last_checked_at=statement_timestamp() WHERE id=${job.id}`;return 'pending';};
        const skip=async(reason:string)=>{await tx`UPDATE viewing_scheduled_actions SET state='SKIPPED',reason_code=${reason},lease_token=NULL,lease_until=NULL,processed_at=statement_timestamp(),last_checked_at=statement_timestamp() WHERE id=${job.id}`;return 'skipped';};
        if(!current)return release();
        const {row,context}=current,c=await this.claim(tx,action.attendance_claim_id,row.id),o=await this.outcome(tx,row);
        if(row.state!=='SCHEDULED'||row.schedule_version!==action.expected_schedule_version||c.schedule_version!==row.schedule_version)return skip('OBSOLETE_OR_FINALIZED');
        if(!o||o.state!=='AWAITING_VALIDATION'||c.state!=='PENDING')return skip('CONTESTED_OR_FINALIZED');
        // Restrictions freeze processing, preserving the original response window.
        if(!(await this.attendanceContextEligible(tx,context))||!(await this.claimantCurrent(tx,c,context)))return release();
        if(!(await tx`SELECT 1 WHERE ${c.response_deadline}::timestamptz<=statement_timestamp()`)[0]) {
          await tx`UPDATE viewing_scheduled_actions SET due_at=${c.response_deadline} WHERE id=${job.id}`;return release();
        }
        await this.finalize(tx,row,o,c,'UNCONTESTED_WINDOW',null,null);return 'processed';
      }); } catch(error) {
        if(!(error instanceof IdentityError)||!['RESOURCE_SCOPE_DENIED','CAPABILITY_RESTRICTED'].includes(error.code))throw error;
        // Expected safety/context loss rolls back all effects before releasing
        // the lease. Unknown database failures retain leased crash evidence.
        result=await this.client.begin(async tx=>{
          const held=(await tx`SELECT id FROM viewings WHERE id=${job.viewing_id} FOR UPDATE SKIP LOCKED`)[0];
          const state=held&&error.code==='RESOURCE_SCOPE_DENIED'?'SKIPPED':'PENDING';
          await tx`UPDATE viewing_scheduled_actions SET state=${state},reason_code=${state==='SKIPPED'?'CONTEXT_CHANGED':null},lease_token=NULL,lease_until=NULL,
            processed_at=${state==='SKIPPED'?tx`statement_timestamp()`:tx`NULL`},last_checked_at=statement_timestamp()
            WHERE id=${job.id} AND state='LEASED' AND lease_token=${token}`;
          return state==='SKIPPED'?'skipped':'pending';
        });
      }
      if(result==='processed')processed++;if(result==='skipped')skipped++;if(result==='pending')pending++;
    }
    return {processed,skipped,pending};
  }
}
