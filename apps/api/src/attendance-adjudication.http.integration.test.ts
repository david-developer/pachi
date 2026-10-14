import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {Controller,Get,Module,UseGuards} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {generateKeyPair,SignJWT} from 'jose';
import {AttendanceAdjudicationStore,IdentityStore,StaffStore,type StaffPrincipal,type createDatabase} from '@pachi/database';
import type {AttendanceAdjudicationCommandResponse} from '@pachi/contracts';
import {StaffAttendanceAdjudicationController,AttendanceAppealController,AttendanceAppealAuthGuard} from './attendance-adjudication.controller.js';
import {StaffAuthService} from './staff.controller.js';
import {AuthService} from './auth.service.js';
import {AuthGuard} from './auth.guard.js';
import {CognitoAccessTokenVerifier} from './token-verifier.js';
import {OrganizationOwnerNoStoreGuard} from './organization-owner.controller.js';
import {OrganizationExceptionFilter} from './organization-exception.filter.js';
import {requestIdMiddleware} from './logging.js';
const integration=process.env.DATABASE_TEST_URL?test:test.skip;
type Fixture={client:ReturnType<typeof createDatabase>['client'];store:AttendanceAdjudicationStore;staff:StaffPrincipal;caseId:string;viewingId:string;seekerId:string;providerUserId:string;actors:{seeker:{sessionId:string};provider:{sessionId:string}};assign:()=>Promise<unknown>;start:()=>Promise<void>;decide:(outcome?:'COMPLETED'|'CLAIM_INVALIDATED')=>Promise<AttendanceAdjudicationCommandResponse>;close:()=>Promise<void>;makeStaff:(permissions?:string[],userId?:string,role?:string)=>Promise<StaffPrincipal>};
type Actor=StaffPrincipal|'seeker'|'provider'|null;
type Call=(path:string,body?:unknown,actor?:Actor,raw?:boolean)=>Promise<Response>;
async function scenario(work:(f:Fixture,call:Call)=>Promise<void>){
 const {attendanceAdjudicationFixture}=await import(new URL('../../../packages/database/dist/attendance-adjudication-fixture.js',import.meta.url).href),f=await attendanceAdjudicationFixture('published') as Fixture;
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const staffVerifier=new CognitoAccessTokenVerifier({issuer:f.staff.row.issuer,getKey:async()=>publicKey,allowedClientIds:new Set(['staff']),requiredScopes:new Set(['pachi/staff']),provider:'LOCAL_TEST',strictStaff:true});
 const accountIssuer='https://local.test/viewing',accountVerifier=new CognitoAccessTokenVerifier({issuer:accountIssuer,getKey:async()=>publicKey,allowedClientIds:new Set(['account']),requiredScopes:new Set(['pachi/account']),provider:'LOCAL_TEST'});
 const subjects={seeker:randomUUID(),provider:randomUUID()};for(const name of ['seeker','provider'] as const)await f.client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES(${name==='seeker'?f.seekerId:f.providerUserId},${accountIssuer},${subjects[name]},'LOCAL_TEST')`;
 @Controller('account/ordinary-check') @UseGuards(OrganizationOwnerNoStoreGuard,AuthGuard) class OrdinaryController{@Get() check(){return {ok:true};}}
 @Module({controllers:[StaffAttendanceAdjudicationController,AttendanceAppealController,OrdinaryController],providers:[OrganizationOwnerNoStoreGuard,AttendanceAppealAuthGuard,AuthGuard,{provide:'AUTH_SERVICE',useValue:new AuthService(new IdentityStore(f.client),accountVerifier)},{provide:'STAFF_AUTH_SERVICE',useValue:new StaffAuthService(new StaffStore(f.client),staffVerifier)},{provide:'ATTENDANCE_ADJUDICATION_STORE',useValue:f.store}]})class TestApp{}
 const app=await NestFactory.create(TestApp,{logger:false});app.setGlobalPrefix('v1');app.use(requestIdMiddleware);app.useGlobalFilters(new OrganizationExceptionFilter(app.getHttpAdapter()));await app.listen(0,'127.0.0.1');
 try{const address=app.getHttpServer().address() as {port:number},base=`http://127.0.0.1:${address.port}/v1`;
 const call:Call=async(path,body,actor=f.staff,raw=false)=>{
  const headers:Record<string,string>={'x-request-id':randomUUID(),...(body===undefined?{}:{'content-type':'application/json'})};
  if(actor){let issuer:string,subject:string,client:string,origin:string,scope:string;
   if(typeof actor==='string'){issuer=accountIssuer;subject=subjects[actor];client='account';scope='pachi/account';origin=(await f.client<{origin_jti:string}[]>`SELECT origin_jti FROM security_sessions WHERE id=${f.actors[actor].sessionId}`)[0]!.origin_jti;}
   else{issuer=actor.row.issuer;subject=(await f.client<{subject:string}[]>`SELECT subject FROM auth_identities WHERE id=${actor.row.identity_id}`)[0]!.subject;client='staff';origin=actor.row.origin_jti;scope='pachi/staff';}
   headers.authorization=`Bearer ${await new SignJWT({client_id:client,origin_jti:origin,jti:randomUUID(),token_use:'access',scope}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(privateKey)}`;
  }
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:raw?String(body):JSON.stringify(body)})});if(!path.endsWith('ordinary-check')){assert.equal(r.headers.get('cache-control'),'private, no-store');assert.match(r.headers.get('x-request-id')??'',/^[0-9a-f-]{36}$/);}return r;
 };await work(f,call);
 }finally{await app.close();await f.close();}
}
const staffPath=(f:Fixture,suffix='')=>`/staff/attendance-cases/${f.caseId}${suffix}`;
const accountPath=(f:Fixture,suffix='resolution')=>`/account/viewings/${f.viewingId}/attendance/${suffix}`;
const payload=(version=3)=>({purpose:'ATTENDANCE_ADJUDICATION',expected_version:version,outcome:'COMPLETED',reason_code:'ATTENDANCE_SUPPORTED',reason_text:'PRIVATE_HTTP_REASON for supported attendance',evidence:[],idempotency_key:randomUUID()});
void integration('G3-H2 HTTP queue and detail enforce staff scope, purpose, assignment and safe metadata',async()=>scenario(async(f,call)=>{
 assert.equal((await call('/staff/attendance-cases?purpose=ATTENDANCE_ADJUDICATION',undefined,null)).status,401);
 const queue=await call('/staff/attendance-cases?purpose=ATTENDANCE_ADJUDICATION');assert.equal(queue.status,200);const text=await queue.text();assert.ok(text.includes(f.caseId));for(const secret of ['CONFIDENTIAL','claims','evidence','rating'])assert.equal(text.includes(secret),false);
 assert.equal((await call(staffPath(f,'?purpose=ATTENDANCE_ADJUDICATION'))).status,403);await f.start();const detail=await call(staffPath(f,'?purpose=ATTENDANCE_ADJUDICATION'));assert.equal(detail.status,200);const content=await detail.text();assert.ok(content.includes('claim_type'));for(const secret of ['CONFIDENTIAL_ATTENDANCE_GUIDANCE','CONFIDENTIAL_ATTENDANCE_REVIEW','reporter_user_id','private_instructions'])assert.equal(content.includes(secret),false);
 assert.equal((await call(staffPath(f,'?purpose=OTHER'))).status,400);
}));
void integration('G3-H2 HTTP step-up and conflicted ordinary SUPER_ADMIN cannot bypass case grants',async()=>scenario(async(f,call)=>{
 const own=await f.makeStaff(undefined,f.seekerId),admin=await f.makeStaff(['admin:permissions_manage'],undefined,'SUPER_ADMIN');assert.equal((await call('/staff/attendance-cases?purpose=ATTENDANCE_ADJUDICATION',undefined,admin)).status,403);
 const assignment={purpose:'ATTENDANCE_ADJUDICATION',expected_version:1,assigned_staff_user_id:own.row.user_id,idempotency_key:randomUUID()};assert.equal((await call(staffPath(f,'/assign'),assignment,own)).status,403);
 await f.start();await f.client`UPDATE staff_sessions SET authenticated_at=statement_timestamp()-interval '15 minutes',absolute_expires_at=statement_timestamp()+interval '7 hours' WHERE id=${f.staff.row.id}`;const denied=await call(staffPath(f,'/decisions'),payload());assert.equal(denied.status,403);assert.equal((await denied.json() as {code:string}).code,'STEP_UP_REQUIRED');
}));
void integration('G3-H2 HTTP decisions are attributed, immutable, versioned and replay-safe',async()=>scenario(async(f,call)=>{
 await f.start();const body=payload(),first=await call(staffPath(f,'/decisions'),body);assert.equal(first.status,201);const d=await first.json() as AttendanceAdjudicationCommandResponse;assert.equal(d.action.command,'DECIDE');assert.equal(d.action.actor_user_id,f.staff.row.user_id);
 const replay=await call(staffPath(f,'/decisions'),body);assert.equal(replay.status,201);assert.equal((await replay.json() as AttendanceAdjudicationCommandResponse).replayed,true);assert.equal((await call(staffPath(f,'/decisions'),{...body,idempotency_key:randomUUID()})).status,409);
 const safe=await call(accountPath(f),undefined,'seeker');assert.equal(safe.status,200);const text=await safe.text();assert.ok(text.includes('COMPLETED'));assert.equal(text.includes('PRIVATE_HTTP_REASON'),false);assert.equal(text.includes(f.staff.row.user_id),false);
}));
void integration('G3-H2 HTTP participant appeal and sole-operator reconsideration preserve private and linked history',async()=>scenario(async(f,call)=>{
 await f.start();const d=await f.decide('CLAIM_INVALIDATED'),body={original_action_id:d.action.id,reason:'I challenge the attendance outcome with existing evidence',evidence:[],idempotency_key:randomUUID()};const ap=await call(accountPath(f,'appeals'),body,'provider');assert.equal(ap.status,201);const submitted=await ap.json() as {appeal:{id:string}};
 const decision={...payload(4),appeal_id:submitted.appeal.id,original_action_id:d.action.id,appeal_outcome:'OVERTURNED',review_mode:'SOLE_OPERATOR_RECONSIDERATION'};assert.equal((await call(staffPath(f,'/appeal-decisions'),decision)).status,201);
 const safe=await call(accountPath(f),undefined,'provider');const text=await safe.text();assert.ok(text.includes('SOLE_OPERATOR_RECONSIDERATION'));assert.ok(text.includes('OVERTURNED'));assert.equal(text.includes('PRIVATE_HTTP_REASON'),false);
}));
void integration('G3-H2 HTTP suspended users can appeal through the dedicated route while ordinary auth remains denied',async()=>scenario(async(f,call)=>{
 await f.start();const d=await f.decide('CLAIM_INVALIDATED');await f.client`UPDATE users SET account_state='SUSPENDED' WHERE id=${f.seekerId}`;
 assert.equal((await call('/account/ordinary-check',undefined,'seeker')).status,401);assert.equal((await call(accountPath(f),undefined,'seeker')).status,200);
 const body={original_action_id:d.action.id,reason:'A suspended participant challenges this decision safely',evidence:[],idempotency_key:randomUUID()};assert.equal((await call(accountPath(f,'appeals'),body,'seeker')).status,201);
}));
void integration('G3-H2 HTTP malformed JSON and extra trusted-role/outcome fields keep private error envelopes',async()=>scenario(async(f,call)=>{
 await f.start();for(const body of [{...payload(),role:'SUPER_ADMIN'},{...payload(),evidence:[{kind:'MESSAGE',reference:randomUUID()}]}]){const r=await call(staffPath(f,'/decisions'),body);assert.ok([400,403].includes(r.status));assert.ok(!(await r.text()).includes('PRIVATE_HTTP_REASON'));}
 const malformed=await call(staffPath(f,'/decisions'),'{',f.staff,true);assert.equal(malformed.status,400);assert.ok(!(await malformed.text()).includes('SyntaxError'));
}));
