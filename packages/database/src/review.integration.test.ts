import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { createDatabase } from './client.js';
import { viewingFixture } from './viewing-fixture.js';
import { ViewingAttendanceStore } from './viewing-attendance.js';
import { ReviewStore } from './review.js';
import { OrganizationAssignmentStore } from './organization-assignments.js';
import { organizationAssignmentFixture } from './organization-assignment-fixture.js';
import { BlockStore } from './block.js';
import type { ViewingResponse } from './viewing.js';

const url=process.env.DATABASE_TEST_URL;
if(url){const u=new URL(url);assert.equal(u.hostname,'localhost');assert.equal(u.port,'5433');assert.equal(u.pathname,'/pachi_test');}
const integration=url?test:test.skip;
const expected=(v:ViewingResponse)=>({expected_version:v.version,expected_schedule_version:v.schedule_version});
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function fixture(){
  const {client}=createDatabase(url!);await client`SET client_min_messages TO warning`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client`TRUNCATE review_reputation`;await client`UPDATE region_publication_controls SET enabled=true`;
  const f=await viewingFixture(client);
  return {...f,client,attendance:new ViewingAttendanceStore(client,true),reviews:new ReviewStore(client,true),async close(){
    await client.unsafe('DROP FUNCTION IF EXISTS public.statement_timestamp()');await client.unsafe('DROP FUNCTION IF EXISTS public.clock_timestamp()');await client`DROP TABLE IF EXISTS g1_test_clock`;
    await client`UPDATE region_publication_controls SET enabled=true`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client.end();
  }};
}
async function completed(f:Fixture,interactionId=f.interaction.interaction_id,providerUser=f.providerUserId,seeker=f.actors.seeker,provider=f.actors.provider){
  const v=(await f.client<{id:string}[]>`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,proposed_start,proposed_end,display_timezone,response_deadline,created_at,updated_at)
    SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.seeker_user_id,statement_timestamp()-interval '3 hours',statement_timestamp()-interval '2 hours','Africa/Douala',statement_timestamp()-interval '5 days',statement_timestamp()-interval '7 days',statement_timestamp()-interval '7 days'
    FROM interactions i WHERE i.id=${interactionId} RETURNING id`)[0]!;
  await f.client`UPDATE viewings SET state='ACCEPTED',scheduled_start=proposed_start,scheduled_end=proposed_end,private_instructions='SYNTHETIC_PRIVATE_G1_GUIDANCE',accepted_by_user_id=${providerUser},accepted_at=created_at+interval '1 hour',version=version+1 WHERE id=${v.id}`;
  await f.client`UPDATE viewings SET state='SCHEDULED',seeker_confirmed=true,provider_confirmed=true,version=version+1 WHERE id=${v.id}`;
  const scheduled=await f.attendance.get(seeker,v.id),claim=await f.attendance.claimAttendance(seeker,v.id,{...expected(scheduled),claim_type:'COMPLETION'},f.command());
  return f.attendance.respondAttendance(provider,v.id,claim.claim.id,'confirm',{...expected(claim.viewing),expected_claim_version:1},f.command());
}
async function clock(f:Fixture){
  await f.client`UPDATE security_sessions SET expires_at=statement_timestamp()+interval '90 days'`;
  await f.client`CREATE TABLE g1_test_clock(value timestamptz NOT NULL)`;await f.client`INSERT INTO g1_test_clock VALUES(statement_timestamp())`;
  await f.client.unsafe("CREATE FUNCTION public.statement_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT value FROM public.g1_test_clock'");
  await f.client.unsafe("CREATE FUNCTION public.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT value FROM public.g1_test_clock'");
  await f.client`SET search_path TO public,pg_catalog`;
}
async function setTime(f:Fixture,viewingId:string,delta:string){await f.client`UPDATE g1_test_clock SET value=(SELECT closes_at FROM viewing_review_eligibilities WHERE viewing_id=${viewingId} LIMIT 1)+${delta}::interval`;}
async function ownSlot(f:Fixture,id:string,side:'seeker'|'provider'='seeker'){const r=await f.reviews.eligibility(f.actors[side],id);assert.ok(r.eligibility);return r.eligibility;}
async function submit(f:Fixture,id:string,side:'seeker'|'provider'='seeker',rating=4,text=`SYNTHETIC_HELD_${side}`){const e=await ownSlot(f,id,side);return f.reviews.submit(f.actors[side],e.id,{expected_version:e.version,rating,text},f.command());}
async function counts(f:Fixture){return(await f.client`SELECT (SELECT count(*)::int FROM reviews) AS reviews,(SELECT count(*)::int FROM review_revisions) AS revisions,(SELECT count(*)::int FROM review_events) AS events,
  (SELECT count(*)::int FROM review_outbox) AS outbox,(SELECT count(*)::int FROM review_command_receipts) AS receipts,(SELECT count(*)::int FROM viewing_notices) AS notices`)[0]!;}
function dedicated(){return postgres(url!,{max:1,onnotice:()=>{},connection:{application_name:'pachi-g1-controlled-test'}});}
async function waiting(client:postgres.Sql,pid:number){for(let i=0;i<5000;i++){const r=(await client<{waiting:boolean}[]>`SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=${pid}`)[0];if(r?.waiting)return;}throw new Error('controlled lock wait not established');}

