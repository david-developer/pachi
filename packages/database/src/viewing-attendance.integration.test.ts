import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createDatabase } from './client.js';
import { viewingFixture } from './viewing-fixture.js';
import { ViewingAttendanceStore } from './viewing-attendance.js';
import { OrganizationAssignmentStore } from './organization-assignments.js';
import { organizationAssignmentFixture } from './organization-assignment-fixture.js';
import type { ViewingResponse } from './viewing.js';

const url=process.env.DATABASE_TEST_URL;
if(url){const u=new URL(url);assert.equal(u.hostname,'localhost');assert.equal(u.port,'5433');assert.equal(u.pathname,'/pachi_test');}
const integration=url?test:test.skip;
type Fixture=Awaited<ReturnType<typeof fixture>>;
const expected=(v:ViewingResponse)=>({expected_version:v.version,expected_schedule_version:v.schedule_version});
async function fixture(){
  const {client}=createDatabase(url!);await client`SET client_min_messages TO warning`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client`UPDATE region_publication_controls SET enabled=true`;
  return {...await viewingFixture(client),client,store:new ViewingAttendanceStore(client,true),async close(){
    await client.unsafe('DROP FUNCTION IF EXISTS public.statement_timestamp()');await client.unsafe('DROP FUNCTION IF EXISTS public.clock_timestamp()');await client`DROP TABLE IF EXISTS f3_test_clock`;
    await client`UPDATE region_publication_controls SET enabled=true`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client.end();
  }};
}
async function scheduled(f:Fixture,startMinutes=-180,interactionId=f.interaction.interaction_id,providerActor=f.actors.provider.userId,reader=f.actors.seeker){
  const inserted=(await f.client<{id:string}[]>`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,proposed_start,proposed_end,display_timezone,response_deadline,created_at,updated_at)
    SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.seeker_user_id,statement_timestamp()+${startMinutes}*interval '1 minute',statement_timestamp()+${startMinutes+60}*interval '1 minute','Africa/Douala',
      statement_timestamp()-interval '5 days',statement_timestamp()-interval '7 days',statement_timestamp()-interval '7 days' FROM interactions i WHERE i.id=${interactionId} RETURNING id`)[0]!;
  await f.client`UPDATE viewings SET state='ACCEPTED',scheduled_start=proposed_start,scheduled_end=proposed_end,private_instructions='SYNTHETIC_PRIVATE_GUIDANCE_F3',accepted_by_user_id=${providerActor},accepted_at=created_at+interval '1 hour',version=version+1 WHERE id=${inserted.id}`;
  await f.client`UPDATE viewings SET state='SCHEDULED',seeker_confirmed=true,provider_confirmed=true,version=version+1 WHERE id=${inserted.id}`;
  return f.store.get(reader,inserted.id);
}
async function clock(f:Fixture){
  await f.client`UPDATE security_sessions SET expires_at=statement_timestamp()+interval '90 days'`;
  await f.client`CREATE TABLE f3_test_clock(value timestamptz NOT NULL)`;await f.client`INSERT INTO f3_test_clock VALUES(statement_timestamp())`;
  await f.client.unsafe("CREATE FUNCTION public.statement_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT value FROM public.f3_test_clock'");
  await f.client.unsafe("CREATE FUNCTION public.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT value FROM public.f3_test_clock'");
  await f.client`SET search_path TO public,pg_catalog`;
}
async function deadline(f:Fixture,id:string,delta:string='0 seconds'){
  await f.client`UPDATE f3_test_clock SET value=(SELECT response_deadline FROM viewing_attendance_claims WHERE id=${id})+${delta}::interval`;
}
async function effects(f:Fixture){return(await f.client`SELECT
  (SELECT count(*)::int FROM viewing_attendance_claims) AS claims,(SELECT count(*)::int FROM viewing_attendance_outcomes) AS outcomes,
  (SELECT count(*)::int FROM viewing_events) AS events,(SELECT count(*)::int FROM viewing_outbox) AS outbox,
  (SELECT count(*)::int FROM viewing_command_receipts) AS receipts,(SELECT count(*)::int FROM viewing_notices) AS notices,
  (SELECT count(*)::int FROM viewing_attendance_cases) AS cases,(SELECT count(*)::int FROM viewing_attendance_reports) AS reports,
  (SELECT count(*)::int FROM viewing_review_eligibilities) AS eligibilities,(SELECT count(*)::int FROM viewing_no_show_events WHERE invalidated_at IS NULL) AS no_shows`)[0]!;}

