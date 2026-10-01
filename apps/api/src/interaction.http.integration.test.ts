import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { AuthorityRiskStore, createDatabase, IdentityStore, InteractionStore, ListingSubmissionStore, PropertyDraftStore } from '@pachi/database';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { InteractionController } from './interaction.controller.js';

const integration = process.env.DATABASE_TEST_URL ? test : test.skip;

void integration('authenticated inquiry HTTP command creates and reuses a safe interaction shell', async () => {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const issuer='https://local.test/inquiry';
  const verifier=new CognitoAccessTokenVerifier({issuer,getKey:async()=>publicKey,allowedClientIds:new Set(['account']),requiredScopes:new Set(['pachi/account']),provider:'LOCAL_TEST'});
  const identityStore=new IdentityStore(client);
  @Module({controllers:[InteractionController],providers:[AuthGuard,{provide:'AUTH_SERVICE',useValue:new AuthService(identityStore,verifier)},{provide:'INTERACTION_STORE',useValue:new InteractionStore(client,true)}]})
  class TestApp {}
  const app=await NestFactory.create(TestApp,{logger:false}); app.setGlobalPrefix('v1'); await app.listen(0,'127.0.0.1');
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const users=await client<{id:string}[]>`INSERT INTO users(account_state) VALUES ('ACTIVE'),('ACTIVE'),('ACTIVE') RETURNING id`;
    const seeker=users[0]!.id, other=users[1]!.id, provider=users[2]!.id;
    await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${seeker},'+237690009001',statement_timestamp(),1),(${other},'+237690009002',statement_timestamp(),1),(${provider},'+237690009003',statement_timestamp(),1)`;
    await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${seeker},${issuer},'seeker','LOCAL_TEST')`;
    await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${other},${issuer},'other','LOCAL_TEST')`;
    const profile=await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name,state,verification_status) VALUES (${provider},ARRAY['OWNER'],'HTTP inquiry provider','ACTIVE','VERIFIED') RETURNING id`;
    const account=await client<{id:string}[]>`INSERT INTO provider_accounts(provider_profile_id,state) VALUES (${profile[0]!.id},'ACTIVE') RETURNING id`;
    const properties=new PropertyDraftStore(client);
    const property=await properties.createProperty(provider,{propertyType:'APARTMENT',region:'Littoral',city:'Douala',neighborhood:'Akwa',bedrooms:2,relationshipType:'OWNER'});
    const draft=await properties.createDraft(provider,{propertyId:property.id,purpose:'RENT',title:'Inquiry HTTP listing',description:'A visible listing for inquiry',amountMinor:200000,availableFrom:'2026-10-01'});
    const verification=await client<{id:string}[]>`INSERT INTO verification_cases(provider_profile_id,applicant_user_id,verification_type,state,policy_version,idempotency_key,submitted_at,valid_until) VALUES (${profile[0]!.id},${provider},'PROVIDER_IDENTITY','VERIFIED','provider-identity-synthetic-v1',${randomUUID()},statement_timestamp(),statement_timestamp()+interval '1 year') RETURNING id`;
    await client`INSERT INTO verification_claims(provider_profile_id,claim_type,status,source_case_id,valid_from,valid_until) VALUES (${profile[0]!.id},'PROVIDER_IDENTITY','VERIFIED',${verification[0]!.id},statement_timestamp(),statement_timestamp()+interval '1 year')`;
    const asset=await client<{id:string}[]>`INSERT INTO media_assets(owner_provider_account_id,classification,storage_reference,lifecycle,original_mime,original_bytes,derivative_manifest) VALUES (${account[0]!.id},'PUBLIC_MARKETPLACE',${randomUUID()},'READY','image/png',128,'{"320":{"mime":"image/webp","width":8,"height":6,"bytes":80}}'::jsonb) RETURNING id`;
    await client`INSERT INTO listing_media(listing_id,media_asset_id,display_order,is_cover,review_status,attached_by_user_id) VALUES (${draft.id},${asset[0]!.id},0,true,'APPROVED',${provider})`;
    const relationship=await client<{id:string}[]>`SELECT provider_property_relationship_id AS id FROM listings WHERE id=${draft.id}`;
    await new AuthorityRiskStore(client).evaluate(relationship[0]!.id);
    const submitted=await new ListingSubmissionStore(client,true).submit(provider,draft.id,{revisionId:draft.revisionId,offeringVersionId:draft.offeringVersionId,idempotencyKey:randomUUID(),requestId:randomUUID()}); assert.ok(submitted.submission);
    await client`UPDATE listings SET publication_status='PUBLISHED',moderation_status='APPROVED',approved_revision_id=${submitted.submission.revisionId},approved_submission_id=${submitted.submission.id},approved_by_user_id=${provider},approved_at=statement_timestamp(),last_confirmed_at=statement_timestamp(),expires_at=statement_timestamp()+interval '30 days' WHERE id=${draft.id}`;
    const token=async(subject:string)=>new SignJWT({client_id:'account',origin_jti:randomUUID(),jti:randomUUID(),token_use:'access',scope:'pachi/account'}).setProtectedHeader({alg:'RS256'}).setSubject(subject).setIssuer(issuer).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const address=app.getHttpServer().address(); const base=`http://127.0.0.1:${address.port}/v1/account`; const seekerToken=await token('seeker'); const otherToken=await token('other'); const key=randomUUID();
    const headers={authorization:`Bearer ${seekerToken}`,'idempotency-key':key};
    const first=await fetch(`${base}/listings/${draft.id}/inquiry`,{method:'POST',headers}); assert.equal(first.status,201); const firstBody=await first.json() as {interaction_id:string;conversation_id:string;listing_id:string;created:boolean}; assert.equal(firstBody.created,true); assert.equal(firstBody.listing_id,draft.id); assert.ok(!JSON.stringify(firstBody).includes(account[0]!.id));
    const repeat=await fetch(`${base}/listings/${draft.id}/inquiry`,{method:'POST',headers}); assert.equal(repeat.status,201); const repeatBody=await repeat.json() as {interaction_id:string;conversation_id:string;created:boolean}; assert.equal(repeatBody.created,false); assert.equal(repeatBody.interaction_id,firstBody.interaction_id);
    const read=await fetch(`${base}/interactions/${firstBody.interaction_id}`,{headers:{authorization:`Bearer ${seekerToken}`}}); assert.equal(read.status,200); assert.equal((await read.json() as {conversation_id:string}).conversation_id,firstBody.conversation_id);
    assert.equal((await fetch(`${base}/interactions/${firstBody.interaction_id}`,{headers:{authorization:`Bearer ${otherToken}`}})).status,404);
    await client`UPDATE users SET account_state='PENDING_PHONE' WHERE id=${seeker}`;
    assert.equal((await fetch(`${base}/listings/${draft.id}/inquiry`,{method:'POST',headers:{...headers,'idempotency-key':randomUUID()}})).status,403);
  } finally { await app.close(); await client`TRUNCATE users RESTART IDENTITY CASCADE`; await client.end(); }
});
