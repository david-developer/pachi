import { createHash, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { z } from 'zod';
import { IdentityError } from './identity.js';
import { isUuid } from './conversation-access.js';
import { contactProhibited } from './contact-safety.js';
import { lockListingRegion } from './region-publication.js';
import { readPublicListingVisibility } from './listing-visibility.js';
import { readAuthorityRisk } from './authority-risk.js';
import { requireOrganizationResourceActor, requireOrganizationResourceSession, type OrganizationResourceActorContext } from './organization-resource-actor.js';
import type { OrganizationActor } from './organization-lifecycle.js';

type Tx = postgres.TransactionSql;
export type ViewingState = 'REQUESTED'|'ACCEPTED'|'SCHEDULED'|'RESCHEDULED'|'DECLINED'|'EXPIRED'|'CANCELLED_BY_SEEKER'|'CANCELLED_BY_PROVIDER'|'SEEKER_NO_SHOW'|'PROVIDER_NO_SHOW'|'COMPLETED'|'DISPUTED';
type Side = 'SEEKER'|'PROVIDER';
export type ViewingResponse = {
  id:string; interaction_id:string; listing_id:string; provider_account_id:string; seeker_user_id:string;
  state:ViewingState; proposed_start:string; proposed_end:string; scheduled_start:string|null; scheduled_end:string|null;
  display_timezone:string; response_deadline:string; version:number; schedule_version:number;
  seeker_confirmed:boolean; provider_confirmed:boolean; private_instructions:string|null; reason:string|null;
  created_at:string; updated_at:string; actor_side:Side; can_accept:boolean; can_decline:boolean; can_confirm:boolean; can_cancel:boolean;
};
export type ViewingCommandOptions = {idempotencyKey:string;requestId?:string};
export type ViewingCreateInput = {proposed_start:string;proposed_end:string;display_timezone:string};
export type ViewingVersionInput = {expected_version:number;expected_schedule_version:number};
export type ViewingAcceptInput = ViewingVersionInput & {scheduled_start:string;scheduled_end:string;private_instructions:string};
export type ViewingReasonInput = ViewingVersionInput & {reason:string};
type Context = {id:string;listing_id:string;provider_account_id:string;seeker_user_id:string;state:string;kind:string;organization_id:string|null;provider_user_id:string|null;provider_profile_id:string|null};
type Authority = {context:Context;side:Side;organization:OrganizationResourceActorContext|null};
type Row = {id:string;interaction_id:string;listing_id:string;provider_account_id:string;seeker_user_id:string;state:ViewingState;proposed_start:Date;proposed_end:Date;scheduled_start:Date|null;scheduled_end:Date|null;display_timezone:string;response_deadline:Date;version:number;schedule_version:number;seeker_confirmed:boolean;provider_confirmed:boolean;private_instructions:string|null;reason:string|null;created_at:Date;updated_at:Date};
const active = ['REQUESTED','ACCEPTED','SCHEDULED','RESCHEDULED','DISPUTED'];
const cancellable = ['REQUESTED','ACCEPTED','SCHEDULED','RESCHEDULED'];
const reasons = ['UNAVAILABLE','TIME_UNSUITABLE','SAFETY','PLANS_CHANGED','OTHER'] as const;
const iso = z.iso.datetime({offset:true});
const versions = {expected_version:z.number().int().positive(),expected_schedule_version:z.number().int().positive()};
const createSchema = z.object({proposed_start:iso,proposed_end:iso,display_timezone:z.string().min(1).max(100)}).strict();
const acceptSchema = z.object({...versions,scheduled_start:iso,scheduled_end:iso,private_instructions:z.string().trim().min(1).max(2000)}).strict();
const reasonSchema = z.object({...versions,reason:z.enum(reasons)}).strict();
const versionSchema = z.object(versions).strict();
function fail(code:string):never {throw new IdentityError(code,code);}
function validId(id:string,code='RESOURCE_SCOPE_DENIED') {if(!isUuid(id))fail(code);return id.toLowerCase();}
function instant(v:Date|string|null):string|null {return v===null?null:new Date(v).toISOString();}
function timezone(name:string):boolean {
  if (name!=='UTC' && !/^[A-Za-z_]+\/[A-Za-z0-9_+\-/]+$/.test(name)) return false;
  try {new Intl.DateTimeFormat('en',{timeZone:name}).format();return true;}catch{return false;}
}
function actorNormalized(actor:OrganizationActor):OrganizationActor {
  return {...actor,userId:validId(actor.userId,'AUTH_REQUIRED'),sessionId:validId(actor.sessionId,'AUTH_REQUIRED')};
}

/** Current scope is resolved for every command and receipt replay. Receipts only
 * point to an episode; they never cache instructions or historical authority. */
export class ViewingStore {
  constructor(private readonly client:postgres.Sql,private readonly allowSyntheticVerification=false) {}
  private async context(tx:Tx,id:string):Promise<Context> {
    const row=(await tx<Context[]>`SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.state,pa.kind,pa.organization_id,
      pp.user_id AS provider_user_id,pa.provider_profile_id FROM interactions i JOIN provider_accounts pa ON pa.id=i.provider_account_id
      LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id WHERE i.id=${id}`)[0];
    if(!row)fail('RESOURCE_SCOPE_DENIED');return row;
  }
  private async authorize(tx:Tx,actor:OrganizationActor,interactionId:string):Promise<Authority> {
    await requireOrganizationResourceSession(tx,actor,false);
    const initial=await this.context(tx,interactionId);
    await lockListingRegion(tx,initial.listing_id);
    let organization:OrganizationResourceActorContext|null=null;
    let side:Side;
    if(initial.seeker_user_id===actor.userId) side='SEEKER';
    else if(initial.kind==='INDIVIDUAL' && initial.provider_user_id===actor.userId) side='PROVIDER';
    else if(initial.kind==='ORGANIZATION' && initial.organization_id) {
      organization=await requireOrganizationResourceActor(tx,actor,{organizationId:initial.organization_id,resourceType:'INTERACTION',resourceId:interactionId},'INTERACTION_OPERATION',false);
      side='PROVIDER';
    } else fail('RESOURCE_SCOPE_DENIED');
    // Parent order agrees with inquiry/listing/organization operations. Every
    // episode writer holds this Interaction before its child Viewing.
    // Existing property writers lock provider user/profile/account before any
    // listing. Pin participants and principal in that order, including seekers'
    // reads, to avoid a listing→provider inversion against those writers.
    await tx`SELECT id FROM users WHERE id=ANY(${[initial.seeker_user_id,initial.provider_user_id].filter((id):id is string=>id!==null)}) ORDER BY id FOR SHARE`;
    if(initial.provider_profile_id) await tx`SELECT id FROM provider_profiles WHERE id=${initial.provider_profile_id} FOR SHARE`;
    await tx`SELECT id FROM provider_accounts WHERE id=${initial.provider_account_id} FOR SHARE`;
    const listings=await tx`SELECT id FROM listings WHERE id=${initial.listing_id} AND provider_account_id=${initial.provider_account_id} FOR SHARE`;
    if(!listings[0])fail('RESOURCE_SCOPE_DENIED');
    // NO KEY UPDATE serializes episode writers while remaining compatible with
    // the expiry event's foreign-key KEY SHARE on the parent Interaction.
    await tx`SELECT id FROM interactions WHERE id=${interactionId} FOR NO KEY UPDATE`;
    const current=await this.context(tx,interactionId);
    if(current.provider_account_id!==initial.provider_account_id || current.listing_id!==initial.listing_id || current.seeker_user_id!==initial.seeker_user_id
      || current.provider_user_id!==initial.provider_user_id || current.organization_id!==initial.organization_id || current.kind!==initial.kind
      || (side==='PROVIDER' && current.kind==='INDIVIDUAL' && current.provider_user_id!==actor.userId))fail('RESOURCE_SCOPE_DENIED');
    const conversation=await tx`SELECT id FROM conversations WHERE interaction_id=${interactionId} FOR SHARE`;
    if(!conversation[0])fail('RESOURCE_SCOPE_DENIED');
    await requireOrganizationResourceSession(tx,actor,false);
    return {context:current,side,organization};
  }
  private async currentScope(tx:Tx,actor:OrganizationActor,a:Authority):Promise<void> {
    await requireOrganizationResourceSession(tx,actor,false);
    if(a.organization?.assignmentId) {
      // Row locks prevent revocation, but time can still cross valid_until while
      // waiting for the child Viewing. Never consume a cached expiry decision.
      const current=await tx`SELECT id FROM organization_resource_assignments WHERE id=${a.organization.assignmentId}
        AND version=${a.organization.assignmentVersion} AND revoked_at IS NULL AND effective_at<=statement_timestamp()
        AND (valid_until IS NULL OR valid_until>statement_timestamp())`;
      if(!current[0])fail('RESOURCE_SCOPE_DENIED');
    }
  }
  private async participantEligible(tx:Tx,userId:string):Promise<boolean> {
    const user=await tx`SELECT id FROM users WHERE id=${userId} AND account_state='ACTIVE' FOR SHARE`;
    const phone=await tx`SELECT id FROM phone_contacts WHERE user_id=${userId} AND verified_at IS NOT NULL AND replaced_at IS NULL AND verification_version>0 FOR SHARE`;
    return !!user[0] && !!phone[0];
  }
  private async eligible(tx:Tx,actor:OrganizationActor,a:Authority):Promise<boolean> {
    const c=a.context;
    if(c.state!=='OPEN' || !(await this.participantEligible(tx,actor.userId)) || !(await this.participantEligible(tx,c.seeker_user_id)))return false;
    if(a.side==='SEEKER' && (c.provider_user_id===actor.userId || (c.organization_id && (await tx`SELECT id FROM organization_memberships WHERE organization_id=${c.organization_id} AND user_id=${actor.userId} AND state='ACTIVE'`)[0])))return false;
    if(c.provider_user_id && !(await this.participantEligible(tx,c.provider_user_id)))return false;
    if(await contactProhibited(tx,c.seeker_user_id,c.provider_account_id,c.provider_user_id))return false;
    // Pin the same mutable approval/eligibility inputs as listing lifecycle
    // commands; a concurrent loss cannot race the committing appointment.
    await tx`SELECT p.id,r.id FROM listings l JOIN properties p ON p.id=l.property_id JOIN provider_property_relationships r ON r.id=l.provider_property_relationship_id
      WHERE l.id=${c.listing_id} FOR SHARE OF p,r`;
    await tx`SELECT o.id,ov.id FROM offerings o JOIN offering_versions ov ON ov.id=o.current_version_id WHERE o.listing_id=${c.listing_id} FOR SHARE OF o,ov`;
    await tx`SELECT lm.id,ma.id FROM listing_media lm JOIN media_assets ma ON ma.id=lm.media_asset_id WHERE lm.listing_id=${c.listing_id} FOR SHARE OF lm,ma`;
    if(c.provider_profile_id) {
      await tx`SELECT provider_profile_id FROM verification_claims WHERE provider_profile_id=${c.provider_profile_id} FOR SHARE`;
      await tx`SELECT id FROM verification_cases WHERE provider_profile_id=${c.provider_profile_id} FOR SHARE`;
    }
    const relation=(await tx<{id:string}[]>`SELECT provider_property_relationship_id AS id FROM listings WHERE id=${c.listing_id}`)[0];
    if(!relation)return false;
    await readAuthorityRisk(tx,relation.id,c.provider_account_id,true);
    // Retain current approval, region, freshness, verification and market policy.
    // Organization publication is still fail-closed in the shared visibility
    // policy; membership cannot invent an approved organization listing.
    return (await readPublicListingVisibility(tx,c.listing_id,{allowSyntheticVerification:this.allowSyntheticVerification})).visible;
  }
  private async projection(tx:Tx,actor:OrganizationActor,a:Authority,row:Row):Promise<ViewingResponse> {
    await this.currentScope(tx,actor,a);
    const eligible=await this.eligible(tx,actor,a);
    const now=new Date((await tx<{now:Date}[]>`SELECT statement_timestamp() AS now`)[0]!.now);
    const timely=new Date(row.response_deadline)>now;
    const future=row.scheduled_start!==null && new Date(row.scheduled_start)>now;
    const ownConfirmed=a.side==='SEEKER'?row.seeker_confirmed:row.provider_confirmed;
    const privateAccess=row.state==='SCHEDULED' && eligible;
    await this.currentScope(tx,actor,a);
    return {id:row.id,interaction_id:row.interaction_id,listing_id:row.listing_id,provider_account_id:row.provider_account_id,seeker_user_id:row.seeker_user_id,
      state:row.state,proposed_start:instant(row.proposed_start)!,proposed_end:instant(row.proposed_end)!,scheduled_start:instant(row.scheduled_start),scheduled_end:instant(row.scheduled_end),
      display_timezone:row.display_timezone,response_deadline:instant(row.response_deadline)!,version:row.version,schedule_version:row.schedule_version,
      seeker_confirmed:row.seeker_confirmed,provider_confirmed:row.provider_confirmed,private_instructions:privateAccess?row.private_instructions:null,
      reason:row.reason,created_at:instant(row.created_at)!,updated_at:instant(row.updated_at)!,actor_side:a.side,
      can_accept:a.side==='PROVIDER'&&row.state==='REQUESTED'&&eligible&&timely,
      can_decline:a.side==='PROVIDER'&&row.state==='REQUESTED'&&timely,
      can_confirm:row.state==='ACCEPTED'&&eligible&&future&&!ownConfirmed,
      can_cancel:cancellable.includes(row.state)};
  }
  private async row(tx:Tx,id:string):Promise<Row> {
    const row=(await tx<Row[]>`SELECT * FROM viewings WHERE id=${id} FOR UPDATE`)[0];if(!row)fail('RESOURCE_SCOPE_DENIED');return row;
  }
  private async record(tx:Tx,row:Row,a:Authority|null,actor:OrganizationActor|null,event:string,prior:string|null,requestId?:string):Promise<void> {
    const e=(await tx<{id:string}[]>`INSERT INTO viewing_events(viewing_id,interaction_id,sequence,event_type,actor_user_id,actor_side,membership_id,assignment_id,prior_state,new_state,version,schedule_version,reason_code,scheduled_start,request_id)
      VALUES(${row.id},${row.interaction_id},${row.version},${event},${actor?.userId??null},${a?.side??null},${a?.organization?.membershipId??null},${a?.organization?.assignmentId??null},${prior},${row.state},${row.version},${row.schedule_version},${row.reason},${row.scheduled_start},${requestId??null}) RETURNING id`)[0]!;
    const payload={viewing_id:row.id,interaction_id:row.interaction_id,state:row.state,version:row.version,schedule_version:row.schedule_version,reason_code:row.reason,policy_version:'viewing-scheduling-v1'};
    const recipients=a?.side==='SEEKER'?['PROVIDER_ACCOUNT']:a?.side==='PROVIDER'?['SEEKER']:['SEEKER','PROVIDER_ACCOUNT'];
    await tx`INSERT INTO viewing_outbox(event_id,viewing_id,event_type,safe_payload,notification_intent)
      VALUES(${e.id},${row.id},${event},${JSON.stringify(payload)}::jsonb,${JSON.stringify({template:event,recipient_sides:recipients,seeker_user_id:row.seeker_user_id,provider_account_id:row.provider_account_id,external_delivery_enabled:false})}::jsonb)`;
    await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,safe_metadata)
      VALUES(${actor?.userId??null},${event.toUpperCase()},'Viewing',${row.id},${row.reason??'PARTICIPANT_ACTION'},${JSON.stringify({event_id:e.id,version:row.version,schedule_version:row.schedule_version,policy_version:'viewing-scheduling-v1'})}::jsonb)`;
  }
  private async closeAction(tx:Tx,id:string):Promise<void> {
    await tx`UPDATE viewing_scheduled_actions SET state='SKIPPED',lease_token=NULL,lease_until=NULL,processed_at=statement_timestamp()
      WHERE viewing_id=${id} AND state IN ('PENDING','LEASED')`;
  }
  private async command(actorInput:OrganizationActor,operation:string,resourceInput:string,input:Record<string,unknown>,options:ViewingCommandOptions,
    work:(tx:Tx,actor:OrganizationActor,a:Authority,row:Row|null)=>Promise<Row>):Promise<{viewing:ViewingResponse;replayed:boolean}> {
    const actor=actorNormalized(actorInput),resource=validId(resourceInput),key=validId(options.idempotencyKey,'INVALID_INPUT');
    if(options.requestId!==undefined)validId(options.requestId,'INVALID_INPUT');
    const hash=createHash('sha256').update(JSON.stringify({operation,resource,...input})).digest('hex');
    return this.client.begin(async tx=>{
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;
      await requireOrganizationResourceSession(tx,actor,false);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`viewing-command:${actor.userId}:${key}`},0))`;
      const prior=(await tx<{viewing_id:string;request_hash:string}[]>`SELECT viewing_id,request_hash FROM viewing_command_receipts WHERE actor_user_id=${actor.userId} AND idempotency_key=${key}`)[0];
      if(prior && prior.request_hash!==hash)fail('IDEMPOTENCY_KEY_REUSED');
      const identity=operation==='CREATE'?resource:(await tx<{interaction_id:string}[]>`SELECT interaction_id FROM viewings WHERE id=${resource}`)[0]?.interaction_id;
      if(!identity)fail('RESOURCE_SCOPE_DENIED');
      const a=await this.authorize(tx,actor,identity);
      if(operation==='CREATE'&&a.side!=='SEEKER')fail('RESOURCE_SCOPE_DENIED');
      if(prior) {
        const row=await this.row(tx,prior.viewing_id);
        if(row.interaction_id!==identity || row.provider_account_id!==a.context.provider_account_id || row.listing_id!==a.context.listing_id || row.seeker_user_id!==a.context.seeker_user_id)fail('RESOURCE_SCOPE_DENIED');
        return {viewing:await this.projection(tx,actor,a,row),replayed:true};
      }
      const old=operation==='CREATE'?null:await this.row(tx,resource);
      await this.currentScope(tx,actor,a);
      if(old && (old.provider_account_id!==a.context.provider_account_id || old.seeker_user_id!==a.context.seeker_user_id || old.listing_id!==a.context.listing_id))fail('RESOURCE_SCOPE_DENIED');
      if(old && old.schedule_version!==input.expected_schedule_version)fail('STALE_SCHEDULE_VERSION');
      if(old && old.version!==input.expected_version)fail('STALE_VERSION');
      const row=await work(tx,actor,a,old);
      await requireOrganizationResourceSession(tx,actor,false);
      await tx`INSERT INTO viewing_command_receipts(actor_user_id,idempotency_key,request_hash,viewing_id,operation) VALUES(${actor.userId},${key},${hash},${row.id},${operation})`;
      return {viewing:await this.projection(tx,actor,a,row),replayed:false};
    });
  }
  async create(actor:OrganizationActor,interactionId:string,input:ViewingCreateInput,options:ViewingCommandOptions) {
    const parsed=createSchema.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');
    const data=parsed.data;
    if(!timezone(data.display_timezone) || new Date(data.proposed_end)<=new Date(data.proposed_start))fail('INVALID_INPUT');
    const normalized={...data,proposed_start:instant(data.proposed_start)!,proposed_end:instant(data.proposed_end)!};
    return this.command(actor,'CREATE',interactionId,normalized,options,async(tx,current,a)=>{
      if(!(await tx`SELECT name FROM pg_timezone_names WHERE name=${data.display_timezone}`)[0])fail('INVALID_INPUT');
      if(!(await this.eligible(tx,current,a)))fail('CAPABILITY_RESTRICTED');
      if((await tx`SELECT id FROM viewings WHERE interaction_id=${a.context.id} AND state=ANY(${active}) LIMIT 1`)[0])fail('ACTIVE_VIEWING_EXISTS');
      const row=(await tx<Row[]>`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,proposed_start,proposed_end,display_timezone,response_deadline)
        SELECT ${a.context.id},${a.context.listing_id},${a.context.provider_account_id},${a.context.seeker_user_id},${current.userId},${normalized.proposed_start},${normalized.proposed_end},${data.display_timezone},LEAST(statement_timestamp()+interval '48 hours',${normalized.proposed_start}::timestamptz)
        WHERE ${normalized.proposed_start}::timestamptz>statement_timestamp() RETURNING *`)[0];
      if(!row)fail('INVALID_INPUT');
      await tx`INSERT INTO viewing_scheduled_actions(viewing_id,expected_schedule_version,due_at) VALUES(${row.id},${row.schedule_version},${row.response_deadline})`;
      await this.record(tx,row,a,current,'viewing_requested',null,options.requestId);return row;
    });
  }
  async accept(actor:OrganizationActor,id:string,input:ViewingAcceptInput,options:ViewingCommandOptions) {
    const parsed=acceptSchema.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');
    const data={...parsed.data,scheduled_start:instant(parsed.data.scheduled_start)!,scheduled_end:instant(parsed.data.scheduled_end)!};
    return this.command(actor,'ACCEPT',id,data,options,async(tx,current,a,old)=>{
      if(a.side!=='PROVIDER')fail('RESOURCE_SCOPE_DENIED');const row=old!;
      if(row.state!=='REQUESTED')fail('INVALID_STATE');
      if(!(await this.eligible(tx,current,a)))fail('CAPABILITY_RESTRICTED');
      if(data.scheduled_start!==instant(row.proposed_start)||data.scheduled_end!==instant(row.proposed_end))fail('INVALID_INPUT');
      const updated=(await tx<Row[]>`UPDATE viewings SET state='ACCEPTED',version=version+1,scheduled_start=${data.scheduled_start},scheduled_end=${data.scheduled_end},
        private_instructions=${data.private_instructions},accepted_by_user_id=${current.userId},accepted_membership_id=${a.organization?.membershipId??null},accepted_assignment_id=${a.organization?.assignmentId??null},accepted_at=statement_timestamp(),updated_at=statement_timestamp()
        WHERE id=${row.id} AND response_deadline>statement_timestamp() AND proposed_start>statement_timestamp() RETURNING *`)[0];
      if(!updated)fail('REQUEST_EXPIRED');
      await this.closeAction(tx,row.id);await this.record(tx,updated,a,current,'viewing_accepted',row.state,options.requestId);return updated;
    });
  }
  async decline(actor:OrganizationActor,id:string,input:ViewingReasonInput,options:ViewingCommandOptions) {
    const parsed=reasonSchema.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');
    return this.command(actor,'DECLINE',id,parsed.data,options,async(tx,current,a,old)=>{
      if(a.side!=='PROVIDER')fail('RESOURCE_SCOPE_DENIED');const row=old!;
      if(row.state!=='REQUESTED')fail('INVALID_STATE');
      const updated=(await tx<Row[]>`UPDATE viewings SET state='DECLINED',reason=${parsed.data.reason},version=version+1,updated_at=statement_timestamp()
        WHERE id=${row.id} AND response_deadline>statement_timestamp() RETURNING *`)[0];
      if(!updated)fail('REQUEST_EXPIRED');await this.closeAction(tx,row.id);
      await this.record(tx,updated,a,current,'viewing_declined',row.state,options.requestId);return updated;
    });
  }
  async confirm(actor:OrganizationActor,id:string,input:ViewingVersionInput,options:ViewingCommandOptions) {
    const parsed=versionSchema.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');
    return this.command(actor,'CONFIRM',id,parsed.data,options,async(tx,current,a,old)=>{
      const row=old!;if(row.state!=='ACCEPTED')fail('INVALID_STATE');
      if(!(await this.eligible(tx,current,a)))fail('CAPABILITY_RESTRICTED');
      if(a.side==='SEEKER'?row.seeker_confirmed:row.provider_confirmed)fail('INVALID_STATE');
      const seeker=row.seeker_confirmed||a.side==='SEEKER',provider=row.provider_confirmed||a.side==='PROVIDER';
      const updated=(await tx<Row[]>`UPDATE viewings SET seeker_confirmed=${seeker},provider_confirmed=${provider},state=${seeker&&provider?'SCHEDULED':'ACCEPTED'},version=version+1,updated_at=statement_timestamp()
        WHERE id=${row.id} AND scheduled_start>statement_timestamp() RETURNING *`)[0];
      if(!updated)fail('APPOINTMENT_PAST');
      await this.record(tx,updated,a,current,seeker&&provider?'viewing_scheduled':'viewing_confirmed',row.state,options.requestId);return updated;
    });
  }
  async cancel(actor:OrganizationActor,id:string,input:ViewingReasonInput,options:ViewingCommandOptions) {
    const parsed=reasonSchema.safeParse(input);if(!parsed.success)fail('INVALID_INPUT');
    return this.command(actor,'CANCEL',id,parsed.data,options,async(tx,current,a,old)=>{
      const row=old!;if(!cancellable.includes(row.state))fail('INVALID_STATE');
      // Attendance commands/claims are deliberately absent in F1. Future claim
      // introduction must guard this transition before allowing cancellation.
      const updated=(await tx<Row[]>`UPDATE viewings SET state=${a.side==='SEEKER'?'CANCELLED_BY_SEEKER':'CANCELLED_BY_PROVIDER'},reason=${parsed.data.reason},cancelled_at=statement_timestamp(),version=version+1,updated_at=statement_timestamp() WHERE id=${row.id} RETURNING *`)[0]!;
      await this.closeAction(tx,row.id);await this.record(tx,updated,a,current,'viewing_cancelled',row.state,options.requestId);return updated;
    });
  }
  async get(actorInput:OrganizationActor,idInput:string):Promise<ViewingResponse> {
    const actor=actorNormalized(actorInput),id=validId(idInput);
    return this.client.begin(async tx=>{
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;
      const seed=(await tx<{interaction_id:string}[]>`SELECT interaction_id FROM viewings WHERE id=${id}`)[0];if(!seed)fail('RESOURCE_SCOPE_DENIED');
      const a=await this.authorize(tx,actor,seed.interaction_id);const row=await this.row(tx,id);
      if(row.provider_account_id!==a.context.provider_account_id||row.listing_id!==a.context.listing_id||row.seeker_user_id!==a.context.seeker_user_id)fail('RESOURCE_SCOPE_DENIED');
      return this.projection(tx,actor,a,row);
    });
  }
  async list(actorInput:OrganizationActor,input:{interaction_id?:string;cursor?:string;limit?:number}={}) {
    const actor=actorNormalized(actorInput),limit=input.limit??20;
    if(!Number.isSafeInteger(limit)||limit<1||limit>50||Object.keys(input).some(k=>!['interaction_id','cursor','limit'].includes(k)))fail('INVALID_INPUT');
    if(input.cursor)validId(input.cursor,'INVALID_INPUT');if(input.interaction_id)validId(input.interaction_id,'INVALID_INPUT');
    let can_request:boolean|null=null;
    if(input.interaction_id)can_request=await this.client.begin(async tx=>{
      await tx`LOCK TABLE block_relationships IN SHARE MODE`;
      const a=await this.authorize(tx,actor,input.interaction_id!.toLowerCase());
      return a.side==='SEEKER' && await this.eligible(tx,actor,a) && !(await tx`SELECT id FROM viewings WHERE interaction_id=${a.context.id} AND state=ANY(${active}) LIMIT 1`)[0];
    });
    // Filter CURRENT scope before pagination; historical participants/receipts
    // do not provide an inbox grant. get() rechecks every selected resource.
    const candidates=await this.client.begin(async tx=>{
      await requireOrganizationResourceSession(tx,actor,false);
      return tx<{id:string}[]>`SELECT v.id FROM viewings v JOIN interactions i ON i.id=v.interaction_id JOIN listings l ON l.id=i.listing_id
        JOIN provider_accounts pa ON pa.id=i.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
        WHERE v.provider_account_id=i.provider_account_id AND l.provider_account_id=i.provider_account_id AND v.seeker_user_id=i.seeker_user_id AND v.listing_id=i.listing_id
        AND (i.seeker_user_id=${actor.userId} OR (pa.kind='INDIVIDUAL' AND pp.user_id=${actor.userId}) OR
          (pa.kind='ORGANIZATION' AND pa.state='ACTIVE' AND EXISTS(SELECT 1 FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id
            WHERE o.id=pa.organization_id AND o.state='ACTIVE' AND o.onboarding_completed_at IS NOT NULL AND m.user_id=${actor.userId} AND m.state='ACTIVE'
              AND (m.role IN ('OWNER','ADMIN') OR (m.role IN ('LISTING_MANAGER','AGENT') AND EXISTS(SELECT 1 FROM organization_resource_assignments s
                WHERE s.organization_id=o.id AND s.provider_account_id=pa.id AND s.membership_id=m.id AND s.resource_type='INTERACTION' AND s.resource_id=i.id
                  AND s.revoked_at IS NULL AND s.effective_at<=statement_timestamp() AND (s.valid_until IS NULL OR s.valid_until>statement_timestamp())))))))
        ${input.interaction_id?tx`AND v.interaction_id=${input.interaction_id}`:tx``} ${input.cursor?tx`AND v.id<${input.cursor}`:tx``}
        ORDER BY v.id DESC LIMIT ${limit+1}`;
    });
    const items:ViewingResponse[]=[];
    for(const c of candidates.slice(0,limit)) {
      try {items.push(await this.get(actor,c.id));}catch(e){if(!(e instanceof IdentityError)||e.code!=='RESOURCE_SCOPE_DENIED')throw e;}
    }
    return {items,next_cursor:candidates.length>limit?candidates[limit-1]!.id:null,can_request};
  }
  async expireOnce(limit=50):Promise<{expired:number;skipped:number}> {
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_INPUT');
    // Lease ownership commits before aggregate work: no action→Viewing lock
    // inversion against participant commands (which use Viewing→action).
    const token=randomUUID();
    const jobs=await this.client.begin(async tx=>tx<{id:string;viewing_id:string}[]>`UPDATE viewing_scheduled_actions SET state='LEASED',lease_token=${token},lease_until=statement_timestamp()+interval '1 minute',attempts=attempts+1
      WHERE id IN (SELECT id FROM viewing_scheduled_actions WHERE due_at<=statement_timestamp() AND (state='PENDING' OR (state='LEASED' AND lease_until<=statement_timestamp()))
        ORDER BY due_at,id LIMIT ${limit} FOR UPDATE SKIP LOCKED) RETURNING id,viewing_id`);
    let expired=0,skipped=0;
    for(const job of jobs) {
      const result=await this.client.begin(async tx=>{
        const row=(await tx<Row[]>`SELECT * FROM viewings WHERE id=${job.viewing_id} FOR UPDATE SKIP LOCKED`)[0];
        if(!row) {
          await tx`UPDATE viewing_scheduled_actions SET state='PENDING',lease_token=NULL,lease_until=NULL WHERE id=${job.id} AND state='LEASED' AND lease_token=${token}`;
          return 'busy';
        }
        const action=(await tx<{expected_schedule_version:number}[]>`SELECT expected_schedule_version FROM viewing_scheduled_actions WHERE id=${job.id} AND state='LEASED' AND lease_token=${token} FOR UPDATE`)[0];
        if(!action)return 'busy';
        if(row.state==='REQUESTED' && row.schedule_version===action.expected_schedule_version) {
          const early=(await tx`UPDATE viewing_scheduled_actions SET state='PENDING',due_at=${row.response_deadline},lease_token=NULL,lease_until=NULL
            WHERE id=${job.id} AND ${row.response_deadline}::timestamptz>statement_timestamp() RETURNING id`)[0];
          // A stale early due row must not permanently disable the real expiry.
          if(early)return 'busy';
        }
        const updated=row.state==='REQUESTED' && row.schedule_version===action.expected_schedule_version
          ?(await tx<Row[]>`UPDATE viewings SET state='EXPIRED',reason='RESPONSE_DEADLINE_ELAPSED',version=version+1,updated_at=statement_timestamp()
            WHERE id=${row.id} AND state='REQUESTED' AND response_deadline<=statement_timestamp() RETURNING *`)[0]:undefined;
        await tx`UPDATE viewing_scheduled_actions SET state=${updated?'PROCESSED':'SKIPPED'},lease_token=NULL,lease_until=NULL,processed_at=statement_timestamp() WHERE id=${job.id}`;
        if(updated)await this.record(tx,updated,null,null,'viewing_expired',row.state);
        return updated?'expired':'skipped';
      });
      if(result==='expired')expired++;else if(result==='skipped')skipped++;
    }
    return {expired,skipped};
  }
}