void integration('G3-G1 v2 opens at exact persisted completion and stores seven UTC calendar days with immutable policy attribution',async()=>{
  const f=await fixture();try{const done=await completed(f);
    const slots=await f.client`SELECT e.policy_version,e.opens_at=a.finalized_at AS anchor,e.closes_at=e.opens_at+interval '7 days' AS duration
      FROM viewing_review_eligibilities e JOIN viewing_attendance_outcomes a ON a.viewing_id=e.viewing_id`;
    assert.equal(slots.length,2);assert.ok(slots.every(e=>e.policy_version==='bilateral-review-v2'&&e.anchor&&e.duration));
    const r=await submit(f,done.viewing.id);assert.ok((await f.client`SELECT policy_version FROM review_events`).every(e=>e.policy_version==='bilateral-review-v2'));
    assert.equal((await f.client`SELECT policy_version FROM reviews WHERE id=${r.review.id}`)[0]!.policy_version,'bilateral-review-v2');
    await assert.rejects(f.client`UPDATE viewing_review_eligibilities SET closes_at=closes_at+interval '7 days' WHERE viewing_id=${done.viewing.id}`,/invalid review eligibility transition/);
    await assert.rejects(f.client`INSERT INTO viewing_review_eligibilities(interaction_id,viewing_id,direction,reviewer_subject_type,reviewer_subject_id,target_type,target_id,opens_at,closes_at,policy_version)
      SELECT interaction_id,viewing_id,direction,reviewer_subject_type,reviewer_subject_id,target_type,target_id,opens_at,opens_at+interval '14 days',policy_version
      FROM viewing_review_eligibilities WHERE direction='PROVIDER_TO_SEEKER'`,/review_policy_duration/);
    await assert.rejects(f.client`INSERT INTO review_events(eligibility_id,interaction_id,viewing_id,direction,event_type,version,policy_version)
      SELECT id,interaction_id,viewing_id,direction,'review_reported',99,'bilateral-review-v1' FROM viewing_review_eligibilities LIMIT 1`,/invalid review event context/);
  }finally{await f.close();}
});
void integration('G3-G1 UTC calendar duration and reminders remain exact across a session daylight-saving transition',async()=>{
  const f=await fixture();try{await clock(f);await f.client`UPDATE g1_test_clock SET value='2026-10-22T12:00:00.123Z'::timestamptz`;
    // The clock rewinds while the provider fixture was created at wall time.
    // Keep its synthetic identity current at the frozen completion/reminder,
    // including when CI runs after the fixed October 26 reminder instant.
    await f.client`UPDATE verification_claims SET valid_from=statement_timestamp(),valid_until=statement_timestamp()+interval '1 year'
      WHERE provider_profile_id IN(SELECT id FROM provider_profiles WHERE user_id=${f.providerUserId})`;
    await f.client`SET TIME ZONE 'Europe/Paris'`;await f.client.unsafe('ALTER TABLE viewing_attendance_claims ALTER COLUMN claimed_at SET DEFAULT public.statement_timestamp()');const done=await completed(f);
    assert.ok((await f.client`SELECT extract(epoch FROM e.closes_at-e.opens_at)=604800 AS duration,e.opens_at=a.finalized_at AS anchor FROM viewing_review_eligibilities e JOIN viewing_attendance_outcomes a ON a.viewing_id=e.viewing_id WHERE e.viewing_id=${done.viewing.id}`).every(e=>e.duration&&e.anchor));
    assert.ok((await f.client`SELECT extract(epoch FROM e.closes_at-j.due_at)=CASE j.action_type WHEN 'REMINDER_3D' THEN 259200 WHEN 'REMINDER_1D' THEN 86400 ELSE 0 END AS exact FROM review_scheduled_actions j JOIN viewing_review_eligibilities e ON e.id=j.eligibility_id`).every(j=>j.exact));
    assert.ok((await f.client`SELECT extract(timezone FROM opens_at)=7200 AND extract(timezone FROM closes_at)=3600 AS crosses_dst FROM viewing_review_eligibilities`).every(e=>e.crosses_dst));
    await f.client`UPDATE g1_test_clock SET value=review_utc_days_before((SELECT closes_at FROM viewing_review_eligibilities LIMIT 1),3)`;
    assert.equal((await f.client<{eligible:boolean}[]>`SELECT review_context_valid(${done.viewing.interaction_id}) AS eligible`)[0]!.eligible,true,'the frozen reminder retains current provider identity');
    await f.reviews.reviewsOnce();assert.equal((await f.client`SELECT id FROM viewing_notices WHERE event_type='review_reminder_3d'`).length,2);
  }finally{await f.client.unsafe('ALTER TABLE viewing_attendance_claims ALTER COLUMN claimed_at SET DEFAULT pg_catalog.statement_timestamp()');await f.client`SET TIME ZONE 'UTC'`;await f.close();}
});
void integration('G3-G1 empty seven-day window expires once without publication',async()=>{
  const f=await fixture();try{const done=await completed(f);await clock(f);await setTime(f,done.viewing.id,'-1 microsecond');await f.reviews.reviewsOnce();assert.ok((await f.client`SELECT state FROM viewing_review_eligibilities`).every(e=>e.state==='OPEN'));
    await setTime(f,done.viewing.id,'0 seconds');await f.reviews.reviewsOnce();assert.ok((await f.client`SELECT state FROM viewing_review_eligibilities`).every(e=>e.state==='EXPIRED'));
    assert.equal((await f.client`SELECT id FROM reviews`).length,0);assert.equal((await f.client`SELECT id FROM review_events WHERE event_type='review_window_closed'`).length,2);
    const before=await counts(f);await f.reviews.reviewsOnce();assert.deepEqual(await counts(f),before);
  }finally{await f.close();}
});
for(const state of ['UNDER_REVIEW','HIDDEN','REMOVED'] as const)void integration(`G3-G1 ${state} fixture excludes publication and reciprocal reveal without inventing moderation commands`,async()=>{
  const f=await fixture();try{const done=await completed(f),r=await submit(f,done.viewing.id);
    // TEST-only persisted-state fixture: adjudication/restoration has no application command.
    await f.client.begin(async tx=>{await tx`ALTER TABLE reviews DISABLE TRIGGER review_guard`;await tx`UPDATE reviews SET state=${state},version=version+1 WHERE id=${r.review.id}`;await tx`ALTER TABLE reviews ENABLE TRIGGER review_guard`;});
    const p=await submit(f,done.viewing.id,'provider');assert.equal(p.review.state,'SUBMITTED_HELD');assert.equal((await f.reviews.publishedProvider(done.viewing.provider_account_id)).reputation.count,0);
    await clock(f);await setTime(f,done.viewing.id,'0 seconds');await f.reviews.reviewsOnce();assert.equal((await f.reviews.own(f.actors.seeker,r.review.id)).state,state);assert.equal((await f.reviews.own(f.actors.provider,p.review.id)).state,'PUBLISHED');
    assert.equal((await f.client`SELECT id FROM review_events WHERE review_id=${r.review.id} AND event_type='review_published'`).length,0);
    await assert.rejects(f.client`UPDATE reviews SET state='PUBLISHED',published_at=statement_timestamp(),version=version+1 WHERE id=${r.review.id}`,/review is locked/);
  }finally{await f.close();}
});
// Replay the real pre-G1 schema inside a rolled-back guarded TEST transaction.
// The merged F3 writer seed omits policy fields exactly as its v1 defaults did.
void integration('G3-G1 migration 0036 retains complete v1 records, fourteen-day deadlines and versioned jobs while new defaults use v2',async()=>{
  const {client}=createDatabase(url!);const rollback=new Error('TEST_REPLAY_ROLLBACK');
  try{await assert.rejects(client.begin(async tx=>{
    await tx`SET LOCAL client_min_messages TO warning`;await tx`DROP SCHEMA public CASCADE`;await tx`CREATE SCHEMA public`;
    const journal=JSON.parse(await readFile(new URL('../migrations/meta/_journal.json',import.meta.url),'utf8')) as {entries:{tag:string}[]};
    for(const entry of journal.entries.filter(e=>Number(e.tag.slice(0,4))<36))await tx.unsafe(await readFile(new URL(`../migrations/${entry.tag}.sql`,import.meta.url),'utf8'));
    const nested=Object.assign(tx,{begin:tx.savepoint.bind(tx)}) as unknown as postgres.Sql;
    const base=await viewingFixture(nested),attendance=new ViewingAttendanceStore(nested,true),reviews=new ReviewStore(nested,true);
    const f={...base,client:nested,attendance,reviews,close:async()=>{}};
    const writer=async(inner:postgres.Sql,row:{interaction_id:string;id:string;seeker_user_id:string;provider_account_id:string},outcome:{id:string})=>{
      const b=(await inner<{opened_at:Date}[]>`INSERT INTO viewing_review_boundaries(interaction_id,attendance_outcome_id,viewing_id,seeker_user_id,provider_account_id,membership_snapshot,eligibility_state,eligibility_reason)
        VALUES(${row.interaction_id},${outcome.id},${row.id},${row.seeker_user_id},${row.provider_account_id},'[]','OPEN','FIRST_VALIDATED_COMPLETION') RETURNING opened_at`)[0]!;
      await inner`INSERT INTO viewing_review_eligibilities(interaction_id,viewing_id,direction,reviewer_subject_type,reviewer_subject_id,target_type,target_id,opens_at,closes_at)
        VALUES(${row.interaction_id},${row.id},'SEEKER_TO_PROVIDER','User',${row.seeker_user_id},'ProviderAccount',${row.provider_account_id},${b.opened_at},${b.opened_at}::timestamptz+interval '14 days'),
        (${row.interaction_id},${row.id},'PROVIDER_TO_SEEKER','ProviderAccount',${row.provider_account_id},'User',${row.seeker_user_id},${b.opened_at},${b.opened_at}::timestamptz+interval '14 days')`;
    };
    // Seed a genuine migration-0035 completion using its retained SQL guards.
    // Current application code requires migration0038 and must not be used to
    // manufacture pre-upgrade rows by adding compatibility shims or bypasses.
    await clock(f);await tx.unsafe('ALTER TABLE viewing_attendance_claims ALTER COLUMN claimed_at SET DEFAULT public.statement_timestamp()');
    const lv=(await tx<{id:string}[]>`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,proposed_start,proposed_end,display_timezone,response_deadline,created_at,updated_at)
      SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.seeker_user_id,statement_timestamp()-interval '3 hours',statement_timestamp()-interval '2 hours','Africa/Douala',statement_timestamp()-interval '5 days',statement_timestamp()-interval '7 days',statement_timestamp()-interval '7 days' FROM interactions i WHERE i.id=${base.interaction.interaction_id} RETURNING id`)[0]!;
    await tx`UPDATE viewings SET state='ACCEPTED',scheduled_start=proposed_start,scheduled_end=proposed_end,private_instructions='SYNTHETIC_LEGACY_GUIDANCE',accepted_by_user_id=${base.providerUserId},accepted_at=created_at+interval '1 hour',version=version+1 WHERE id=${lv.id}`;
    await tx`UPDATE viewings SET state='SCHEDULED',seeker_confirmed=true,provider_confirmed=true,version=version+1 WHERE id=${lv.id}`;
    const current=(await tx`UPDATE viewings SET version=version+1 WHERE id=${lv.id} RETURNING *`)[0]!;
    const event=(await tx<{id:string}[]>`INSERT INTO viewing_events(viewing_id,interaction_id,sequence,event_type,actor_user_id,actor_side,prior_state,new_state,version,schedule_version)
      VALUES(${lv.id},${current.interaction_id},${current.version},'viewing_completion_claimed',${base.seekerId},'SEEKER','SCHEDULED','SCHEDULED',${current.version},1) RETURNING id`)[0]!;
    const outbox=(await tx<{id:string}[]>`INSERT INTO viewing_outbox(event_id,viewing_id,event_type,safe_payload,notification_intent) VALUES(${event.id},${lv.id},'viewing_completion_claimed','{}','{}') RETURNING id`)[0]!;
    const notice=(await tx`SELECT id,available_at FROM viewing_notices WHERE source_outbox_id=${outbox.id} AND recipient_side='PROVIDER'`)[0]!;
    const claim=(await tx<{id:string}[]>`INSERT INTO viewing_attendance_claims(viewing_id,schedule_version,claimant_user_id,claimant_side,claim_type,claimed_outcome,counterparty_notice_id,notice_available_at,response_deadline)
      VALUES(${lv.id},1,${base.seekerId},'SEEKER','COMPLETION','COMPLETED',${notice.id},${notice.available_at},${notice.available_at}::timestamptz+interval '48 hours') RETURNING id`)[0]!;
    const outcome=(await tx<{id:string}[]>`INSERT INTO viewing_attendance_outcomes(viewing_id,schedule_version,claimed_outcome,primary_claim_id) VALUES(${lv.id},1,'COMPLETED',${claim.id}) RETURNING id`)[0]!;
    await tx`UPDATE viewing_attendance_claims SET state='CONFIRMED',version=version+1,finalized_at=statement_timestamp(),responded_at=statement_timestamp(),responded_by_user_id=${base.providerUserId},responded_by_side='PROVIDER' WHERE id=${claim.id}`;
    await tx`UPDATE viewing_attendance_outcomes SET state='COMPLETED',version=version+1,finalized_at=statement_timestamp(),validation_method='COUNTERPARTY_CONFIRMED' WHERE id=${outcome.id}`;
    const finalized=(await tx`UPDATE viewings SET state='COMPLETED',version=version+1 WHERE id=${lv.id} RETURNING *`)[0]!;
    await writer(nested,finalized as {interaction_id:string;id:string;seeker_user_id:string;provider_account_id:string},outcome);
    const legacy={viewing:await attendance.get(base.actors.seeker,lv.id)};
    const before=await tx`SELECT to_jsonb(e) AS row FROM viewing_review_eligibilities e ORDER BY id`,boundary=await tx`SELECT to_jsonb(b) AS row FROM viewing_review_boundaries b`;
    await tx.unsafe(await readFile(new URL('../migrations/0036_bilateral_reviews.sql',import.meta.url),'utf8'));
    assert.deepEqual(await tx`SELECT to_jsonb(e)-'version' AS row FROM viewing_review_eligibilities e ORDER BY id`,before);assert.deepEqual(await tx`SELECT to_jsonb(b) AS row FROM viewing_review_boundaries b`,boundary);
    await assert.rejects(tx.savepoint(async inner=>inner`INSERT INTO viewing_review_eligibilities(interaction_id,viewing_id,direction,reviewer_subject_type,reviewer_subject_id,target_type,target_id,opens_at,closes_at,policy_version)
      SELECT e.interaction_id,e.viewing_id,e.direction,e.reviewer_subject_type,e.reviewer_subject_id,e.target_type,e.target_id,b.opened_at,b.opened_at+interval '7 days',e.policy_version
      FROM viewing_review_eligibilities e JOIN viewing_review_boundaries b ON b.interaction_id=e.interaction_id WHERE e.direction='PROVIDER_TO_SEEKER'`),/review_policy_duration/);
    assert.ok((await tx`SELECT policy_version FROM review_events`).every(e=>e.policy_version==='bilateral-review-v1'));
    assert.ok((await tx`SELECT a.due_at=e.closes_at-CASE a.action_type WHEN 'REMINDER_3D' THEN interval '3 days' WHEN 'REMINDER_1D' THEN interval '1 day' ELSE interval '0 days' END AS correct FROM review_scheduled_actions a JOIN viewing_review_eligibilities e ON e.id=a.eligibility_id`).every(a=>a.correct));
    await setTime(f,legacy.viewing.id,'-7 days');const held=await submit(f,legacy.viewing.id);assert.equal(held.review.state,'SUBMITTED_HELD');assert.equal((await reviews.reviewsOnce()).published,0);
    await setTime(f,legacy.viewing.id,'-1 microsecond');assert.equal((await reviews.reviewsOnce()).published,0);await setTime(f,legacy.viewing.id,'0 seconds');assert.equal((await reviews.reviewsOnce()).published,1);
    assert.ok((await tx`SELECT policy_version FROM review_events`).every(e=>e.policy_version==='bilateral-review-v1'));assert.equal((await tx`SELECT policy_version FROM reviews`)[0]!.policy_version,'bilateral-review-v1');
    // Retain all v1 checks above, then upgrade to the current application schema.
    for(const tag of ['0037_review_moderation','0038_attendance_adjudication'])await tx.unsafe(await readFile(new URL(`../migrations/${tag}.sql`,import.meta.url),'utf8'));
    assert.ok((await tx`SELECT initial_closes_at=closes_at AND closes_at=opens_at+interval '14 days' AS retained FROM viewing_review_eligibilities WHERE viewing_id=${legacy.viewing.id}`).every(e=>e.retained));
    f.attendance=new ViewingAttendanceStore(nested,true);
    const inquiry=await f.inquiries.createOrReuseInquiry(f.otherUserId,f.listingId,randomUUID()),fresh=await completed(f,inquiry.interaction_id,f.providerUserId,f.actors.other);
    assert.ok((await tx`SELECT e.policy_version,e.opens_at=a.finalized_at AS anchor,e.closes_at=e.opens_at+interval '7 days' AS duration FROM viewing_review_eligibilities e JOIN viewing_attendance_outcomes a ON a.viewing_id=e.viewing_id WHERE e.viewing_id=${fresh.viewing.id}`).every(e=>e.policy_version==='bilateral-review-v2'&&e.anchor&&e.duration));
    assert.deepEqual(await tx`SELECT to_jsonb(b) AS row FROM viewing_review_boundaries b WHERE viewing_id=${legacy.viewing.id}`,boundary);
    assert.ok((await tx`SELECT closes_at=opens_at+interval '14 days' AS original FROM viewing_review_eligibilities WHERE viewing_id=${legacy.viewing.id}`).every(e=>e.original));
    throw rollback;
  }),error=>{if(error!==rollback)throw error;return true;});
  }finally{await client.end();}
});

