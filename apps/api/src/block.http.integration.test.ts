import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { BlockStore, createDatabase, IdentityStore, InteractionStore } from '@pachi/database';
import type { OwnBlockResponse, ContactSafetyResponse } from '@pachi/contracts';
import { BlockController } from './block.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { OrganizationNoStoreGuard } from './organization.controller.js';
import { OrganizationExceptionFilter } from './organization-exception.filter.js';
import { requestIdMiddleware } from './logging.js';
import { fixtureFor } from './conversation-fixture.js';

const integration=process.env.DATABASE_TEST_URL?test:test.skip;
void integration('private block HTTP derives both directions, protects parser/cache/enumeration boundaries and permits phone-free own controls',async()=>{
  const url=new URL(process.env.DATABASE_TEST_URL!);assert.equal(url.hostname,'localhost');assert.equal(url.port,'5433');assert.equal(url.pathname,'/pachi_test');
  const {client}=createDatabase(url.href);const {privateKey,publicKey}=await generateKeyPair('RS256');const issuer='https://local.test/block-http';
  const verifier=new CognitoAccessTokenVerifier({issuer,getKey:async()=>publicKey,allowedClientIds:new Set(['account']),requiredScopes:new Set(['pachi/account']),provider:'LOCAL_TEST'});
  @Module({controllers:[BlockController],providers:[AuthGuard,OrganizationNoStoreGuard,{provide:'AUTH_SERVICE',useValue:new AuthService(new IdentityStore(client),verifier)},{provide:'BLOCK_STORE',useValue:new BlockStore(client,true)}]})class TestApp{}
  const app=await NestFactory.create(TestApp,{logger:false});app.use(requestIdMiddleware);app.useGlobalFilters(new OrganizationExceptionFilter(app.getHttpAdapter()));app.setGlobalPrefix('v1');await app.listen(0,'127.0.0.1');
  try{
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;const f=await fixtureFor(client);const tokens={} as Record<string,string>;
    for(const [name,id] of [['seeker',f.seekerId],['provider',f.providerUserId],['other',f.otherUserId]]){
      await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${id!},${issuer},${name!},'LOCAL_TEST')`;
      tokens[name!]=await new SignJWT({client_id:'account',origin_jti:randomUUID(),jti:randomUUID(),token_use:'access',scope:'pachi/account'}).setProtectedHeader({alg:'RS256'}).setSubject(name!).setIssuer(issuer).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    }
    const context=await new InteractionStore(client,true).createOrReuseInquiry(f.seekerId,f.listingId,randomUUID());const base=`${await app.getUrl()}/v1/account`;
    const call=async(actor:string,path:string,body?:unknown,key:string|null=randomUUID(),raw=false)=>{
      const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(actor==='anonymous'?{}:{authorization:`Bearer ${tokens[actor]}`}),'content-type':'application/json',...(key?{'idempotency-key':key}:{})},...(body===undefined?{}:{body:raw?String(body):JSON.stringify(body)})});
      assert.equal(response.headers.get('cache-control'),'no-store');return response;
    };
    const path=`/interactions/${context.interaction_id}/block`;
    assert.equal((await call('anonymous','/blocks')).status,401);
    for(const input of [{blocked_user_id:f.providerUserId},[],null])assert.equal((await call('seeker',path,input)).status,400);
    assert.equal((await call('seeker',path,{},null)).status,400);assert.equal((await call('seeker',path,{},'invalid')).status,400);
    assert.equal((await call('seeker',path,'{bad',randomUUID(),true)).status,400);
    for(const id of [randomUUID(),'invalid']){
      const miss=await call('seeker',`/interactions/${id}/block`,{});assert.equal(miss.status,404);assert.deepEqual(await miss.json(),{statusCode:404,message:'RESOURCE_UNAVAILABLE'});
    }
    assert.equal((await call('other',path,{})).status,404);
    assert.equal((await call('provider',`/listings/${f.listingId}/block-provider`,{})).status,404);
    const key=randomUUID();const response=await call('seeker',path,{},key);assert.equal(response.status,201);const block=await response.json() as OwnBlockResponse;
    assert.equal(block.subject_kind,'PROVIDER_ACCOUNT');assert.deepEqual(await (await call('seeker',path,{},key)).json(),block);
    assert.equal((await call('seeker',`/interactions/${randomUUID()}/block`,{},key)).status,409);
    const providerBlock=await (await call('provider',path,{})).json() as OwnBlockResponse;assert.equal(providerBlock.subject_kind,'USER');
    const projection=await (await call('seeker',`/interactions/${context.interaction_id}/contact-safety`)).json() as ContactSafetyResponse;
    assert.equal(projection.can_contact,false);assert.equal(projection.own_block?.id,block.id);assert.doesNotMatch(JSON.stringify(projection),/blocked_by|blocker_user|blocked_user|provider_account_id|\+237|token/);
    // Existing foundation context is synthetic; this does not add organization
    // inquiry/messaging. Even an active OWNER cannot author an organization block.
    const organization=(await client`INSERT INTO organizations(state) VALUES ('ACTIVE') RETURNING id`)[0]!.id;
    const organizationAccount=(await client`INSERT INTO provider_accounts(kind,organization_id,state) VALUES ('ORGANIZATION',${organization},'ACTIVE') RETURNING id`)[0]!.id;
    await client`INSERT INTO organization_memberships(organization_id,user_id,role,state,changed_by) VALUES (${organization},${f.providerUserId},'OWNER','ACTIVE',${f.providerUserId})`;
    await client`UPDATE interactions SET provider_account_id=${organizationAccount} WHERE id=${context.interaction_id}`;
    const organizationBlock=await call('seeker',path,{});assert.equal(organizationBlock.status,201);assert.equal((await organizationBlock.json() as OwnBlockResponse).subject_kind,'PROVIDER_ACCOUNT');
    assert.equal((await call('provider',path,{})).status,404);assert.equal((await call('other',path,{})).status,404);
    const organizationSafety=await call('seeker',`/interactions/${context.interaction_id}/contact-safety`);assert.equal(organizationSafety.status,200);assert.equal((await organizationSafety.json() as ContactSafetyResponse).can_contact,false);
    assert.equal((await call('seeker','/blocks?limit=0')).status,400);assert.equal((await call('seeker','/blocks?extra=1')).status,400);assert.equal((await call('seeker','/blocks?cursor=invalid')).status,400);
    assert.equal((await call('seeker',`/blocks/${providerBlock.id}/unblock`,{expected_version:1})).status,404);
    for(const version of [0,'1',1.5,null])assert.equal((await call('seeker',`/blocks/${block.id}/unblock`,{expected_version:version})).status,400);
    assert.equal((await call('seeker',`/blocks/${block.id}/unblock`,{expected_version:2})).status,409);
    await client`UPDATE users SET account_state='LIMITED' WHERE id=${f.seekerId}`;await client`UPDATE phone_contacts SET replaced_at=statement_timestamp(),verified_at=NULL WHERE user_id=${f.seekerId}`;
    assert.equal((await call('seeker','/blocks')).status,200);const unblockKey=randomUUID();
    const revoked=await call('seeker',`/blocks/${block.id}/unblock`,{expected_version:1},unblockKey);assert.equal(revoked.status,201);assert.equal((await revoked.json() as OwnBlockResponse).state,'REVOKED');
    assert.equal((await call('seeker',`/blocks/${block.id}/unblock`,{expected_version:1},unblockKey)).status,201);
    assert.equal((await call('seeker',`/blocks/${block.id}/unblock`,{expected_version:1})).status,409);
    assert.equal((await (await call('seeker',`/interactions/${context.interaction_id}/contact-safety`)).json() as ContactSafetyResponse).can_contact,false);
    await client`UPDATE users SET account_state='SUSPENDED' WHERE id=${f.seekerId}`;assert.equal((await call('seeker','/blocks')).status,401);
    await client`UPDATE users SET account_state='DELETED' WHERE id=${f.seekerId}`;assert.equal((await call('seeker','/blocks')).status,401);
  }finally{await client`TRUNCATE users RESTART IDENTITY CASCADE`;await app.close();await client.end();}
});
