import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ViewingStore, actorNormalized, fail, instant, validId, type Authority, type Row, type Tx, type ViewingCommandOptions, type ViewingVersionInput } from './viewing.js';
import { requireOrganizationResourceSession } from './organization-resource-actor.js';
import { lockListingRegion } from './region-publication.js';
import { IdentityError } from './identity.js';
import type { OrganizationActor } from './organization-lifecycle.js';

type Proposal = {
  id:string;viewing_id:string;base_schedule_version:number;base_scheduled_start:Date;
  proposed_start:Date;proposed_end:Date;display_timezone:string;proposed_by_user_id:string;proposed_by_side:'SEEKER'|'PROVIDER';
  state:'PENDING'|'FINALIZED'|'REJECTED'|'WITHDRAWN'|'EXPIRED'|'INVALIDATED';version:number;
  seeker_approved:boolean;provider_approved:boolean;finalized_schedule_version:number|null;expires_at:Date;created_at:Date;updated_at:Date;
};
export type ViewingRescheduleInput = ViewingVersionInput & {proposed_start:string;proposed_end:string};
export type ViewingProposalInput = ViewingVersionInput & {expected_proposal_version:number};
const versions={expected_version:z.number().int().positive(),expected_schedule_version:z.number().int().positive()};
const proposeSchema=z.object({...versions,proposed_start:z.iso.datetime({offset:true}),proposed_end:z.iso.datetime({offset:true})}).strict();
const proposalSchema=z.object({...versions,expected_proposal_version:z.number().int().positive()}).strict();
type Notice = {id:string;viewing_id:string;recipient_side:'SEEKER'|'PROVIDER';event_type:string;schedule_version:number;event_at:Date;available_at:Date;inbox_state:'AVAILABLE';external_state:'NOT_ENABLED';read_at:Date|null;moderation_command:'HOLD'|'HIDE'|'REMOVE'|'RESTORE'|null;moderation_reason_code:string|null;moderation_recipient_user_id:string|null;appeal_deadline:Date|null};
function page(input:{cursor?:string;limit?:number}) {
  const limit=input.limit??20;
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)fail('INVALID_INPUT');
  if(input.cursor)validId(input.cursor,'INVALID_INPUT');return limit;
}
function matches(row:Row,a:Authority) {
  if(row.interaction_id!==a.context.id || row.provider_account_id!==a.context.provider_account_id || row.listing_id!==a.context.listing_id || row.seeker_user_id!==a.context.seeker_user_id)fail('RESOURCE_SCOPE_DENIED');
}

