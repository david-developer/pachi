import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuthorityRiskStore } from './authority-risk.js';
import { createDatabase } from './client.js';
import { InteractionStore } from './interaction.js';
import { ListingSubmissionStore } from './listing-submission.js';
import { PropertyDraftStore } from './property.js';

const integration = process.env.DATABASE_TEST_URL ? test : test.skip;

void integration('inquiry creates, reuses, idempotently retries and emits one interaction event', async () => {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const fixture = await fixtureFor(client);
    const store = new InteractionStore(client, true);
    const key = randomUUID();
    const first = await store.createOrReuseInquiry(fixture.seekerId,fixture.listingId,key);
    assert.equal(first.created,true);
    const repeat = await store.createOrReuseInquiry(fixture.seekerId,fixture.listingId,key);
    assert.equal(repeat.created,false); assert.equal(repeat.interaction_id,first.interaction_id); assert.equal(repeat.conversation_id,first.conversation_id);
    const reuse = await store.createOrReuseInquiry(fixture.seekerId,fixture.listingId,randomUUID());
    assert.equal(reuse.created,false); assert.equal(reuse.interaction_id,first.interaction_id);
    await assert.rejects(store.createOrReuseInquiry(fixture.seekerId,fixture.otherListingId,key),{code:'IDEMPOTENCY_KEY_REUSED'});
    assert.equal((await client`SELECT count(*)::int AS count FROM interactions`)[0]?.count,1);
    assert.equal((await client`SELECT count(*)::int AS count FROM conversations`)[0]?.count,1);
    assert.equal((await client`SELECT count(*)::int AS count FROM interaction_outbox WHERE event_type='interaction_created'`)[0]?.count,1);
    assert.equal((await client`SELECT count(*)::int AS count FROM interaction_participants WHERE interaction_id=${first.interaction_id}`)[0]?.count,2);
  } finally { await client`TRUNCATE users RESTART IDENTITY CASCADE`; await client.end(); }
});

void integration('inquiry is race-safe, preserves closed history and enforces phone/self/visibility boundaries', async () => {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const fixture = await fixtureFor(client);
    const store = new InteractionStore(client, true);
    const concurrent = await Promise.all([1,2].map(() => store.createOrReuseInquiry(fixture.seekerId,fixture.listingId,randomUUID())));
    assert.equal(new Set(concurrent.map((item) => item.interaction_id)).size,1);
    assert.equal((await client`SELECT count(*)::int AS count FROM interactions`)[0]?.count,1);
    await client`UPDATE interactions SET state='RESTRICTED',closed_at=NULL,version=version+1 WHERE id=${concurrent[0]!.interaction_id}`;
    await assert.rejects(client`INSERT INTO interactions(listing_id,seeker_user_id,provider_account_id,state,initial_channel) VALUES (${fixture.listingId},${fixture.seekerId},(SELECT provider_account_id FROM interactions WHERE id=${concurrent[0]!.interaction_id}),'OPEN','MESSAGE')`,{code:'23505'});
    await assert.rejects(store.createOrReuseInquiry(fixture.seekerId,fixture.listingId,randomUUID()),{code:'CAPABILITY_RESTRICTED'});
    assert.equal((await client`SELECT count(*)::int AS count FROM interactions`)[0]?.count,1);
    assert.equal((await client`SELECT count(*)::int AS count FROM conversations`)[0]?.count,1);
    assert.equal((await client`SELECT count(*)::int AS count FROM interaction_participants`)[0]?.count,2);
    assert.equal((await client`SELECT count(*)::int AS count FROM interaction_outbox WHERE event_type='interaction_created'`)[0]?.count,1);
    await client`UPDATE interactions SET state='CLOSED',closed_at=statement_timestamp(),version=version+1 WHERE id=${concurrent[0]!.interaction_id}`;
    const reopened = await store.createOrReuseInquiry(fixture.seekerId,fixture.listingId,randomUUID());
    assert.notEqual(reopened.interaction_id,concurrent[0]!.interaction_id);
    assert.equal((await client`SELECT count(*)::int AS count FROM interactions WHERE listing_id=${fixture.listingId}`)[0]?.count,2);
    await assert.rejects(store.createOrReuseInquiry(fixture.providerUserId,fixture.listingId,randomUUID()),{code:'RESOURCE_SCOPE_DENIED'});
    await client`UPDATE users SET account_state='PENDING_PHONE' WHERE id=${fixture.seekerId}`;
    await assert.rejects(store.createOrReuseInquiry(fixture.seekerId,fixture.otherListingId,randomUUID()),{code:'PHONE_REQUIRED'});
    await client`UPDATE users SET account_state='ACTIVE' WHERE id=${fixture.seekerId}`;
    await client`UPDATE listings SET publication_status='DRAFT' WHERE id=${fixture.listingId}`;
    await assert.rejects(store.createOrReuseInquiry(fixture.seekerId,fixture.listingId,randomUUID()),{code:'PUBLIC_LISTING_NOT_FOUND'});
    await assert.rejects(store.read(fixture.otherUserId,concurrent[0]!.interaction_id),{code:'RESOURCE_SCOPE_DENIED'});
  } finally { await client`TRUNCATE users RESTART IDENTITY CASCADE`; await client.end(); }
});

