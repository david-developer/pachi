import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthorityRiskStore, createDatabase, ListingSubmissionStore, PropertyDraftStore, PublicListingStore } from '@pachi/database';
import { LocalPrivateMediaStorage } from '@pachi/media';
import { PublicListingController } from './public-listing.controller.js';

const integration = process.env.DATABASE_TEST_URL ? test : test.skip;

void integration('anonymous public search, detail and guarded media use safe visibility projections', async () => {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  @Module({
    controllers: [PublicListingController],
    providers: [
      { provide: 'PUBLIC_LISTING_STORE', useValue: new PublicListingStore(client, true) },
      { provide: 'LOCAL_PRIVATE_MEDIA_STORAGE', useValue: { readVariant: async () => Buffer.from('public-derivative') } },
    ],
  })
  class TestApp {}
  const app = await NestFactory.create(TestApp, { logger: false });
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const users = await client<{id:string}[]>`INSERT INTO users(account_state) VALUES ('ACTIVE') RETURNING id`;
    const ownerId = users[0]!.id;
    await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${ownerId},'+237690004441',statement_timestamp(),1)`;
    const profile = await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name,state,verification_status) VALUES (${ownerId},ARRAY['OWNER'],'HTTP public owner','ACTIVE','VERIFIED') RETURNING id`;
    const account = await client<{id:string}[]>`INSERT INTO provider_accounts(provider_profile_id,state) VALUES (${profile[0]!.id},'ACTIVE') RETURNING id`;
    const propertyStore = new PropertyDraftStore(client);
    const property = await propertyStore.createProperty(ownerId,{propertyType:'APARTMENT',region:'Littoral',city:'Douala',neighborhood:'Akwa',bedrooms:2,relationshipType:'OWNER'});
    const draft = await propertyStore.createDraft(ownerId,{propertyId:property.id,purpose:'RENT',title:'HTTP public flat',description:'Safe public listing detail',amountMinor:200000,availableFrom:'2026-10-01'});
    const verificationCase = await client<{id:string}[]>`INSERT INTO verification_cases(provider_profile_id,applicant_user_id,verification_type,state,policy_version,idempotency_key,submitted_at,valid_until) VALUES (${profile[0]!.id},${ownerId},'PROVIDER_IDENTITY','VERIFIED','provider-identity-synthetic-v1',${randomUUID()},statement_timestamp(),statement_timestamp()+interval '1 year') RETURNING id`;
    await client`INSERT INTO verification_claims(provider_profile_id,claim_type,status,source_case_id,valid_from,valid_until) VALUES (${profile[0]!.id},'PROVIDER_IDENTITY','VERIFIED',${verificationCase[0]!.id},statement_timestamp(),statement_timestamp()+interval '1 year')`;
    const storageReference = randomUUID();
    const asset = await client<{id:string}[]>`INSERT INTO media_assets(owner_provider_account_id,classification,storage_reference,lifecycle,original_mime,original_bytes,derivative_manifest) VALUES (${account[0]!.id},'PUBLIC_MARKETPLACE',${storageReference},'READY','image/png',128,'{"640":{"mime":"image/webp","width":16,"height":12,"bytes":160}}'::jsonb) RETURNING id`;
    const media = await client<{id:string}[]>`INSERT INTO listing_media(listing_id,media_asset_id,display_order,is_cover,review_status,attached_by_user_id) VALUES (${draft.id},${asset[0]!.id},0,true,'APPROVED',${ownerId}) RETURNING id`;
    const relationship = await client<{id:string}[]>`SELECT provider_property_relationship_id AS id FROM listings WHERE id=${draft.id}`;
    await new AuthorityRiskStore(client).evaluate(relationship[0]!.id);
    const submission = await new ListingSubmissionStore(client,true).submit(ownerId,draft.id,{revisionId:draft.revisionId,offeringVersionId:draft.offeringVersionId,idempotencyKey:randomUUID(),requestId:randomUUID()});
    assert.ok(submission.submission);
    await client`UPDATE listings SET publication_status='PUBLISHED',moderation_status='APPROVED',approved_revision_id=${submission.submission.revisionId},approved_submission_id=${submission.submission.id},approved_by_user_id=${ownerId},approved_at=statement_timestamp(),last_confirmed_at=statement_timestamp(),expires_at=statement_timestamp()+interval '30 days' WHERE id=${draft.id}`;
    const address = app.getHttpServer().address();
    const base = `http://127.0.0.1:${address.port}/v1/public/listings`;
    for (const query of ['property_type=VILLA', 'city=%20%20', `city=${'x'.repeat(121)}`, 'available_from=2026-02-30', 'limit=21', 'cursor=not-a-cursor']) assert.equal((await fetch(`${base}?${query}`)).status,400,query);
    const search = await fetch(`${base}?purpose=RENT&region=Littoral&min_price=100000`);
    assert.equal(search.status,200);
    const searchBody = await search.json() as { items: Array<{id:string;location:{city:string;neighborhood?:string};media:Array<{id:string}>}> };
    assert.equal(searchBody.items[0]?.id,draft.id);
    assert.equal(searchBody.items[0]?.location.neighborhood,'Akwa');
    assert.ok(!JSON.stringify(searchBody).includes(storageReference));
    const detail = await fetch(`${base}/${draft.id}`);
    assert.equal(detail.status,200);
    const detailBody = await detail.json() as {id:string;location:{neighborhood?:string};media:Array<{id:string}>};
    assert.equal(detailBody.id,draft.id);
    assert.equal(detailBody.location.neighborhood,'Akwa');
    const mediaResponse = await fetch(`${base}/${draft.id}/media/${media[0]!.id}/variants/640`);
    assert.equal(mediaResponse.status,200);
    assert.equal(await mediaResponse.text(),'public-derivative');
    await client`UPDATE listings SET publication_status='DRAFT' WHERE id=${draft.id}`;
    assert.equal((await fetch(`${base}?purpose=RENT`)).status,200);
    assert.deepEqual((await (await fetch(`${base}?purpose=RENT`)).json() as {items:unknown[]}).items,[]);
    assert.equal((await fetch(`${base}/${draft.id}`)).status,404);
    assert.equal((await fetch(`${base}/${draft.id}/media/${media[0]!.id}/variants/640`)).status,404);
  } finally {
    await app.close();
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});
