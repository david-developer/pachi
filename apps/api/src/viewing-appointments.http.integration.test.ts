import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { createDatabase, IdentityStore, ViewingAppointmentStore } from '@pachi/database';
import type { ViewingCommandResponse, ViewingRescheduleCommandResponse, ViewingRescheduleListResponse, ViewingNoticeListResponse, ViewingNoticeResponse, ViewingReminderResponse, ViewingResponse } from '@pachi/contracts';
import { ViewingController } from './viewing.controller.js';
import { OrganizationOwnerNoStoreGuard } from './organization-owner.controller.js';
import { OrganizationExceptionFilter } from './organization-exception.filter.js';
import { requestIdMiddleware } from './logging.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
process.env.NODE_ENV='test';
const integration=process.env.DATABASE_TEST_URL?test:test.skip;
const guidance='SYNTHETIC_HTTP_F2_PRIVATE_GUIDANCE: staffed reception';
const expected=(v:ViewingResponse)=>({expected_version:v.version,expected_schedule_version:v.schedule_version});
type Call=(actor:string,path:string,body?:unknown,key?:string|null,raw?:boolean)=>Promise<Response>;
type Fixture={client:ReturnType<typeof createDatabase>['client'];seekerId:string;listingId:string;interaction:{interaction_id:string};input:{proposed_start:string;proposed_end:string;display_timezone:string}};
async function scenario(run:(call:Call,f:Fixture)=>Promise<void>){
  const url=process.env.DATABASE_TEST_URL!,u=new URL(url);assert.equal(u.hostname,'localhost');assert.equal(u.port,'5433');assert.equal(u.pathname,'/pachi_test');
  const {client}=createDatabase(url);await client`SET client_min_messages TO warning`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client`UPDATE region_publication_controls SET enabled=true`;
  const {viewingFixture}=await import(new URL('../../../packages/database/dist/viewing-fixture.js',import.meta.url).href);const f=await viewingFixture(client);
  const {privateKey,publicKey}=await generateKeyPair('RS256'),issuer='https://local.test/viewing-f2-http',tokens:Record<string,string>={};
  for(const [name,id] of [['seeker',f.seekerId],['provider',f.providerUserId],['other',f.otherUserId]] as const){
    await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES(${id},${issuer},${name},'LOCAL_TEST')`;
    tokens[name]=await new SignJWT({client_id:'account',origin_jti:randomUUID(),jti:randomUUID(),token_use:'access',scope:'pachi/account'}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setSubject(name).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  }
  const verifier=new CognitoAccessTokenVerifier({issuer,getKey:async()=>publicKey,allowedClientIds:new Set(['account']),requiredScopes:new Set(['pachi/account']),provider:'LOCAL_TEST'});
  @Module({controllers:[ViewingController],providers:[AuthGuard,OrganizationOwnerNoStoreGuard,{provide:'AUTH_SERVICE',useValue:new AuthService(new IdentityStore(client),verifier)},{provide:'VIEWING_STORE',useValue:new ViewingAppointmentStore(client,true)}]})class TestApp{}
  const app=await NestFactory.create(TestApp,{logger:false});app.use(requestIdMiddleware);app.useGlobalFilters(new OrganizationExceptionFilter(app.getHttpAdapter()));app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');const base=`${await app.getUrl()}/v1/account`;
  try{await run(async(actor,path,body,key=randomUUID(),raw=false)=>{
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(tokens[actor]?{authorization:`Bearer ${tokens[actor]}`}:{ }),'content-type':'application/json',...(key?{'idempotency-key':key}:{})},...(body===undefined?{}:{body:raw?String(body):JSON.stringify(body)})});
    assert.equal(response.headers.get('cache-control'),'private, no-store');return response;
  },{...f,client});}finally{await app.close();await client`UPDATE region_publication_controls SET enabled=true`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client.end();}
}
async function error(r:Response,status:number,code?:string){assert.equal(r.status,status);const body=await r.json() as {statusCode:number;code:string;message:string;request_id:string};assert.deepEqual(Object.keys(body).sort(),['statusCode','code','message','request_id'].sort());assert.equal(body.request_id,r.headers.get('x-request-id'));assert.match(body.request_id,/^[0-9a-f-]{36}$/);if(code)assert.equal(body.code,code);}
async function value<T>(r:Response,status:number):Promise<T>{assert.equal(r.status,status);return r.json() as Promise<T>;}
async function scheduled(call:Call,f:Fixture){
  let r=await value<ViewingCommandResponse>(await call('seeker',`/interactions/${f.interaction.interaction_id}/viewings`,f.input),201);
  const path=`/viewings/${r.viewing.id}`;r=await value(await call('provider',path+'/accept',{...expected(r.viewing),scheduled_start:f.input.proposed_start,scheduled_end:f.input.proposed_end,private_instructions:guidance}),201);
  r=await value(await call('seeker',path+'/confirm',expected(r.viewing)),201);r=await value(await call('provider',path+'/confirm',expected(r.viewing)),201);return r.viewing;
}
const replacement=(v:ViewingResponse)=>({...expected(v),proposed_start:new Date(Date.parse(v.scheduled_start!)+86400000).toISOString(),proposed_end:new Date(Date.parse(v.scheduled_end!)+86400000).toISOString()});

void integration('G3-F2 HTTP seeker/provider proposal, both approvals, retained schedule history and safe participant notice acknowledgement',()=>scenario(async(call,f)=>{
  const old=await scheduled(call,f),path=`/viewings/${old.id}/reschedules`,key=randomUUID(),input=replacement(old);
  let r=await value<ViewingRescheduleCommandResponse>(await call('provider',path,input,key),201);assert.equal(r.viewing.scheduled_start,old.scheduled_start);assert.equal(r.proposal.seeker_approved,false);assert.equal(r.proposal.provider_approved,false);
  assert.equal((await value<ViewingRescheduleCommandResponse>(await call('provider',path,input,key),201)).replayed,true);
  r=await value(await call('provider',`${path}/${r.proposal.id}/accept`,{...expected(r.viewing),expected_proposal_version:r.proposal.version}),201);assert.equal(r.viewing.schedule_version,1);
  r=await value(await call('seeker',`${path}/${r.proposal.id}/accept`,{...expected(r.viewing),expected_proposal_version:r.proposal.version}),201);assert.equal(r.viewing.schedule_version,2);assert.equal(r.proposal.state,'FINALIZED');assert.equal(r.viewing.scheduled_start,input.proposed_start);
  const list=await value<ViewingRescheduleListResponse>(await call('seeker',path),200);assert.equal(list.schedule_history[0]!.scheduled_start,old.scheduled_start);
  const notices=await value<ViewingNoticeListResponse>(await call('seeker',`/viewing-notices?viewing_id=${old.id}`),200);assert.ok(notices.items.some(n=>n.event_type==='viewing_reschedule_finalized'));assert.equal(JSON.stringify(notices).includes(guidance),false);assert.equal(JSON.stringify(notices).includes(input.proposed_start),false);
  const n=notices.items[0]!,read=await value<ViewingNoticeResponse>(await call('seeker',`/viewing-notices/${n.id}/read`,{}),201);assert.ok(read.read_at);assert.equal((await value<ViewingNoticeResponse>(await call('seeker',`/viewing-notices/${n.id}/read`,{}),201)).read_at,read.read_at);
  await error(await call('provider',`/viewing-notices/${n.id}/read`,{}),404,'RESOURCE_UNAVAILABLE');
  const reminders=await value<ViewingReminderResponse>(await call('provider',`/viewings/${old.id}/reminders`),200);assert.equal(reminders.external_state,'NOT_ENABLED');assert.equal(reminders.items.filter(j=>j.expected_schedule_version===2&&j.state==='PENDING').length,2);
}));

void integration('G3-F2 HTTP authentication, malformed parser input, strict DTOs, neutral cross-account scope and stale versions remain fail closed',()=>scenario(async(call,f)=>{
  const v=await scheduled(call,f),path=`/viewings/${v.id}/reschedules`,input=replacement(v);
  for(const route of ['/viewing-notices',path,`/viewings/${v.id}/reminders`])await error(await call('anonymous',route),401,'AUTH_REQUIRED');
  await error(await call('other',path,input),404,'RESOURCE_UNAVAILABLE');await error(await call('other',`/viewing-notices?viewing_id=${v.id}`),404,'RESOURCE_UNAVAILABLE');
  await error(await call('seeker',path,'{malformed',randomUUID(),true),400,'INVALID_INPUT');await error(await call('seeker',path,{...input,organization_id:randomUUID()}),400,'INVALID_INPUT');await error(await call('seeker',path,input,null),400,'INVALID_IDEMPOTENCY_KEY');
  await error(await call('seeker',path,{...input,proposed_start:'2026-02-30T12:00:00Z'}),400,'INVALID_INPUT');await error(await call('seeker',path,{...input,proposed_start:'2000-01-01T00:00:00Z'}),409,'APPOINTMENT_PAST');
  const r=await value<ViewingRescheduleCommandResponse>(await call('seeker',path,input),201);
  await error(await call('provider',`${path}/${r.proposal.id}/accept`,{...expected(v),expected_proposal_version:1}),409,'STALE_VERSION');
  await error(await call('provider',`${path}/${r.proposal.id}/accept`,{...expected(r.viewing),expected_proposal_version:2}),409,'STALE_PROPOSAL_VERSION');
  for(const query of ['limit=0','limit=51','cursor=invalid','organization_id=anything'])await error(await call('seeker',`/viewing-notices?${query}`),400,'INVALID_INPUT');
}));

void integration('G3-F2 HTTP rejection/withdrawal retain the scheduled appointment and cannot be performed by the wrong side',()=>scenario(async(call,f)=>{
  const v=await scheduled(call,f),path=`/viewings/${v.id}/reschedules`;let r=await value<ViewingRescheduleCommandResponse>(await call('seeker',path,replacement(v)),201);
  await error(await call('seeker',`${path}/${r.proposal.id}/reject`,{...expected(r.viewing),expected_proposal_version:1}),404,'RESOURCE_UNAVAILABLE');
  r=await value(await call('provider',`${path}/${r.proposal.id}/reject`,{...expected(r.viewing),expected_proposal_version:1}),201);assert.equal(r.proposal.state,'REJECTED');assert.equal(r.viewing.scheduled_start,v.scheduled_start);
  r=await value(await call('provider',path,replacement(r.viewing)),201);
  r=await value(await call('provider',`${path}/${r.proposal.id}/withdraw`,{...expected(r.viewing),expected_proposal_version:1}),201);assert.equal(r.proposal.state,'WITHDRAWN');assert.equal(r.viewing.schedule_version,1);
}));

void integration('G3-F2 HTTP blocking/restrictions deny approvals, retain safe notices and allow current-scope withdrawal without revealing directions',()=>scenario(async(call,f)=>{
  const v=await scheduled(call,f),path=`/viewings/${v.id}/reschedules`;const r=await value<ViewingRescheduleCommandResponse>(await call('seeker',path,replacement(v)),201);
  await f.client`INSERT INTO block_relationships(blocker_user_id,blocked_provider_account_id) VALUES(${f.seekerId},${v.provider_account_id})`;
  await error(await call('provider',`${path}/${r.proposal.id}/accept`,{...expected(r.viewing),expected_proposal_version:1}),403,'CAPABILITY_RESTRICTED');
  await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${f.seekerId}`;
  const notices=await value<ViewingNoticeListResponse>(await call('seeker',`/viewing-notices?viewing_id=${v.id}`),200);assert.equal(JSON.stringify(notices).includes(guidance),false);
  const withdrawal=await value<ViewingRescheduleCommandResponse>(await call('seeker',`${path}/${r.proposal.id}/withdraw`,{...expected(r.viewing),expected_proposal_version:1}),201);assert.equal(withdrawal.proposal.state,'WITHDRAWN');assert.equal(withdrawal.viewing.private_instructions,null);
  const notice=notices.items[0]!;await error(await call('seeker',`/viewing-notices/${notice.id}/read`,{user_id:randomUUID()}),400,'INVALID_INPUT');
}));

void integration('G3-F2 HTTP concurrent identical proposal retries persist one proposal and no duplicate participant notices',()=>scenario(async(call,f)=>{
  const v=await scheduled(call,f),path=`/viewings/${v.id}/reschedules`,key=randomUUID(),input=replacement(v);
  const results=await Promise.all([call('seeker',path,input,key),call('seeker',path,input,key)]);const bodies=await Promise.all(results.map(r=>value<ViewingRescheduleCommandResponse>(r,201)));
  assert.equal(bodies[0]!.proposal.id,bodies[1]!.proposal.id);assert.equal(bodies.filter(r=>r.replayed).length,1);
  assert.equal((await f.client`SELECT count(*)::int AS count FROM viewing_reschedule_proposals`)[0]!.count,1);
  assert.equal((await f.client`SELECT count(*)::int AS count FROM viewing_notices WHERE event_type='viewing_reschedule_proposed'`)[0]!.count,2);
}));