for(const side of ['seeker','provider'] as const)void integration(`G3-F3 ${side} completion claim waits for exact counterparty confirmation and creates first bilateral eligibility once`,async()=>{
  const f=await fixture();try{
    const v=await scheduled(f),r=await f.store.claimAttendance(f.actors[side],v.id,{...expected(v),claim_type:'COMPLETION'},f.command());
    assert.equal(r.viewing.state,'SCHEDULED');assert.equal(r.attendance.state,'AWAITING_VALIDATION');assert.equal(r.claim.state,'PENDING');assert.equal(r.attendance.review_eligibility_created,false);assert.equal(r.attendance.version,r.viewing.version);
    assert.equal(Date.parse(r.claim.response_deadline)-Date.parse(r.claim.notice_available_at),48*3600000);assert.equal((await effects(f)).eligibilities,0);
    await assert.rejects(f.store.respondAttendance(f.actors[side],v.id,r.claim.id,'confirm',{...expected(r.viewing),expected_claim_version:1},f.command()),{code:'SELF_CONFIRMATION_DENIED'});
    const key=f.command(),input={...expected(r.viewing),expected_claim_version:1};
    const confirmed=await f.store.respondAttendance(f.actors[side==='seeker'?'provider':'seeker'],v.id,r.claim.id,'confirm',input,key);
    assert.equal(confirmed.viewing.state,'COMPLETED');assert.equal(confirmed.claim.state,'CONFIRMED');assert.equal(confirmed.attendance.outcome,'COMPLETED');assert.equal((await effects(f)).eligibilities,2);
    const before=await effects(f);assert.equal((await f.store.respondAttendance(f.actors[side==='seeker'?'provider':'seeker'],v.id,r.claim.id,'confirm',input,key)).replayed,true);assert.deepEqual(await effects(f),before);
    const slots=await f.client`SELECT reviewer_subject_type,target_type,direction,closes_at=opens_at+interval '14 days' AS duration FROM viewing_review_eligibilities ORDER BY direction`;
    assert.deepEqual(slots.map(s=>s.direction),['PROVIDER_TO_SEEKER','SEEKER_TO_PROVIDER']);assert.ok(slots.every(s=>s.duration));
    const next=await scheduled(f),second=await f.store.claimAttendance(f.actors.seeker,next.id,{...expected(next),claim_type:'COMPLETION'},f.command());
    await f.store.respondAttendance(f.actors.provider,next.id,second.claim.id,'confirm',{...expected(second.viewing),expected_claim_version:1},f.command());assert.equal((await effects(f)).eligibilities,2);
  }finally{await f.close();}
});
for(const [minutes,type,allowed] of [[-59,'COMPLETION',false],[-30,'NO_SHOW',true],[-29,'NO_SHOW',false],[-180,'COMPLETION',true]] as const)
void integration(`G3-F3 exact database-time ${type} start ${minutes} minutes eligibility ${allowed}`,async()=>{
  const f=await fixture();try{await clock(f);const v=await scheduled(f,minutes),input=type==='COMPLETION'?{...expected(v),claim_type:'COMPLETION' as const}:{...expected(v),claim_type:'NO_SHOW' as const,absent_side:'PROVIDER' as const};
    const before=await effects(f);if(allowed){const r=await f.store.claimAttendance(f.actors.seeker,v.id,input,f.command());assert.equal(r.claim.state,'PENDING');assert.equal((await effects(f)).no_shows,0);}else{await assert.rejects(f.store.claimAttendance(f.actors.seeker,v.id,input,f.command()),{code:'CLAIM_TOO_EARLY'});assert.deepEqual(await effects(f),before);}
  }finally{await f.close();}
});
for(const side of ['seeker','provider'] as const)void integration(`G3-F3 ${side} no-show requires opposite alleged side and validation; late dispute invalidates operational effect`,async()=>{
  const f=await fixture();try{const v=await scheduled(f),input={...expected(v),claim_type:'NO_SHOW' as const,absent_side:(side==='seeker'?'PROVIDER':'SEEKER') as 'SEEKER'|'PROVIDER'};
    await assert.rejects(f.store.claimAttendance(f.actors[side],v.id,{...input,absent_side:side==='seeker'?'SEEKER':'PROVIDER'},f.command()),{code:'INVALID_INPUT'});
    const r=await f.store.claimAttendance(f.actors[side],v.id,input,f.command());assert.equal((await effects(f)).no_shows,0);
    const actor=f.actors[side==='seeker'?'provider':'seeker'],confirmed=await f.store.respondAttendance(actor,v.id,r.claim.id,'confirm',{...expected(r.viewing),expected_claim_version:1},f.command());
    assert.equal(confirmed.attendance.outcome,input.absent_side+'_NO_SHOW');assert.equal((await effects(f)).no_shows,1);assert.equal((await effects(f)).eligibilities,0);
    const disputed=await f.store.respondAttendance(actor,v.id,r.claim.id,'dispute',{...expected(confirmed.viewing),expected_claim_version:2,reason:'OUTCOME_INCORRECT'},f.command());
    assert.equal(disputed.viewing.state,'DISPUTED');assert.equal(disputed.attendance.case?.review_status,'PENDING_REVIEW');assert.equal((await effects(f)).no_shows,0);assert.equal((await f.client`SELECT id FROM viewing_no_show_events`).length,1);
  }finally{await f.close();}
});
void integration('G3-F3 contradictory claims preserve exact claims, freeze worker/reviews and retain immutable private pending case',async()=>{
  const f=await fixture();try{const v=await scheduled(f),one=await f.store.claimAttendance(f.actors.provider,v.id,{...expected(v),claim_type:'NO_SHOW',absent_side:'SEEKER'},f.command());
    const two=await f.store.claimAttendance(f.actors.provider,v.id,{...expected(one.viewing),claim_type:'COMPLETION'},f.command());
    assert.equal(two.viewing.state,'DISPUTED');assert.equal(two.attendance.claims.length,2);assert.ok(two.attendance.claims.every(c=>c.state==='DISPUTED'));assert.equal((await effects(f)).eligibilities,0);assert.equal((await effects(f)).no_shows,0);
    assert.deepEqual(await f.store.attendanceOnce(),{processed:0,skipped:0,pending:0});
    await assert.rejects(f.client`DELETE FROM viewing_attendance_claims WHERE id=${one.claim.id}`,/retained/);await assert.rejects(f.client`DELETE FROM viewing_attendance_reports`,/append-only/);await assert.rejects(f.client`UPDATE viewing_attendance_cases SET state='OPEN'`,/append-only/);
    const previews=JSON.stringify(await f.store.listNotices(f.actors.seeker,{viewing_id:v.id}));assert.equal(previews.includes('SYNTHETIC_PRIVATE_GUIDANCE_F3'),false);assert.equal(previews.includes(v.scheduled_start!),false);
  }finally{await f.close();}
});
void integration('G3-F3 matching second claim cannot bypass exact confirmation; idempotency replay/conflict/cross-command namespace stay effect-free',async()=>{
  const f=await fixture();try{const v=await scheduled(f),input={...expected(v),claim_type:'COMPLETION' as const},key=f.command(),r=await f.store.claimAttendance(f.actors.seeker,v.id,input,key),before=await effects(f);
    assert.equal((await f.store.claimAttendance(f.actors.seeker,v.id,input,key)).replayed,true);assert.deepEqual(await effects(f),before);
    await assert.rejects(f.store.claimAttendance(f.actors.seeker,v.id,{...input,claim_type:'NO_SHOW',absent_side:'PROVIDER'},key),{code:'IDEMPOTENCY_KEY_REUSED'});
    await assert.rejects(f.store.cancel(f.actors.seeker,v.id,{...expected(r.viewing),reason:'SAFETY'},key),{code:'IDEMPOTENCY_KEY_REUSED'});
    await assert.rejects(f.store.claimAttendance(f.actors.provider,v.id,{...expected(r.viewing),claim_type:'COMPLETION'},f.command()),{code:'ATTENDANCE_CLAIM_EXISTS'});assert.deepEqual(await effects(f),before);
  }finally{await f.close();}
});
for(const restriction of ['other','blocked','limited','provider-limited','phone','restricted','session'] as const)void integration(`G3-F3 ${restriction} denies new claims; safe current participant dispute remains available when permitted`,async()=>{
  const f=await fixture();try{const v=await scheduled(f),r=await f.store.claimAttendance(f.actors.provider,v.id,{...expected(v),claim_type:'COMPLETION'},f.command()),before=await effects(f);let actor=f.actors.seeker,code='CAPABILITY_RESTRICTED';
    if(restriction==='other'){actor=f.actors.other;code='RESOURCE_SCOPE_DENIED';}
    if(restriction==='blocked')await f.client`INSERT INTO block_relationships(blocker_user_id,blocked_provider_account_id) VALUES(${f.seekerId},${v.provider_account_id})`;
    if(restriction==='limited'||restriction==='provider-limited')await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${restriction==='limited'?f.seekerId:f.providerUserId}`;
    if(restriction==='phone')await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${f.seekerId}`;
    if(restriction==='restricted')await f.client`UPDATE interactions SET state='RESTRICTED',version=version+1 WHERE id=${v.interaction_id}`;
    if(restriction==='session'){await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${actor.sessionId}`;code='AUTH_REQUIRED';}
    await assert.rejects(f.store.respondAttendance(actor,v.id,r.claim.id,'confirm',{...expected(r.viewing),expected_claim_version:1},f.command()),{code});assert.deepEqual(await effects(f),before);
    if(!['other','session'].includes(restriction)){const d=await f.store.respondAttendance(actor,v.id,r.claim.id,'dispute',{...expected(r.viewing),expected_claim_version:1,reason:'SAFETY'},f.command());assert.equal(d.viewing.state,'DISPUTED');}
  }finally{await f.close();}
});
void integration('G3-F3 market closure/archive/freshness/region suppression preserves existing attendance validation without new viewing authority',async()=>{
  const f=await fixture();try{const v=await scheduled(f);await f.client`UPDATE listings SET publication_status='ARCHIVED',market_status='RENTED',last_confirmed_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day' WHERE id=${f.listingId}`;await f.client`UPDATE region_publication_controls SET enabled=false`;
    const r=await f.store.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},f.command());const done=await f.store.respondAttendance(f.actors.provider,v.id,r.claim.id,'confirm',{...expected(r.viewing),expected_claim_version:1},f.command());assert.equal(done.viewing.state,'COMPLETED');assert.equal((await f.store.attendance(f.actors.seeker,v.id)).state,'COMPLETED');
    await assert.rejects(f.store.create(f.actors.seeker,v.interaction_id,f.input,f.command()),{code:'CAPABILITY_RESTRICTED'});
  }finally{await f.close();}
});
void integration('G3-F3 stale/foreign schedules, claims and tuples cannot change outcomes or disclose private claims',async()=>{
  const f=await fixture();try{const v=await scheduled(f),r=await f.store.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},f.command()),before=await effects(f);
    for(const [delta,code] of [[{expected_schedule_version:2},'STALE_SCHEDULE_VERSION'],[{expected_version:1},'STALE_VERSION'],[{expected_claim_version:2},'STALE_CLAIM_VERSION']] as const)await assert.rejects(f.store.respondAttendance(f.actors.provider,v.id,r.claim.id,'confirm',{...expected(r.viewing),expected_claim_version:1,...delta},f.command()),{code});
    await assert.rejects(f.store.respondAttendance(f.actors.provider,v.id,randomUUID(),'confirm',{...expected(r.viewing),expected_claim_version:1},f.command()),{code:'RESOURCE_SCOPE_DENIED'});await assert.rejects(f.store.attendance(f.actors.other,v.id),{code:'RESOURCE_SCOPE_DENIED'});
    await f.client`UPDATE interactions SET listing_id=${f.otherListingId} WHERE id=${v.interaction_id}`;await assert.rejects(f.store.attendance(f.actors.seeker,v.id),{code:'RESOURCE_SCOPE_DENIED'});await f.client`UPDATE interactions SET listing_id=${v.listing_id} WHERE id=${v.interaction_id}`;assert.deepEqual(await effects(f),before);
    await assert.rejects(f.store.cancel(f.actors.seeker,v.id,{...expected(r.viewing),reason:'SAFETY'},f.command()),{code:'ATTENDANCE_PENDING'});await assert.rejects(f.store.proposeReschedule(f.actors.provider,v.id,{...expected(r.viewing),proposed_start:f.input.proposed_start,proposed_end:f.input.proposed_end},f.command()),{code:'ATTENDANCE_PENDING'});
    await assert.rejects(f.client`UPDATE viewings SET state='CANCELLED_BY_SEEKER',reason='SAFETY',version=version+1 WHERE id=${v.id}`,/attendance claim prevents/);
  }finally{await f.close();}
});
void integration('G3-F3 durable notice failure rolls back claim/outcome/history/receipt atomically',async()=>{
  const f=await fixture();try{const v=await scheduled(f),before=await effects(f);await f.client`ALTER TABLE viewing_notices ADD CONSTRAINT f3_test_notice_failure CHECK(event_type<>'viewing_completion_claimed')`;
    await assert.rejects(f.store.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},f.command()));assert.deepEqual(await effects(f),before);
  }finally{await f.client`ALTER TABLE viewing_notices DROP CONSTRAINT IF EXISTS f3_test_notice_failure`;await f.close();}
});
void integration('G3-F3 late completion dispute holds both review slots and cannot grant another first-completion boundary',async()=>{
  const f=await fixture();try{const v=await scheduled(f),r=await f.store.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},f.command()),done=await f.store.respondAttendance(f.actors.provider,v.id,r.claim.id,'confirm',{...expected(r.viewing),expected_claim_version:1},f.command());
    const d=await f.store.respondAttendance(f.actors.provider,v.id,r.claim.id,'dispute',{...expected(done.viewing),expected_claim_version:2,reason:'DID_NOT_ATTEND'},f.command());assert.equal(d.attendance.state,'DISPUTED');assert.equal(d.attendance.review_eligibility_created,false);assert.equal((await f.client`SELECT id FROM viewing_review_eligibilities WHERE state='HELD'`).length,2);assert.equal((await f.client`SELECT interaction_id FROM viewing_review_boundaries`).length,1);
  }finally{await f.close();}
});

