import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createDatabase } from './client.js';
import { viewingFixture } from './viewing-fixture.js';
import { ViewingAppointmentStore } from './viewing-appointments.js';
import { OrganizationAssignmentStore } from './organization-assignments.js';
import { organizationAssignmentFixture } from './organization-assignment-fixture.js';

const url=process.env.DATABASE_TEST_URL;
if(url){const u=new URL(url);assert.equal(u.hostname,'localhost');assert.equal(u.port,'5433');assert.equal(u.pathname,'/pachi_test');}
const integration=url?test:test.skip;
type Fixture=Awaited<ReturnType<typeof fixture>>;
type Viewing=Awaited<ReturnType<ViewingAppointmentStore['get']>>;
const expected=(v:Viewing)=>({expected_version:v.version,expected_schedule_version:v.schedule_version});
const guidance='SYNTHETIC_PRIVATE_GUIDANCE_F2: staffed reception';
async function fixture(){
  const {client}=createDatabase(url!);await client`SET client_min_messages TO warning`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client`UPDATE region_publication_controls SET enabled=true`;
  return {...await viewingFixture(client),client,store:new ViewingAppointmentStore(client,true),async close(){await client`UPDATE region_publication_controls SET enabled=true`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client.end();}};
}
async function schedule(f:Fixture,hours=72,beforeFinalConfirmation?:()=>Promise<void>){
  const time=(await f.client<{start:Date;end:Date}[]>`SELECT statement_timestamp()+${hours}*interval '1 hour' AS start,statement_timestamp()+${hours+1}*interval '1 hour' AS end`)[0]!;
  let v=(await f.store.create(f.actors.seeker,f.interaction.interaction_id,{...f.input,proposed_start:new Date(time.start).toISOString(),proposed_end:new Date(time.end).toISOString()},f.command())).viewing;
  v=(await f.store.accept(f.actors.provider,v.id,{...expected(v),scheduled_start:v.proposed_start,scheduled_end:v.proposed_end,private_instructions:guidance},f.command())).viewing;
  v=(await f.store.confirm(f.actors.seeker,v.id,expected(v),f.command())).viewing;
  await beforeFinalConfirmation?.();
  return (await f.store.confirm(f.actors.provider,v.id,expected(v),f.command())).viewing;
}
const replacement=(v:Viewing)=>({...expected(v),proposed_start:new Date(Date.parse(v.scheduled_start!)+24*3600000).toISOString(),proposed_end:new Date(Date.parse(v.scheduled_end!)+24*3600000).toISOString()});
async function effects(f:Fixture){return (await f.client`SELECT (SELECT count(*)::int FROM viewings) AS viewings,(SELECT count(*)::int FROM viewing_events) AS events,(SELECT count(*)::int FROM viewing_outbox) AS outbox,(SELECT count(*)::int FROM viewing_command_receipts) AS receipts,(SELECT count(*)::int FROM viewing_reschedule_proposals) AS proposals,(SELECT count(*)::int FROM viewing_schedule_history) AS history,(SELECT count(*)::int FROM viewing_notices) AS notices,(SELECT count(*)::int FROM viewing_notice_reads) AS reads,(SELECT count(*)::int FROM viewing_scheduled_actions) AS jobs`)[0]!;}

for(const side of ['seeker','provider'] as const)void integration(`G3-F2 ${side}-initiated proposal preserves confirmed schedule until two explicit approvals and retains schedule history`,async()=>{
  const f=await fixture();try{
    const original=await schedule(f),input=replacement(original);
    let r=await f.store.proposeReschedule(f.actors[side],original.id,input,f.command());
    assert.equal(r.proposal.seeker_approved,false);assert.equal(r.proposal.provider_approved,false);
    assert.equal(r.viewing.scheduled_start,original.scheduled_start);assert.equal(r.viewing.schedule_version,1);assert.equal(r.viewing.private_instructions,guidance);
    const deadline=(await f.client`SELECT expires_at=LEAST(created_at+interval '48 hours',base_scheduled_start,proposed_start) AS correct FROM viewing_reschedule_proposals WHERE id=${r.proposal.id}`)[0]!;assert.equal(deadline.correct,true);
    r=await f.store.respondReschedule(f.actors[side],original.id,r.proposal.id,'accept',{...expected(r.viewing),expected_proposal_version:r.proposal.version},f.command());
    assert.equal(r.viewing.scheduled_start,original.scheduled_start);assert.equal(r.proposal.state,'PENDING');assert.equal(r.viewing.schedule_version,1);
    r=await f.store.respondReschedule(f.actors[side==='seeker'?'provider':'seeker'],original.id,r.proposal.id,'accept',{...expected(r.viewing),expected_proposal_version:r.proposal.version},f.command());
    assert.equal(r.viewing.state,'SCHEDULED');assert.equal(r.proposal.state,'FINALIZED');assert.equal(r.viewing.schedule_version,2);assert.equal(r.viewing.scheduled_start,input.proposed_start);
    const history=(await f.store.listReschedules(f.actors.seeker,original.id)).schedule_history;
    assert.equal(history.length,1);assert.equal(history[0]!.scheduled_start,original.scheduled_start);assert.equal(history[0]!.schedule_version,1);
    assert.equal((await effects(f)).viewings,1);
    const jobs=await f.client`SELECT action_type,expected_schedule_version,state FROM viewing_scheduled_actions WHERE action_type LIKE 'REMINDER_%'`;
    assert.equal(jobs.filter(j=>j.expected_schedule_version===1&&j.state==='SKIPPED').length,2);assert.equal(jobs.filter(j=>j.expected_schedule_version===2&&j.state==='PENDING').length,2);
    const eventTypes=(await f.client`SELECT event_type FROM viewing_events WHERE viewing_id=${original.id} ORDER BY sequence`).map(e=>e.event_type);
    assert.deepEqual(eventTypes.slice(-2),['viewing_rescheduled','viewing_reschedule_finalized']);
    assert.equal((await f.client`SELECT count(*)::int AS count FROM viewing_notices`)[0]!.count,eventTypes.length*2);
  }finally{await f.close();}
});

