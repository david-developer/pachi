import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { AuthorityRiskStore, createDatabase, ListingModerationStore, ListingSubmissionStore, PropertyDraftStore, StaffStore } from '@pachi/database';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { StaffAuthService } from './staff.controller.js';
import { StaffListingModerationController } from './staff-listing-moderation.controller.js';

const integration = process.env.DATABASE_TEST_URL ? test : test.skip;

void integration('positive listing approve-and-publish is reachable through the scoped staff HTTP stack', async () => {
  const url = process.env.DATABASE_TEST_URL!;
  const { client } = createDatabase(url);
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  await client`TRUNCATE users RESTART IDENTITY CASCADE`;
  const staffStore = new StaffStore(client, 'synthetic-staff-secret-long-enough-for-http-listing-test');
  const submissions = new ListingSubmissionStore(client, true);
  const moderation = new ListingModerationStore(client, submissions);
  const verifier = new CognitoAccessTokenVerifier({ issuer: 'https://local.test/listing-staff', getKey: async () => publicKey, allowedClientIds: new Set(['listing-staff']), requiredScopes: new Set(['pachi/staff']), provider: 'LOCAL_TEST', strictStaff: true });
  @Module({
    controllers: [StaffListingModerationController],
    providers: [
      { provide: 'STAFF_AUTH_SERVICE', useValue: new StaffAuthService(staffStore, verifier) },
      { provide: 'LISTING_MODERATION_STORE', useValue: moderation },
      { provide: 'LOCAL_PRIVATE_MEDIA_STORAGE', useValue: { readVariant: async () => Buffer.from('synthetic-private-preview') } },
    ],
  })
  class TestApp {}
  const app = await NestFactory.create(TestApp, { logger: false });
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');
  try {
    const users = await client<{id:string}[]>`INSERT INTO users(account_state,display_name) VALUES ('ACTIVE','Synthetic listing owner'),('ACTIVE','Synthetic listing moderator') RETURNING id`;
    const ownerId = users[0]!.id;
    const staffId = users[1]!.id;
    await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${ownerId},'+237690009991',statement_timestamp(),1)`;
    const profile = await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name,state,verification_status) VALUES (${ownerId},ARRAY['OWNER'],'Synthetic listing owner','ACTIVE','VERIFIED') RETURNING id`;
    const account = await client<{id:string}[]>`INSERT INTO provider_accounts(provider_profile_id,state) VALUES (${profile[0]!.id},'ACTIVE') RETURNING id`;
    const propertyStore = new PropertyDraftStore(client);
    const property = await propertyStore.createProperty(ownerId,{propertyType:'APARTMENT',region:'Littoral',city:'Douala',neighborhood:'Akwa',bedrooms:2,relationshipType:'OWNER'});
    const draft = await propertyStore.createDraft(ownerId,{propertyId:property.id,purpose:'RENT',title:'HTTP synthetic listing',description:'A complete synthetic listing',amountMinor:200000,availableFrom:'2026-10-01'});
    const verificationCase = await client<{id:string}[]>`INSERT INTO verification_cases(provider_profile_id,applicant_user_id,verification_type,state,policy_version,idempotency_key,submitted_at,valid_until) VALUES (${profile[0]!.id},${ownerId},'PROVIDER_IDENTITY','VERIFIED','provider-identity-synthetic-v1',${randomUUID()},statement_timestamp(),statement_timestamp()+interval '1 year') RETURNING id`;
    await client`INSERT INTO verification_claims(provider_profile_id,claim_type,status,source_case_id,valid_from,valid_until) VALUES (${profile[0]!.id},'PROVIDER_IDENTITY','VERIFIED',${verificationCase[0]!.id},statement_timestamp(),statement_timestamp()+interval '1 year')`;
    const asset = await client<{id:string}[]>`INSERT INTO media_assets(owner_provider_account_id,classification,storage_reference,lifecycle,original_mime,original_bytes,derivative_manifest) VALUES (${account[0]!.id},'PUBLIC_MARKETPLACE',${randomUUID()},'READY','image/png',128,'{"320":{"mime":"image/webp","width":8,"height":6,"bytes":80}}'::jsonb) RETURNING id`;
    await client`INSERT INTO listing_media(listing_id,media_asset_id,display_order,is_cover,review_status,attached_by_user_id) VALUES (${draft.id},${asset[0]!.id},0,true,'APPROVED',${ownerId})`;
    const relationship = await client<{id:string}[]>`SELECT provider_property_relationship_id AS id FROM listings WHERE id=${draft.id}`;
    await new AuthorityRiskStore(client).evaluate(relationship[0]!.id);
    const submitted = await submissions.submit(ownerId,draft.id,{revisionId:draft.revisionId,offeringVersionId:draft.offeringVersionId,idempotencyKey:randomUUID(),requestId:randomUUID()});
    assert.ok(submitted.submission);

    const issuer = 'https://local.test/listing-staff';
    const subject = randomUUID();
    const originJti = randomUUID();
    await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${staffId},${issuer},${subject},'LOCAL_TEST')`;
    await staffStore.provision({operator:'http-test',userId:staffId,issuer,subject,role:'LISTING_MODERATOR',scope:{kind:'region',id:'Littoral',permissions:['listing:moderate']},reason:'Synthetic listing moderation HTTP grant',expiresAt:new Date(Date.now()+3600000)});
    const token = await new SignJWT({client_id:'listing-staff',origin_jti:originJti,jti:randomUUID(),token_use:'access',scope:'pachi/staff'}).setProtectedHeader({alg:'RS256'}).setSubject(subject).setIssuer(issuer).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const claims = await verifier.verify(token);
    await staffStore.register(claims,new Date(),'access','refresh');
    const address = app.getHttpServer().address();
    const base = `http://127.0.0.1:${address.port}/v1/staff/listing-revisions`;
    const headers = { authorization:`Bearer ${token}` };
    const queueResponse = await fetch(base,{headers});
    assert.equal(queueResponse.status,200);
    const queue = await queueResponse.json() as {submissions:Array<{submission_id:string;revision_id:string;revision_version:number}>};
    assert.equal(queue.submissions[0]?.submission_id,submitted.submission.id);
    const decisionResponse = await fetch(`${base}/${draft.id}/decision`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({submission_id:submitted.submission.id,revision_id:submitted.submission.revisionId,expected_version:submitted.readiness.revisionVersion,command:'APPROVE_AND_PUBLISH',reason_code:'CONTENT_REVIEWED',reason_text:'Synthetic exact revision approved.',idempotency_key:randomUUID()})});
    assert.equal(decisionResponse.status,201,await decisionResponse.text());
    const listing = await client<{publication_status:string;moderation_status:string;approved_revision_id:string;approved_submission_id:string}[]>`SELECT publication_status,moderation_status,approved_revision_id,approved_submission_id FROM listings WHERE id=${draft.id}`;
    assert.deepEqual(listing[0],{publication_status:'PUBLISHED',moderation_status:'APPROVED',approved_revision_id:submitted.submission.revisionId,approved_submission_id:submitted.submission.id});
  } finally {
    await app.close();
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});