void integration('interaction history suppresses an unapproved current revision and other invisible listing content', async () => {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const fixture = await fixtureFor(client);
    const store = new InteractionStore(client, true);
    const interaction = await store.createOrReuseInquiry(fixture.seekerId,fixture.listingId,randomUUID());
    const revisions=await client<{id:string}[]>`INSERT INTO listing_revisions(listing_id,version,title,description,created_by_user_id) SELECT l.id,r.version+1,'PRIVATE_UNAPPROVED_SENTINEL_71C1',r.description,l.created_by_user_id FROM listings l JOIN listing_revisions r ON r.id=l.current_revision_id WHERE l.id=${fixture.listingId} RETURNING id`;
    await client`UPDATE listings SET current_revision_id=${revisions[0]!.id} WHERE id=${fixture.listingId}`;
    const revisionLost=await store.read(fixture.seekerId,interaction.interaction_id);
    assert.equal(revisionLost.state,'OPEN');
    assert.equal(revisionLost.listing_visible,false);
    assert.equal(revisionLost.title,null);
    assert.equal(JSON.stringify(revisionLost).includes('PRIVATE_UNAPPROVED_SENTINEL_71C1'),false);
    await client`UPDATE listings SET current_revision_id=approved_revision_id WHERE id=${fixture.listingId}`;
    await client`UPDATE authority_risk_source_clock SET version=version+1 WHERE singleton`;
    const authorityLost=await store.read(fixture.seekerId,interaction.interaction_id);
    assert.equal(authorityLost.interaction_id,interaction.interaction_id);
    assert.equal(authorityLost.listing_visible,false);
    assert.equal(authorityLost.title,null);
  } finally { await client`TRUNCATE users RESTART IDENTITY CASCADE`; await client.end(); }
});

void integration('inquiry visibility-loss matrix denies without creating interaction effects', async () => {
  const cases: Array<{name:string;mutate:(client:ReturnType<typeof createDatabase>['client'],fixture:Fixture)=>Promise<void>}> = [
    {name:'publication',mutate:async(client,fixture)=>{await client`UPDATE listings SET publication_status='DRAFT' WHERE id=${fixture.listingId}`;}},
    {name:'freshness',mutate:async(client,fixture)=>{await client`UPDATE listings SET last_confirmed_at=statement_timestamp()-interval '2 seconds',expires_at=statement_timestamp()-interval '1 second' WHERE id=${fixture.listingId}`;}},
    {name:'provider profile',mutate:async(client,fixture)=>{await client`UPDATE provider_profiles SET state='SUSPENDED' WHERE user_id=${fixture.providerUserId}`;}},
    {name:'identity claim',mutate:async(client,fixture)=>{await client`UPDATE verification_claims SET valid_until=statement_timestamp()-interval '1 second' WHERE provider_profile_id=(SELECT provider_profile_id FROM provider_accounts WHERE id=(SELECT provider_account_id FROM listings WHERE id=${fixture.listingId}))`;}},
    {name:'relationship',mutate:async(client,fixture)=>{await client`UPDATE provider_property_relationships SET valid_until=statement_timestamp()-interval '1 second' WHERE id=(SELECT provider_property_relationship_id FROM listings WHERE id=${fixture.listingId})`;}},
    {name:'authority stale',mutate:async(client)=>{await client`UPDATE authority_risk_source_clock SET version=version+1 WHERE singleton`;}},
    {name:'media eligibility',mutate:async(client,fixture)=>{await client`UPDATE media_assets SET lifecycle='PROCESSING' WHERE id=(SELECT media_asset_id FROM listing_media WHERE listing_id=${fixture.listingId})`;}},
    {name:'market discoverability',mutate:async(client,fixture)=>{await client`UPDATE listings SET market_status='RENTED' WHERE id=${fixture.listingId}`;}},
  ];
  for (const current of cases) {
    const {client}=createDatabase(process.env.DATABASE_TEST_URL!);
    try {
      await client`TRUNCATE users RESTART IDENTITY CASCADE`;
      const fixture=await fixtureFor(client);
      const store=new InteractionStore(client,true);
      await current.mutate(client,fixture);
      await assert.rejects(store.createOrReuseInquiry(fixture.seekerId,fixture.listingId,randomUUID()),{code:'PUBLIC_LISTING_NOT_FOUND'},current.name);
      for (const table of ['interactions','conversations','interaction_participants','interaction_outbox'] as const) {
        const counts=await client.unsafe<{count:number}[]>(`SELECT count(*)::int AS count FROM ${table}${table==='interaction_outbox' ? " WHERE event_type='interaction_created'" : ''}`);
        assert.equal(counts[0]?.count,0,`${current.name}: ${table}`);
      }
    } finally { await client`TRUNCATE users RESTART IDENTITY CASCADE`; await client.end(); }
  }
});