for(const action of ['reject','withdraw'] as const)void integration(`G3-F2 ${action} is actor-scoped and terminal without changing the confirmed schedule`,async()=>{
  const f=await fixture();try{
    const old=await schedule(f),r=await f.store.proposeReschedule(f.actors.seeker,old.id,replacement(old),f.command());
    await assert.rejects(f.store.respondReschedule(f.actors[action==='withdraw'?'provider':'seeker'],old.id,r.proposal.id,action,{...expected(r.viewing),expected_proposal_version:1},f.command()),{code:'RESOURCE_SCOPE_DENIED'});
    const result=await f.store.respondReschedule(f.actors[action==='withdraw'?'seeker':'provider'],old.id,r.proposal.id,action,{...expected(r.viewing),expected_proposal_version:1},f.command());
    assert.equal(result.proposal.state,action==='reject'?'REJECTED':'WITHDRAWN');assert.equal(result.viewing.scheduled_start,old.scheduled_start);assert.equal(result.viewing.schedule_version,1);
    assert.equal((await effects(f)).history,0);assert.equal((await f.store.listReschedules(f.actors.seeker,old.id)).can_propose,true);
    const next=await f.store.proposeReschedule(f.actors.provider,old.id,replacement(result.viewing),f.command());assert.notEqual(next.proposal.id,r.proposal.id);
    await assert.rejects(f.client`DELETE FROM viewing_reschedule_proposals WHERE id=${r.proposal.id}`,/retained/);
  }finally{await f.close();}
});

