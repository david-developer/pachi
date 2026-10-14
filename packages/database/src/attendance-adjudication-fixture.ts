// Synthetic fixtures guard the sole authorized disposable TEST database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from './client.js';
import { viewingFixture } from './viewing-fixture.js';
import { ViewingAttendanceStore } from './viewing-attendance.js';
import { ReviewStore } from './review.js';
import { StaffStore, type StaffPrincipal } from './staff.js';
import { AttendanceAdjudicationStore } from './attendance-adjudication.js';
import type { AttendanceDecisionOutcome,AttendanceDecisionRequest } from './attendance-adjudication-types.js';
export async function attendanceAdjudicationFixture(mode:'unused'|'published'|'held'|'unvalidated'|'no-show'='unused',historical=false){
 const url=process.env.DATABASE_TEST_URL;if(!url)throw Error('DATABASE_TEST_URL required');const u=new URL(url);assert.equal(u.hostname,'localhost');assert.equal(u.port,'5433');assert.equal(u.pathname,'/pachi_test');
 const {client}=createDatabase(url);await client`SET client_min_messages TO warning`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client`TRUNCATE review_reputation`;await client`UPDATE region_publication_controls SET enabled=true`;
 const base=await viewingFixture(client),attendance=new ViewingAttendanceStore(client,true),reviews=new ReviewStore(client,true),store=new AttendanceAdjudicationStore(client,true);
 const inserted=(await client<{id:string}[]>`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,proposed_start,proposed_end,display_timezone,response_deadline,created_at,updated_at)
 SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.seeker_user_id,statement_timestamp()-interval '3 hours',statement_timestamp()-interval '2 hours','Africa/Douala',statement_timestamp()-interval '5 days',statement_timestamp()-interval '7 days',statement_timestamp()-interval '7 days' FROM interactions i WHERE i.id=${base.interaction.interaction_id} RETURNING id`)[0]!;
 await client`UPDATE viewings SET state='ACCEPTED',scheduled_start=proposed_start,scheduled_end=proposed_end,private_instructions='CONFIDENTIAL_ATTENDANCE_GUIDANCE',accepted_by_user_id=${base.providerUserId},accepted_at=created_at+interval '1 hour',version=version+1 WHERE id=${inserted.id}`;
 await client`UPDATE viewings SET state='SCHEDULED',seeker_confirmed=true,provider_confirmed=true,version=version+1 WHERE id=${inserted.id}`;
 const expected=(v:{version:number;schedule_version:number})=>({expected_version:v.version,expected_schedule_version:v.schedule_version});
 const v=await attendance.get(base.actors.seeker,inserted.id);
 const claim=await attendance.claimAttendance(base.actors.seeker,v.id,mode==='no-show'?{...expected(v),claim_type:'NO_SHOW',absent_side:'PROVIDER'}:{...expected(v),claim_type:'COMPLETION'},base.command());
 if(mode!=='unvalidated')await attendance.respondAttendance(base.actors.provider,v.id,claim.claim.id,'confirm',{...expected(claim.viewing),expected_claim_version:1},base.command());
 if(mode==='held'||mode==='published'){
  const slot=(await reviews.eligibility(base.actors.seeker,v.id)).eligibility!;await reviews.submit(base.actors.seeker,slot.id,{expected_version:slot.version,rating:4,text:'CONFIDENTIAL_ATTENDANCE_REVIEW'},base.command());
  if(mode==='published'){const other=(await reviews.eligibility(base.actors.provider,v.id)).eligibility!;await reviews.submit(base.actors.provider,other.id,{expected_version:other.version,rating:5},base.command());}
 }
 const newer=historical?(await attendance.create(base.actors.seeker,v.interaction_id,base.input,base.command())).viewing:null;
 const beforeDispute=await attendance.get(base.actors.provider,v.id);
 await attendance.respondAttendance(base.actors.provider,v.id,claim.claim.id,'dispute',{...expected(beforeDispute),expected_claim_version:mode==='unvalidated'?1:2,reason:'OUTCOME_INCORRECT'},base.command());
 const caseId=(await client<{id:string}[]>`SELECT id FROM viewing_attendance_cases WHERE viewing_id=${v.id}`)[0]!.id;
 const makeStaff=async(permissions=['case:assign','report:triage','moderation:act','evidence:read','appeal:resolve'],userInput?:string,role='TRUST_SAFETY_MODERATOR',caseInput=caseId):Promise<StaffPrincipal>=>{
  const userId=userInput??(await client<{id:string}[]>`INSERT INTO users(account_state,display_name) VALUES('ACTIVE','Synthetic attendance moderator') RETURNING id`)[0]!.id;
  const issuer='https://local.test/staff-attendance',subject=randomUUID();await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES(${userId},${issuer},${subject},'LOCAL_TEST')`;
  await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES(${userId},${role},${JSON.stringify({kind:role==='SUPER_ADMIN'?'platform':'case',id:role==='SUPER_ADMIN'?'pachi':caseInput,permissions})}::text::jsonb,now()+interval '1 day','synthetic-test','Synthetic attendance case authority')`;
  const staffStore=new StaffStore(client,'synthetic-attendance-staff-key-with-more-than-thirty-two-characters'),now=new Date();
  const sid=await staffStore.register({issuer,subject,clientId:'staff',originJti:randomUUID(),jti:randomUUID(),expiresAt:new Date(+now+3600000),issuedAt:now,scopes:['pachi/staff'],provider:'LOCAL_TEST'},now,'synthetic-access','synthetic-refresh');return staffStore.read(sid,false);
 };
 const staff=await makeStaff();
 const detail=(p=staff)=>store.get(p,caseId,'ATTENDANCE_ADJUDICATION',randomUUID());
 const assign=(p=staff,recipient=p.row.user_id,expected_version=1)=>store.assign(p,caseId,{purpose:'ATTENDANCE_ADJUDICATION',expected_version,assigned_staff_user_id:recipient,idempotency_key:randomUUID()},randomUUID());
 const begin=(p=staff,version=2)=>store.beginInvestigation(p,caseId,{purpose:'ATTENDANCE_ADJUDICATION',expected_version:version,reason_text:'Begin the scoped attendance evidence investigation',idempotency_key:randomUUID()},randomUUID());
 const start=async()=>{await assign();await begin();};
 const decide=async(outcome:AttendanceDecisionOutcome='COMPLETED',extra:Partial<AttendanceDecisionRequest>={},p=staff)=>{let d=await detail(p);if(d.case.state==='TRIAGED'){await begin(p,d.case.version);d=await detail(p);}return store.decide(p,caseId,{purpose:'ATTENDANCE_ADJUDICATION',expected_version:d.case.version,outcome,reason_code:outcome==='COMPLETED'?'ATTENDANCE_SUPPORTED':outcome.endsWith('NO_SHOW')?'NO_SHOW_SUPPORTED':outcome==='CLAIM_INVALIDATED'?'UNSUPPORTED_CLAIM':'INSUFFICIENT_EVIDENCE',reason_text:'PRIVATE_STAFF_RATIONALE for the synthetic attendance decision',evidence:[],idempotency_key:randomUUID(),...extra},randomUUID());};
 return {...base,client,attendance,reviews,store,staff,makeStaff,caseId,viewingId:v.id,claimId:claim.claim.id,newer,detail,assign,begin,start,decide,async close(){await client.unsafe('DROP FUNCTION IF EXISTS public.statement_timestamp()');await client.unsafe('DROP FUNCTION IF EXISTS public.clock_timestamp()');await client`DROP TABLE IF EXISTS h2_test_clock`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client`TRUNCATE review_reputation`;await client`UPDATE region_publication_controls SET enabled=true`;await client.end();}};
}