type Fixture = { seekerId:string; otherUserId:string; providerUserId:string; listingId:string; otherListingId:string };
async function fixtureFor(client: ReturnType<typeof createDatabase>['client']): Promise<Fixture> {
  const users=await client<{id:string}[]>`INSERT INTO users(account_state) VALUES ('ACTIVE'),('ACTIVE'),('ACTIVE') RETURNING id`;
  const seekerId=users[0]!.id, otherUserId=users[1]!.id, providerUserId=users[2]!.id;
  await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${seekerId},'+237690008881',statement_timestamp(),1),(${otherUserId},'+237690008882',statement_timestamp(),1),(${providerUserId},'+237690008883',statement_timestamp(),1)`;
  const profile=await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name,state,verification_status) VALUES (${providerUserId},ARRAY['OWNER'],'Interaction provider','ACTIVE','VERIFIED') RETURNING id`;
  const account=await client<{id:string}[]>`INSERT INTO provider_accounts(provider_profile_id,state) VALUES (${profile[0]!.id},'ACTIVE') RETURNING id`;
  const properties=new PropertyDraftStore(client);
  const property=await properties.createProperty(providerUserId,{propertyType:'APARTMENT',region:'Littoral',city:'Douala',neighborhood:'Akwa',bedrooms:2,relationshipType:'OWNER'});
  const secondProperty=await properties.createProperty(providerUserId,{propertyType:'HOUSE',region:'Littoral',city:'Douala',neighborhood:'Bonapriso',bedrooms:3,relationshipType:'OWNER'});
  const draft=await properties.createDraft(providerUserId,{propertyId:property.id,purpose:'RENT',title:'Interaction listing',description:'Safe interaction listing',amountMinor:200000,availableFrom:'2026-10-01'});
  const otherDraft=await properties.createDraft(providerUserId,{propertyId:secondProperty.id,purpose:'RENT',title:'Other interaction listing',description:'Other listing',amountMinor:250000,availableFrom:'2026-10-01'});
  const verification=await client<{id:string}[]>`INSERT INTO verification_cases(provider_profile_id,applicant_user_id,verification_type,state,policy_version,idempotency_key,submitted_at,valid_until) VALUES (${profile[0]!.id},${providerUserId},'PROVIDER_IDENTITY','VERIFIED','provider-identity-synthetic-v1',${randomUUID()},statement_timestamp(),statement_timestamp()+interval '1 year') RETURNING id`;
  await client`INSERT INTO verification_claims(provider_profile_id,claim_type,status,source_case_id,valid_from,valid_until) VALUES (${profile[0]!.id},'PROVIDER_IDENTITY','VERIFIED',${verification[0]!.id},statement_timestamp(),statement_timestamp()+interval '1 year')`;
  for (const id of [draft.id,otherDraft.id]) {
    const asset=await client<{id:string}[]>`INSERT INTO media_assets(owner_provider_account_id,classification,storage_reference,lifecycle,original_mime,original_bytes,derivative_manifest) VALUES (${account[0]!.id},'PUBLIC_MARKETPLACE',${randomUUID()},'READY','image/png',128,'{"320":{"mime":"image/webp","width":8,"height":6,"bytes":80}}'::jsonb) RETURNING id`;
    await client`INSERT INTO listing_media(listing_id,media_asset_id,display_order,is_cover,review_status,attached_by_user_id) VALUES (${id},${asset[0]!.id},0,true,'APPROVED',${providerUserId})`;
    const relation=await client<{id:string}[]>`SELECT provider_property_relationship_id AS id FROM listings WHERE id=${id}`;
    await new AuthorityRiskStore(client).evaluate(relation[0]!.id);
    const row=await client<{revision_id:string;offering_version_id:string}[]>`SELECT l.current_revision_id AS revision_id,o.current_version_id AS offering_version_id FROM listings l JOIN offerings o ON o.listing_id=l.id WHERE l.id=${id}`;
    const submitted=await new ListingSubmissionStore(client,true).submit(providerUserId,id,{revisionId:row[0]!.revision_id,offeringVersionId:row[0]!.offering_version_id,idempotencyKey:randomUUID(),requestId:randomUUID()});
    assert.ok(submitted.submission);
    await client`UPDATE listings SET publication_status='PUBLISHED',moderation_status='APPROVED',approved_revision_id=${submitted.submission.revisionId},approved_submission_id=${submitted.submission.id},approved_by_user_id=${providerUserId},approved_at=statement_timestamp(),last_confirmed_at=statement_timestamp(),expires_at=statement_timestamp()+interval '30 days' WHERE id=${id}`;
  }
  return {seekerId,otherUserId,providerUserId,listingId:draft.id,otherListingId:otherDraft.id};
}