for(const type of ['COMPLETION','NO_SHOW'] as const)void integration(`G3-F3 ${type} worker exact 48-hour boundary finalizes once with unchanged notice clock`,async()=>{
  const f=await fixture();try{await clock(f);const v=await scheduled(f),r=await f.store.claimAttendance(f.actors.seeker,v.id,type==='COMPLETION'?{...expected(v),claim_type:type}:{...expected(v),claim_type:type,absent_side:'PROVIDER'},f.command());
    const before=await effects(f);await deadline(f,r.claim.id,'-1 microsecond');assert.equal((await f.store.attendanceOnce()).processed,0);assert.deepEqual(await effects(f),before);
    await deadline(f,r.claim.id);assert.equal((await f.store.attendanceOnce()).processed,1);const done=await f.store.attendance(f.actors.provider,v.id);assert.equal(done.state,type==='COMPLETION'?'COMPLETED':'PROVIDER_NO_SHOW');assert.equal(done.claims[0]!.state,'FINALIZED');
    assert.equal((await effects(f)).eligibilities,type==='COMPLETION'?2:0);assert.equal((await effects(f)).no_shows,type==='NO_SHOW'?1:0);const after=await effects(f);assert.equal((await f.store.attendanceOnce()).processed,0);assert.deepEqual(await effects(f),after);
  }finally{await f.close();}
});
for(const restriction of ['block','limited','restricted','safety-hold'] as const)void integration(`G3-F3 ${restriction} freezes worker without cancelling original response window; recovery remains idempotent`,async()=>{
  const f=await fixture();try{await clock(f);const v=await scheduled(f),r=await f.store.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},f.command());await deadline(f,r.claim.id);
    if(restriction==='block')await f.client`INSERT INTO block_relationships(blocker_user_id,blocked_provider_account_id) VALUES(${f.seekerId},${v.provider_account_id})`;
    if(restriction==='limited')await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${f.seekerId}`;
    if(restriction==='restricted')await f.client`UPDATE interactions SET state='RESTRICTED',version=version+1 WHERE id=${v.interaction_id}`;
    if(restriction==='safety-hold')await f.client`UPDATE listings SET publication_status='HIDDEN' WHERE id=${f.listingId}`;
    assert.equal((await f.store.attendanceOnce()).pending,1);assert.equal((await effects(f)).eligibilities,0);assert.equal((await f.store.attendance(f.actors.seeker,v.id)).claims[0]!.response_deadline,r.claim.response_deadline);
    if(restriction==='block')await f.client`UPDATE block_relationships SET revoked_at=statement_timestamp() WHERE revoked_at IS NULL`;
    if(restriction==='limited')await f.client`UPDATE users SET account_state='ACTIVE' WHERE id=${f.seekerId}`;
    if(restriction==='restricted')await f.client`UPDATE interactions SET state='OPEN',version=version+1 WHERE id=${v.interaction_id}`;
    if(restriction==='safety-hold')await f.client`UPDATE listings SET publication_status='PAUSED' WHERE id=${f.listingId}`;
    assert.equal((await f.store.attendanceOnce()).processed,1);assert.equal((await effects(f)).eligibilities,2);
  }finally{await f.close();}
});
void integration('G3-F3 worker recovers durable expired lease after effect failure without premature duplicate side effects',async()=>{
  const f=await fixture();try{await clock(f);const v=await scheduled(f),r=await f.store.claimAttendance(f.actors.provider,v.id,{...expected(v),claim_type:'NO_SHOW',absent_side:'SEEKER'},f.command());await deadline(f,r.claim.id);
    await f.client`ALTER TABLE viewing_notices ADD CONSTRAINT f3_test_final_notice_failure CHECK(event_type<>'viewing_attendance_finalized')`;const before=await effects(f);
    await assert.rejects(f.store.attendanceOnce());assert.deepEqual(await effects(f),before);assert.equal((await f.client`SELECT state FROM viewing_scheduled_actions WHERE action_type='FINALIZE_ATTENDANCE'`)[0]!.state,'LEASED');
    await f.client`ALTER TABLE viewing_notices DROP CONSTRAINT f3_test_final_notice_failure`;assert.equal((await f.store.attendanceOnce()).processed,0);
    await f.client`UPDATE viewing_scheduled_actions SET lease_until=statement_timestamp()-interval '1 microsecond' WHERE state='LEASED'`;assert.equal((await f.store.attendanceOnce()).processed,1);assert.equal((await effects(f)).no_shows,1);assert.equal((await f.store.attendanceOnce()).processed,0);
  }finally{await f.client`ALTER TABLE viewing_notices DROP CONSTRAINT IF EXISTS f3_test_final_notice_failure`;await f.close();}
});
void integration('G3-F3 corrupt early action due time cannot shorten claim notice response deadline; context loss terminally skips unsafe work',async()=>{
  const f=await fixture();try{await clock(f);const v=await scheduled(f),r=await f.store.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},f.command());await f.client`UPDATE viewing_scheduled_actions SET due_at=statement_timestamp() WHERE action_type='FINALIZE_ATTENDANCE'`;
    assert.equal((await f.store.attendanceOnce()).pending,1);assert.equal((await effects(f)).eligibilities,0);
    await deadline(f,r.claim.id);await f.client`UPDATE interactions SET listing_id=${f.otherListingId} WHERE id=${v.interaction_id}`;assert.equal((await f.store.attendanceOnce()).skipped,1);
    await f.client`UPDATE interactions SET listing_id=${f.listingId} WHERE id=${v.interaction_id}`;assert.equal((await f.store.attendanceOnce()).processed,0);assert.equal((await f.store.attendance(f.actors.seeker,v.id)).state,'AWAITING_VALIDATION');
  }finally{await f.close();}
});
void integration('G3-F3 worker after advertisement closure still validates exact prior appointment while no new public gate opens',async()=>{
  const f=await fixture();try{await clock(f);const v=await scheduled(f),r=await f.store.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},f.command());await deadline(f,r.claim.id);await f.client`UPDATE listings SET publication_status='ARCHIVED',market_status='RENTED' WHERE id=${f.listingId}`;await f.client`UPDATE region_publication_controls SET enabled=false`;
    assert.equal((await f.store.attendanceOnce()).processed,1);assert.equal((await f.store.attendance(f.actors.seeker,v.id)).state,'COMPLETED');
  }finally{await f.close();}
});
void integration('G3-F3 schema rejects fabricated cross-context cases/reports/review boundaries and premature finalized/foreign confirmed claims',async()=>{
  const f=await fixture();try{const v=await scheduled(f),r=await f.store.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},f.command()),o=(await f.client`SELECT id FROM viewing_attendance_outcomes`)[0]!;
    await assert.rejects(f.client`UPDATE viewing_attendance_claims SET state='FINALIZED',finalized_at=statement_timestamp(),version=version+1 WHERE id=${r.claim.id}`,/invalid attendance claim transition/);
    await assert.rejects(f.client`UPDATE viewing_attendance_claims SET state='CONFIRMED',responded_by_user_id=${f.otherUserId},responded_by_side='PROVIDER',responded_at=statement_timestamp(),finalized_at=statement_timestamp(),version=version+1 WHERE id=${r.claim.id}`,/invalid attendance claim transition/);
    await assert.rejects(f.client`INSERT INTO viewing_attendance_cases(attendance_outcome_id,viewing_id,schedule_version) VALUES(${o.id},${v.id},2)`,/invalid attendance case context/);
    await assert.rejects(f.client`INSERT INTO viewing_review_boundaries(interaction_id,attendance_outcome_id,viewing_id,seeker_user_id,provider_account_id,membership_snapshot,eligibility_state,eligibility_reason) VALUES(${v.interaction_id},${o.id},${v.id},${f.otherUserId},${v.provider_account_id},'[]','OPEN','FIRST_VALIDATED_COMPLETION')`,/invalid review boundary context/);
    const d=await f.store.respondAttendance(f.actors.provider,v.id,r.claim.id,'dispute',{...expected(r.viewing),expected_claim_version:1,reason:'OTHER'},f.command());
    await assert.rejects(f.client`INSERT INTO viewing_attendance_reports(case_id,claim_id,reporter_user_id,reporter_side,reason_code) VALUES(${d.attendance.case!.id},${r.claim.id},${f.otherUserId},'PROVIDER','OTHER')`,/invalid attendance report context/);
  }finally{await f.close();}
});
void integration('G3-F3 dispute evidence accepts only opaque messages from exact Interaction and is excluded from participant/notices projections',async()=>{
  const f=await fixture();try{const v=await scheduled(f),r=await f.store.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},f.command());
    const conversation=(await f.client`SELECT id FROM conversations WHERE interaction_id=${v.interaction_id}`)[0]!;
    const message=(await f.client`INSERT INTO messages(conversation_id,sender_user_id,sender_side,client_message_id,body) VALUES(${conversation.id},${f.providerUserId},'PROVIDER',${randomUUID()},'PRIVATE_F3_MESSAGE_EVIDENCE') RETURNING id`)[0]!;
    await assert.rejects(f.store.respondAttendance(f.actors.provider,v.id,r.claim.id,'dispute',{...expected(r.viewing),expected_claim_version:1,reason:'OTHER',evidence:[{kind:'MESSAGE',reference:randomUUID()}]},f.command()),{code:'RESOURCE_SCOPE_DENIED'});
    const d=await f.store.respondAttendance(f.actors.provider,v.id,r.claim.id,'dispute',{...expected(r.viewing),expected_claim_version:1,reason:'OTHER',evidence:[{kind:'MESSAGE',reference:message.id}]},f.command());
    const serialized=JSON.stringify(d);assert.equal(serialized.includes(message.id),false);assert.equal(serialized.includes('PRIVATE_F3_MESSAGE_EVIDENCE'),false);assert.equal(JSON.stringify(await f.store.listNotices(f.actors.seeker)).includes(message.id),false);
    assert.equal((await f.client`SELECT evidence_metadata FROM viewing_attendance_reports`)[0]!.evidence_metadata[0].reference,message.id);
  }finally{await f.close();}
});

function dedicated(){const c=postgres(url!,{max:1,prepare:false});drizzle(c);return c;}
async function waiting(client:Fixture['client'],pid:number){for(let i=0;i<1000;i++){if((await client`SELECT pid FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'`)[0])return;await new Promise<void>(r=>setImmediate(r));}throw Error('Expected controlled G3-F3 lock barrier');}
for(const operation of ['same-key','incompatible','cancel','reschedule'] as const)void integration(`G3-F3 controlled concurrent claim versus ${operation} converges without lost outcomes or duplicate effects`,async()=>{
  const f=await fixture(),a=dedicated(),b=dedicated(),gate=dedicated();let release!:()=>void;let holder:Promise<unknown>|undefined;let first:Promise<PromiseSettledResult<unknown>[]>|undefined,second:Promise<PromiseSettledResult<unknown>[]>|undefined;
  try{const v=await scheduled(f),one=new ViewingAttendanceStore(a,true),two=new ViewingAttendanceStore(b,true),key=f.command();let ready!:()=>void;const held=new Promise<void>(r=>{ready=r;}),free=new Promise<void>(r=>{release=r;});
    holder=gate.begin(async tx=>{await tx`LOCK TABLE viewing_notices IN SHARE MODE`;ready();await free;});await held;
    const pidA=(await a<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid,pidB=(await b<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    first=Promise.allSettled([one.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},key)]);await waiting(f.client,pidA);
    const next=operation==='same-key'?two.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},key):operation==='incompatible'?two.claimAttendance(f.actors.provider,v.id,{...expected(v),claim_type:'NO_SHOW',absent_side:'SEEKER'},f.command()):operation==='cancel'?two.cancel(f.actors.provider,v.id,{...expected(v),reason:'SAFETY'},f.command()):two.proposeReschedule(f.actors.provider,v.id,{...expected(v),proposed_start:f.input.proposed_start,proposed_end:f.input.proposed_end},f.command());
    second=Promise.allSettled([next]);await waiting(f.client,pidB);release();await holder;
    const leading=(await first)[0]!;assert.equal(leading.status,'fulfilled',leading.status==='rejected'?String(leading.reason?.stack??leading.reason):undefined);const result=(await second)[0]!;
    if(operation==='same-key'){assert.equal(result.status,'fulfilled');assert.equal((result as PromiseFulfilledResult<{replayed:boolean}>).value.replayed,true);}else{assert.equal(result.status,'rejected');assert.equal((result as PromiseRejectedResult).reason.code,'STALE_VERSION');}
    assert.equal((await effects(f)).claims,1);assert.equal((await effects(f)).outcomes,1);assert.equal((await effects(f)).eligibilities,0);
    if(operation==='incompatible'){const current=await f.store.get(f.actors.provider,v.id);const conflict=await f.store.claimAttendance(f.actors.provider,v.id,{...expected(current),claim_type:'NO_SHOW',absent_side:'SEEKER'},f.command());assert.equal(conflict.attendance.state,'DISPUTED');assert.equal((await effects(f)).claims,2);}
  }finally{release?.();await holder?.catch(()=>{});await Promise.all([first,second]);await Promise.all([a.end(),b.end(),gate.end()]);await f.close();}
});
void integration('G3-F3 controlled notice insertion wait starts response window only at fresh durable availability time',async()=>{
  const f=await fixture(),writer=dedicated(),gate=dedicated();let release!:()=>void;let holder:Promise<unknown>|undefined,pending:Promise<PromiseSettledResult<unknown>[]>|undefined;
  try{await clock(f);const v=await scheduled(f);await writer`SET search_path TO public,pg_catalog`;const pid=(await writer<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    let ready!:()=>void;const held=new Promise<void>(r=>{ready=r;}),free=new Promise<void>(r=>{release=r;});holder=gate.begin(async tx=>{await tx`LOCK TABLE viewing_notices IN SHARE MODE`;ready();await free;});await held;
    pending=Promise.allSettled([new ViewingAttendanceStore(writer,true).claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},f.command())]);await waiting(f.client,pid);
    await f.client`UPDATE f3_test_clock SET value=value+interval '1 hour'`;const now=(await f.client<{value:Date}[]>`SELECT value FROM f3_test_clock`)[0]!.value;release();await holder;const leading=(await pending)[0]!;assert.equal(leading.status,'fulfilled',leading.status==='rejected'?String(leading.reason?.stack??leading.reason):undefined);
    const c=(await f.store.attendance(f.actors.seeker,v.id)).claims[0]!;assert.equal(c.notice_available_at,new Date(now).toISOString());assert.equal(Date.parse(c.response_deadline),Date.parse(c.notice_available_at)+48*3600000);
  }finally{release?.();await holder?.catch(()=>{});await pending;await writer.end();await gate.end();await f.close();}
});

