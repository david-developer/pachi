// Synthetic test fixture only; no production authorization shortcuts.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AuthorityRiskStore } from './authority-risk.js';
import { createDatabase } from './client.js';
import { ListingSubmissionStore } from './listing-submission.js';
import { PropertyDraftStore } from './property.js';
export type Fixture = {
  seekerId: string;
  otherUserId: string;
  providerUserId: string;
  listingId: string;
  otherListingId: string;
};
export async function fixtureFor(
  client: ReturnType<typeof createDatabase>['client']
): Promise<Fixture> {
  const users = await client<
    { id: string }[]
  >`INSERT INTO users(account_state) VALUES ('ACTIVE'),('ACTIVE'),('ACTIVE') RETURNING id`;
  const seekerId = users[0]!.id,
    otherUserId = users[1]!.id,
    providerUserId = users[2]!.id;
  await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${seekerId},'+237690008881',statement_timestamp(),1),(${otherUserId},'+237690008882',statement_timestamp(),1),(${providerUserId},'+237690008883',statement_timestamp(),1)`;
  const profile = await client<
    { id: string }[]
  >`INSERT INTO provider_profiles(user_id,provider_types,display_name,state,verification_status) VALUES (${providerUserId},ARRAY['OWNER'],'Interaction provider','ACTIVE','VERIFIED') RETURNING id`;
  const account = await client<
    { id: string }[]
  >`INSERT INTO provider_accounts(provider_profile_id,state) VALUES (${profile[0]!.id},'ACTIVE') RETURNING id`;
  const properties = new PropertyDraftStore(client);
  const property = await properties.createProperty(providerUserId, {
    propertyType: 'APARTMENT',
    region: 'Littoral',
    city: 'Douala',
    neighborhood: 'Akwa',
    bedrooms: 2,
    relationshipType: 'OWNER'
  });
  const secondProperty = await properties.createProperty(providerUserId, {
    propertyType: 'HOUSE',
    region: 'Littoral',
    city: 'Douala',
    neighborhood: 'Bonapriso',
    bedrooms: 3,
    relationshipType: 'OWNER'
  });
  const draft = await properties.createDraft(providerUserId, {
    propertyId: property.id,
    purpose: 'RENT',
    title: 'Interaction listing',
    description: 'Safe interaction listing',
    amountMinor: 200000,
    availableFrom: '2026-10-01'
  });
  const otherDraft = await properties.createDraft(providerUserId, {
    propertyId: secondProperty.id,
    purpose: 'RENT',
    title: 'Other interaction listing',
    description: 'Other listing',
    amountMinor: 250000,
    availableFrom: '2026-10-01'
  });
  const verification = await client<
    { id: string }[]
  >`INSERT INTO verification_cases(provider_profile_id,applicant_user_id,verification_type,state,policy_version,idempotency_key,submitted_at,valid_until) VALUES (${profile[0]!.id},${providerUserId},'PROVIDER_IDENTITY','VERIFIED','provider-identity-synthetic-v1',${randomUUID()},statement_timestamp(),statement_timestamp()+interval '1 year') RETURNING id`;
  await client`INSERT INTO verification_claims(provider_profile_id,claim_type,status,source_case_id,valid_from,valid_until) VALUES (${profile[0]!.id},'PROVIDER_IDENTITY','VERIFIED',${verification[0]!.id},statement_timestamp(),statement_timestamp()+interval '1 year')`;
  for (const id of [draft.id, otherDraft.id]) {
    const asset = await client<
      { id: string }[]
    >`INSERT INTO media_assets(owner_provider_account_id,classification,storage_reference,lifecycle,original_mime,original_bytes,derivative_manifest) VALUES (${account[0]!.id},'PUBLIC_MARKETPLACE',${randomUUID()},'READY','image/png',128,'{"320":{"mime":"image/webp","width":8,"height":6,"bytes":80}}'::jsonb) RETURNING id`;
    await client`INSERT INTO listing_media(listing_id,media_asset_id,display_order,is_cover,review_status,attached_by_user_id) VALUES (${id},${asset[0]!.id},0,true,'APPROVED',${providerUserId})`;
    const relation = await client<
      { id: string }[]
    >`SELECT provider_property_relationship_id AS id FROM listings WHERE id=${id}`;
    await new AuthorityRiskStore(client).evaluate(relation[0]!.id);
    const row = await client<
      { revision_id: string; offering_version_id: string }[]
    >`SELECT l.current_revision_id AS revision_id,o.current_version_id AS offering_version_id FROM listings l JOIN offerings o ON o.listing_id=l.id WHERE l.id=${id}`;
    const submitted = await new ListingSubmissionStore(client, true).submit(
      providerUserId,
      id,
      {
        revisionId: row[0]!.revision_id,
        offeringVersionId: row[0]!.offering_version_id,
        idempotencyKey: randomUUID(),
        requestId: randomUUID()
      }
    );
    assert.ok(submitted.submission);
    await client`UPDATE listings SET publication_status='PUBLISHED',moderation_status='APPROVED',approved_revision_id=${submitted.submission.revisionId},approved_submission_id=${submitted.submission.id},approved_by_user_id=${providerUserId},approved_at=statement_timestamp(),last_confirmed_at=statement_timestamp(),expires_at=statement_timestamp()+interval '30 days' WHERE id=${id}`;
  }
  return {
    seekerId,
    otherUserId,
    providerUserId,
    listingId: draft.id,
    otherListingId: otherDraft.id
  };
}
