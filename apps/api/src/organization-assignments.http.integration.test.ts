import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { createDatabase, IdentityStore, OrganizationAssignmentStore } from '@pachi/database';
import type { OrganizationAssignment } from '@pachi/contracts';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { OrganizationNoStoreGuard } from './organization.controller.js';
import { OrganizationAssignmentsController } from './organization-assignments.controller.js';
import { OrganizationExceptionFilter } from './organization-exception.filter.js';
import { requestIdMiddleware } from './logging.js';

const integration=process.env.DATABASE_TEST_URL?test:test.skip;
// The shared fixture is loaded at runtime from the database package's built
// test fixture, keeping app compilation inside its own rootDir.
async function scenario(run:(call:(actor:string,path:string,body?:unknown,key?:string|null,raw?:boolean)=>Promise<Response>, f:Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const f=await fixture(),{privateKey,publicKey}=await generateKeyPair('RS256');
  const tokens:Record<string,string>={};
  const verifier=new CognitoAccessTokenVerifier({issuer:'https://local.test/assignments',getKey:async()=>publicKey,allowedClientIds:new Set(['account']),requiredScopes:new Set(['pachi/account']),provider:'LOCAL_TEST'});
  for(const [name,actor] of Object.entries(f.actors)) {
    await f.client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES(${actor.userId},'https://local.test/assignments',${name},'LOCAL_TEST')`;
    const session=(await f.client`SELECT origin_jti,current_jti FROM security_sessions WHERE id=${actor.sessionId}`)[0]!;
    tokens[name]=await new SignJWT({client_id:'account',origin_jti:session.origin_jti,jti:session.current_jti,token_use:'access',scope:'pachi/account'})
      .setProtectedHeader({alg:'RS256'}).setIssuer('https://local.test/assignments').setSubject(name).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  }
  @Module({controllers:[OrganizationAssignmentsController],providers:[AuthGuard,OrganizationNoStoreGuard,
    {provide:'AUTH_SERVICE',useValue:new AuthService(new IdentityStore(f.client),verifier)},
    {provide:'ORGANIZATION_ASSIGNMENT_STORE',useValue:new OrganizationAssignmentStore(f.client)}]})
  class TestApp {}
  const app=await NestFactory.create(TestApp,{logger:false});app.use(requestIdMiddleware);app.useGlobalFilters(new OrganizationExceptionFilter(app.getHttpAdapter()));app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
  const base=await app.getUrl();
  try {
    await run(async(actor,path,body,key=randomUUID(),raw=false)=>{
      const headers:Record<string,string>={};if(tokens[actor])headers.authorization=`Bearer ${tokens[actor]}`;
      if(body!==undefined){headers['content-type']='application/json';if(key!==null)headers['idempotency-key']=key;}
      const response=await fetch(`${base}/v1${path}`,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:raw?String(body):JSON.stringify(body)})});
      assert.equal(response.headers.get('cache-control'),'no-store');return response;
    },f);
  }finally{await app.close();await f.client`TRUNCATE users RESTART IDENTITY CASCADE`;await f.client.end();}
}
async function fixture() {
  const u=new URL(process.env.DATABASE_TEST_URL!);assert.equal(u.hostname,'localhost');assert.equal(u.port,'5433');assert.equal(u.pathname,'/pachi_test');
  const {client}=createDatabase(u.toString());await client`TRUNCATE users RESTART IDENTITY CASCADE`;
  const {organizationAssignmentFixture}=await import(new URL('../../../packages/database/dist/organization-assignment-fixture.js',import.meta.url).href) as {
    organizationAssignmentFixture:(client:ReturnType<typeof createDatabase>['client'])=>Promise<{
      actors:Record<string,{userId:string;sessionId:string;securityVersion:number}>;memberships:Record<string,string>;
      org:{id:string;provider_account_id:string};otherOrg:{id:string};listingIds:string[];foreignListingId:string;interactionIds:string[];
    }>
  };
  return {...await organizationAssignmentFixture(client),client};
}
const path=(org:string,type:string,id:string)=>`/account/organizations/${org}/resources/${type}/${id}/assignments`;
void integration('assignment HTTP uses current role and resource authority, neutral no-store errors, strict inputs and safe history',()=>scenario(async(call,f)=>{
  const listing=path(f.org.id,'LISTING',f.listingIds[0]!),interaction=path(f.org.id,'INTERACTION',f.interactionIds[0]!);
  const body={membership_id:f.memberships.agent,expected_version:0};
  assert.equal((await call('anonymous',listing)).status,401);
  for(const actor of ['unrelated','otherOwner','invited','suspended','revoked','analyst','agent'])assert.equal((await call(actor,listing,body)).status,404);
  for(const extra of ['provider_account_id','organization_id','role','assignment_id','authorized'])assert.equal((await call('owner',listing,{...body,[extra]:f.org.id})).status,400);
  assert.equal((await call('owner',listing,body,null)).status,400);
  assert.equal((await call('owner',listing,body,'bad')).status,400);
  assert.equal((await call('owner',listing,'{ malformed',randomUUID(),true)).status,400);
  assert.equal((await call('owner',path(f.otherOrg.id,'LISTING',f.listingIds[0]!),body)).status,404);
  assert.equal((await call('owner',path(f.org.id,'LISTING',f.foreignListingId),body)).status,404);
  assert.equal((await call('owner',path(f.org.id,'VIEWING',f.interactionIds[0]!),body)).status,400);
  assert.equal((await call('owner',listing,{...body,membership_id:f.memberships.otherOwner})).status,404);
  const key=randomUUID(),response=await call('manager',listing,body,key);assert.equal(response.status,201);
  const granted=await response.json() as OrganizationAssignment;
  assert.equal(granted.version,1);assert.equal(granted.state,'ACTIVE');
  assert.doesNotMatch(JSON.stringify(granted),/assigned_by|policy_version|contact|phone|token|evidence|title|body|provider_account/);
  assert.equal((await f.client`SELECT request_id FROM organization_assignment_actions WHERE assignment_id=${granted.id}`)[0]!.request_id,response.headers.get('x-request-id'));
  assert.deepEqual(await (await call('manager',listing,body,key)).json(),granted);
  assert.equal((await call('manager',listing,{...body,expected_version:1},key)).status,409);
  assert.equal((await call('manager',`${listing}?role=OWNER`)).status,400);
  assert.equal((await call('manager',`${listing}?membership_id=${f.memberships.agent}&limit=1`)).status,200);
  assert.equal((await call('agent',listing)).status,404);
  assert.equal((await call('admin',interaction,body)).status,201);
  assert.equal((await call('agent',`${listing}/${granted.id}/revoke`,{expected_version:1})).status,404);
  assert.equal((await call('owner',`${interaction}/${granted.id}/revoke`,{expected_version:1})).status,404);
  const revoked=await call('owner',`${listing}/${granted.id}/revoke`,{expected_version:1});assert.equal(revoked.status,201);
  assert.equal((await revoked.json() as OrganizationAssignment).version,2);
  assert.equal((await call('owner',listing,body)).status,409);
  assert.equal((await call('owner',listing,{...body,expected_version:2})).status,201);
  await f.client`UPDATE organization_memberships SET state='REVOKED',version=version+1 WHERE id=${f.memberships.manager!}`;
  assert.equal((await call('manager',listing,body,key)).status,404);
  await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE user_id=${f.actors.owner!.userId}`;
  assert.equal((await call('owner',listing)).status,401);
}));
