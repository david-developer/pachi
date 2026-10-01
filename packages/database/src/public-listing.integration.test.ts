import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuthorityRiskStore } from './authority-risk.js';
import { createDatabase } from './client.js';
import { ListingSubmissionStore } from './listing-submission.js';
import { PropertyDraftStore } from './property.js';
import { PublicListingStore } from './public-listing.js';

const integration = process.env.DATABASE_TEST_URL ? test : test.skip;

void integration('public search and detail share the current visibility policy and safe projection', async () => {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const fixture = await createPublishedFixture(client);
    const publicStore = new PublicListingStore(client, true);
    const defaultStore = new PublicListingStore(client);
    const search = await publicStore.search({ purpose: 'RENT', region: 'Littoral', city: 'Douala', minPrice: 100000, maxPrice: 300000, sort: 'price_asc', limit: 1 });
    assert.equal(search.items[0]?.id, fixture.listingId);
    assert.equal(search.items[0]?.location.neighborhood, 'Akwa');
    assert.equal(search.items[0]?.price.amount_minor, 200000);
    assert.ok(!JSON.stringify(search).includes(fixture.accountId));
    assert.ok(!JSON.stringify(search).includes(fixture.relationshipId));
    assert.ok(!JSON.stringify(search).includes('storage_reference'));
    assert.equal((await publicStore.detail(fixture.listingId)).id, fixture.listingId);
    assert.deepEqual((await defaultStore.search({})).items, []);
    await assert.rejects(defaultStore.detail(fixture.listingId), { code: 'PUBLIC_LISTING_NOT_FOUND' });

    await client`UPDATE listings SET public_location_mode='HIDDEN' WHERE id=${fixture.listingId}`;
    const hidden = await publicStore.detail(fixture.listingId);
    assert.deepEqual(hidden.location, { region: 'Littoral', city: 'Douala' });
    const media = await publicStore.media(fixture.listingId, fixture.mediaId, 640);
    assert.equal(media.mime, 'image/webp');
    assert.equal(media.storageReference, fixture.storageReference);

    await client`UPDATE listings SET publication_status='DRAFT' WHERE id=${fixture.listingId}`;
    assert.deepEqual((await publicStore.search({})).items, []);
    await assert.rejects(publicStore.detail(fixture.listingId), { code: 'PUBLIC_LISTING_NOT_FOUND' });
    await assert.rejects(publicStore.media(fixture.listingId, fixture.mediaId, 640), { code: 'PUBLIC_LISTING_NOT_FOUND' });
  } finally {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});

void integration('public filter and cursor validation is bounded and deterministic', async () => {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await createPublishedFixture(client);
    const store = new PublicListingStore(client, true);
    await assert.rejects(store.search({ limit: 21 }), { code: 'PUBLIC_FILTER_INVALID' });
    await assert.rejects(store.search({ minPrice: 300000, maxPrice: 100000 }), { code: 'PUBLIC_FILTER_INVALID' });
    await assert.rejects(store.search({ minBedrooms: -1 }), { code: 'PUBLIC_FILTER_INVALID' });
    await assert.rejects(store.search({ cursor: 'not-a-cursor' }), { code: 'PUBLIC_CURSOR_INVALID' });
    const first = await store.search({ sort: 'newest', limit: 1 });
    assert.equal(first.items.length, 1);
    assert.equal(first.next_cursor, null);
  } finally {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});

type Fixture = { listingId: string; mediaId: string; accountId: string; relationshipId: string; storageReference: string };

async function createPublishedFixture(client: ReturnType<typeof createDatabase>['client']): Promise<Fixture> {
  const users = await client<{id:string}[]>`INSERT INTO users(account_state) VALUES ('ACTIVE') RETURNING id`;
  const ownerId = users[0]!.id;
  await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${ownerId},'+237690007771',statement_timestamp(),1)`;
  const profile = await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name,state,verification_status) VALUES (${ownerId},ARRAY['OWNER'],'Public synthetic owner','ACTIVE','VERIFIED') RETURNING id`;
  const account = await client<{id:string}[]>`INSERT INTO provider_accounts(provider_profile_id,state) VALUES (${profile[0]!.id},'ACTIVE') RETURNING id`;
  const propertyStore = new PropertyDraftStore(client);
  const property = await propertyStore.createProperty(ownerId,{propertyType:'APARTMENT',region:'Littoral',city:'Douala',neighborhood:'Akwa',bedrooms:2,relationshipType:'OWNER'});
  const draft = await propertyStore.createDraft(ownerId,{propertyId:property.id,purpose:'RENT',title:'Public synthetic flat',description:'A public synthetic listing for isolated discovery',amountMinor:200000,availableFrom:'2026-10-01'});
  const verificationCase = await client<{id:string}[]>`INSERT INTO verification_cases(provider_profile_id,applicant_user_id,verification_type,state,policy_version,idempotency_key,submitted_at,valid_until) VALUES (${profile[0]!.id},${ownerId},'PROVIDER_IDENTITY','VERIFIED','provider-identity-synthetic-v1',${randomUUID()},statement_timestamp(),statement_timestamp()+interval '1 year') RETURNING id`;
  await client`INSERT INTO verification_claims(provider_profile_id,claim_type,status,source_case_id,valid_from,valid_until) VALUES (${profile[0]!.id},'PROVIDER_IDENTITY','VERIFIED',${verificationCase[0]!.id},statement_timestamp(),statement_timestamp()+interval '1 year')`;
  const storageReference = randomUUID();
  const asset = await client<{id:string}[]>`INSERT INTO media_assets(owner_provider_account_id,classification,storage_reference,lifecycle,original_mime,original_bytes,derivative_manifest) VALUES (${account[0]!.id},'PUBLIC_MARKETPLACE',${storageReference},'READY','image/png',128,'{"320":{"mime":"image/webp","width":8,"height":6,"bytes":80},"640":{"mime":"image/webp","width":16,"height":12,"bytes":160}}'::jsonb) RETURNING id`;
  const media = await client<{id:string}[]>`INSERT INTO listing_media(listing_id,media_asset_id,display_order,is_cover,review_status,attached_by_user_id) VALUES (${draft.id},${asset[0]!.id},0,true,'APPROVED',${ownerId}) RETURNING id`;
  const relationship = await client<{id:string}[]>`SELECT provider_property_relationship_id AS id FROM listings WHERE id=${draft.id}`;
  await new AuthorityRiskStore(client).evaluate(relationship[0]!.id);
  const submitted = await new ListingSubmissionStore(client,true).submit(ownerId,draft.id,{revisionId:draft.revisionId,offeringVersionId:draft.offeringVersionId,idempotencyKey:randomUUID(),requestId:randomUUID()});
  assert.ok(submitted.submission);
  await client`UPDATE listings SET publication_status='PUBLISHED',moderation_status='APPROVED',approved_revision_id=${submitted.submission.revisionId},approved_submission_id=${submitted.submission.id},approved_by_user_id=${ownerId},approved_at=statement_timestamp(),last_confirmed_at=statement_timestamp(),expires_at=statement_timestamp()+interval '30 days' WHERE id=${draft.id}`;
  return { listingId:draft.id,mediaId:media[0]!.id,accountId:account[0]!.id,relationshipId:relationship[0]!.id,storageReference };
}
