// Synthetic local TEST fixture only. Creation and cleanup guard localhost:5433/pachi_test.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from './client.js';
import { viewingFixture } from './viewing-fixture.js';
import { ViewingAttendanceStore } from './viewing-attendance.js';
import { ReviewStore } from './review.js';
import { ReviewModerationStore, type ReviewModerationCommand, type ReviewModerationDecisionInput } from './review-moderation.js';
import { StaffStore } from './staff.js';
const purpose='REVIEW_MODERATION' as const;
export async function reviewModerationFixture(published=false,urlInput=process.env.DATABASE_TEST_URL){
 if(!urlInput)throw new Error('DATABASE_TEST_URL is required');const parsed=new URL(urlInput);assert.equal(parsed.hostname,'localhost');assert.equal(parsed.port,'5433');assert.equal(parsed.pathname,'/pachi_test');
 const {client}=createDatabase(urlInput);await client`SET client_min_messages TO warning`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client`TRUNCATE review_reputation`;await client`UPDATE region_publication_controls SET enabled=true`;
 const base=await viewingFixture(client),attendance=new ViewingAttendanceStore(client,true),reviews=new ReviewStore(client,true),moderation=new ReviewModerationStore(client,true);
 const v=(await client<{id:string}[]>`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,proposed_start,proposed_end,display_timezone,response_deadline,created_at,updated_at)
 SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.seeker_user_id,statement_timestamp()-interval '3 hours',statement_timestamp()-interval '2 hours','Africa/Douala',statement_timestamp()-interval '5 days',statement_timestamp()-interval '7 days',statement_timestamp()-interval '7 days' FROM interactions i WHERE i.id=${base.interaction.interaction_id} RETURNING id`)[0]!;
 await client`UPDATE viewings SET state='ACCEPTED',scheduled_start=proposed_start,scheduled_end=proposed_end,private_instructions='CONFIDENTIAL_MEETING_CANARY',accepted_by_user_id=${base.providerUserId},accepted_at=created_at+interval '1 hour',version=version+1 WHERE id=${v.id}`;
 await client`UPDATE viewings SET state='SCHEDULED',seeker_confirmed=true,provider_confirmed=true,version=version+1 WHERE id=${v.id}`;
 const scheduled=await attendance.get(base.actors.seeker,v.id),expected=(x:{version:number;schedule_version:number})=>({expected_version:x.version,expected_schedule_version:x.schedule_version});
 const claim=await attendance.claimAttendance(base.actors.seeker,v.id,{...expected(scheduled),claim_type:'COMPLETION'},base.command());await attendance.respondAttendance(base.actors.provider,v.id,claim.claim.id,'confirm',{...expected(claim.viewing),expected_claim_version:1},base.command());
 const slot=(await reviews.eligibility(base.actors.seeker,v.id)).eligibility!,review=(await reviews.submit(base.actors.seeker,slot.id,{expected_version:slot.version,rating:4,text:'HELD_REVIEW_CANARY'},base.command())).review;
 if(published){const p=(await reviews.eligibility(base.actors.provider,v.id)).eligibility!;await reviews.submit(base.actors.provider,p.id,{expected_version:p.version,rating:5,text:'COUNTERPART_REVIEW_CANARY'},base.command());}
 const report=await reviews.report(base.actors.seeker,review.id,{reason:'THREATS',details:'CONFIDENTIAL_REPORT_CONTEXT'},base.command());const caseId=(await client<{case_id:string}[]>`SELECT case_id FROM review_reports WHERE id=${report.report.id}`)[0]!.case_id;
 const makeStaff=async(permissions:string[]= ['case:assign','report:triage','review:moderate','moderation:act','evidence:read'],userInput?:string,role='TRUST_SAFETY_MODERATOR')=>{
  const userId=userInput??(await client<{id:string}[]>`INSERT INTO users(account_state,display_name) VALUES('ACTIVE','Synthetic safety actor') RETURNING id`)[0]!.id;
  const issuer='https://local.test/staff-review',subject=randomUUID();await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES(${userId},${issuer},${subject},'LOCAL_TEST')`;
  await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES(${userId},${role},${JSON.stringify({kind:'case',id:caseId,permissions})}::jsonb,now()+interval '1 day','synthetic-test','Synthetic review case grant')`;
  const staffStore=new StaffStore(client,'synthetic-staff-key-with-more-than-thirty-two-characters');const now=new Date();const sid=await staffStore.register({issuer,subject,clientId:'staff',originJti:randomUUID(),jti:randomUUID(),expiresAt:new Date(+now+3600000),issuedAt:now,scopes:['pachi/staff'],provider:'LOCAL_TEST'},now,'synthetic-access','synthetic-refresh');return staffStore.read(sid,false);
 };
 const staff=await makeStaff();
 const detail=(p=staff)=>moderation.get(p,caseId,purpose,randomUUID());
 const assign=(p=staff,recipient=p.row.user_id,version=1)=>moderation.assign(p,caseId,{purpose,expected_version:version,assigned_staff_user_id:recipient,idempotency_key:randomUUID()},randomUUID());
 const decide=async(command:ReviewModerationCommand,extra:Partial<ReviewModerationDecisionInput>={},p=staff)=>{const d=await detail(p);return moderation.decide(p,caseId,{purpose,command,expected_version:d.case.version,expected_review_version:d.review.version,reason_code:command==='RESTORE'?'ELIGIBILITY_RESTORED':command==='REMOVE'?'REVIEW_POLICY_VIOLATION':'INVESTIGATION',reason_text:'Synthetic reason for scoped review decision',idempotency_key:randomUUID(),...extra},randomUUID());};
 const addPublishedReview=async(rating:number)=>{
  const user=(await client<{id:string}[]>`INSERT INTO users(account_state) VALUES('ACTIVE') RETURNING id`)[0]!.id;
  await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES(${user},${'+1555'+randomUUID().replace(/\D/g,'').slice(0,7).padEnd(7,'0')},statement_timestamp(),1)`;
  const session=(await client<{id:string}[]>`INSERT INTO security_sessions(user_id,issuer,app_client_id,origin_jti,current_jti,expires_at) VALUES(${user},'https://local.test/viewing','account',${randomUUID()},${randomUUID()},statement_timestamp()+interval '1 hour') RETURNING id`)[0]!.id;
  const actor={userId:user,sessionId:session,securityVersion:0},interaction=await base.inquiries.createOrReuseInquiry(user,base.listingId,randomUUID());
  const viewing=(await client<{id:string}[]>`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,proposed_start,proposed_end,display_timezone,response_deadline,created_at,updated_at)
   SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.seeker_user_id,statement_timestamp()-interval '3 hours',statement_timestamp()-interval '2 hours','Africa/Douala',statement_timestamp()-interval '5 days',statement_timestamp()-interval '7 days',statement_timestamp()-interval '7 days' FROM interactions i WHERE i.id=${interaction.interaction_id} RETURNING id`)[0]!.id;
  await client`UPDATE viewings SET state='ACCEPTED',scheduled_start=proposed_start,scheduled_end=proposed_end,private_instructions='SYNTHETIC_EXTRA_GUIDANCE',accepted_by_user_id=${base.providerUserId},accepted_at=created_at+interval '1 hour',version=version+1 WHERE id=${viewing}`;
  await client`UPDATE viewings SET state='SCHEDULED',seeker_confirmed=true,provider_confirmed=true,version=version+1 WHERE id=${viewing}`;
  const current=await attendance.get(actor,viewing),c=await attendance.claimAttendance(actor,viewing,{...expected(current),claim_type:'COMPLETION'},base.command());await attendance.respondAttendance(base.actors.provider,viewing,c.claim.id,'confirm',{...expected(c.viewing),expected_claim_version:1},base.command());
  const e=(await reviews.eligibility(actor,viewing)).eligibility!,r=await reviews.submit(actor,e.id,{expected_version:e.version,rating},base.command()),other=(await reviews.eligibility(base.actors.provider,viewing)).eligibility!;
  await reviews.submit(base.actors.provider,other.id,{expected_version:other.version,rating:5},base.command());return r.review;
 };
 const providerAccountId=(await client<{provider_account_id:string}[]>`SELECT provider_account_id FROM interactions WHERE id=${base.interaction.interaction_id}`)[0]!.provider_account_id;
 return {...base,providerAccountId,claimId:claim.claim.id,addPublishedReview,client,attendance,reviews,moderation,viewingId:v.id,reviewId:review.id,caseId,staff,makeStaff,detail,assign,decide,async start(){await assign();await decide('BEGIN_INVESTIGATION');},async close(){await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client`TRUNCATE review_reputation`;await client`UPDATE region_publication_controls SET enabled=true`;await client.end();}};
}