void integration('G3-F2 proposal and approval retries are effect-free, namespace conflicts fail closed, and replay rechecks current authority',async()=>{
  const f=await fixture();try{
    const old=await schedule(f),key=f.command(),input=replacement(old),r=await f.store.proposeReschedule(f.actors.seeker,old.id,input,key),before=await effects(f);
    assert.equal((await f.store.proposeReschedule(f.actors.seeker,old.id,input,key)).replayed,true);assert.deepEqual(await effects(f),before);
    await assert.rejects(f.store.proposeReschedule(f.actors.seeker,old.id,{...input,proposed_end:new Date(Date.parse(input.proposed_end)+3600000).toISOString()},key),{code:'IDEMPOTENCY_KEY_REUSED'});
    await assert.rejects(f.store.cancel(f.actors.seeker,old.id,{...expected(r.viewing),reason:'SAFETY'},key),{code:'IDEMPOTENCY_KEY_REUSED'});
    const approvalKey=f.command(),approval={...expected(r.viewing),expected_proposal_version:1};
    await f.store.respondReschedule(f.actors.seeker,old.id,r.proposal.id,'accept',approval,approvalKey);const approved=await effects(f);
    assert.equal((await f.store.respondReschedule(f.actors.seeker,old.id,r.proposal.id,'accept',approval,approvalKey)).replayed,true);assert.deepEqual(await effects(f),approved);
    await f.client`INSERT INTO block_relationships(blocker_user_id,blocked_provider_account_id) VALUES(${f.seekerId},${old.provider_account_id})`;
    const blocked=await f.store.proposeReschedule(f.actors.seeker,old.id,input,key);assert.equal(blocked.viewing.private_instructions,null);assert.equal(blocked.proposal.can_accept,false);assert.deepEqual(await effects(f),approved);
    await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${f.actors.seeker.sessionId}`;
    await assert.rejects(f.store.proposeReschedule(f.actors.seeker,old.id,input,key),{code:'AUTH_REQUIRED'});
  }finally{await f.close();}
});

for(const denial of ['other','limited','suspended','phone','provider-phone','blocked','closed','listing-unavailable','revoked-session','expired-session','security-version'] as const)
void integration(`G3-F2 current ${denial} prevents proposal effects`,async()=>{
  const f=await fixture();try{
    const v=await schedule(f),before=await effects(f);let actor=f.actors.seeker,code='CAPABILITY_RESTRICTED';
    if(denial==='other'){actor=f.actors.other;code='RESOURCE_SCOPE_DENIED';}
    if(denial==='limited'||denial==='suspended'){await f.client`UPDATE users SET account_state=${denial==='limited'?'LIMITED':'SUSPENDED'} WHERE id=${f.seekerId}`;if(denial==='suspended')code='AUTH_REQUIRED';}
    if(denial==='phone'||denial==='provider-phone')await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${denial==='phone'?f.seekerId:f.providerUserId}`;
    if(denial==='blocked')await f.client`INSERT INTO block_relationships(blocker_user_id,blocked_provider_account_id) VALUES(${f.seekerId},${v.provider_account_id})`;
    if(denial==='closed')await f.client`UPDATE interactions SET state='CLOSED',closed_at=statement_timestamp(),version=version+1 WHERE id=${v.interaction_id}`;
    if(denial==='listing-unavailable')await f.client`UPDATE listings SET market_status='RENTED' WHERE id=${f.listingId}`;
    if(denial==='revoked-session'){await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${actor.sessionId}`;code='AUTH_REQUIRED';}
    if(denial==='expired-session'){await f.client`UPDATE security_sessions SET expires_at=statement_timestamp()-interval '1 second' WHERE id=${actor.sessionId}`;code='AUTH_REQUIRED';}
    if(denial==='security-version'){await f.client`UPDATE users SET security_version=security_version+1 WHERE id=${actor.userId}`;code='AUTH_REQUIRED';}
    await assert.rejects(f.store.proposeReschedule(actor,v.id,replacement(v),f.command()),{code});assert.deepEqual(await effects(f),before);
  }finally{await f.close();}
});

void integration('G3-F2 stale aggregate, schedule and proposal versions and cross-resource commands cannot overwrite an appointment',async()=>{
  const f=await fixture();try{
    const v=await schedule(f),r=await f.store.proposeReschedule(f.actors.seeker,v.id,replacement(v),f.command()),before=await effects(f);
    await assert.rejects(f.store.proposeReschedule(f.actors.provider,v.id,replacement(r.viewing),f.command()),{code:'PENDING_PROPOSAL_EXISTS'});
    for(const [delta,code] of [[{expected_version:1},'STALE_VERSION'],[{expected_schedule_version:2},'STALE_SCHEDULE_VERSION'],[{expected_proposal_version:2},'STALE_PROPOSAL_VERSION']] as const)
      await assert.rejects(f.store.respondReschedule(f.actors.provider,v.id,r.proposal.id,'accept',{...expected(r.viewing),expected_proposal_version:1,...delta},f.command()),{code});
    await assert.rejects(f.store.respondReschedule(f.actors.provider,v.id,randomUUID(),'accept',{...expected(r.viewing),expected_proposal_version:1},f.command()),{code:'RESOURCE_SCOPE_DENIED'});
    await assert.rejects(f.store.respondReschedule(f.actors.other,v.id,r.proposal.id,'accept',{...expected(r.viewing),expected_proposal_version:1},f.command()),{code:'RESOURCE_SCOPE_DENIED'});
    assert.deepEqual(await effects(f),before);
    await assert.rejects(f.client`UPDATE viewings SET scheduled_start=scheduled_start+interval '1 hour',scheduled_end=scheduled_end+interval '1 hour',version=version+1 WHERE id=${v.id}`,/joint approval/);
  }finally{await f.close();}
});

void integration('G3-F2 malformed, past, reversed and unchanged replacement windows fail without business effects',async()=>{
  const f=await fixture();try{
    const v=await schedule(f),before=await effects(f),valid=replacement(v);
    for(const input of [{...valid,proposed_start:'2026-02-30T12:00:00Z'},{...valid,proposed_start:'2000-01-01T00:00:00Z'},{...valid,proposed_end:valid.proposed_start},{...valid,proposed_start:v.scheduled_start!,proposed_end:v.scheduled_end!},{...valid,provider_account_id:randomUUID()}])
      await assert.rejects(f.store.proposeReschedule(f.actors.seeker,v.id,input,f.command()));
    assert.deepEqual(await effects(f),before);
  }finally{await f.close();}
});

void integration('G3-F2 notice persistence failure rolls back the complete joint replacement and all effects',async()=>{
  const f=await fixture();try{
    const v=await schedule(f);let r=await f.store.proposeReschedule(f.actors.seeker,v.id,replacement(v),f.command());
    r=await f.store.respondReschedule(f.actors.seeker,v.id,r.proposal.id,'accept',{...expected(r.viewing),expected_proposal_version:1},f.command());const before=await effects(f);
    await f.client`ALTER TABLE viewing_notices ADD CONSTRAINT f2_test_notice_failure CHECK(event_type<>'viewing_reschedule_finalized')`;
    await assert.rejects(f.store.respondReschedule(f.actors.provider,v.id,r.proposal.id,'accept',{...expected(r.viewing),expected_proposal_version:2},f.command()));
    assert.deepEqual(await effects(f),before);assert.equal((await f.store.get(f.actors.seeker,v.id)).scheduled_start,v.scheduled_start);assert.equal((await f.store.listReschedules(f.actors.seeker,v.id)).items[0]!.provider_approved,false);
  }finally{await f.client`ALTER TABLE viewing_notices DROP CONSTRAINT IF EXISTS f2_test_notice_failure`;await f.close();}
});

for(const hours of [72,23,1])void integration(`G3-F2 ${hours}-hour appointment creates only future 24-hour and 2-hour reminder intent`,async()=>{
  const f=await fixture();try{
    const v=await schedule(f,hours),status=await f.store.reminderStatus(f.actors.seeker,v.id);
    assert.equal(status.items.length,hours>24?2:hours>2?1:0);assert.equal(status.external_state,'NOT_ENABLED');
    for(const j of status.items){assert.equal(j.state,'PENDING');assert.ok(Date.parse(j.due_at)>Date.now());assert.equal(Date.parse(v.scheduled_start!)-Date.parse(j.due_at),(j.action_type==='REMINDER_24H'?24:2)*3600000);}
    await f.store.appointmentsOnce();assert.equal((await f.client`SELECT id FROM viewing_notices WHERE source_action_id IS NOT NULL`).length,0);
  }finally{await f.close();}
});

async function historicalScheduled(f:Fixture,hours:number,interactionId=f.interaction.interaction_id,providerActor=f.actors.provider.userId){
  const inserted=(await f.client<{id:string}[]>`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,proposed_start,proposed_end,display_timezone,response_deadline,created_at,updated_at)
    SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.seeker_user_id,statement_timestamp()+${hours}*interval '1 hour',statement_timestamp()+${hours+1}*interval '1 hour','Africa/Douala',
      LEAST(statement_timestamp()+interval '18 hours',statement_timestamp()+${hours}*interval '1 hour'),statement_timestamp()-interval '30 hours',statement_timestamp()-interval '30 hours'
    FROM interactions i WHERE i.id=${interactionId} RETURNING id`)[0]!;
  await f.client`UPDATE viewings SET state='ACCEPTED',scheduled_start=proposed_start,scheduled_end=proposed_end,private_instructions=${guidance},accepted_by_user_id=${providerActor},accepted_at=created_at+interval '1 hour',version=version+1,updated_at=created_at+interval '1 hour' WHERE id=${inserted.id}`;
  await f.client`UPDATE viewings SET state='SCHEDULED',seeker_confirmed=true,provider_confirmed=true,version=version+1,updated_at=created_at+interval '2 hours' WHERE id=${inserted.id}`;
  return inserted.id;
}
async function historicJobs(f:Fixture,id:string){
  await f.client`INSERT INTO viewing_reminder_plans(viewing_id,schedule_version,status,planned_at) SELECT id,schedule_version,'PLANNED',created_at+interval '3 hours' FROM viewings WHERE id=${id}`;
  await f.client`INSERT INTO viewing_scheduled_actions(viewing_id,action_type,expected_schedule_version,due_at)
    SELECT v.id,s.kind,v.schedule_version,v.scheduled_start-s.lead_time FROM viewings v CROSS JOIN (VALUES ('REMINDER_24H',interval '24 hours'),('REMINDER_2H',interval '2 hours')) s(kind,lead_time) WHERE v.id=${id}`;
}
for(const [hours,expectedType] of [[23,'viewing_reminder_24h'],[1,'viewing_reminder_2h'],[-1,null]] as const)
void integration(`G3-F2 deterministic ${hours}-hour worker respects reminder windows, deduplicates inbox and prevents a retroactive burst`,async()=>{
  const f=await fixture();try{
    const id=await historicalScheduled(f,hours);await historicJobs(f,id);const first=await f.store.appointmentsOnce();
    const notices=await f.client`SELECT event_type,recipient_side,external_state FROM viewing_notices WHERE source_action_id IS NOT NULL`;
    assert.equal(notices.length,expectedType?2:0);assert.ok(notices.every(n=>n.event_type===expectedType&&n.external_state==='NOT_ENABLED'));
    assert.equal(first.processed,expectedType?1:0);assert.equal(first.skipped,hours<=2?hours<0?2:1:0);
    await f.store.appointmentsOnce();assert.equal((await f.client`SELECT id FROM viewing_notices WHERE source_action_id IS NOT NULL`).length,notices.length);
    assert.equal((await f.client`SELECT id FROM audit_events WHERE action='VIEWING_REMINDER_AVAILABLE'`).length,expectedType?1:0);
  }finally{await f.close();}
});

void integration('G3-F2 an interrupted expired worker lease is reclaimed once; an early due corruption never sends a future reminder',async()=>{
  const f=await fixture();try{
    const id=await historicalScheduled(f,23);await historicJobs(f,id);
    await f.client`UPDATE viewing_scheduled_actions SET state='LEASED',lease_token=${randomUUID()},lease_until=statement_timestamp()-interval '1 minute' WHERE action_type='REMINDER_24H'`;
    await f.client`UPDATE viewing_scheduled_actions SET due_at=statement_timestamp()-interval '1 day' WHERE action_type='REMINDER_2H'`;
    assert.equal((await f.store.appointmentsOnce()).processed,1);assert.equal((await f.client`SELECT id FROM viewing_notices WHERE source_action_id IS NOT NULL`).length,2);
    const job=(await f.client`SELECT j.state,j.due_at=v.scheduled_start-interval '2 hours' AS canonical FROM viewing_scheduled_actions j JOIN viewings v ON v.id=j.viewing_id WHERE j.action_type='REMINDER_2H'`)[0]!;
    assert.equal(job.state,'PENDING');assert.equal(job.canonical,true);assert.equal((await f.store.appointmentsOnce()).processed,0);
  }finally{await f.close();}
});

for(const loss of ['block','limited','restricted','listing-closed'] as const)void integration(`G3-F2 future ${loss} invalidates proposal and reminder intent without cancelling the confirmed appointment`,async()=>{
  const f=await fixture();try{
    const v=await schedule(f),r=await f.store.proposeReschedule(f.actors.seeker,v.id,replacement(v),f.command());
    if(loss==='block')await f.client`INSERT INTO block_relationships(blocker_user_id,blocked_provider_account_id) VALUES(${f.seekerId},${v.provider_account_id})`;
    if(loss==='limited')await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${f.seekerId}`;
    if(loss==='restricted')await f.client`UPDATE interactions SET state='RESTRICTED',version=version+1 WHERE id=${v.interaction_id}`;
    if(loss==='listing-closed')await f.client`UPDATE listings SET market_status='RENTED' WHERE id=${f.listingId}`;
    await f.store.appointmentsOnce();
    const current=await f.store.get(f.actors.seeker,v.id);assert.equal(current.state,'SCHEDULED');assert.equal(current.scheduled_start,v.scheduled_start);assert.equal(current.private_instructions,null);
    assert.equal((await f.store.listReschedules(f.actors.seeker,v.id)).items.find(p=>p.id===r.proposal.id)!.state,'INVALIDATED');
    assert.equal((await f.client`SELECT id FROM viewing_scheduled_actions WHERE state IN ('PENDING','LEASED')`).length,0);
    assert.equal((await f.client`SELECT id FROM viewing_notices WHERE source_action_id IS NOT NULL`).length,0);
  }finally{await f.close();}
});

