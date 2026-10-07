import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { createDatabase, IdentityStore, OrganizationOwnerStore, type OrganizationActor, type OrganizationOwnershipTransfer } from '@pachi/database';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { OrganizationOwnerController, OrganizationOwnerNoStoreGuard } from './organization-owner.controller.js';
import { OrganizationExceptionFilter } from './organization-exception.filter.js';
import { requestIdMiddleware } from './logging.js';
process.env.NODE_ENV='test';
const integration=process.env.DATABASE_TEST_URL?test:test.skip;
async function fixture(){
 const url=process.env.DATABASE_TEST_URL!;const u=new URL(url);assert.equal(u.hostname,'localhost');assert.equal(u.port,'5433');assert.equal(u.pathname,'/pachi_test');
 const {client}=createDatabase(url);await client`SET client_min_messages TO warning`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;
 const {organizationOwnerFixture}=await import(new URL('../../../packages/database/dist/organization-owner-fixture.js',import.meta.url).href) as {
  organizationOwnerFixture:(sql:typeof client)=>Promise<{actors:Record<string,OrganizationActor>;memberships:Record<string,string>;org:{id:string};otherOrg:{id:string};store:OrganizationOwnerStore;context:(actor:OrganizationActor)=>Promise<{expectedOrganizationVersion:number;expectedActorMembershipVersion:number;idempotencyKey:string;requestId:string}>}>};
 return{...await organizationOwnerFixture(client),client};
}
async function scenario(run:(call:(actor:string,path:string,body?:unknown,key?:string|null)=>Promise<Response>,f:Awaited<ReturnType<typeof fixture>>)=>Promise<void>,trusted=true){
 const f=await fixture(),{privateKey,publicKey}=await generateKeyPair('RS256');const tokens:Record<string,string>={};
 const verifier=new CognitoAccessTokenVerifier({issuer:'https://local.test/assignments',getKey:async()=>publicKey,allowedClientIds:new Set(['account']),requiredScopes:new Set(['pachi/account']),provider:'LOCAL_TEST'});
 for(const [name,actor]of Object.entries(f.actors)){const session=(await f.client`SELECT origin_jti,current_jti FROM security_sessions WHERE id=${actor.sessionId}`)[0]!;
  tokens[name]=await new SignJWT({client_id:'account',origin_jti:session.origin_jti,jti:session.current_jti,token_use:'access',scope:'pachi/account'}).setProtectedHeader({alg:'RS256'}).setIssuer('https://local.test/assignments').setSubject(name).setIssuedAt().setExpirationTime('5m').sign(privateKey);}
 @Module({controllers:[OrganizationOwnerController],providers:[AuthGuard,OrganizationOwnerNoStoreGuard,{provide:'AUTH_SERVICE',useValue:new AuthService(new IdentityStore(f.client),verifier)},{provide:'ORGANIZATION_OWNER_STORE',useValue:trusted?f.store:new OrganizationOwnerStore(f.client)}]})class TestApp{}
 const app=await NestFactory.create(TestApp,{logger:false});app.use(requestIdMiddleware);app.useGlobalFilters(new OrganizationExceptionFilter(app.getHttpAdapter()));app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 try{await run(async(actor,path,body,key=randomUUID())=>{const headers:Record<string,string>={};if(tokens[actor])headers.authorization=`Bearer ${tokens[actor]}`;if(body!==undefined){headers['content-type']='application/json';if(key!==null)headers['idempotency-key']=key;}
  const response=await fetch(`${base}/v1/account/organizations/${path}`,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(response.headers.get('cache-control'),'private, no-store');return response;},f);
 }finally{await app.close();await f.client`TRUNCATE users RESTART IDENTITY CASCADE`;await f.client.end();}
}
const versions=async(f:Awaited<ReturnType<typeof fixture>>,name='owner')=>{const c=await f.context(f.actors[name]!);return{expected_organization_version:c.expectedOrganizationVersion,expected_actor_membership_version:c.expectedActorMembershipVersion};};
void integration('privileged HTTP denies anonymous, wrong current roles, cross-org identities, extra flags and stale payloads with private neutral errors',()=>scenario(async(call,f)=>{
 const member=`${f.org.id}/members/${f.memberships.agent}/privileged-role`,body={...await versions(f),expected_membership_version:1,role:'ADMIN'};
 const paths=[member,`${f.org.id}/members/${f.memberships.owner}/privileged-revoke`,`${f.org.id}/ownership-transfers`,...['accept','complete','cancel'].map(x=>`${f.org.id}/ownership-transfers/${randomUUID()}/${x}`)];
 for(const path of paths)assert.equal((await call('anonymous',path,body)).status,401);
 assert.equal((await call('anonymous',`${f.org.id}/ownership-transfers`)).status,401);
 for(const name of ['admin','manager','agent','analyst','unrelated','otherOwner','invited','suspended','revoked'])assert.equal((await call(name,member,body)).status,404);
 for(const extra of ['mfa','step_up','organization_id','user_id','source_owner'])assert.equal((await call('owner',member,{...body,[extra]:true})).status,400);
 assert.equal((await call('owner',member,body,null)).status,400);assert.equal((await call('owner',member,body,'bad')).status,400);
 assert.equal((await call('owner',`${f.org.id}/members/${f.memberships.otherOwner}/privileged-role`,body)).status,404);
 const key=randomUUID();const response=await call('owner',member,body,key);assert.equal(response.status,201);const promoted=await response.json() as {role:string};assert.equal(promoted.role,'ADMIN');
 assert.deepEqual(await(await call('owner',member,body,key)).json(),promoted);
 assert.equal((await call('owner',member,{...body,role:'OWNER'},key)).status,409);assert.equal((await call('owner',member,body)).status,409);
 assert.equal((await call('otherOwner',`${f.org.id}/ownership-transfers`)).status,404);
}));
void integration('normal owner runtime rejects client MFA assertions and returns STEP_UP_REQUIRED without business changes',()=>scenario(async(call,f)=>{
 const path=`${f.org.id}/members/${f.memberships.agent}/privileged-role`,body={...await versions(f),expected_membership_version:1,role:'OWNER'};
 assert.equal((await call('owner',path,{...body,mfa:true})).status,400);
 const response=await call('owner',path,body);assert.equal(response.status,403);assert.equal((await response.json() as {message:string}).message,'STEP_UP_REQUIRED');
 assert.equal((await f.client`SELECT count(*)::int AS count FROM organization_owner_actions`)[0]?.count,0);
},false));
void integration('ownership HTTP executes initiate, intended acceptance and atomic completion with safe current projections and private retries',()=>scenario(async(call,f)=>{
 const collection=`${f.org.id}/ownership-transfers`;
 const initiated=await call('owner',collection,{...await versions(f),recipient_membership_id:f.memberships.agent,expected_recipient_membership_version:1,source_role_after:'ANALYST'});assert.equal(initiated.status,201);
 let transfer=await initiated.json() as OrganizationOwnershipTransfer;
 const input=async(name:string)=>({...await versions(f,name),expected_transfer_version:transfer.version,expected_source_membership_version:1,expected_recipient_membership_version:1});
 assert.equal((await call('admin',`${collection}/${transfer.id}/accept`,await input('admin'))).status,404);
 assert.equal((await(await call('analyst',collection)).json() as {transfers:unknown[]}).transfers.length,0);
 const accepted=await call('agent',`${collection}/${transfer.id}/accept`,await input('agent'));assert.equal(accepted.status,201);transfer=await accepted.json() as OrganizationOwnershipTransfer;assert.equal(transfer.state,'ACCEPTED');
 const body=await input('owner'),key=randomUUID();const completed=await call('owner',`${collection}/${transfer.id}/complete`,body,key);assert.equal(completed.status,201);const projection=await completed.json() as OrganizationOwnershipTransfer;assert.equal(projection.state,'COMPLETED');
 assert.doesNotMatch(JSON.stringify(projection),/session|security_version|secret|token|phone|evidence|accepted_by|completed_by/);
 assert.deepEqual(await(await call('owner',`${collection}/${transfer.id}/complete`,body,key)).json(),projection);
 assert.equal((await f.client`SELECT role FROM organization_memberships WHERE id=${f.memberships.owner!}`)[0]?.role,'ANALYST');
}));
void integration('privileged HTTP exposes cancellation, final-owner protection and version-safe revocation separately from ordinary routes',()=>scenario(async(call,f)=>{
 const remove=`${f.org.id}/members/${f.memberships.owner}/privileged-revoke`;
 const response=await call('owner',remove,{...await versions(f),expected_membership_version:1});assert.equal(response.status,409);assert.equal((await response.json() as {message:string}).message,'FINAL_OWNER_PROTECTED');
 const collection=`${f.org.id}/ownership-transfers`,initiated=await call('owner',collection,{...await versions(f),recipient_membership_id:f.memberships.agent,expected_recipient_membership_version:1,source_role_after:'AGENT'});const transfer=await initiated.json() as OrganizationOwnershipTransfer;
 const cancelled=await call('owner',`${collection}/${transfer.id}/cancel`,{...await versions(f),expected_transfer_version:1,expected_source_membership_version:1,expected_recipient_membership_version:1});assert.equal(cancelled.status,201);assert.equal((await cancelled.json() as OrganizationOwnershipTransfer).state,'CANCELLED');
 assert.equal((await call('owner',`${f.org.id}/members/${f.memberships.admin}/privileged-revoke`,{...await versions(f),expected_membership_version:1})).status,201);
}));