void integration('G3-G1 bilateral submission consumes one slot and atomically reveals both with safe projections',async()=>{
  const f=await fixture();try{const done=await completed(f),seeker=await submit(f,done.viewing.id);
    assert.equal(seeker.review.state,'SUBMITTED_HELD');assert.equal((await f.reviews.publishedProvider(done.viewing.provider_account_id)).reputation.count,0);
    const counterpart=await f.reviews.eligibility(f.actors.provider,done.viewing.id);assert.equal(counterpart.own_review,null);assert.equal(counterpart.eligibility?.can_submit,true);
    await assert.rejects(f.reviews.own(f.actors.provider,seeker.review.id),{code:'RESOURCE_SCOPE_DENIED'});
    const provider=await submit(f,done.viewing.id,'provider',5);assert.equal(provider.review.state,'PUBLISHED');assert.equal((await f.reviews.own(f.actors.seeker,seeker.review.id)).state,'PUBLISHED');
    const publicPage=await f.reviews.publishedProvider(done.viewing.provider_account_id);assert.equal(publicPage.reputation.count,1);assert.equal(publicPage.reputation.average,null);assert.equal(publicPage.items[0]!.text,null);
    const scoped=await f.reviews.publishedProviderForActor(f.actors.provider,done.viewing.provider_account_id,{interaction_id:done.viewing.interaction_id});assert.equal(scoped.items[0]!.text,'SYNTHETIC_HELD_seeker');
    assert.equal((await f.reviews.publishedSeeker(f.actors.seeker,f.seekerId)).items[0]!.text,'SYNTHETIC_HELD_provider');
    const events=await f.client`SELECT event_type FROM review_events WHERE event_type='review_published'`;assert.equal(events.length,2);
    const own=await f.reviews.eligibility(f.actors.seeker,done.viewing.id);assert.equal(own.eligibility?.state,'CONSUMED');assert.equal(own.eligibility?.can_submit,false);
    assert.equal((await f.attendance.attendance(f.actors.provider,done.viewing.id)).review_eligibility_created,true);
  }finally{await f.close();}
});
void integration('G3-G1 exact receipt replay, payload conflict, slot version and durable unique eligibility guards',async()=>{
  const f=await fixture();try{const done=await completed(f),e=await ownSlot(f,done.viewing.id),key=f.command(),input={expected_version:e.version,rating:3,text:'SYNTHETIC_IDEMPOTENT'};
    const r=await f.reviews.submit(f.actors.seeker,e.id,input,key),before=await counts(f);assert.equal((await f.reviews.submit(f.actors.seeker,e.id,input,key)).replayed,true);assert.deepEqual(await counts(f),before);
    await assert.rejects(f.reviews.submit(f.actors.seeker,e.id,{...input,rating:4},key),{code:'IDEMPOTENCY_KEY_REUSED'});
    await assert.rejects(f.reviews.submit(f.actors.seeker,e.id,input,f.command()),{code:'STALE_VERSION'});
    await assert.rejects(f.reviews.submit(f.actors.seeker,e.id,{...input,expected_version:2},f.command()),{code:'REVIEW_ELIGIBILITY_UNAVAILABLE'});
    await assert.rejects(f.client`INSERT INTO reviews(eligibility_id,interaction_id,viewing_id,direction,reviewer_subject_type,reviewer_subject_id,author_user_id,target_type,target_id,rating)
      SELECT eligibility_id,interaction_id,viewing_id,direction,reviewer_subject_type,reviewer_subject_id,author_user_id,target_type,target_id,rating FROM reviews WHERE id=${r.review.id}`,/invalid review submission|unique/);
    assert.deepEqual(await counts(f),before);
  }finally{await f.close();}
});
void integration('G3-G1 author edits retained revisions before reveal and cannot edit after publication',async()=>{
  const f=await fixture();try{const done=await completed(f),r=await submit(f,done.viewing.id),key=f.command(),input={expected_version:r.review.version,rating:2,text:'SYNTHETIC_REVISED',criteria:{communication:4}};
    const edited=await f.reviews.edit(f.actors.seeker,r.review.id,input,key);assert.equal(edited.review.version,2);assert.equal(edited.review.text,input.text);assert.equal((await f.reviews.edit(f.actors.seeker,r.review.id,input,key)).replayed,true);
    assert.equal((await f.client`SELECT * FROM review_revisions WHERE review_id=${r.review.id}`).length,2);
    await assert.rejects(f.reviews.edit(f.actors.provider,r.review.id,input,f.command()),{code:'RESOURCE_SCOPE_DENIED'});
    await submit(f,done.viewing.id,'provider');const published=await f.reviews.own(f.actors.seeker,r.review.id);
    await assert.rejects(f.reviews.edit(f.actors.seeker,r.review.id,{...input,expected_version:published.version},f.command()),{code:'REVIEW_LOCKED'});
    await assert.rejects(f.client`UPDATE reviews SET rating=1,version=version+1 WHERE id=${r.review.id}`,/review is locked/);
    await assert.rejects(f.client`UPDATE review_revisions SET rating=1 WHERE review_id=${r.review.id}`,/append-only/);
  }finally{await f.close();}
});
for(const field of ['rating','criteria','text','unknown'] as const)void integration(`G3-G1 strict content validation rejects ${field} invalidity transactionally`,async()=>{
  const f=await fixture();try{const done=await completed(f),e=await ownSlot(f,done.viewing.id),before=await counts(f),input={expected_version:e.version,rating:field==='rating'?2.5:4,...(field==='criteria'?{criteria:{appointment_attendance:3}}:field==='text'?{text:'😀'.repeat(2001)}:{author_user_id:f.providerUserId})};
    await assert.rejects(f.reviews.submit(f.actors.seeker,e.id,input,f.command()),{code:'INVALID_INPUT'});assert.deepEqual(await counts(f),before);
  }finally{await f.close();}
});
void integration('G3-G1 Unicode limit counts code points and provider/seeker criterion sets stay distinct',async()=>{
  const f=await fixture();try{const done=await completed(f),e=await ownSlot(f,done.viewing.id);const r=await f.reviews.submit(f.actors.seeker,e.id,{expected_version:e.version,rating:5,text:'😀'.repeat(2000),criteria:{listing_accuracy:1,overall_experience:5}},f.command());assert.equal(Array.from(r.review.text!).length,2000);
    const p=await ownSlot(f,done.viewing.id,'provider');await assert.rejects(f.reviews.submit(f.actors.provider,p.id,{expected_version:p.version,rating:5,criteria:{listing_accuracy:3}},f.command()),{code:'INVALID_INPUT'});
    const accepted=await f.reviews.submit(f.actors.provider,p.id,{expected_version:p.version,rating:5,criteria:{appointment_attendance:4,overall_interaction:5}},f.command());assert.equal(accepted.review.state,'PUBLISHED');
  }finally{await f.close();}
});
for(const reason of ['outsider','opposite-slot','revoked-session','phone','account','identity','provider-state','restricted'] as const)
void integration(`G3-G1 current ${reason} denial retains all review effects`,async()=>{
  const f=await fixture();try{const done=await completed(f),e=await ownSlot(f,done.viewing.id),actor=reason==='outsider'?f.actors.other:reason==='opposite-slot'?f.actors.provider:f.actors.seeker;
    if(reason==='revoked-session')await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${actor.sessionId}`;
    if(reason==='phone')await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${actor.userId}`;
    if(reason==='account')await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${actor.userId}`;
    if(reason==='identity')await f.client`UPDATE verification_claims SET status='REVOKED',revoked_at=statement_timestamp() WHERE provider_profile_id=(SELECT provider_profile_id FROM provider_accounts WHERE id=${done.viewing.provider_account_id})`;
    if(reason==='provider-state')await f.client`UPDATE provider_accounts SET state='SUSPENDED' WHERE id=${done.viewing.provider_account_id}`;
    if(reason==='restricted')await f.client`UPDATE interactions SET state='RESTRICTED' WHERE id=${done.viewing.interaction_id}`;
    const before=await counts(f);await assert.rejects(f.reviews.submit(actor,e.id,{expected_version:e.version,rating:4},f.command()));assert.deepEqual(await counts(f),before);
  }finally{await f.close();}
});
void integration('G3-G1 ordinary blocking cannot cancel a review window, reveal content early or suppress unfavorable reputation',async()=>{
  const f=await fixture();try{const done=await completed(f);await new BlockStore(f.client,true).block(f.actors.provider,'interaction',done.viewing.interaction_id,f.command());const e=await ownSlot(f,done.viewing.id);assert.equal(e.can_submit,true);
    const r=await submit(f,done.viewing.id,'seeker',1);assert.equal(r.review.state,'SUBMITTED_HELD');assert.equal((await f.reviews.publishedProvider(done.viewing.provider_account_id)).reputation.count,0);
    await submit(f,done.viewing.id,'provider');assert.equal((await f.reviews.publishedProvider(done.viewing.provider_account_id)).reputation.count,1);
    assert.equal((await f.reviews.own(f.actors.seeker,r.review.id)).state,'PUBLISHED');assert.equal((await ownSlot(f,done.viewing.id)).closes_at,e.closes_at);
  }finally{await f.close();}
});
void integration('G3-G1 completion remains eligible after advertisement market/freshness/region closure',async()=>{
  const f=await fixture();try{const done=await completed(f);await f.client`UPDATE listings SET market_status='OFF_MARKET',expires_at=last_confirmed_at+interval '1 second' WHERE id=${done.viewing.listing_id}`;await f.client`UPDATE region_publication_controls SET enabled=false`;
    assert.equal((await ownSlot(f,done.viewing.id)).can_submit,true);assert.equal((await submit(f,done.viewing.id)).review.state,'SUBMITTED_HELD');
  }finally{await f.close();}
});
void integration('G3-G1 wrong Viewing, Interaction, self-review principal and no attendance cannot fabricate slots',async()=>{
  const f=await fixture();try{
    const pending=await f.store.create(f.actors.seeker,f.interaction.interaction_id,f.input,f.command());assert.equal((await f.reviews.eligibility(f.actors.seeker,pending.viewing.id)).eligibility,null);
    await assert.rejects(f.reviews.eligibility(f.actors.seeker,randomUUID()),{code:'RESOURCE_SCOPE_DENIED'});
    await f.store.cancel(f.actors.seeker,pending.viewing.id,{...expected(pending.viewing),reason:'PLANS_CHANGED'},f.command());
    const done=await completed(f),e=await ownSlot(f,done.viewing.id);await f.client`UPDATE interactions SET listing_id=${f.otherListingId} WHERE id=${done.viewing.interaction_id}`;
    await assert.rejects(f.reviews.submit(f.actors.seeker,e.id,{expected_version:e.version,rating:5},f.command()));await f.client`UPDATE interactions SET listing_id=${done.viewing.listing_id} WHERE id=${done.viewing.interaction_id}`;
    await assert.rejects(f.client`INSERT INTO reviews(eligibility_id,interaction_id,viewing_id,direction,reviewer_subject_type,reviewer_subject_id,author_user_id,target_type,target_id,rating)
      VALUES(${e.id},${e.id},${done.viewing.id},'SEEKER_TO_PROVIDER','User',${f.seekerId},${f.seekerId},'ProviderAccount',${done.viewing.provider_account_id},5)`,/invalid review subject context/);
  }finally{await f.close();}
});
for(const delta of ['-1 microsecond','0 seconds','1 microsecond'])void integration(`G3-G1 exact review submission deadline ${delta}`,async()=>{
  const f=await fixture();try{const done=await completed(f);await clock(f);await setTime(f,done.viewing.id,delta);const e=await ownSlot(f,done.viewing.id),input={expected_version:e.version,rating:3};
    if(delta==='-1 microsecond')assert.equal((await f.reviews.submit(f.actors.seeker,e.id,input,f.command())).review.state,'SUBMITTED_HELD');else await assert.rejects(f.reviews.submit(f.actors.seeker,e.id,input,f.command()),{code:'REVIEW_WINDOW_CLOSED'});
  }finally{await f.close();}
});
for(const position of ['before','after'] as const)void integration(`G3-G1 withdrawal ${position} reveal permanently consumes slot and corrects reputation`,async()=>{
  const f=await fixture();try{const done=await completed(f),r=await submit(f,done.viewing.id);if(position==='after')await submit(f,done.viewing.id,'provider');
    const current=await f.reviews.own(f.actors.seeker,r.review.id),key=f.command(),input={expected_version:current.version};const withdrawn=await f.reviews.withdraw(f.actors.seeker,r.review.id,input,key);assert.equal(withdrawn.review.state,'WITHDRAWN');assert.equal((await f.reviews.withdraw(f.actors.seeker,r.review.id,input,key)).replayed,true);
    assert.equal((await f.reviews.publishedProvider(done.viewing.provider_account_id)).reputation.count,0);const e=await ownSlot(f,done.viewing.id);assert.equal(e.state,'CONSUMED');await assert.rejects(f.reviews.submit(f.actors.seeker,e.id,{expected_version:e.version,rating:5},f.command()),{code:'REVIEW_ELIGIBILITY_UNAVAILABLE'});
    if(position==='before'){const p=await submit(f,done.viewing.id,'provider');assert.equal(p.review.state,'SUBMITTED_HELD');await clock(f);await setTime(f,done.viewing.id,'0 seconds');const jobs=await f.reviews.reviewsOnce();assert.equal(jobs.published,1);assert.equal((await f.reviews.own(f.actors.provider,p.review.id)).state,'PUBLISHED');}
  }finally{await f.close();}
});
void integration('G3-G1 deadline alone reveals one review exactly once and expires the unused slot',async()=>{
  const f=await fixture();try{const done=await completed(f),r=await submit(f,done.viewing.id);await clock(f);await setTime(f,done.viewing.id,'-1 microsecond');assert.equal((await f.reviews.reviewsOnce()).published,0);
    await setTime(f,done.viewing.id,'0 seconds');assert.equal((await f.reviews.reviewsOnce()).published,1);const before=await counts(f);assert.equal((await f.reviews.reviewsOnce()).published,0);assert.deepEqual(await counts(f),before);assert.equal((await ownSlot(f,done.viewing.id,'provider')).state,'EXPIRED');assert.equal((await f.reviews.own(f.actors.seeker,r.review.id)).state,'PUBLISHED');
  }finally{await f.close();}
});
for(const published of [false,true])void integration(`G3-G1 historical attendance dispute with newer current appointment suppresses ${published?'published':'held'} reviews and stale aggregate immediately`,async()=>{
  const f=await fixture();try{const done=await completed(f),r=await submit(f,done.viewing.id);if(published)await submit(f,done.viewing.id,'provider');
    const newer=await f.store.create(f.actors.seeker,done.viewing.interaction_id,f.input,f.command());const current=await f.attendance.get(f.actors.provider,done.viewing.id);
    await f.attendance.respondAttendance(f.actors.provider,done.viewing.id,done.claim.id,'dispute',{...expected(current),expected_claim_version:2,reason:'OUTCOME_INCORRECT'},f.command());
    assert.equal((await f.store.get(f.actors.seeker,newer.viewing.id)).state,'REQUESTED');assert.equal((await f.reviews.publishedProvider(done.viewing.provider_account_id)).reputation.count,0);
    assert.equal((await f.reviews.publishedSeeker(f.actors.seeker,f.seekerId)).reputation.count,0);assert.equal((await f.reviews.own(f.actors.seeker,r.review.id)).can_edit,false);
    await clock(f);await setTime(f,done.viewing.id,'0 seconds');assert.equal((await f.reviews.reviewsOnce()).published,0);assert.equal((await f.reviews.reviewsOnce()).pending,2);
    await f.reviews.reconcileOnce();const rows=await f.client`SELECT published_count,rating_sum FROM review_reputation`;assert.ok(rows.every(p=>p.published_count===0&&p.rating_sum===0));
    assert.equal((await f.client`SELECT interaction_id FROM viewing_review_boundaries`).length,1);assert.equal((await f.client`SELECT id FROM viewing_review_eligibilities`).length,2);
  }finally{await f.close();}
});
void integration('G3-G1 aggregate projection repair is idempotent and public counts derive current source',async()=>{
  const f=await fixture();try{const done=await completed(f);await submit(f,done.viewing.id);await submit(f,done.viewing.id,'provider');await f.client`UPDATE review_reputation SET published_count=99,rating_sum=495`;
    assert.equal((await f.reviews.publishedProvider(done.viewing.provider_account_id)).reputation.count,1);assert.equal((await f.reviews.reconcileOnce()).reconciled,2);assert.equal((await f.reviews.reconcileOnce()).reconciled,2);
    assert.ok((await f.client`SELECT published_count,rating_sum FROM review_reputation`).every(r=>r.published_count===1&&r.rating_sum===4));
  }finally{await f.close();}
});
void integration('G3-G1 safe events/notices never expose held scores, text, criteria, private instructions or counterpart status',async()=>{
  const f=await fixture();try{const done=await completed(f),before=await f.attendance.listNotices(f.actors.provider,{viewing_id:done.viewing.id}),r=await submit(f,done.viewing.id);const after=await f.attendance.listNotices(f.actors.provider,{viewing_id:done.viewing.id});assert.deepEqual(after,before);
    const generic=JSON.stringify(await f.client`SELECT safe_payload FROM review_outbox`);assert.ok(!generic.includes(r.review.text!));assert.ok(!generic.includes('rating'));assert.ok(!generic.includes('criteria'));assert.ok(!generic.includes('SYNTHETIC_PRIVATE_G1_GUIDANCE'));
    const notices=JSON.stringify(await f.client`SELECT event_type,recipient_side FROM viewing_notices WHERE source_review_event_id IS NOT NULL`);assert.ok(!notices.includes(r.review.text!));
    assert.equal((await f.reviews.eligibility(f.actors.provider,done.viewing.id)).own_review,null);assert.equal((await f.attendance.attendance(f.actors.provider,done.viewing.id)).review_eligibility_created,true);
  }finally{await f.close();}
});
for(const delta of ['-3 days','-1 day','0 seconds'])void integration(`G3-G1 bounded reminders ${delta} never catch up missed windows or expose counterparty state`,async()=>{
  const f=await fixture();try{const done=await completed(f);await submit(f,done.viewing.id);await clock(f);await setTime(f,done.viewing.id,delta);await f.reviews.reviewsOnce();const rows=await f.client`SELECT recipient_side,event_type FROM viewing_notices WHERE source_review_action_id IS NOT NULL`;
    assert.equal(rows.length,delta==='0 seconds'?0:1);if(rows.length){assert.equal(rows[0]!.recipient_side,'PROVIDER');assert.equal(rows[0]!.event_type,delta==='-3 days'?'review_reminder_3d':'review_reminder_1d');}
    const before=await counts(f);await f.reviews.reviewsOnce();assert.deepEqual(await counts(f),before);
  }finally{await f.close();}
});
void integration('G3-G1 private report intake retains immutable metadata without hiding or changing rating',async()=>{
  const f=await fixture();try{const done=await completed(f),held=await submit(f,done.viewing.id);await assert.rejects(f.reviews.report(f.actors.provider,held.review.id,{reason:'OTHER'},f.command()),{code:'RESOURCE_SCOPE_DENIED'});
    await submit(f,done.viewing.id,'provider');const key=f.command(),input={reason:'PRIVACY_EXPOSURE' as const,details:'SYNTHETIC_PRIVATE_REPORT_DETAILS'};
    const report=await f.reviews.report(f.actors.other,held.review.id,input,key);assert.equal(report.report.state,'OPEN');assert.equal((await f.reviews.report(f.actors.other,held.review.id,input,key)).replayed,true);
    const second=await f.reviews.report(f.actors.provider,held.review.id,{reason:'THREATS'},f.command());assert.notEqual(second.report.id,report.report.id);assert.equal((await f.client`SELECT id FROM review_moderation_cases`).length,1);
    assert.equal((await f.reviews.publishedProvider(done.viewing.provider_account_id)).reputation.count,1);assert.equal((await f.reviews.own(f.actors.seeker,held.review.id)).state,'PUBLISHED');
    await assert.rejects(f.client`UPDATE review_reports SET reason='OTHER' WHERE id=${report.report.id}`,/append-only/);assert.ok(!JSON.stringify(await f.client`SELECT safe_payload FROM review_outbox`).includes(input.details));
    await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${f.otherUserId}`;await assert.rejects(f.reviews.report(f.actors.other,held.review.id,{reason:'OTHER'},f.command()),{code:'CAPABILITY_RESTRICTED'});
  }finally{await f.close();}
});
void integration('G3-G1 reporting and own withdrawal remain available under blocked/restricted participation without held counterparty access',async()=>{
  const f=await fixture();try{const done=await completed(f),r=await submit(f,done.viewing.id);await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${f.seekerId}`;await f.client`UPDATE interactions SET state='RESTRICTED' WHERE id=${done.viewing.interaction_id}`;
    assert.equal((await f.reviews.report(f.actors.seeker,r.review.id,{reason:'OTHER'},f.command())).report.state,'OPEN');assert.equal((await f.reviews.withdraw(f.actors.seeker,r.review.id,{expected_version:r.review.version},f.command())).review.state,'WITHDRAWN');
  }finally{await f.close();}
});
void integration('G3-G1 current participants can report previously revealed withdrawn feedback without learning never-revealed content',async()=>{
  const f=await fixture();try{const done=await completed(f),held=await submit(f,done.viewing.id);
    await assert.rejects(f.reviews.report(f.actors.provider,held.review.id,{reason:'THREATS'},f.command()),{code:'RESOURCE_SCOPE_DENIED'});
    await submit(f,done.viewing.id,'provider');const revealed=await f.reviews.own(f.actors.seeker,held.review.id);
    await f.reviews.withdraw(f.actors.seeker,revealed.id,{expected_version:revealed.version},f.command());
    const report=await f.reviews.report(f.actors.provider,revealed.id,{reason:'THREATS'},f.command());assert.equal(report.report.state,'OPEN');
    await assert.rejects(f.reviews.report(f.actors.other,revealed.id,{reason:'THREATS'},f.command()),{code:'RESOURCE_SCOPE_DENIED'});
    assert.equal((await f.reviews.publishedProvider(done.viewing.provider_account_id)).reputation.count,0);
    assert.equal(JSON.stringify(report).includes('SYNTHETIC_HELD'),false);
  }finally{await f.close();}
});
void integration('G3-G1 identical reports deduplicate with a fresh key until the exact 24-hour boundary while urgent changes remain possible',async()=>{
  const f=await fixture();try{const done=await completed(f),r=await submit(f,done.viewing.id);await submit(f,done.viewing.id,'provider');await clock(f);
    const input={reason:'OTHER' as const,details:'SYNTHETIC_IDENTICAL_REPORT'},first=await f.reviews.report(f.actors.other,r.review.id,input,f.command());
    await f.client`UPDATE g1_test_clock SET value=(SELECT created_at FROM review_reports WHERE id=${first.report.id})+interval '24 hours'-interval '1 microsecond'`;
    const repeated=await f.reviews.report(f.actors.other,r.review.id,input,f.command());assert.equal(repeated.report.id,first.report.id);assert.equal(repeated.replayed,true);
    const urgent=await f.reviews.report(f.actors.other,r.review.id,{...input,reason:'THREATS'},f.command());assert.notEqual(urgent.report.id,first.report.id);
    await f.client`UPDATE g1_test_clock SET value=(SELECT created_at FROM review_reports WHERE id=${first.report.id})+interval '24 hours'`;
    const boundary=await f.reviews.report(f.actors.other,r.review.id,input,f.command());assert.notEqual(boundary.report.id,first.report.id);assert.equal(boundary.replayed,false);
    assert.equal((await f.client`SELECT id FROM review_reports`).length,3);assert.equal((await f.client`SELECT id FROM review_events WHERE event_type='review_reported'`).length,3);
  }finally{await f.close();}
});
void integration('G3-G1 organization principal slot, current assignment and successor privacy preserve historical author',async()=>{
  const f=await fixture();try{const org=await organizationAssignmentFixture(f.client),assignments=new OrganizationAssignmentStore(f.client),resource=org.resource('INTERACTION');
    const assigned=await assignments.assign(org.actors.owner,resource,org.memberships.agent,{...org.command(),expectedVersion:0});const done=await completed(f,resource.resourceId,org.actors.agent.userId,org.actors.unrelated,org.actors.agent);
    await assert.rejects(f.reviews.eligibility(org.actors.owner,done.viewing.id),{code:'RESOURCE_SCOPE_DENIED'});
    const e=(await f.reviews.eligibility(org.actors.agent,done.viewing.id)).eligibility!;assert.equal(e.direction,'PROVIDER_TO_SEEKER');
    const r=await f.reviews.submit(org.actors.agent,e.id,{expected_version:e.version,rating:4,text:'SYNTHETIC_ORG_AUTHOR'},f.command());
    await assignments.revoke(org.actors.owner,resource,assigned.id,{...org.command(),expectedVersion:assigned.version});await assignments.assign(org.actors.owner,resource,org.memberships.manager,{...org.command(),expectedVersion:0});
    await assert.rejects(f.reviews.own(org.actors.agent,r.review.id),{code:'RESOURCE_SCOPE_DENIED'});await assert.rejects(f.reviews.own(org.actors.manager,r.review.id),{code:'RESOURCE_SCOPE_DENIED'});
    const successor=await f.reviews.eligibility(org.actors.manager,done.viewing.id);assert.equal(successor.own_review,null);assert.equal(successor.eligibility?.state,'CONSUMED');
    await assert.rejects(f.reviews.submit(org.actors.manager,e.id,{expected_version:2,rating:5},f.command()),{code:'REVIEW_ELIGIBILITY_UNAVAILABLE'});
    await assert.rejects(f.client`UPDATE reviews SET text='ILLEGAL_REVOKED_AUTHOR_EDIT',version=version+1 WHERE id=${r.review.id}`,/invalid review transition/);
    const seekerSlot=(await f.reviews.eligibility(org.actors.unrelated,done.viewing.id)).eligibility!;await f.reviews.submit(org.actors.unrelated,seekerSlot.id,{expected_version:seekerSlot.version,rating:5},f.command());
    const persisted=(await f.client`SELECT state,reviewer_subject_id,author_user_id FROM reviews WHERE id=${r.review.id}`)[0]!;assert.equal(persisted.state,'PUBLISHED');assert.equal(persisted.reviewer_subject_id,org.org.provider_account_id);assert.equal(persisted.author_user_id,org.actors.agent.userId);
    assert.equal((await f.reviews.publishedSeeker(org.actors.unrelated,org.actors.unrelated.userId)).reputation.count,1);
    await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${org.actors.agent.userId}`;assert.equal((await f.reviews.publishedSeeker(org.actors.unrelated,org.actors.unrelated.userId)).reputation.count,0);
  }finally{await f.close();}
});
void integration('G3-G1 authorized organization successor can consume only an unused principal slot',async()=>{
  const f=await fixture();try{const org=await organizationAssignmentFixture(f.client),assignments=new OrganizationAssignmentStore(f.client),resource=org.resource('INTERACTION');const a=await assignments.assign(org.actors.owner,resource,org.memberships.agent,{...org.command(),expectedVersion:0});const done=await completed(f,resource.resourceId,org.actors.agent.userId,org.actors.unrelated,org.actors.agent);
    await assignments.revoke(org.actors.owner,resource,a.id,{...org.command(),expectedVersion:a.version});await assignments.assign(org.actors.owner,resource,org.memberships.manager,{...org.command(),expectedVersion:0});const e=(await f.reviews.eligibility(org.actors.manager,done.viewing.id)).eligibility!;
    const r=await f.reviews.submit(org.actors.manager,e.id,{expected_version:e.version,rating:3},f.command());assert.equal(r.review.state,'SUBMITTED_HELD');assert.equal((await f.client`SELECT author_user_id FROM reviews`)[0]!.author_user_id,org.actors.manager.userId);
  }finally{await f.close();}
});
for(const restriction of ['last-assignment','author-limited'] as const)void integration(`G3-G1 ${restriction} deadline holds remain recoverable under lawful current successor eligibility`,async()=>{
  const f=await fixture();try{const org=await organizationAssignmentFixture(f.client),assignments=new OrganizationAssignmentStore(f.client),resource=org.resource('INTERACTION');const a=await assignments.assign(org.actors.owner,resource,org.memberships.agent,{...org.command(),expectedVersion:0});const done=await completed(f,resource.resourceId,org.actors.agent.userId,org.actors.unrelated,org.actors.agent);
    const e=(await f.reviews.eligibility(org.actors.agent,done.viewing.id)).eligibility!,r=await f.reviews.submit(org.actors.agent,e.id,{expected_version:1,rating:4},f.command());
    if(restriction==='last-assignment')await assignments.revoke(org.actors.owner,resource,a.id,{...org.command(),expectedVersion:a.version});
    else{await assignments.assign(org.actors.owner,resource,org.memberships.manager,{...org.command(),expectedVersion:0});await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${org.actors.agent.userId}`;}
    await clock(f);await setTime(f,done.viewing.id,'0 seconds');const held=await f.reviews.reviewsOnce();assert.equal(held.published,0);assert.ok(held.pending>=1);assert.equal((await f.client`SELECT state FROM reviews WHERE id=${r.review.id}`)[0]!.state,'SUBMITTED_HELD');
    if(restriction==='last-assignment')await assignments.assign(org.actors.owner,resource,org.memberships.manager,{...org.command(),expectedVersion:0});else await f.client`UPDATE users SET account_state='ACTIVE' WHERE id=${org.actors.agent.userId}`;
    const restored=await f.reviews.reviewsOnce();assert.equal(restored.published,1);assert.equal((await f.client`SELECT state FROM reviews WHERE id=${r.review.id}`)[0]!.state,'PUBLISHED');assert.equal((await f.reviews.reviewsOnce()).published,0);
  }finally{await f.close();}
});
void integration('G3-G1 deadline reveal pins current organization successor phone eligibility across notice lock waits',async()=>{
  const f=await fixture(),worker=dedicated(),phoneWriter=dedicated(),gate=dedicated();let release!:()=>void;let holder:Promise<unknown>|undefined,reveal:Promise<unknown>|undefined,replace:Promise<unknown>|undefined;
  try{const org=await organizationAssignmentFixture(f.client),assignments=new OrganizationAssignmentStore(f.client),resource=org.resource('INTERACTION');
    const a=await assignments.assign(org.actors.owner,resource,org.memberships.agent,{...org.command(),expectedVersion:0});
    const done=await completed(f,resource.resourceId,org.actors.agent.userId,org.actors.unrelated,org.actors.agent),e=(await f.reviews.eligibility(org.actors.agent,done.viewing.id)).eligibility!;
    const r=await f.reviews.submit(org.actors.agent,e.id,{expected_version:1,rating:4},f.command());
    await assignments.revoke(org.actors.owner,resource,a.id,{...org.command(),expectedVersion:a.version});await assignments.assign(org.actors.owner,resource,org.memberships.manager,{...org.command(),expectedVersion:0});
    await clock(f);await setTime(f,done.viewing.id,'0 seconds');await worker`SET search_path TO public,pg_catalog`;
    let ready!:()=>void;const held=new Promise<void>(resolve=>{ready=resolve;}),free=new Promise<void>(resolve=>{release=resolve;});
    holder=gate.begin(async tx=>{await tx`LOCK TABLE review_events IN SHARE MODE`;ready();await free;});await held;
    const workerPid=(await worker<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid,phonePid=(await phoneWriter<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    reveal=new ReviewStore(worker,true).reviewsOnce();await waiting(f.client,workerPid);
    replace=phoneWriter`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${org.actors.manager.userId}`.then(result=>result);await waiting(f.client,phonePid);
    release();await holder;await reveal;await replace;
    assert.equal((await f.client`SELECT state FROM reviews WHERE id=${r.review.id}`)[0]!.state,'PUBLISHED');
    assert.equal((await f.client`SELECT id FROM review_events WHERE review_id=${r.review.id} AND event_type='review_published'`).length,1);
  }finally{release?.();await holder?.catch(()=>{});await Promise.allSettled([reveal,replace].filter((p):p is Promise<unknown>=>!!p));await Promise.all([worker.end(),phoneWriter.end(),gate.end()]);await f.close();}
});
void integration('G3-G1 aggregate average appears at three source-eligible publications and vanishes immediately on current restrictions',async()=>{
  const f=await fixture();try{
    let providerId='';const seekers:string[]=[];
    for(let i=0;i<3;i++){
      const u=(await f.client<{id:string}[]>`INSERT INTO users(account_state,display_name) VALUES('ACTIVE','Synthetic reviewed seeker') RETURNING id`)[0]!;
      await f.client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES(${u.id},${`+1555999000${i}`},statement_timestamp(),1)`;
      const session=(await f.client<{id:string}[]>`INSERT INTO security_sessions(user_id,issuer,app_client_id,origin_jti,current_jti,expires_at) VALUES(${u.id},'https://local.test/review','account',${randomUUID()},${randomUUID()},statement_timestamp()+interval '1 hour') RETURNING id`)[0]!;
      const actor={userId:u.id,sessionId:session.id,securityVersion:0},interaction=await f.inquiries.createOrReuseInquiry(u.id,f.listingId,randomUUID()),done=await completed(f,interaction.interaction_id,f.providerUserId,actor,f.actors.provider);providerId=done.viewing.provider_account_id;
      const e=(await f.reviews.eligibility(actor,done.viewing.id)).eligibility!;await f.reviews.submit(actor,e.id,{expected_version:1,rating:i+3},f.command());await submit(f,done.viewing.id,'provider');seekers.push(u.id);
    }
    const page=await f.reviews.publishedProvider(providerId);assert.equal(page.reputation.count,3);assert.equal(page.reputation.average,4);assert.equal(page.items.length,3);
    await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${seekers[0]!}`;const suppressed=await f.reviews.publishedProvider(providerId);assert.equal(suppressed.reputation.count,2);assert.equal(suppressed.reputation.average,null);await f.reviews.reconcileOnce();
    const stored=(await f.client`SELECT published_count,rating_sum FROM review_reputation WHERE target_type='ProviderAccount' AND target_id=${providerId}`)[0]!;assert.equal(stored.published_count,2);assert.equal(stored.rating_sum,9);
  }finally{await f.close();}
});
void integration('G3-G1 simultaneous same-slot submissions permit exactly one durable review and receipt',async()=>{
  const f=await fixture(),one=dedicated(),two=dedicated();try{const done=await completed(f),e=await ownSlot(f,done.viewing.id);const results=await Promise.allSettled([new ReviewStore(one,true).submit(f.actors.seeker,e.id,{expected_version:1,rating:4},f.command()),new ReviewStore(two,true).submit(f.actors.seeker,e.id,{expected_version:1,rating:5},f.command())]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal((await f.client`SELECT id FROM reviews`).length,1);assert.equal((await f.client`SELECT review_id FROM review_command_receipts`).length,1);
  }finally{await one.end();await two.end();await f.close();}
});
void integration('G3-G1 simultaneous reciprocal submissions publish two reviews once under parent serialization',async()=>{
  const f=await fixture(),one=dedicated(),two=dedicated();try{const done=await completed(f),s=await ownSlot(f,done.viewing.id),p=await ownSlot(f,done.viewing.id,'provider');
    const results=await Promise.all([new ReviewStore(one,true).submit(f.actors.seeker,s.id,{expected_version:1,rating:4},f.command()),new ReviewStore(two,true).submit(f.actors.provider,p.id,{expected_version:1,rating:5},f.command())]);assert.equal(results.length,2);
    assert.equal((await f.client`SELECT id FROM reviews WHERE state='PUBLISHED'`).length,2);assert.equal((await f.client`SELECT id FROM review_events WHERE event_type='review_published'`).length,2);assert.equal((await f.client`SELECT review_id FROM review_command_receipts`).length,2);
  }finally{await one.end();await two.end();await f.close();}
});
for(const order of ['submit-first','worker-first'] as const)void integration(`G3-G1 controlled ${order} deadline race retains one reveal and denies late submission`,async()=>{
  const f=await fixture(),one=dedicated(),two=dedicated(),gate=dedicated();let release!:()=>void;let holder:Promise<unknown>|undefined,first:Promise<PromiseSettledResult<unknown>[]>|undefined,second:Promise<PromiseSettledResult<unknown>[]>|undefined;
  try{const done=await completed(f),r=await submit(f,done.viewing.id),p=await ownSlot(f,done.viewing.id,'provider');await clock(f);await setTime(f,done.viewing.id,'0 seconds');await one`SET search_path TO public,pg_catalog`;await two`SET search_path TO public,pg_catalog`;
    // One retained parent lock puts both operations behind a controlled gate.
    let ready!:()=>void;const held=new Promise<void>(r=>{ready=r;}),free=new Promise<void>(r=>{release=r;});holder=gate.begin(async tx=>{await tx`SELECT id FROM interactions WHERE id=${done.viewing.interaction_id} FOR UPDATE`;ready();await free;});await held;
    const pidOne=(await one<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid,pidTwo=(await two<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    const submitLate=(client:postgres.Sql)=>new ReviewStore(client,true).submit(f.actors.provider,p.id,{expected_version:p.version,rating:5},f.command());const worker=(client:postgres.Sql)=>new ReviewStore(client,true).reviewsOnce();
    first=Promise.allSettled([order==='submit-first'?submitLate(one):worker(one)]);await waiting(f.client,pidOne);second=Promise.allSettled([order==='submit-first'?worker(two):submitLate(two)]);await waiting(f.client,pidTwo);release();await holder;
    const results=[...(await first),...(await second)];assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal((await f.reviews.own(f.actors.seeker,r.review.id)).state,'PUBLISHED');
    assert.equal((await f.client`SELECT id FROM review_events WHERE event_type='review_published'`).length,1);assert.equal((await f.client`SELECT id FROM reviews`).length,1);
  }finally{release?.();await holder?.catch(()=>{});await Promise.all([first,second]);await Promise.all([one.end(),two.end(),gate.end()]);await f.close();}
});

for(const order of ['withdraw-first','submit-first'] as const)void integration(`G3-G1 controlled ${order} withdrawal and reciprocal reveal race preserves blind publication history`,async()=>{
  const f=await fixture(),one=dedicated(),two=dedicated(),gate=dedicated();let release!:()=>void;let holder:Promise<unknown>|undefined,first:Promise<PromiseSettledResult<unknown>[]>|undefined,second:Promise<PromiseSettledResult<unknown>[]>|undefined;
  try{const done=await completed(f),r=await submit(f,done.viewing.id),p=await ownSlot(f,done.viewing.id,'provider');
    let ready!:()=>void;const held=new Promise<void>(resolve=>{ready=resolve;}),free=new Promise<void>(resolve=>{release=resolve;});
    holder=gate.begin(async tx=>{await tx`SELECT id FROM interactions WHERE id=${done.viewing.interaction_id} FOR UPDATE`;ready();await free;});await held;
    const pidOne=(await one<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid,pidTwo=(await two<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    const withdrawal=(client:postgres.Sql)=>new ReviewStore(client,true).withdraw(f.actors.seeker,r.review.id,{expected_version:1},f.command());
    const counterpart=(client:postgres.Sql)=>new ReviewStore(client,true).submit(f.actors.provider,p.id,{expected_version:p.version,rating:5},f.command());
    first=Promise.allSettled([order==='withdraw-first'?withdrawal(one):counterpart(one)]);await waiting(f.client,pidOne);
    second=Promise.allSettled([order==='withdraw-first'?counterpart(two):withdrawal(two)]);await waiting(f.client,pidTwo);release();await holder;
    const results=[...(await first),...(await second)];assert.equal(results.filter(r=>r.status==='fulfilled').length,order==='withdraw-first'?2:1);
    if(order==='submit-first'){const rejected=results.find(r=>r.status==='rejected');assert.equal((rejected as PromiseRejectedResult).reason.code,'STALE_VERSION');const current=await f.reviews.own(f.actors.seeker,r.review.id);await f.reviews.withdraw(f.actors.seeker,current.id,{expected_version:current.version},f.command());}
    assert.equal((await f.reviews.own(f.actors.seeker,r.review.id)).state,'WITHDRAWN');
    assert.equal((await f.client`SELECT state FROM reviews WHERE author_user_id=${f.providerUserId}`)[0]!.state,order==='withdraw-first'?'SUBMITTED_HELD':'PUBLISHED');
    assert.equal((await f.client`SELECT id FROM review_events WHERE event_type='review_published'`).length,order==='withdraw-first'?0:2);
    assert.equal((await f.client`SELECT state FROM viewing_review_eligibilities WHERE id=${r.review.eligibility_id}`)[0]!.state,'CONSUMED');
    assert.equal((await f.reviews.publishedProvider(done.viewing.provider_account_id)).reputation.count,0);
  }finally{release?.();await holder?.catch(()=>{});await Promise.all([first,second]);await Promise.all([one.end(),two.end(),gate.end()]);await f.close();}
});