void integration('G3-F2 cancellation invalidates proposal and reminder jobs; safe withdrawal survives a block before maintenance',async()=>{
  const f=await fixture();try{
    const v=await schedule(f);let r=await f.store.proposeReschedule(f.actors.seeker,v.id,replacement(v),f.command());
    await f.client`INSERT INTO block_relationships(blocker_user_id,blocked_provider_account_id) VALUES(${f.seekerId},${v.provider_account_id})`;
    r=await f.store.respondReschedule(f.actors.seeker,v.id,r.proposal.id,'withdraw',{...expected(r.viewing),expected_proposal_version:1},f.command());assert.equal(r.proposal.state,'WITHDRAWN');
    const cancelled=await f.store.cancel(f.actors.seeker,v.id,{...expected(r.viewing),reason:'SAFETY'},f.command());assert.equal(cancelled.viewing.state,'CANCELLED_BY_SEEKER');
    await f.store.appointmentsOnce();assert.equal((await f.client`SELECT id FROM viewing_scheduled_actions WHERE state IN ('PENDING','LEASED')`).length,0);assert.equal((await f.client`SELECT id FROM viewing_notices WHERE source_action_id IS NOT NULL`).length,0);
  }finally{await f.close();}
});

void integration('G3-F2 notice previews never carry instructions, times or location; reads are per actor, idempotent and current-authority protected',async()=>{
  const f=await fixture();try{
    const v=await schedule(f),seeker=await f.store.listNotices(f.actors.seeker,{viewing_id:v.id}),provider=await f.store.listNotices(f.actors.provider,{viewing_id:v.id});
    assert.equal(seeker.items.length,4);assert.equal(provider.items.length,4);assert.equal(JSON.stringify(seeker).includes(guidance),false);
    assert.equal(JSON.stringify(seeker).includes(v.scheduled_start!),false);
    for(const n of seeker.items)assert.deepEqual(Object.keys(n).sort(),['available_at','event_at','event_type','external_state','id','inbox_state','read_at','recipient_side','schedule_version','viewing_id'].sort());
    const n=seeker.items[0]!,read=await f.store.readNotice(f.actors.seeker,n.id);assert.ok(read.read_at);assert.equal((await f.store.readNotice(f.actors.seeker,n.id)).read_at,read.read_at);assert.equal((await effects(f)).reads,1);
    await assert.rejects(f.store.readNotice(f.actors.provider,n.id),{code:'RESOURCE_SCOPE_DENIED'});await assert.rejects(f.store.readNotice(f.actors.other,n.id),{code:'RESOURCE_SCOPE_DENIED'});
    await f.client`UPDATE interactions SET listing_id=${f.otherListingId} WHERE id=${v.interaction_id}`;
    await assert.rejects(f.store.readNotice(f.actors.seeker,n.id),{code:'RESOURCE_SCOPE_DENIED'});assert.equal((await f.store.listNotices(f.actors.seeker)).items.length,0);
    await assert.rejects(f.client`UPDATE viewing_notices SET event_type='viewing_cancelled' WHERE id=${n.id}`,/append-only/);
    await assert.rejects(f.client`DELETE FROM viewing_notice_reads WHERE notice_id=${n.id}`,/append-only/);
  }finally{await f.close();}
});

