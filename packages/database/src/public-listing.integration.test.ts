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
    assert.deepEqual((await publicStore.search({ neighborhood: 'Akwa' })).items, []);
    await client`UPDATE listings SET public_location_mode='NEIGHBORHOOD_ONLY' WHERE id=${fixture.listingId}`;
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

void integration('public visibility loss removes listings from search, detail and media', async () => {
  const cases: Array<{ name: string; setup?: boolean; mutate: (client: ReturnType<typeof createDatabase>['client'], fixture: Fixture) => Promise<void> }> = [
    { name: 'publication', mutate: async (client, fixture) => { await client`UPDATE listings SET publication_status='DRAFT' WHERE id=${fixture.listingId}`; } },
    { name: 'moderation', mutate: async (client, fixture) => { await client`UPDATE listings SET moderation_status='IN_REVIEW' WHERE id=${fixture.listingId}`; } },
    { name: 'freshness', mutate: async (client, fixture) => { await client`UPDATE listings SET last_confirmed_at=statement_timestamp()-interval '2 seconds',expires_at=statement_timestamp()-interval '1 second' WHERE id=${fixture.listingId}`; } },
    { name: 'provider', mutate: async (client, fixture) => { await client`UPDATE provider_profiles SET state='SUSPENDED' WHERE user_id=(SELECT pp.user_id FROM listings l JOIN provider_accounts pa ON pa.id=l.provider_account_id JOIN provider_profiles pp ON pp.id=pa.provider_profile_id WHERE l.id=${fixture.listingId})`; } },
    { name: 'identity', mutate: async (client, fixture) => { await client`UPDATE verification_claims SET valid_until=statement_timestamp()-interval '1 second' WHERE provider_profile_id=(SELECT pp.id FROM listings l JOIN provider_accounts pa ON pa.id=l.provider_account_id JOIN provider_profiles pp ON pp.id=pa.provider_profile_id WHERE l.id=${fixture.listingId})`; } },
    { name: 'relationship', mutate: async (client, fixture) => { await client`UPDATE provider_property_relationships SET authorization_status='REVOKED' WHERE id=${fixture.relationshipId}`; } },
    { name: 'principal mismatch', mutate: async (client, fixture) => { const user=await client<{id:string}[]>`INSERT INTO users(account_state) VALUES ('ACTIVE') RETURNING id`; const profile=await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name,state) VALUES (${user[0]!.id},ARRAY['OWNER'],'Other public owner','ACTIVE') RETURNING id`; const account=await client<{id:string}[]>`INSERT INTO provider_accounts(provider_profile_id,state) VALUES (${profile[0]!.id},'ACTIVE') RETURNING id`; await client`UPDATE listings SET provider_account_id=${account[0]!.id} WHERE id=${fixture.listingId}`; } },
    { name: 'property', mutate: async (client, fixture) => { await client`UPDATE properties SET record_state='ARCHIVED' WHERE id=(SELECT property_id FROM listings WHERE id=${fixture.listingId})`; } },
    { name: 'offering', mutate: async (client, fixture) => { await client`UPDATE offering_versions SET amount_minor=NULL WHERE id=(SELECT current_version_id FROM offerings WHERE listing_id=${fixture.listingId})`; } },
    { name: 'media processing', mutate: async (client, fixture) => { await client`UPDATE media_assets SET lifecycle='PROCESSING' WHERE id=(SELECT media_asset_id FROM listing_media WHERE id=${fixture.mediaId})`; } },
    { name: 'media approval', mutate: async (client, fixture) => { await client`UPDATE listing_media SET review_status='NOT_REVIEWED' WHERE id=${fixture.mediaId}`; } },
    { name: 'cover', mutate: async (client, fixture) => { await client`UPDATE listing_media SET is_cover=false WHERE id=${fixture.mediaId}`; } },
    { name: 'media removed', mutate: async (client, fixture) => { await client`UPDATE listing_media SET removed_at=statement_timestamp() WHERE id=${fixture.mediaId}`; } },
    { name: 'market', mutate: async (client, fixture) => { await client`UPDATE listings SET market_status='RENTED' WHERE id=${fixture.listingId}`; } },
    { name: 'authority stale', mutate: async (client) => { await client`UPDATE authority_risk_source_clock SET version=version+1 WHERE singleton`; } },
    { name: 'authority incomplete', mutate: async (client, fixture) => { await client`UPDATE authority_risk_source_clock SET version=version+1 WHERE singleton`; await client`INSERT INTO authority_risk_evaluations(relationship_id,relationship_version,principal_id,principal_version,source_version,rule_version,outcome,source_coverage,trigger_findings,applicable_case_ids) SELECT r.id,r.authority_version,r.provider_account_id,a.authority_principal_version,c.version,'authority-risk-internal-v1','INCOMPLETE','{"relationships":"INCOMPLETE"}'::jsonb,'{"dispute":"UNAVAILABLE"}'::jsonb,'{}'::uuid[] FROM listings l JOIN provider_property_relationships r ON r.id=l.provider_property_relationship_id JOIN provider_accounts a ON a.id=r.provider_account_id CROSS JOIN authority_risk_source_clock c WHERE l.id=${fixture.listingId} AND c.singleton`; } },
    { name: 'authority hold', mutate: async (client, fixture) => { const relation=await client<{relationship_id:string;property_id:string;principal_id:string}[]>`SELECT provider_property_relationship_id AS relationship_id,property_id,provider_account_id AS principal_id FROM listings WHERE id=${fixture.listingId}`; const cases=await client<{id:string}[]>`INSERT INTO authority_risk_cases(property_id,relationship_id,principal_id,subject_scope,trigger_kind,allegation_kind,assigned_staff_user_id,source_provenance,received_at,reason_code,safe_remediation) VALUES (${relation[0]!.property_id},${relation[0]!.relationship_id},${relation[0]!.principal_id},'RELATIONSHIP','DISPUTE','REPORTED',(SELECT created_by_user_id FROM properties WHERE id=${relation[0]!.property_id}),'STAFF_OBSERVATION',statement_timestamp(),'DISPUTE_REPORTED','Contact support for authority review.') RETURNING id`; await client`INSERT INTO authority_risk_case_actions(case_id,action,reason_code,request_id) VALUES (${cases[0]!.id},'OPENED','DISPUTE_REPORTED',${randomUUID()})`; await new AuthorityRiskStore(client).evaluate(relation[0]!.relationship_id); } },
  ];
  for (const current of cases) {
    const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
    try {
      await client`TRUNCATE users RESTART IDENTITY CASCADE`;
      const fixture = await createPublishedFixture(client, current.name === 'authority absent');
      const store = new PublicListingStore(client, true);
      assert.equal((await store.search({})).items[0]?.id, fixture.listingId, current.name);
      await current.mutate(client, fixture);
      assert.deepEqual((await store.search({})).items, [], current.name);
      await assert.rejects(store.detail(fixture.listingId), { code: 'PUBLIC_LISTING_NOT_FOUND' }, current.name);
      await assert.rejects(store.media(fixture.listingId, fixture.mediaId, 640), { code: 'PUBLIC_LISTING_NOT_FOUND' }, current.name);
    } finally { await client`TRUNCATE users RESTART IDENTITY CASCADE`; await client.end(); }
  }
});

type Fixture = { listingId: string; mediaId: string; accountId: string; relationshipId: string; storageReference: string };

async function createPublishedFixture(client: ReturnType<typeof createDatabase>['client'], skipAuthority = false): Promise<Fixture> {
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
  if (!skipAuthority) await new AuthorityRiskStore(client).evaluate(relationship[0]!.id);
  const submitted = await new ListingSubmissionStore(client,true).submit(ownerId,draft.id,{revisionId:draft.revisionId,offeringVersionId:draft.offeringVersionId,idempotencyKey:randomUUID(),requestId:randomUUID()});
  assert.ok(submitted.submission);
  await client`UPDATE listings SET publication_status='PUBLISHED',moderation_status='APPROVED',approved_revision_id=${submitted.submission.revisionId},approved_submission_id=${submitted.submission.id},approved_by_user_id=${ownerId},approved_at=statement_timestamp(),last_confirmed_at=statement_timestamp(),expires_at=statement_timestamp()+interval '30 days' WHERE id=${draft.id}`;
  return { listingId:draft.id,mediaId:media[0]!.id,accountId:account[0]!.id,relationshipId:relationship[0]!.id,storageReference };
}