/** Same current authority and lock order as F1; notices cannot confer authority. */
export class ViewingAppointmentStore extends ViewingStore {
  protected override async record(tx:Tx,row:Row,a:Authority|null,actor:OrganizationActor|null,event:string,prior:string|null,requestId?:string) {
    await super.record(tx,row,a,actor,event,prior,requestId);
    if(event==='viewing_scheduled'||event==='viewing_reschedule_finalized')await this.planReminders(tx,row,true);
  }
  protected override async closeAction(tx:Tx,id:string) {
    await super.closeAction(tx,id);
    await tx`UPDATE viewing_reschedule_proposals SET state='INVALIDATED',version=version+1,updated_at=statement_timestamp() WHERE viewing_id=${id} AND state='PENDING'`;
  }
  protected async authorizedViewing(tx:Tx,actor:OrganizationActor,id:string) {
    const seed=(await tx<{interaction_id:string}[]>`SELECT interaction_id FROM viewings WHERE id=${id}`)[0];if(!seed)fail('RESOURCE_SCOPE_DENIED');
    const a=await this.authorize(tx,actor,seed.interaction_id),row=await this.row(tx,id);matches(row,a);
    await this.currentScope(tx,actor,a);return {a,row};
  }
  private async proposal(tx:Tx,id:string,viewingId:string) {
    const p=(await tx<Proposal[]>`SELECT * FROM viewing_reschedule_proposals WHERE id=${id} AND viewing_id=${viewingId} FOR UPDATE`)[0];
    if(!p)fail('RESOURCE_SCOPE_DENIED');return p;
  }
  private async proposalProjection(tx:Tx,actor:OrganizationActor,a:Authority,row:Row,p:Proposal) {
    await this.currentScope(tx,actor,a);
    const eligible=await this.eligible(tx,actor,a);
    const valid=(await tx`SELECT 1 WHERE ${p.expires_at}::timestamptz>statement_timestamp() AND ${row.scheduled_start}::timestamptz>statement_timestamp()`)[0];
    const current=p.state==='PENDING'&&row.state==='SCHEDULED'&&p.base_schedule_version===row.schedule_version&&!!valid;
    const own=a.side==='SEEKER'?p.seeker_approved:p.provider_approved;
    await this.currentScope(tx,actor,a);
    return {id:p.id,viewing_id:p.viewing_id,base_schedule_version:p.base_schedule_version,proposed_start:instant(p.proposed_start)!,proposed_end:instant(p.proposed_end)!,
      display_timezone:p.display_timezone,proposed_by_user_id:p.proposed_by_user_id,proposed_by_side:p.proposed_by_side,state:p.state,version:p.version,
      seeker_approved:p.seeker_approved,provider_approved:p.provider_approved,finalized_schedule_version:p.finalized_schedule_version,
      expires_at:instant(p.expires_at)!,created_at:instant(p.created_at)!,updated_at:instant(p.updated_at)!,actor_side:a.side,
      can_accept:current&&eligible&&!own,can_reject:current&&a.side!==p.proposed_by_side,can_withdraw:current&&actor.userId===p.proposed_by_user_id};
  }
  private async rescheduleCommand(actorInput:OrganizationActor,idInput:string,pInput:string|null,operation:string,input:Record<string,unknown>,options:ViewingCommandOptions,
    work:(tx:Tx,actor:OrganizationActor,a:Authority,row:Row)=>Promise<Proposal>) {
    const actor=actorNormalized(actorInput),id=validId(idInput),proposalId=pInput===null?null:validId(pInput),key=validId(options.idempotencyKey,'INVALID_INPUT');
    if(options.requestId!==undefined)validId(options.requestId,'INVALID_INPUT');
    const hash=createHash('sha256').update(JSON.stringify({operation,resource:id,proposal_id:proposalId,...input})).digest('hex');
    return this.client.begin(async tx=>{
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;
      await requireOrganizationResourceSession(tx,actor,false);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`viewing-command:${actor.userId}:${key}`},0))`;
      const prior=(await tx<{request_hash:string;viewing_id:string;proposal_id:string|null}[]>`SELECT request_hash,viewing_id,proposal_id FROM viewing_command_receipts WHERE actor_user_id=${actor.userId} AND idempotency_key=${key}`)[0];
      if(prior&&prior.request_hash!==hash)fail('IDEMPOTENCY_KEY_REUSED');
      const {a,row}=await this.authorizedViewing(tx,actor,id);
      if(prior) {
        if(prior.viewing_id!==id||!prior.proposal_id)fail('RESOURCE_SCOPE_DENIED');
        const p=await this.proposal(tx,prior.proposal_id,id);
        return {viewing:await this.projection(tx,actor,a,row),proposal:await this.proposalProjection(tx,actor,a,row,p),replayed:true};
      }
      if(row.schedule_version!==input.expected_schedule_version)fail('STALE_SCHEDULE_VERSION');
      if(row.version!==input.expected_version)fail('STALE_VERSION');
      const p=await work(tx,actor,a,row);
      await this.currentScope(tx,actor,a);
      await tx`INSERT INTO viewing_command_receipts(actor_user_id,idempotency_key,request_hash,viewing_id,operation,proposal_id) VALUES(${actor.userId},${key},${hash},${id},${operation},${p.id})`;
      const current=await this.row(tx,id);
      const viewing=await this.projection(tx,actor,a,current),proposal=await this.proposalProjection(tx,actor,a,current,p);
      if(operation==='PROPOSE_RESCHEDULE'||operation==='ACCEPT_RESCHEDULE') {
        if(!(await this.eligible(tx,actor,a)))fail('CAPABILITY_RESTRICTED');
        if(!(await tx`SELECT 1 WHERE ${p.expires_at}::timestamptz>statement_timestamp() AND ${current.scheduled_start}::timestamptz>statement_timestamp()`)[0])fail('PROPOSAL_EXPIRED');
      }
      await this.currentScope(tx,actor,a);
      return {viewing,proposal,replayed:false};
    });
  }
  async proposeReschedule(actor:OrganizationActor,id:string,input:ViewingRescheduleInput,options:ViewingCommandOptions) {
    const parsed=proposeSchema.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');
    const data={...parsed.data,proposed_start:instant(parsed.data.proposed_start)!,proposed_end:instant(parsed.data.proposed_end)!};
    if(data.proposed_end<=data.proposed_start)fail('INVALID_INPUT');
    return this.rescheduleCommand(actor,id,null,'PROPOSE_RESCHEDULE',data,options,async(tx,current,a,row)=>{
      if(row.state!=='SCHEDULED')fail('INVALID_STATE');
      if((await tx`SELECT id FROM viewing_attendance_claims WHERE viewing_id=${row.id} AND schedule_version=${row.schedule_version} LIMIT 1`)[0])fail('ATTENDANCE_PENDING');
      if(!(await this.eligible(tx,current,a)))fail('CAPABILITY_RESTRICTED');
      if(data.proposed_start===instant(row.scheduled_start)&&data.proposed_end===instant(row.scheduled_end))fail('INVALID_INPUT');
      if((await tx`SELECT id FROM viewing_reschedule_proposals WHERE viewing_id=${row.id} AND state='PENDING' LIMIT 1`)[0])fail('PENDING_PROPOSAL_EXISTS');
      const p=(await tx<Proposal[]>`INSERT INTO viewing_reschedule_proposals(viewing_id,base_schedule_version,base_scheduled_start,proposed_start,proposed_end,display_timezone,proposed_by_user_id,proposed_by_side,membership_id,assignment_id,expires_at)
        SELECT ${row.id},${row.schedule_version},${row.scheduled_start},${data.proposed_start},${data.proposed_end},${row.display_timezone},${current.userId},${a.side},${a.organization?.membershipId??null},${a.organization?.assignmentId??null},
          LEAST(statement_timestamp()+interval '48 hours',${row.scheduled_start}::timestamptz,${data.proposed_start}::timestamptz)
        WHERE ${row.scheduled_start}::timestamptz>statement_timestamp() AND ${data.proposed_start}::timestamptz>statement_timestamp() RETURNING *`)[0];
      if(!p)fail('APPOINTMENT_PAST');
      await tx`INSERT INTO viewing_scheduled_actions(viewing_id,proposal_id,action_type,expected_schedule_version,due_at) VALUES(${row.id},${p.id},'EXPIRE_RESCHEDULE',${row.schedule_version},${p.expires_at})`;
      const updated=(await tx<Row[]>`UPDATE viewings SET version=version+1,updated_at=statement_timestamp() WHERE id=${row.id} RETURNING *`)[0]!;
      await this.record(tx,updated,a,current,'viewing_reschedule_proposed',row.state,options.requestId);return p;
    });
  }
  async respondReschedule(actor:OrganizationActor,id:string,proposalId:string,action:'accept'|'reject'|'withdraw',input:ViewingProposalInput,options:ViewingCommandOptions) {
    const parsed=proposalSchema.safeParse(input);if(!parsed.success||!['accept','reject','withdraw'].includes(action))fail('INVALID_INPUT');
    return this.rescheduleCommand(actor,id,proposalId,`${action.toUpperCase()}_RESCHEDULE`,parsed.data,options,async(tx,current,a,row)=>{
      const p=await this.proposal(tx,validId(proposalId),row.id);
      await this.currentScope(tx,current,a);
      if(p.version!==parsed.data.expected_proposal_version)fail('STALE_PROPOSAL_VERSION');
      if(p.base_schedule_version!==row.schedule_version)fail('STALE_SCHEDULE_VERSION');
      if((await tx`SELECT id FROM viewing_attendance_claims WHERE viewing_id=${row.id} AND schedule_version=${row.schedule_version} LIMIT 1`)[0])fail('ATTENDANCE_PENDING');
      if(p.state!=='PENDING'||row.state!=='SCHEDULED')fail('INVALID_STATE');
      if(action==='withdraw'&&p.proposed_by_user_id!==current.userId)fail('RESOURCE_SCOPE_DENIED');
      if(action==='reject'&&p.proposed_by_side===a.side)fail('RESOURCE_SCOPE_DENIED');
      if(action==='accept'&&!(await this.eligible(tx,current,a)))fail('CAPABILITY_RESTRICTED');
      if(action==='accept'&&(a.side==='SEEKER'?p.seeker_approved:p.provider_approved))fail('INVALID_STATE');
      const seeker=p.seeker_approved||(action==='accept'&&a.side==='SEEKER'),provider=p.provider_approved||(action==='accept'&&a.side==='PROVIDER');
      const finalized=action==='accept'&&seeker&&provider;
      const updated=(await tx<Proposal[]>`UPDATE viewing_reschedule_proposals SET state=${finalized?'FINALIZED':action==='reject'?'REJECTED':action==='withdraw'?'WITHDRAWN':'PENDING'},
        seeker_approved=${seeker},provider_approved=${provider},finalized_schedule_version=${finalized?row.schedule_version+1:null},version=version+1,updated_at=statement_timestamp()
        WHERE id=${p.id} AND expires_at>statement_timestamp() AND base_scheduled_start>statement_timestamp() AND proposed_start>statement_timestamp() RETURNING *`)[0];
      if(!updated)fail('PROPOSAL_EXPIRED');
      const event=action==='accept'?'viewing_reschedule_accepted':action==='reject'?'viewing_reschedule_rejected':'viewing_reschedule_withdrawn';
      const versioned=(await tx<Row[]>`UPDATE viewings SET version=version+1,updated_at=statement_timestamp() WHERE id=${row.id} RETURNING *`)[0]!;
      await this.record(tx,versioned,a,current,event,row.state,options.requestId);
      if(finalized) {
        await tx`INSERT INTO viewing_schedule_history(viewing_id,schedule_version,scheduled_start,scheduled_end,display_timezone,superseded_by_proposal_id) VALUES(${row.id},${row.schedule_version},${row.scheduled_start},${row.scheduled_end},${row.display_timezone},${p.id})`;
        const replaced=(await tx<Row[]>`UPDATE viewings SET state='RESCHEDULED',schedule_version=schedule_version+1,scheduled_start=${p.proposed_start},scheduled_end=${p.proposed_end},version=version+1,updated_at=statement_timestamp() WHERE id=${row.id} RETURNING *`)[0]!;
        await this.record(tx,replaced,a,current,'viewing_rescheduled','SCHEDULED',options.requestId);
        await tx`UPDATE viewing_scheduled_actions SET state='SKIPPED',reason_code='OBSOLETE_SCHEDULE',lease_token=NULL,lease_until=NULL,processed_at=statement_timestamp()
          WHERE viewing_id=${row.id} AND expected_schedule_version=${row.schedule_version} AND state IN ('PENDING','LEASED')`;
        const scheduled=(await tx<Row[]>`UPDATE viewings SET state='SCHEDULED',version=version+1,updated_at=statement_timestamp() WHERE id=${row.id} RETURNING *`)[0]!;
        await this.record(tx,scheduled,a,current,'viewing_reschedule_finalized','RESCHEDULED',options.requestId);
      } else if(action!=='accept') {
        await tx`UPDATE viewing_scheduled_actions SET state='SKIPPED',reason_code='PROPOSAL_CLOSED',lease_token=NULL,lease_until=NULL,processed_at=statement_timestamp() WHERE proposal_id=${p.id} AND state IN ('PENDING','LEASED')`;
      }
      return updated;
    });
  }
  async listReschedules(actorInput:OrganizationActor,idInput:string,input:{cursor?:string;limit?:number}={}) {
    const actor=actorNormalized(actorInput),id=validId(idInput),limit=page(input);
    if(Object.keys(input).some(k=>!['cursor','limit'].includes(k)))fail('INVALID_INPUT');
    return this.client.begin(async tx=>{
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;
      const {a,row}=await this.authorizedViewing(tx,actor,id);
      const proposals=await tx<Proposal[]>`SELECT * FROM viewing_reschedule_proposals WHERE viewing_id=${id} ${input.cursor?tx`AND id<${input.cursor}`:tx``} ORDER BY id DESC LIMIT ${limit+1}`;
      const items=[];for(const p of proposals.slice(0,limit))items.push(await this.proposalProjection(tx,actor,a,row,p));
      const pending=(await tx<Proposal[]>`SELECT * FROM viewing_reschedule_proposals WHERE viewing_id=${id} AND state='PENDING' LIMIT 1`)[0];
      const current_proposal=pending?await this.proposalProjection(tx,actor,a,row,pending):null;
      const future=(await tx`SELECT 1 WHERE ${row.scheduled_start}::timestamptz>statement_timestamp()`)[0];
      const can_propose=row.state==='SCHEDULED'&&!!future&&!pending&&!(await tx`SELECT id FROM viewing_attendance_claims WHERE viewing_id=${row.id} AND schedule_version=${row.schedule_version} LIMIT 1`)[0]&&await this.eligible(tx,actor,a);
      await this.currentScope(tx,actor,a);
      const history=await tx<{schedule_version:number;scheduled_start:Date;scheduled_end:Date;display_timezone:string;superseded_at:Date}[]>`SELECT schedule_version,scheduled_start,scheduled_end,display_timezone,superseded_at FROM viewing_schedule_history WHERE viewing_id=${id} ORDER BY schedule_version DESC LIMIT 50`;
      return {items,current_proposal,next_cursor:proposals.length>limit?proposals[limit-1]!.id:null,can_propose,schedule_history:history.map(h=>({...h,scheduled_start:instant(h.scheduled_start)!,scheduled_end:instant(h.scheduled_end)!,superseded_at:instant(h.superseded_at)!}))};
    });
  }
  private async planReminders(tx:Tx,row:Row,eligible:boolean) {
    const inserted=(await tx`INSERT INTO viewing_reminder_plans(viewing_id,schedule_version,status) VALUES(${row.id},${row.schedule_version},${eligible?'PLANNED':'SUPPRESSED'}) ON CONFLICT DO NOTHING RETURNING viewing_id`)[0];
    if(!inserted||!eligible)return;
    await tx`INSERT INTO viewing_scheduled_actions(viewing_id,action_type,expected_schedule_version,due_at)
      SELECT ${row.id},s.kind,${row.schedule_version},${row.scheduled_start}::timestamptz-s.lead_time
      FROM (VALUES ('REMINDER_24H',interval '24 hours'),('REMINDER_2H',interval '2 hours')) s(kind,lead_time)
      WHERE ${row.scheduled_start}::timestamptz-s.lead_time>statement_timestamp() ON CONFLICT DO NOTHING`;
  }
  async reminderStatus(actorInput:OrganizationActor,idInput:string) {
    const actor=actorNormalized(actorInput),id=validId(idInput);
    return this.client.begin(async tx=>{
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;
      const {a,row}=await this.authorizedViewing(tx,actor,id);
      const plans=await tx<{schedule_version:number;status:'PLANNED'|'SUPPRESSED';planned_at:Date}[]>`SELECT * FROM viewing_reminder_plans WHERE viewing_id=${id} AND schedule_version=${row.schedule_version}`;
      const jobs=await tx<{id:string;action_type:'REMINDER_24H'|'REMINDER_2H';expected_schedule_version:number;due_at:Date;state:'PENDING'|'LEASED'|'PROCESSED'|'SKIPPED';reason_code:string|null}[]>`SELECT id,action_type,expected_schedule_version,due_at,state,reason_code FROM viewing_scheduled_actions WHERE viewing_id=${id} AND action_type IN ('REMINDER_24H','REMINDER_2H') ORDER BY expected_schedule_version DESC,due_at DESC LIMIT 50`;
      await this.currentScope(tx,actor,a);
      return {schedule_version:row.schedule_version,plan_status:plans[0]?.status??'NOT_PREPARED',planned_at:plans[0]?instant(plans[0].planned_at):null,
        items:jobs.map(j=>({...j,due_at:instant(j.due_at)!})),external_state:'NOT_ENABLED' as const};
    });
  }
  private async noticeForActor(tx:Tx,actor:OrganizationActor,id:string,markRead=false) {
    const n=(await tx<Notice[]>`SELECT n.*,a.command AS moderation_command,r.read_at FROM viewing_notices n LEFT JOIN review_moderation_actions a ON a.id=n.source_review_moderation_action_id LEFT JOIN viewing_notice_reads r ON r.notice_id=n.id AND r.user_id=${actor.userId} WHERE n.id=${id}`)[0];
    if(!n||n.moderation_recipient_user_id&&n.moderation_recipient_user_id!==actor.userId)fail('RESOURCE_SCOPE_DENIED');
    const {a}=await this.authorizedViewing(tx,actor,n.viewing_id);
    if(a.side!==n.recipient_side)fail('RESOURCE_SCOPE_DENIED');
    if(markRead) {
      const r=(await tx<{read_at:Date}[]>`INSERT INTO viewing_notice_reads(notice_id,user_id) VALUES(${id},${actor.userId}) ON CONFLICT DO NOTHING RETURNING read_at`)[0];
      n.read_at=r?.read_at??(await tx<{read_at:Date}[]>`SELECT read_at FROM viewing_notice_reads WHERE notice_id=${id} AND user_id=${actor.userId}`)[0]!.read_at;
    }
    await this.currentScope(tx,actor,a);
    return {id:n.id,viewing_id:n.viewing_id,recipient_side:n.recipient_side,event_type:n.event_type,schedule_version:n.schedule_version,
      event_at:instant(n.event_at)!,available_at:instant(n.available_at)!,inbox_state:n.inbox_state,external_state:n.external_state,read_at:instant(n.read_at),...(n.moderation_reason_code?{moderation_reason_code:n.moderation_reason_code,moderation_command:n.moderation_command!,appeal_deadline:instant(n.appeal_deadline)!}:{})};
  }
  async readNotice(actorInput:OrganizationActor,idInput:string) {
    const actor=actorNormalized(actorInput),id=validId(idInput);
    return this.client.begin(async tx=>{await tx`LOCK TABLE block_relationships IN SHARE MODE`;return this.noticeForActor(tx,actor,id,true);});
  }
  async listNotices(actorInput:OrganizationActor,input:{viewing_id?:string;cursor?:string;limit?:number}={}) {
    const actor=actorNormalized(actorInput),limit=page(input);
    if(Object.keys(input).some(k=>!['viewing_id','cursor','limit'].includes(k)))fail('INVALID_INPUT');
    if(input.viewing_id)validId(input.viewing_id,'INVALID_INPUT');
    const ids=await this.client.begin(async tx=>{
      await requireOrganizationResourceSession(tx,actor,false);
      if(input.viewing_id){await tx`LOCK TABLE block_relationships IN SHARE MODE`;await this.authorizedViewing(tx,actor,input.viewing_id.toLowerCase());}
      return tx<{id:string}[]>`SELECT n.id FROM viewing_notices n JOIN viewings v ON v.id=n.viewing_id JOIN interactions i ON i.id=v.interaction_id
        JOIN listings l ON l.id=i.listing_id JOIN provider_accounts pa ON pa.id=i.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
        WHERE (n.moderation_recipient_user_id IS NULL OR n.moderation_recipient_user_id=${actor.userId}) AND v.provider_account_id=i.provider_account_id AND v.listing_id=i.listing_id AND v.seeker_user_id=i.seeker_user_id AND l.provider_account_id=i.provider_account_id
          AND ((n.recipient_side='SEEKER' AND n.seeker_user_id=i.seeker_user_id AND i.seeker_user_id=${actor.userId}) OR
            (n.recipient_side='PROVIDER' AND n.provider_account_id=i.provider_account_id AND ((pa.kind='INDIVIDUAL' AND pp.user_id=${actor.userId}) OR
              (pa.kind='ORGANIZATION' AND pa.state='ACTIVE' AND EXISTS(SELECT 1 FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id
                WHERE o.id=pa.organization_id AND o.state='ACTIVE' AND o.onboarding_completed_at IS NOT NULL AND m.state='ACTIVE' AND m.user_id=${actor.userId}
                  AND (m.role IN ('OWNER','ADMIN') OR (m.role IN ('LISTING_MANAGER','AGENT') AND EXISTS(SELECT 1 FROM organization_resource_assignments s
                    WHERE s.organization_id=o.id AND s.provider_account_id=pa.id AND s.membership_id=m.id AND s.resource_type='INTERACTION' AND s.resource_id=i.id
                    AND s.revoked_at IS NULL AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp())))))))))
          ${input.viewing_id?tx`AND n.viewing_id=${input.viewing_id}`:tx``} ${input.cursor?tx`AND n.id<${input.cursor}`:tx``}
        ORDER BY n.id DESC LIMIT ${limit+1}`;
    });
    const items=[];
    for(const id of ids.slice(0,limit)) {
      try {items.push(await this.client.begin(async tx=>{await tx`LOCK TABLE block_relationships IN SHARE MODE`;return this.noticeForActor(tx,actor,id.id);}));}
      catch(e){if(!(e instanceof IdentityError)||e.code!=='RESOURCE_SCOPE_DENIED')throw e;}
    }
    return {items,next_cursor:ids.length>limit?ids[limit-1]!.id:null};
  }
  protected async maintenanceViewing(tx:Tx,id:string) {
    await tx`LOCK TABLE block_relationships IN SHARE MODE`;
    const seed=(await tx<{interaction_id:string}[]>`SELECT interaction_id FROM viewings WHERE id=${id}`)[0];if(!seed)fail('RESOURCE_SCOPE_DENIED');
    const initial=await this.context(tx,seed.interaction_id);
    await lockListingRegion(tx,initial.listing_id);
    const context=await this.lockContext(tx,initial);
    const row=(await tx<Row[]>`SELECT * FROM viewings WHERE id=${id} FOR UPDATE SKIP LOCKED`)[0];
    if(!row)return null;
    const a:Authority={context,side:'SEEKER',organization:null};matches(row,a);
    return {row,context,eligible:await this.contextEligible(tx,context)};
  }
  private async prepareRemindersOnce(limit:number) {
    const ids=await this.client<{id:string}[]>`SELECT v.id FROM viewings v JOIN interactions i ON i.id=v.interaction_id
      WHERE v.state='SCHEDULED' AND v.provider_account_id=i.provider_account_id AND v.listing_id=i.listing_id AND v.seeker_user_id=i.seeker_user_id
      AND NOT EXISTS(SELECT 1 FROM viewing_reminder_plans p WHERE p.viewing_id=v.id AND p.schedule_version=v.schedule_version) ORDER BY v.id LIMIT ${limit}`;
    let prepared=0;
    for(const id of ids) {
      try {await this.client.begin(async tx=>{const c=await this.maintenanceViewing(tx,id.id);if(c&&c.row.state==='SCHEDULED'){await this.planReminders(tx,c.row,c.eligible);prepared++;}});}
      catch(e){if(!(e instanceof IdentityError)||e.code!=='RESOURCE_SCOPE_DENIED')throw e;}
    }
    return prepared;
  }
  private async backfillNoticesOnce(limit:number) {
    // New effects use the outbox trigger; only pre-F2 history needs this bounded replay.
    return this.client.begin(async tx=>{
      const rows=await tx<{id:string}[]>`SELECT o.id FROM viewing_outbox o WHERE (SELECT count(*) FROM viewing_notices n WHERE n.source_outbox_id=o.id)<2 ORDER BY o.id LIMIT ${limit}`;
      if(!rows.length)return 0;
      const inserted=await tx`INSERT INTO viewing_notices(viewing_id,source_outbox_id,recipient_side,seeker_user_id,provider_account_id,event_type,schedule_version,event_at)
        SELECT v.id,o.id,s.side,CASE WHEN s.side='SEEKER' THEN v.seeker_user_id END,CASE WHEN s.side='PROVIDER' THEN v.provider_account_id END,o.event_type,e.schedule_version,e.created_at
        FROM viewing_outbox o JOIN viewing_events e ON e.id=o.event_id JOIN viewings v ON v.id=o.viewing_id CROSS JOIN (VALUES ('SEEKER'),('PROVIDER')) s(side)
        WHERE o.id=ANY(${rows.map(r=>r.id)}) ON CONFLICT DO NOTHING RETURNING id`;
      return inserted.length;
    });
  }
  async appointmentsOnce(limit=50):Promise<{prepared:number;notices:number;processed:number;skipped:number}> {
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_INPUT');
    const prepared=await this.prepareRemindersOnce(limit),notices=await this.backfillNoticesOnce(limit),token=randomUUID();
    // Revalidate future work fairly as well as processing due jobs: loss of
    // participation invalidates intent, rather than reviving it on later recovery.
    // Freeze the bounded locking selection once; a rescanned IN subquery can
    // otherwise claim fresh rows as earlier candidates become leased.
    const jobs=await this.client.begin(async tx=>tx<{id:string;viewing_id:string}[]>`WITH candidates AS MATERIALIZED (
      SELECT id FROM viewing_scheduled_actions WHERE action_type IN ('EXPIRE_RESCHEDULE','REMINDER_24H','REMINDER_2H') AND (state='PENDING' OR (state='LEASED' AND lease_until<=statement_timestamp()))
        ORDER BY (due_at<=statement_timestamp()) DESC,last_checked_at NULLS FIRST,due_at,id LIMIT ${limit} FOR UPDATE SKIP LOCKED
      ) UPDATE viewing_scheduled_actions SET state='LEASED',lease_token=${token},lease_until=statement_timestamp()+interval '1 minute',attempts=attempts+1
      WHERE id IN (SELECT id FROM candidates) RETURNING id,viewing_id`);
    let processed=0,skipped=0;
    for(const job of jobs) {
      try {
        const result=await this.client.begin(async tx=>{
          const current=await this.maintenanceViewing(tx,job.viewing_id);
          const action=(await tx<{id:string;action_type:string;proposal_id:string|null;expected_schedule_version:number;due_at:Date}[]>`SELECT * FROM viewing_scheduled_actions WHERE id=${job.id} AND state='LEASED' AND lease_token=${token} FOR UPDATE`)[0];
          if(!action)return 'busy';
          const pending=async()=>{await tx`UPDATE viewing_scheduled_actions SET state='PENDING',lease_token=NULL,lease_until=NULL,last_checked_at=statement_timestamp() WHERE id=${action.id}`;return 'pending';};
          const finish=async(state:'PROCESSED'|'SKIPPED',reason:string|null)=>{await tx`UPDATE viewing_scheduled_actions SET state=${state},reason_code=${reason},lease_token=NULL,lease_until=NULL,processed_at=statement_timestamp(),last_checked_at=statement_timestamp() WHERE id=${action.id}`;return state==='PROCESSED'?'processed':'skipped';};
          if(!current)return pending();
          const row=current.row,eligible=await this.contextEligible(tx,current.context);
          if(action.action_type==='EXPIRE_RESCHEDULE') {
            const p=await this.proposal(tx,action.proposal_id!,row.id);
            if(p.state!=='PENDING')return finish('SKIPPED','PROPOSAL_CLOSED');
            const due=(await tx`SELECT 1 WHERE ${p.expires_at}::timestamptz<=statement_timestamp()`)[0];
            if(row.state!=='SCHEDULED'||row.schedule_version!==p.base_schedule_version||!eligible||due) {
              const state=due?'EXPIRED':'INVALIDATED';
              await tx`UPDATE viewing_reschedule_proposals SET state=${state},version=version+1,updated_at=statement_timestamp() WHERE id=${p.id}`;
              if(row.state==='SCHEDULED') {
                const updated=(await tx<Row[]>`UPDATE viewings SET version=version+1,updated_at=statement_timestamp() WHERE id=${row.id} RETURNING *`)[0]!;
                await this.record(tx,updated,null,null,due?'viewing_reschedule_expired':'viewing_reschedule_invalidated',row.state);
              }
              return finish('PROCESSED',state);
            }
            if(instant(action.due_at)!==instant(p.expires_at))await tx`UPDATE viewing_scheduled_actions SET due_at=${p.expires_at} WHERE id=${action.id}`;
            return pending();
          }
          if(row.state!=='SCHEDULED'||row.schedule_version!==action.expected_schedule_version)return finish('SKIPPED','OBSOLETE_SCHEDULE');
          if(!eligible)return finish('SKIPPED','NOT_ELIGIBLE');
          const hours=action.action_type==='REMINDER_24H'?24:2;
          const window=(await tx<{due:Date;ends:Date;ready:boolean;missed:boolean}[]>`SELECT ${row.scheduled_start}::timestamptz-${hours}*interval '1 hour' AS due,
            ${row.scheduled_start}::timestamptz-${hours===24?2:0}*interval '1 hour' AS ends,
            ${row.scheduled_start}::timestamptz-${hours}*interval '1 hour'<=statement_timestamp() AS ready,
            ${row.scheduled_start}::timestamptz-${hours===24?2:0}*interval '1 hour'<=statement_timestamp() AS missed`)[0]!;
          if(window.missed)return finish('SKIPPED','MISSED_WINDOW');
          if(instant(action.due_at)!==instant(window.due))await tx`UPDATE viewing_scheduled_actions SET due_at=${window.due} WHERE id=${action.id}`;
          if(!window.ready)return pending();
          const created=await tx`INSERT INTO viewing_notices(viewing_id,source_action_id,recipient_side,seeker_user_id,provider_account_id,event_type,schedule_version,event_at)
            SELECT ${row.id},${action.id},s.side,CASE WHEN s.side='SEEKER' THEN ${row.seeker_user_id}::uuid END,
              CASE WHEN s.side='PROVIDER' THEN ${row.provider_account_id}::uuid END,${hours===24?'viewing_reminder_24h':'viewing_reminder_2h'},${row.schedule_version},statement_timestamp()
            FROM (VALUES ('SEEKER'),('PROVIDER')) s(side) WHERE ${window.ends}::timestamptz>statement_timestamp() ON CONFLICT DO NOTHING RETURNING id`;
          if(!created.length && !(await tx`SELECT id FROM viewing_notices WHERE source_action_id=${action.id}`)[0])return finish('SKIPPED','MISSED_WINDOW');
          if(created.length)await tx`INSERT INTO audit_events(action,target_type,target_id,reason_code,safe_metadata) VALUES('VIEWING_REMINDER_AVAILABLE','Viewing',${row.id},'INBOX_AVAILABLE',${JSON.stringify({action_id:action.id,schedule_version:row.schedule_version,external_delivery_enabled:false})}::jsonb)`;
          if(!(await this.contextEligible(tx,current.context)))fail('REMINDER_ELIGIBILITY_LOST');
          if(!(await tx`SELECT 1 WHERE ${window.ends}::timestamptz>statement_timestamp()`)[0])fail('REMINDER_WINDOW_ELAPSED');
          return finish('PROCESSED',null);
        });
        if(result==='processed')processed++;if(result==='skipped')skipped++;
      } catch(e) {
        if(!(e instanceof IdentityError)||!['RESOURCE_SCOPE_DENIED','REMINDER_WINDOW_ELAPSED','REMINDER_ELIGIBILITY_LOST'].includes(e.code))throw e;
        const reason=e.code==='REMINDER_WINDOW_ELAPSED'?'MISSED_WINDOW':e.code==='REMINDER_ELIGIBILITY_LOST'?'NOT_ELIGIBLE':'CONTEXT_CHANGED';
        const result=await this.client.begin(async tx=>{
          const owned=(await tx`SELECT id FROM viewings WHERE id=${job.viewing_id} FOR UPDATE SKIP LOCKED`)[0];
          if(!owned){await tx`UPDATE viewing_scheduled_actions SET state='PENDING',lease_token=NULL,lease_until=NULL,last_checked_at=statement_timestamp() WHERE id=${job.id} AND state='LEASED' AND lease_token=${token}`;return [];}
          const action=(await tx<{proposal_id:string|null}[]>`SELECT proposal_id FROM viewing_scheduled_actions WHERE id=${job.id} AND state='LEASED' AND lease_token=${token}`)[0];
          if(action?.proposal_id)await tx`UPDATE viewing_reschedule_proposals SET state='INVALIDATED',version=version+1,updated_at=statement_timestamp() WHERE id=${action.proposal_id} AND state='PENDING'`;
          return tx`UPDATE viewing_scheduled_actions SET state='SKIPPED',reason_code=${reason},lease_token=NULL,lease_until=NULL,processed_at=statement_timestamp(),last_checked_at=statement_timestamp()
            WHERE id=${job.id} AND state='LEASED' AND lease_token=${token} RETURNING id`;
        });
        skipped+=result.length;
      }
    }
    return {prepared,notices,processed,skipped};
  }
}