void integration('G3-F2 organization notices target stable ProviderAccount and require current role and exact Interaction assignment after replacement',async()=>{
  const f=await fixture();try{
    const org=await organizationAssignmentFixture(f.client),assignments=new OrganizationAssignmentStore(f.client),resource=org.resource('INTERACTION');
    const assignment=await assignments.assign(org.actors.owner,resource,org.memberships.agent,{...org.command(),expectedVersion:0});
    const id=await historicalScheduled(f,72,resource.resourceId,org.actors.agent.userId);
    const event=(await f.client<{id:string}[]>`INSERT INTO viewing_events(viewing_id,interaction_id,sequence,event_type,new_state,version,schedule_version) VALUES(${id},${resource.resourceId},3,'viewing_scheduled','SCHEDULED',3,1) RETURNING id`)[0]!;
    await f.client`INSERT INTO viewing_outbox(event_id,viewing_id,event_type,safe_payload,notification_intent) VALUES(${event.id},${id},'viewing_scheduled','{}','{}')`;
    const notices=await f.store.listNotices(org.actors.agent,{viewing_id:id});assert.equal(notices.items.length,1);const noticeId=notices.items[0]!.id;
    const target=(await f.client`SELECT provider_account_id FROM viewing_notices WHERE id=${noticeId}`)[0]!;assert.equal(target.provider_account_id,org.org.provider_account_id);
    await f.store.readNotice(org.actors.agent,noticeId);
    await assert.rejects(f.store.listNotices(org.actors.analyst,{viewing_id:id}),{code:'RESOURCE_SCOPE_DENIED'});
    await assignments.revoke(org.actors.owner,resource,assignment.id,{...org.command(),expectedVersion:assignment.version});
    await assert.rejects(f.store.readNotice(org.actors.agent,noticeId),{code:'RESOURCE_SCOPE_DENIED'});
    await assignments.assign(org.actors.owner,resource,org.memberships.manager,{...org.command(),expectedVersion:0});
    const replacementNotices=await f.store.listNotices(org.actors.manager,{viewing_id:id});assert.equal(replacementNotices.items[0]!.id,noticeId);assert.equal(replacementNotices.items[0]!.read_at,null);
    const v=await f.store.get(org.actors.manager,id);await assert.rejects(f.store.proposeReschedule(org.actors.manager,id,replacement(v),org.command()),{code:'CAPABILITY_RESTRICTED'});
  }finally{await f.close();}
});