for(const order of ['dispute-first','worker-first'] as const)void integration(`G3-F3 controlled ${order} worker/dispute race preserves evidence and freezes or holds effects`,async()=>{
  const f=await fixture(),a=dedicated(),b=dedicated(),gate=dedicated();let release!:()=>void;let holder:Promise<unknown>|undefined,first:Promise<PromiseSettledResult<unknown>[]>|undefined,second:Promise<PromiseSettledResult<unknown>[]>|undefined;
  try{await clock(f);const v=await scheduled(f),r=await f.store.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},f.command());await deadline(f,r.claim.id);await a`SET search_path TO public,pg_catalog`;await b`SET search_path TO public,pg_catalog`;
    let ready!:()=>void;const held=new Promise<void>(r=>{ready=r;}),free=new Promise<void>(r=>{release=r;});holder=gate.begin(async tx=>{if(order==='dispute-first')await tx`LOCK TABLE viewing_attendance_reports IN SHARE MODE`;else await tx`LOCK TABLE viewing_notices IN SHARE MODE`;ready();await free;});await held;
    const pidA=(await a<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid,pidB=(await b<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    const one=new ViewingAttendanceStore(a,true),two=new ViewingAttendanceStore(b,true),dispute=(s:ViewingAttendanceStore)=>s.respondAttendance(f.actors.provider,v.id,r.claim.id,'dispute',{...expected(r.viewing),expected_claim_version:1,reason:'DID_NOT_ATTEND'},f.command());
    first=Promise.allSettled([order==='dispute-first'?dispute(one):one.attendanceOnce()]);await waiting(f.client,pidA);
    second=Promise.allSettled([order==='dispute-first'?two.attendanceOnce():dispute(two)]);await waiting(f.client,pidB);release();await holder;const leading=(await first)[0]!;assert.equal(leading.status,'fulfilled',leading.status==='rejected'?String(leading.reason?.stack??leading.reason):undefined);
    const trailing=(await second)[0]!;
    if(order==='dispute-first'){assert.equal(trailing.status,'fulfilled');assert.equal((await effects(f)).eligibilities,0);}else{
      assert.equal(trailing.status,'rejected');assert.equal((trailing as PromiseRejectedResult).reason.code,'STALE_VERSION');const now=await f.store.get(f.actors.provider,v.id),claim=(await f.store.attendance(f.actors.provider,v.id)).claims[0]!;
      await f.store.respondAttendance(f.actors.provider,v.id,claim.id,'dispute',{...expected(now),expected_claim_version:claim.version,reason:'DID_NOT_ATTEND'},f.command());assert.equal((await f.client`SELECT id FROM viewing_review_eligibilities WHERE state='HELD'`).length,2);
    }
    assert.equal((await f.store.attendance(f.actors.seeker,v.id)).state,'DISPUTED');assert.equal((await effects(f)).cases,1);assert.equal((await f.store.attendanceOnce()).processed,0);
  }finally{release?.();await holder?.catch(()=>{});await Promise.all([first,second]);await Promise.all([a.end(),b.end(),gate.end()]);await f.close();}
});
void integration('G3-F3 current organization assignment controls claims/history/replay; reassignment preserves stable principal and cannot self-confirm same side',async()=>{
  const f=await fixture();try{const org=await organizationAssignmentFixture(f.client),assignments=new OrganizationAssignmentStore(f.client),resource=org.resource('INTERACTION');const assignment=await assignments.assign(org.actors.owner,resource,org.memberships.agent,{...org.command(),expectedVersion:0});
    const v=await scheduled(f,-180,resource.resourceId,org.actors.agent.userId,org.actors.unrelated),key=f.command(),input={...expected(v),claim_type:'COMPLETION' as const},r=await f.store.claimAttendance(org.actors.agent,v.id,input,key);
    await assert.rejects(f.store.respondAttendance(org.actors.owner,v.id,r.claim.id,'confirm',{...expected(r.viewing),expected_claim_version:1},f.command()),{code:'SELF_CONFIRMATION_DENIED'});
    await assignments.revoke(org.actors.owner,resource,assignment.id,{...org.command(),expectedVersion:assignment.version});await assert.rejects(f.store.claimAttendance(org.actors.agent,v.id,input,key),{code:'RESOURCE_SCOPE_DENIED'});await assert.rejects(f.store.attendance(org.actors.agent,v.id),{code:'RESOURCE_SCOPE_DENIED'});
    await assignments.assign(org.actors.owner,resource,org.memberships.manager,{...org.command(),expectedVersion:0});const successor=await f.store.attendance(org.actors.manager,v.id);assert.equal(successor.actor_side,'PROVIDER');assert.equal(successor.claims[0]!.can_confirm,false);
    const done=await f.store.respondAttendance(org.actors.unrelated,v.id,r.claim.id,'confirm',{...expected(r.viewing),expected_claim_version:1},f.command());assert.equal(done.viewing.state,'COMPLETED');
    const providerSlot=(await f.client`SELECT reviewer_subject_id,target_id FROM viewing_review_eligibilities WHERE direction='PROVIDER_TO_SEEKER'`)[0]!;assert.equal(providerSlot.reviewer_subject_id,org.org.provider_account_id);assert.equal(providerSlot.target_id,org.actors.unrelated.userId);
    // Historical synthetic organization appointment does not enable publication
    // or new normal scheduling for its unapproved DRAFT listing.
    await assert.rejects(f.store.create(org.actors.unrelated,resource.resourceId,f.input,f.command()),{code:'CAPABILITY_RESTRICTED'});
  }finally{await f.close();}
});
void integration('G3-F3 revoked provider claimant organization assignment freezes uncontested worker while safe counterpart dispute remains available',async()=>{
  const f=await fixture();try{const org=await organizationAssignmentFixture(f.client),assignments=new OrganizationAssignmentStore(f.client),resource=org.resource('INTERACTION');const assignment=await assignments.assign(org.actors.owner,resource,org.memberships.agent,{...org.command(),expectedVersion:0});await clock(f);
    const v=await scheduled(f,-180,resource.resourceId,org.actors.agent.userId,org.actors.unrelated),r=await f.store.claimAttendance(org.actors.agent,v.id,{...expected(v),claim_type:'COMPLETION'},f.command());await deadline(f,r.claim.id);
    await assignments.revoke(org.actors.owner,resource,assignment.id,{...org.command(),expectedVersion:assignment.version});assert.equal((await f.store.attendanceOnce()).pending,1);assert.equal((await effects(f)).eligibilities,0);
    const d=await f.store.respondAttendance(org.actors.unrelated,v.id,r.claim.id,'dispute',{...expected(r.viewing),expected_claim_version:1,reason:'SAFETY'},f.command());assert.equal(d.attendance.state,'DISPUTED');assert.equal((await f.store.attendanceOnce()).processed,0);
  }finally{await f.close();}
});
void integration('G3-F3 worker assignment expiry during a notice lock wait rolls back finalization and review effects',async()=>{
  const f=await fixture(),worker=dedicated(),gate=dedicated();let release!:()=>void;let holder:Promise<unknown>|undefined,pending:Promise<PromiseSettledResult<unknown>[]>|undefined;
  try{const org=await organizationAssignmentFixture(f.client),resource=org.resource('INTERACTION');await clock(f);
    await f.client`INSERT INTO organization_resource_assignments(organization_id,provider_account_id,membership_id,resource_type,interaction_id,assigned_by_user_id,assigned_by_membership_id,grant_request_id,version,created_at,effective_at,valid_until)
      VALUES(${org.org.id},${org.org.provider_account_id},${org.memberships.agent},'INTERACTION',${resource.resourceId},${org.actors.owner.userId},${org.memberships.owner},${randomUUID()},1,statement_timestamp(),statement_timestamp(),statement_timestamp()+interval '48 hours 1 minute')`;
    const v=await scheduled(f,-180,resource.resourceId,org.actors.agent.userId,org.actors.unrelated),r=await f.store.claimAttendance(org.actors.agent,v.id,{...expected(v),claim_type:'COMPLETION'},f.command());await deadline(f,r.claim.id);
    await worker`SET search_path TO public,pg_catalog`;const pid=(await worker<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;let ready!:()=>void;const held=new Promise<void>(r=>{ready=r;}),free=new Promise<void>(r=>{release=r;});holder=gate.begin(async tx=>{await tx`LOCK TABLE viewing_notices IN SHARE MODE`;ready();await free;});await held;
    pending=Promise.allSettled([new ViewingAttendanceStore(worker,true).attendanceOnce()]);await waiting(f.client,pid);await f.client`UPDATE f3_test_clock SET value=value+interval '2 minutes'`;release();await holder;
    const result=(await pending)[0]!;assert.equal(result.status,'fulfilled');assert.equal((result as PromiseFulfilledResult<{processed:number;pending:number}>).value.processed,0);assert.equal((result as PromiseFulfilledResult<{pending:number}>).value.pending,1);assert.equal((await effects(f)).eligibilities,0);assert.equal((await f.store.attendance(org.actors.unrelated,v.id)).state,'AWAITING_VALIDATION');
  }finally{release?.();await holder?.catch(()=>{});await pending;await worker.end();await gate.end();await f.close();}
});

void integration('G3-F3 independent SQL guard rejects validation when an incompatible retained claim exists',async()=>{
  const f=await fixture();try{const v=await scheduled(f),r=await f.store.claimAttendance(f.actors.seeker,v.id,{...expected(v),claim_type:'COMPLETION'},f.command());
    const current=(await f.client`UPDATE viewings SET version=version+1 WHERE id=${v.id} RETURNING version`)[0]!;
    const e=(await f.client`INSERT INTO viewing_events(viewing_id,interaction_id,sequence,event_type,actor_user_id,actor_side,prior_state,new_state,version,schedule_version)
      VALUES(${v.id},${v.interaction_id},${current.version},'viewing_no_show_claimed',${f.providerUserId},'PROVIDER','SCHEDULED','SCHEDULED',${current.version},1) RETURNING id`)[0]!;
    const o=(await f.client`INSERT INTO viewing_outbox(event_id,viewing_id,event_type,safe_payload,notification_intent) VALUES(${e.id},${v.id},'viewing_no_show_claimed','{}','{}') RETURNING id`)[0]!;
    const n=(await f.client`SELECT id,available_at FROM viewing_notices WHERE source_outbox_id=${o.id} AND recipient_side='SEEKER'`)[0]!;
    await f.client`INSERT INTO viewing_attendance_claims(viewing_id,schedule_version,claimant_user_id,claimant_side,claim_type,claimed_outcome,counterparty_notice_id,notice_available_at,response_deadline)
      VALUES(${v.id},1,${f.providerUserId},'PROVIDER','NO_SHOW','SEEKER_NO_SHOW',${n.id},${n.available_at},${n.available_at}::timestamptz+interval '48 hours')`;
    await assert.rejects(f.client`UPDATE viewing_attendance_claims SET state='CONFIRMED',responded_by_user_id=${f.providerUserId},responded_by_side='PROVIDER',responded_at=statement_timestamp(),finalized_at=statement_timestamp(),version=version+1 WHERE id=${r.claim.id}`,/invalid attendance claim transition/);
    assert.equal((await effects(f)).eligibilities,0);assert.equal((await effects(f)).no_shows,0);assert.equal((await f.client`SELECT state FROM viewing_attendance_outcomes`)[0]!.state,'AWAITING_VALIDATION');
  }finally{await f.close();}
});


async function validated(f:Fixture,outcome:'COMPLETED'|'SEEKER_NO_SHOW'|'PROVIDER_NO_SHOW') {
  const v=await scheduled(f),side=outcome==='SEEKER_NO_SHOW'?'provider':'seeker';
  const input=outcome==='COMPLETED'?{...expected(v),claim_type:'COMPLETION' as const}:{...expected(v),claim_type:'NO_SHOW' as const,absent_side:(outcome==='SEEKER_NO_SHOW'?'SEEKER':'PROVIDER') as 'SEEKER'|'PROVIDER'};
  const c=await f.store.claimAttendance(f.actors[side],v.id,input,f.command());
  return f.store.respondAttendance(f.actors[side==='seeker'?'provider':'seeker'],v.id,c.claim.id,'confirm',{...expected(c.viewing),expected_claim_version:1},f.command());
}
async function scheduleCurrent(f:Fixture,v:ViewingResponse) {
  const accepted=await f.store.accept(f.actors.provider,v.id,{...expected(v),scheduled_start:f.input.proposed_start,scheduled_end:f.input.proposed_end,private_instructions:'SYNTHETIC_CURRENT_GUIDANCE_F3'},f.command());
  const seeker=await f.store.confirm(f.actors.seeker,v.id,expected(accepted.viewing),f.command());
  await f.store.confirm(f.actors.provider,v.id,expected(seeker.viewing),f.command());
  return f.store.get(f.actors.seeker,v.id);
}
for(const outcome of ['COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW'] as const)
for(const state of ['REQUESTED','SCHEDULED'] as const)
void integration(`G3-F3 historical ${outcome} dispute retains newer ${state}, holds its own trust effects and blocks further requests`,async()=>{
  const f=await fixture();try{
    const done=await validated(f,outcome),old=done.viewing;
    const provenance=(await f.client`SELECT v.attendance_validated_at,a.finalized_at FROM viewings v JOIN viewing_attendance_outcomes a ON a.viewing_id=v.id AND a.schedule_version=v.schedule_version WHERE v.id=${old.id}`)[0]!;
    assert.ok(provenance.attendance_validated_at);assert.equal(+provenance.attendance_validated_at,+provenance.finalized_at);
    let current=(await f.store.create(f.actors.seeker,old.interaction_id,f.input,f.command())).viewing;
    if(state==='SCHEDULED')current=await scheduleCurrent(f,current);
    const actor=done.claim.claimant_side==='SEEKER'?f.actors.provider:f.actors.seeker;
    const disputed=await f.store.respondAttendance(actor,old.id,done.claim.id,'dispute',{...expected(old),expected_claim_version:2,reason:'OUTCOME_INCORRECT'},f.command());
    assert.equal(disputed.viewing.state,'DISPUTED');assert.equal(disputed.attendance.case?.review_status,'PENDING_REVIEW');assert.equal(disputed.claim.state,'DISPUTED');
    assert.deepEqual(await f.store.get(f.actors.seeker,current.id),current);
    const retained=(await f.client`SELECT (SELECT attendance_validated_at FROM viewings WHERE id=${old.id}) AS provenance,(SELECT count(*)::int FROM viewing_review_eligibilities WHERE state='OPEN') AS open_slots,(SELECT count(*)::int FROM viewing_review_eligibilities WHERE state='HELD') AS held_slots,(SELECT count(*)::int FROM viewing_no_show_events WHERE invalidated_at IS NULL) AS no_shows,(SELECT count(*)::int FROM viewing_no_show_events WHERE invalidated_at IS NOT NULL) AS invalidated`)[0]!;
    assert.equal(+retained.provenance,+provenance.attendance_validated_at);assert.equal(retained.open_slots,0);assert.equal(retained.held_slots,outcome==='COMPLETED'?2:0);assert.equal(retained.no_shows,0);assert.equal(retained.invalidated,outcome==='COMPLETED'?0:1);
    if(state==='REQUESTED')current=await scheduleCurrent(f,current);
    assert.equal(current.state,'SCHEDULED');
    const marker=(await f.client`SELECT attendance_validated_at FROM viewings WHERE id=${current.id}`)[0]!;assert.equal(marker.attendance_validated_at,null);
    await f.store.cancel(f.actors.seeker,current.id,{...expected(current),reason:'PLANS_CHANGED'},f.command());
    assert.equal((await f.store.list(f.actors.seeker,{interaction_id:old.interaction_id})).can_request,false);
    await assert.rejects(f.store.create(f.actors.seeker,old.interaction_id,f.input,f.command()),{code:'ACTIVE_VIEWING_EXISTS'});
    await assert.rejects(f.client`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,proposed_start,proposed_end,display_timezone,response_deadline)
      VALUES(${old.interaction_id},${old.listing_id},${old.provider_account_id},${old.seeker_user_id},${old.seeker_user_id},${f.input.proposed_start},${f.input.proposed_end},'Africa/Douala',${f.input.proposed_start})`,/attendance dispute prevents new appointment/);
    assert.equal((await f.client`SELECT id FROM viewings WHERE interaction_id=${old.interaction_id}`).length,2);
    assert.equal((await f.client`SELECT id FROM viewing_attendance_cases WHERE viewing_id=${old.id}`).length,1);
    assert.equal((await f.store.attendanceOnce()).processed,0);
  }finally{await f.close();}
});
void integration('G3-F3 validation provenance cannot be fabricated or cleared to release an unvalidated or historical dispute slot',async()=>{
  const f=await fixture();try{
    const v=await scheduled(f);
    await assert.rejects(f.client`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,proposed_start,proposed_end,display_timezone,response_deadline,attendance_validated_at)
      VALUES(${v.interaction_id},${v.listing_id},${v.provider_account_id},${v.seeker_user_id},${v.seeker_user_id},${f.input.proposed_start},${f.input.proposed_end},'Africa/Douala',${f.input.proposed_start},statement_timestamp())`,/invalid viewing context/);
    await assert.rejects(f.client`UPDATE viewings SET attendance_validated_at=statement_timestamp(),version=version+1 WHERE id=${v.id}`,/validated attendance provenance is immutable/);
    const one=await f.store.claimAttendance(f.actors.provider,v.id,{...expected(v),claim_type:'COMPLETION'},f.command());
    const conflict=await f.store.claimAttendance(f.actors.seeker,v.id,{...expected(one.viewing),claim_type:'NO_SHOW',absent_side:'PROVIDER'},f.command());
    assert.equal(conflict.viewing.state,'DISPUTED');assert.equal((await f.client`SELECT attendance_validated_at FROM viewings WHERE id=${v.id}`)[0]!.attendance_validated_at,null);
    await assert.rejects(f.client`UPDATE viewings SET attendance_validated_at=statement_timestamp(),version=version+1 WHERE id=${v.id}`,/validated attendance provenance is immutable/);
    await assert.rejects(f.store.create(f.actors.seeker,v.interaction_id,f.input,f.command()),{code:'ACTIVE_VIEWING_EXISTS'});
    await f.client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const next=await viewingFixture(f.client),store=new ViewingAttendanceStore(f.client,true),fresh={...next,client:f.client,store,close:f.close};
    const done=await validated(fresh,'COMPLETED');
    await assert.rejects(f.client`UPDATE viewings SET attendance_validated_at=NULL,version=version+1 WHERE id=${done.viewing.id}`,/validated attendance provenance is immutable/);
  }finally{await f.close();}
});
for(const order of ['request-first','dispute-first'] as const)
void integration(`G3-F3 controlled historical dispute versus new request ${order} preserves one current appointment and the dispute hold`,async()=>{
  const f=await fixture(),a=dedicated(),b=dedicated(),gate=dedicated();let release!:()=>void;let holder:Promise<unknown>|undefined,first:Promise<PromiseSettledResult<unknown>[]>|undefined,second:Promise<PromiseSettledResult<unknown>[]>|undefined;
  try{
    const done=await validated(f,'COMPLETED'),one=new ViewingAttendanceStore(a,true),two=new ViewingAttendanceStore(b,true);
    let ready!:()=>void;const held=new Promise<void>(r=>{ready=r;}),free=new Promise<void>(r=>{release=r;});
    holder=gate.begin(async tx=>{await tx`LOCK TABLE viewing_notices IN SHARE MODE`;ready();await free;});await held;
    const pidA=(await a<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid,pidB=(await b<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    const request=(store:ViewingAttendanceStore)=>store.create(f.actors.seeker,done.viewing.interaction_id,f.input,f.command());
    const dispute=(store:ViewingAttendanceStore)=>store.respondAttendance(f.actors.provider,done.viewing.id,done.claim.id,'dispute',{...expected(done.viewing),expected_claim_version:2,reason:'DID_NOT_ATTEND'},f.command());
    first=Promise.allSettled([order==='request-first'?request(one):dispute(one)]);await waiting(f.client,pidA);
    second=Promise.allSettled([order==='request-first'?dispute(two):request(two)]);await waiting(f.client,pidB);release();await holder;
    assert.equal((await first)[0]!.status,'fulfilled');const trailing=(await second)[0]!;
    if(order==='request-first')assert.equal(trailing.status,'fulfilled');else{assert.equal(trailing.status,'rejected');assert.equal((trailing as PromiseRejectedResult).reason.code,'ACTIVE_VIEWING_EXISTS');}
    assert.equal((await f.store.attendance(f.actors.seeker,done.viewing.id)).state,'DISPUTED');
    assert.equal((await f.client`SELECT id FROM viewings WHERE state IN ('REQUESTED','ACCEPTED','SCHEDULED','RESCHEDULED')`).length,order==='request-first'?1:0);
    assert.equal((await f.client`SELECT id FROM viewing_attendance_cases`).length,1);assert.equal((await f.client`SELECT id FROM viewing_review_eligibilities WHERE state='HELD'`).length,2);
  }finally{release?.();await holder?.catch(()=>{});await Promise.all([first,second]);await Promise.all([a.end(),b.end(),gate.end()]);await f.close();}
});


void integration('G3-F3 later completion cannot replace the held first review boundary and both validated histories can be disputed independently',async()=>{
  const f=await fixture();try{
    await clock(f);
    // Stored defaults bind the original function OID. Rebind only TEST defaults
    // for this controlled future request/claim, then restore before clock cleanup.
    await f.client.unsafe('ALTER TABLE viewings ALTER COLUMN created_at SET DEFAULT public.statement_timestamp(), ALTER COLUMN updated_at SET DEFAULT public.statement_timestamp()');
    await f.client.unsafe('ALTER TABLE viewing_attendance_claims ALTER COLUMN claimed_at SET DEFAULT public.statement_timestamp()');
    const first=await validated(f,'COMPLETED');
    const current=await scheduleCurrent(f,(await f.store.create(f.actors.seeker,first.viewing.interaction_id,f.input,f.command())).viewing);
    await f.store.respondAttendance(f.actors.provider,first.viewing.id,first.claim.id,'dispute',{...expected(first.viewing),expected_claim_version:2,reason:'DID_NOT_ATTEND'},f.command());
    await f.client`UPDATE f3_test_clock SET value=${current.scheduled_end}::timestamptz+interval '1 microsecond'`;
    const claimed=await f.store.claimAttendance(f.actors.seeker,current.id,{...expected(current),claim_type:'COMPLETION'},f.command());
    const done=await f.store.respondAttendance(f.actors.provider,current.id,claimed.claim.id,'confirm',{...expected(claimed.viewing),expected_claim_version:1},f.command());
    assert.equal(done.viewing.state,'COMPLETED');assert.equal(done.attendance.review_eligibility_created,false);
    assert.equal((await f.client`SELECT id FROM viewing_review_eligibilities WHERE state='HELD'`).length,2);assert.equal((await f.client`SELECT id FROM viewing_review_eligibilities WHERE state='OPEN'`).length,0);
    assert.equal((await f.client`SELECT viewing_id FROM viewing_review_boundaries`)[0]!.viewing_id,first.viewing.id);
    await f.store.respondAttendance(f.actors.provider,current.id,claimed.claim.id,'dispute',{...expected(done.viewing),expected_claim_version:2,reason:'OUTCOME_INCORRECT'},f.command());
    assert.equal((await f.client`SELECT id FROM viewing_attendance_cases`).length,2);assert.equal((await f.client`SELECT id FROM viewings WHERE state='DISPUTED' AND attendance_validated_at IS NOT NULL`).length,2);
    assert.equal((await f.store.list(f.actors.seeker,{interaction_id:current.interaction_id})).can_request,false);
  }finally{
    await f.client.unsafe('ALTER TABLE viewings ALTER COLUMN created_at SET DEFAULT pg_catalog.statement_timestamp(), ALTER COLUMN updated_at SET DEFAULT pg_catalog.statement_timestamp()');
    await f.client.unsafe('ALTER TABLE viewing_attendance_claims ALTER COLUMN claimed_at SET DEFAULT pg_catalog.statement_timestamp()');
    await f.close();
  }
});