void integration('G3-F2 reminder worker batch bounds reject invalid limits and do not fabricate external delivery',async()=>{
  const f=await fixture();try{
    // Analyze the single expiry action before confirmation adds both reminders.
    // This valid stale-statistics plan exposed rescans of the locking subquery.
    const v=await schedule(f,72,async()=>{await f.client`ANALYZE viewing_scheduled_actions`;});
    const before=await f.client`SELECT id,attempts FROM viewing_scheduled_actions WHERE action_type LIKE 'REMINDER_%' ORDER BY id`;
    assert.equal(before.length,2);assert.ok(before.every(row=>row.attempts===0));
    await assert.rejects(f.store.appointmentsOnce(0),{code:'INVALID_INPUT'});
    await assert.rejects(f.store.appointmentsOnce(101),{code:'INVALID_INPUT'});
    assert.deepEqual(await f.client`SELECT id,attempts FROM viewing_scheduled_actions WHERE action_type LIKE 'REMINDER_%' ORDER BY id`,before);
    await f.store.appointmentsOnce(1);
    const claimed=await f.client`SELECT id FROM viewing_scheduled_actions WHERE action_type LIKE 'REMINDER_%' AND attempts>0`;
    assert.ok(claimed.length<=1);assert.equal(claimed.length,1);
    assert.equal((await f.store.reminderStatus(f.actors.seeker,v.id)).external_state,'NOT_ENABLED');
  }finally{await f.close();}
});

function dedicated(){const c=postgres(url!,{max:1,prepare:false});drizzle(c);return c;}
async function waiting(client:Fixture['client'],pid:number){for(let i=0;i<1000;i++){if((await client`SELECT pid FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'`)[0])return;await new Promise<void>(r=>setImmediate(r));}throw Error('Expected controlled G3-F2 lock barrier');}
for(const operation of ['proposal','approval'] as const)void integration(`G3-F2 controlled concurrent ${operation} rejects stale writer and converges without duplicate schedule effects`,async()=>{
  const f=await fixture(),a=dedicated(),b=dedicated(),gate=dedicated();let release!:()=>void;let holder:Promise<unknown>|undefined;const pending:Promise<PromiseSettledResult<unknown>[]>[]=[];
  try{
    const v=await schedule(f);const initial=operation==='approval'?await f.store.proposeReschedule(f.actors.seeker,v.id,replacement(v),f.command()):null;
    let ready!:()=>void;const held=new Promise<void>(r=>{ready=r;}),free=new Promise<void>(r=>{release=r;});
    holder=gate.begin(async tx=>{if(operation==='proposal')await tx`LOCK TABLE viewing_reschedule_proposals IN SHARE MODE`;else await tx`LOCK TABLE viewing_events IN SHARE MODE`;ready();await free;});await held;
    const pidA=(await a<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid,pidB=(await b<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    const one=new ViewingAppointmentStore(a,true),two=new ViewingAppointmentStore(b,true);
    const invoke=(store:ViewingAppointmentStore,side:'seeker'|'provider')=>initial?store.respondReschedule(f.actors[side],v.id,initial.proposal.id,'accept',{...expected(initial.viewing),expected_proposal_version:1},f.command()):store.proposeReschedule(f.actors[side],v.id,replacement(v),f.command());
    pending.push(Promise.allSettled([invoke(one,'seeker')]));await waiting(f.client,pidA);pending.push(Promise.allSettled([invoke(two,'provider')]));await waiting(f.client,pidB);release();await holder;
    assert.equal((await pending[0]!)[0]!.status,'fulfilled');const second=(await pending[1]!)[0]!;assert.equal(second.status,'rejected');assert.equal((second as PromiseRejectedResult).reason.code,'STALE_VERSION');
    assert.equal((await effects(f)).proposals,1);assert.equal((await f.store.get(f.actors.seeker,v.id)).schedule_version,1);
    if(initial){const current=await f.store.get(f.actors.provider,v.id),p=(await f.store.listReschedules(f.actors.provider,v.id)).items[0]!;const final=await f.store.respondReschedule(f.actors.provider,v.id,p.id,'accept',{...expected(current),expected_proposal_version:p.version},f.command());assert.equal(final.viewing.schedule_version,2);assert.equal((await effects(f)).history,1);}
  }finally{release?.();await holder?.catch(()=>{});await Promise.all(pending);await Promise.all([a.end(),b.end(),gate.end()]);await f.close();}
});

void integration('G3-F2 unanswered proposal expires once without replacing the schedule and forbids retroactive approval',async()=>{
  const f=await fixture();try{
    const v=await schedule(f);
    const p=(await f.client<{id:string}[]>`INSERT INTO viewing_reschedule_proposals(viewing_id,base_schedule_version,base_scheduled_start,proposed_start,proposed_end,display_timezone,proposed_by_user_id,proposed_by_side,expires_at,created_at,updated_at)
      SELECT id,schedule_version,scheduled_start,scheduled_start+interval '1 day',scheduled_end+interval '1 day',display_timezone,seeker_user_id,'SEEKER',statement_timestamp()-interval '1 day',statement_timestamp()-interval '3 days',statement_timestamp()-interval '3 days' FROM viewings WHERE id=${v.id} RETURNING id`)[0]!;
    await f.client`INSERT INTO viewing_scheduled_actions(viewing_id,action_type,proposal_id,expected_schedule_version,due_at) SELECT viewing_id,'EXPIRE_RESCHEDULE',id,base_schedule_version,expires_at FROM viewing_reschedule_proposals WHERE id=${p.id}`;
    const before=await effects(f);await assert.rejects(f.store.respondReschedule(f.actors.provider,v.id,p.id,'accept',{...expected(v),expected_proposal_version:1},f.command()),{code:'PROPOSAL_EXPIRED'});assert.deepEqual(await effects(f),before);
    assert.equal((await f.store.appointmentsOnce()).processed,1);assert.equal((await f.store.listReschedules(f.actors.seeker,v.id)).items[0]!.state,'EXPIRED');
    assert.equal((await f.store.get(f.actors.seeker,v.id)).scheduled_start,v.scheduled_start);const after=await effects(f);await f.store.appointmentsOnce();assert.deepEqual(await effects(f),after);
  }finally{await f.close();}
});
for(const earlier of ['existing-start','replacement-start'] as const)void integration(`G3-F2 proposal deadline is bounded by ${earlier} instead of a later 48-hour window`,async()=>{
  const f=await fixture();try{
    const v=await schedule(f,1),input=replacement(v);
    if(earlier==='replacement-start'){input.proposed_start=new Date(Date.parse(v.scheduled_start!)-30*60000).toISOString();input.proposed_end=new Date(Date.parse(v.scheduled_start!)-15*60000).toISOString();}
    const r=await f.store.proposeReschedule(f.actors.seeker,v.id,input,f.command());assert.equal(r.proposal.expires_at,earlier==='existing-start'?v.scheduled_start:input.proposed_start);
  }finally{await f.close();}
});

void integration('G3-F2 reminder effect failure rolls back notices/audit; an unexpired lease cannot replay and expired ownership recovers once',async()=>{
  const f=await fixture();try{
    const id=await historicalScheduled(f,23);await historicJobs(f,id);await f.client`ALTER TABLE viewing_notices ADD CONSTRAINT f2_test_reminder_failure CHECK(event_type<>'viewing_reminder_24h')`;
    await assert.rejects(f.store.appointmentsOnce());assert.equal((await f.client`SELECT id FROM viewing_notices WHERE source_action_id IS NOT NULL`).length,0);assert.equal((await f.client`SELECT id FROM audit_events WHERE action='VIEWING_REMINDER_AVAILABLE'`).length,0);
    await f.client`ALTER TABLE viewing_notices DROP CONSTRAINT f2_test_reminder_failure`;assert.equal((await f.store.appointmentsOnce()).processed,0);
    await f.client`UPDATE viewing_scheduled_actions SET lease_until=statement_timestamp()-interval '1 minute' WHERE state='LEASED'`;
    assert.equal((await f.store.appointmentsOnce()).processed,1);await f.store.appointmentsOnce();assert.equal((await f.client`SELECT id FROM viewing_notices WHERE source_action_id IS NOT NULL`).length,2);assert.equal((await f.client`SELECT id FROM audit_events WHERE action='VIEWING_REMINDER_AVAILABLE'`).length,1);
  }finally{await f.client`ALTER TABLE viewing_notices DROP CONSTRAINT IF EXISTS f2_test_reminder_failure`;await f.close();}
});
void integration('G3-F2 context loss permanently invalidates pending proposal work instead of reviving it when linkage is restored',async()=>{
  const f=await fixture();try{
    const v=await schedule(f),key=f.command(),input=replacement(v),r=await f.store.proposeReschedule(f.actors.seeker,v.id,input,key);
    await f.client`UPDATE interactions SET listing_id=${f.otherListingId} WHERE id=${v.interaction_id}`;await f.store.appointmentsOnce();
    await assert.rejects(f.store.respondReschedule(f.actors.provider,v.id,r.proposal.id,'accept',{...expected(r.viewing),expected_proposal_version:1},f.command()),{code:'RESOURCE_SCOPE_DENIED'});
    await f.client`UPDATE interactions SET listing_id=${v.listing_id} WHERE id=${v.interaction_id}`;
    const replay=await f.store.proposeReschedule(f.actors.seeker,v.id,input,key);assert.equal(replay.replayed,true);assert.equal(replay.proposal.state,'INVALIDATED');assert.equal(replay.proposal.can_accept,false);assert.equal(replay.viewing.scheduled_start,v.scheduled_start);
  }finally{await f.close();}
});
void integration('G3-F2 current proposal is returned independently of the paginated historical page',async()=>{
  const f=await fixture();try{
    const v=await schedule(f),historic='ffffffff-ffff-4fff-8fff-ffffffffffff';
    await f.client`INSERT INTO viewing_reschedule_proposals(id,viewing_id,base_schedule_version,base_scheduled_start,proposed_start,proposed_end,display_timezone,proposed_by_user_id,proposed_by_side,expires_at)
      SELECT ${historic},id,schedule_version,scheduled_start,scheduled_start+interval '1 day',scheduled_end+interval '1 day',display_timezone,seeker_user_id,'SEEKER',LEAST(statement_timestamp()+interval '48 hours',scheduled_start) FROM viewings WHERE id=${v.id}`;
    await f.client`UPDATE viewing_reschedule_proposals SET state='WITHDRAWN',version=version+1 WHERE id=${historic}`;
    const r=await f.store.proposeReschedule(f.actors.provider,v.id,replacement(v),f.command()),page=await f.store.listReschedules(f.actors.seeker,v.id,{limit:1});
    assert.equal(page.items.length,1);assert.equal(page.items[0]!.id,historic);assert.equal(page.current_proposal!.id,r.proposal.id);assert.equal(page.current_proposal!.can_accept,true);assert.ok(page.next_cursor);
  }finally{await f.close();}
});

void integration('G3-F2 controlled reminder notice lock wait crosses the canonical window and rolls back stale availability',async()=>{
  const f=await fixture(),worker=dedicated(),gate=dedicated();let release!:()=>void;let holder:Promise<unknown>|undefined;let pending:Promise<PromiseSettledResult<unknown>[]>|undefined;
  try{
    const id=await historicalScheduled(f,72);await historicJobs(f,id);
    // Only this guarded TEST connection resolves the fixture clock first.
    // Production uses the unchanged PostgreSQL builtin and has no clock hook.
    await f.client`CREATE TABLE f2_test_clock(value timestamptz NOT NULL)`;
    await f.client`INSERT INTO f2_test_clock SELECT scheduled_start-interval '23 hours' FROM viewings WHERE id=${id}`;
    await f.client.unsafe("CREATE FUNCTION public.statement_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT value FROM public.f2_test_clock'");
    await worker`SET search_path TO public,pg_catalog`;
    const pid=(await worker<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    let ready!:()=>void;const held=new Promise<void>(r=>{ready=r;}),free=new Promise<void>(r=>{release=r;});
    holder=gate.begin(async tx=>{await tx`LOCK TABLE viewing_notices IN SHARE MODE`;ready();await free;});await held;
    pending=Promise.allSettled([new ViewingAppointmentStore(worker,true).appointmentsOnce(1)]);await waiting(f.client,pid);
    await f.client`UPDATE f2_test_clock SET value=(SELECT scheduled_start-interval '1 hour' FROM viewings WHERE id=${id})`;
    release();await holder;const result=(await pending)[0]!;assert.equal(result.status,'fulfilled');assert.equal((result as PromiseFulfilledResult<{processed:number;skipped:number}>).value.processed,0);assert.equal((result as PromiseFulfilledResult<{skipped:number}>).value.skipped,1);
    assert.equal((await f.client`SELECT id FROM viewing_notices WHERE source_action_id IS NOT NULL`).length,0);assert.equal((await f.client`SELECT id FROM audit_events WHERE action='VIEWING_REMINDER_AVAILABLE'`).length,0);
    assert.equal((await f.client`SELECT state FROM viewing_scheduled_actions WHERE action_type='REMINDER_24H'`)[0]!.state,'SKIPPED');
  }finally{release?.();await holder?.catch(()=>{});await pending;await worker.end();await gate.end();await f.client.unsafe('DROP FUNCTION IF EXISTS public.statement_timestamp()');await f.client`DROP TABLE IF EXISTS f2_test_clock`;await f.close();}
});

void integration('G3-F2 additive migration keeps pending proposals and reminders cancelled for a compatible F1 writer',async()=>{
  const f=await fixture();try{
    const {ViewingStore}=await import('./viewing.js');const v=await schedule(f),r=await f.store.proposeReschedule(f.actors.seeker,v.id,replacement(v),f.command());
    await new ViewingStore(f.client,true).cancel(f.actors.seeker,v.id,{...expected(r.viewing),reason:'PLANS_CHANGED'},f.command());
    assert.equal((await f.store.listReschedules(f.actors.seeker,v.id)).items[0]!.state,'INVALIDATED');assert.equal((await f.client`SELECT id FROM viewing_scheduled_actions WHERE state IN ('PENDING','LEASED')`).length,0);
  }finally{await f.close();}
});
