import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuthorityRiskStore } from './authority-risk.js';
import { createDatabase } from './client.js';
import { ListingModerationStore } from './listing-moderation.js';
import { ListingSubmissionStore } from './listing-submission.js';
import { readPublicListingVisibility } from './listing-visibility.js';
import { PropertyDraftStore } from './property.js';
import type { StaffPrincipal } from './staff.js';

if (!process.env.DATABASE_TEST_URL && process.env.CI === 'true') throw new Error('DATABASE_TEST_URL is required');
const integration = process.env.DATABASE_TEST_URL ? test : test.skip;

void integration('publishes the exact submitted revision once and is idempotent', async () => {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const fixture = await createFixture(client);
    const submissions = new ListingSubmissionStore(client, true);
    const moderation = new ListingModerationStore(client, submissions);
    const submitted = await submit(fixture, submissions);
    assert.ok(submitted.submission);
    assert.equal(submitted.readiness.publicationStatus, 'PENDING_REVIEW');
    const input = decision(submitted.submission.id, submitted.submission.revisionId, submitted.readiness.revisionVersion, 'APPROVE_AND_PUBLISH');
    const published = await moderation.decide(fixture.staff, fixture.listingId, input);
    assert.equal(published.publication_status, 'PUBLISHED');
    assert.equal(published.moderation_status, 'APPROVED');
    const repeated = await moderation.decide(fixture.staff, fixture.listingId, input);
    assert.equal(repeated.idempotent, true);
    assert.equal(repeated.action_id, published.action_id);
    const rows = await client<{publication_status:string;moderation_status:string;approved_revision_id:string;approved_submission_id:string;approved_at:Date;last_confirmed_at:Date;expires_at:Date}[]>`SELECT publication_status,moderation_status,approved_revision_id,approved_submission_id,approved_at,last_confirmed_at,expires_at FROM listings WHERE id=${fixture.listingId}`;
    const listing = rows[0]!;
    assert.equal(listing.approved_revision_id, submitted.submission.revisionId);
    assert.equal(listing.approved_submission_id, submitted.submission.id);
    assert.ok(listing.approved_at);
    assert.ok(listing.last_confirmed_at);
    assert.equal(Math.round((new Date(listing.expires_at).getTime() - new Date(listing.last_confirmed_at).getTime()) / 86_400_000), 30);
    assert.equal((await client`SELECT count(*)::int AS count FROM listing_revision_moderation_actions WHERE listing_id=${fixture.listingId}`)[0]?.count, 1);
    assert.equal((await client`SELECT count(*)::int AS count FROM listing_revision_moderation_outbox WHERE action_id=${published.action_id}`)[0]?.count, 1);
    assert.equal((await client`SELECT count(*)::int AS count FROM audit_events WHERE target_id=${fixture.listingId} AND action='LISTING_APPROVE_AND_PUBLISH'`)[0]?.count, 1);
    const visibility = await readPublicListingVisibility(client, fixture.listingId);
    assert.deepEqual(visibility, { visible: false, reason: 'IDENTITY_NOT_CURRENT' });
  } finally {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});

void integration('request changes preserves the episode and corrected resubmission is a new exact episode', async () => {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const fixture = await createFixture(client);
    const submissions = new ListingSubmissionStore(client, true);
    const moderation = new ListingModerationStore(client, submissions);
    const first = await submit(fixture, submissions);
    assert.ok(first.submission);
    const requested = await moderation.decide(fixture.staff, fixture.listingId, decision(first.submission.id, first.submission.revisionId, first.readiness.revisionVersion, 'REQUEST_CHANGES'));
    assert.equal(requested.publication_status, 'DRAFT');
    assert.equal(requested.moderation_status, 'CHANGES_REQUIRED');
    const unchanged = await client<{current_revision_id:string;moderation_feedback:string}[]>`SELECT current_revision_id,moderation_feedback FROM listings WHERE id=${fixture.listingId}`;
    assert.equal(unchanged[0]!.current_revision_id, first.submission.revisionId);
    assert.equal(unchanged[0]!.moderation_feedback, 'Please correct the listing details.');
    assert.equal((await client`SELECT count(*)::int AS count FROM listing_revisions WHERE listing_id=${fixture.listingId}`)[0]?.count, 1);

    const propertyStore = new PropertyDraftStore(client);
    const corrected = await propertyStore.updateDraft(fixture.ownerId, fixture.listingId, { title: 'Corrected synthetic listing' });
    const second = await submit(fixture, submissions, corrected.revisionId, corrected.offeringVersionId);
    assert.ok(second.submission);
    assert.notEqual(second.submission.id, first.submission.id);
    assert.notEqual(second.submission.revisionId, first.submission.revisionId);
    const published = await moderation.decide(fixture.staff, fixture.listingId, decision(second.submission.id, second.submission.revisionId, second.readiness.revisionVersion, 'APPROVE_AND_PUBLISH'));
    assert.equal(published.publication_status, 'PUBLISHED');
    assert.equal((await client`SELECT count(*)::int AS count FROM listing_revision_moderation_actions WHERE listing_id=${fixture.listingId}`)[0]?.count, 2);
    assert.equal((await client`SELECT count(*)::int AS count FROM listing_submissions WHERE listing_id=${fixture.listingId}`)[0]?.count, 2);
    await assert.rejects(moderation.decide(fixture.staff, fixture.listingId, decision(first.submission.id, first.submission.revisionId, 1, 'APPROVE_AND_PUBLISH')), { code: 'STALE_VERSION' });
  } finally {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});

void integration('publication remains fail-closed for current eligibility and staff changes', async () => {
  const cases: Array<{ name: string; mutate: (client: ReturnType<typeof createDatabase>['client'], fixture: Fixture) => Promise<void>; expected?: string }> = [
    { name: 'provider inactive', mutate: async (client, fixture) => { await client`UPDATE provider_profiles SET state='SUSPENDED' WHERE user_id=${fixture.ownerId}`; } },
    { name: 'identity unavailable', mutate: async (client, fixture) => { await client`UPDATE verification_claims SET valid_until=statement_timestamp()-interval '1 second' WHERE provider_profile_id=(SELECT provider_profile_id FROM provider_accounts WHERE id=(SELECT provider_account_id FROM listings WHERE id=${fixture.listingId}))`; } },
    { name: 'relationship expired', mutate: async (client, fixture) => { await client`UPDATE provider_property_relationships SET valid_until=statement_timestamp()-interval '1 second' WHERE id=(SELECT provider_property_relationship_id FROM listings WHERE id=${fixture.listingId})`; } },
    { name: 'relationship revoked', mutate: async (client, fixture) => { await client`UPDATE provider_property_relationships SET authorization_status='REVOKED' WHERE id=(SELECT provider_property_relationship_id FROM listings WHERE id=${fixture.listingId})`; } },
    { name: 'relationship principal mismatch', expected: 'SUBMISSION_SCOPE_DENIED', mutate: async (client, fixture) => { const other=await client<{id:string}[]>`INSERT INTO users(account_state) VALUES ('ACTIVE') RETURNING id`; const profile=await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name,state) VALUES (${other[0]!.id},ARRAY['OWNER'],'Other synthetic owner','ACTIVE') RETURNING id`; const account=await client<{id:string}[]>`INSERT INTO provider_accounts(provider_profile_id,state) VALUES (${profile[0]!.id},'ACTIVE') RETURNING id`; await client`UPDATE listings SET provider_account_id=${account[0]!.id} WHERE id=${fixture.listingId}`; } },
    { name: 'authority stale', mutate: async (client) => { await client`UPDATE authority_risk_source_clock SET version=version+1 WHERE singleton`; } },
    { name: 'authority hold', mutate: async (client, fixture) => { const relation=await client<{relationship_id:string;property_id:string;principal_id:string}[]>`SELECT provider_property_relationship_id AS relationship_id,property_id,provider_account_id AS principal_id FROM listings WHERE id=${fixture.listingId}`; const cases=await client<{id:string}[]>`INSERT INTO authority_risk_cases(property_id,relationship_id,principal_id,subject_scope,trigger_kind,allegation_kind,assigned_staff_user_id,source_provenance,received_at,reason_code,safe_remediation) VALUES (${relation[0]!.property_id},${relation[0]!.relationship_id},${relation[0]!.principal_id},'RELATIONSHIP','DISPUTE','REPORTED',${fixture.staff.row.user_id},'STAFF_OBSERVATION',statement_timestamp(),'DISPUTE_REPORTED','Contact support for authority review.') RETURNING id`; await client`INSERT INTO authority_risk_case_actions(case_id,action,actor_user_id,reason_code,request_id) VALUES (${cases[0]!.id},'OPENED',${fixture.staff.row.user_id},'DISPUTE_REPORTED',${randomUUID()})`; await new AuthorityRiskStore(client).evaluate(relation[0]!.relationship_id); } },
    { name: 'authority incomplete', mutate: async (client, fixture) => { const relation=await client<{relationship_id:string;principal_id:string;authority_version:number;principal_version:number}[]>`SELECT r.id AS relationship_id,r.provider_account_id AS principal_id,r.authority_version,a.authority_principal_version AS principal_version FROM listings l JOIN provider_property_relationships r ON r.id=l.provider_property_relationship_id JOIN provider_accounts a ON a.id=r.provider_account_id WHERE l.id=${fixture.listingId}`; await client`UPDATE authority_risk_source_clock SET version=version+1 WHERE singleton`; const source=await client<{version:string}[]>`SELECT version::text FROM authority_risk_source_clock WHERE singleton`; await client`INSERT INTO authority_risk_evaluations(relationship_id,relationship_version,principal_id,principal_version,source_version,rule_version,outcome,source_coverage,trigger_findings,applicable_case_ids) VALUES (${relation[0]!.relationship_id},${relation[0]!.authority_version},${relation[0]!.principal_id},${relation[0]!.principal_version},${source[0]!.version},'authority-risk-internal-v1','INCOMPLETE','{"relationships":"INCOMPLETE"}'::jsonb,'{"dispute":"UNAVAILABLE"}'::jsonb,'{}'::uuid[])`; } },
    { name: 'property specification missing', mutate: async (client, fixture) => { await client`UPDATE properties SET bedrooms=NULL,bathrooms=NULL,size_sqm=NULL,furnishing=NULL WHERE id=(SELECT property_id FROM listings WHERE id=${fixture.listingId})`; } },
    { name: 'offering incomplete', mutate: async (client, fixture) => { await client`UPDATE offering_versions SET amount_minor=NULL WHERE id=${fixture.offeringVersionId}`; } },
    { name: 'stale offering version', expected: 'STALE_VERSION', mutate: async (client, fixture) => { const next=await client<{id:string;offering_id:string}[]>`INSERT INTO offering_versions(offering_id,version,currency,amount_minor,pricing_period,available_from,created_by_user_id) SELECT offering_id,2,currency,amount_minor,pricing_period,available_from,created_by_user_id FROM offering_versions WHERE id=${fixture.offeringVersionId} RETURNING id,offering_id`; await client`UPDATE offerings SET current_version_id=${next[0]!.id} WHERE id=${next[0]!.offering_id}`; } },
    { name: 'media processing incomplete', mutate: async (client, fixture) => { await client`UPDATE media_assets SET lifecycle='PROCESSING' WHERE id=(SELECT media_asset_id FROM listing_media WHERE listing_id=${fixture.listingId} LIMIT 1)`; } },
    { name: 'media approval missing', mutate: async (client, fixture) => { await client`UPDATE listing_media SET review_status='NOT_REVIEWED' WHERE listing_id=${fixture.listingId}`; } },
    { name: 'submitted media removed', expected: 'STALE_VERSION', mutate: async (client, fixture) => { await client`UPDATE listing_media SET removed_at=statement_timestamp() WHERE listing_id=${fixture.listingId}`; } },
    { name: 'cover missing', expected: 'STALE_VERSION', mutate: async (client, fixture) => { await client`UPDATE listing_media SET is_cover=false WHERE listing_id=${fixture.listingId}`; } },
    { name: 'market not discoverable', expected: 'LISTING_MARKET_STATUS_INVALID', mutate: async (client, fixture) => { await client`UPDATE listings SET market_status='RENTED' WHERE id=${fixture.listingId}`; } },
  ];
  for (const current of cases) {
    const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
    try {
      await client`TRUNCATE users RESTART IDENTITY CASCADE`;
      const fixture = await createFixture(client);
      const submissions = new ListingSubmissionStore(client, true);
      const moderation = new ListingModerationStore(client, submissions);
      const submitted = await submit(fixture, submissions);
      assert.ok(submitted.submission, current.name);
      await current.mutate(client, fixture);
      await assert.rejects(moderation.decide(fixture.staff, fixture.listingId, decision(submitted.submission.id, submitted.submission.revisionId, submitted.readiness.revisionVersion, 'APPROVE_AND_PUBLISH')), { code: current.expected ?? 'PUBLICATION_REQUIREMENTS_BLOCKED' }, current.name);
    } finally {
      await client`TRUNCATE users RESTART IDENTITY CASCADE`;
      await client.end();
    }
  }
});

void integration('staff listing moderation requires current scoped session and grant', async () => {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const fixture = await createFixture(client);
    const submissions = new ListingSubmissionStore(client, true);
    const moderation = new ListingModerationStore(client, submissions);
    const submitted = await submit(fixture, submissions);
    assert.ok(submitted.submission);
    await client`UPDATE staff_grants SET revoked_at=statement_timestamp() WHERE user_id=${fixture.staff.row.user_id}`;
    await assert.rejects(moderation.decide(fixture.staff, fixture.listingId, decision(submitted.submission.id, submitted.submission.revisionId, 1, 'APPROVE_AND_PUBLISH')), { code: 'RESOURCE_SCOPE_DENIED' });
  } finally {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});

void integration('listing moderation enforces grant, session, step-up, role and self-review boundaries', async () => {
  const cases: Array<{ name: string; mutate: (client: ReturnType<typeof createDatabase>['client'], fixture: Fixture, submissionId: string) => Promise<void>; expected: string }> = [
    { name: 'no grant', expected: 'RESOURCE_SCOPE_DENIED', mutate: async (client, fixture) => { await client`UPDATE staff_grants SET revoked_at=statement_timestamp() WHERE user_id=${fixture.staff.row.user_id}`; } },
    { name: 'wrong region', expected: 'RESOURCE_SCOPE_DENIED', mutate: async (client, fixture) => { await client`UPDATE staff_grants SET permission_scope=${JSON.stringify({kind:'region',id:'Southwest',permissions:['listing:moderate']})}::jsonb WHERE user_id=${fixture.staff.row.user_id}`; } },
    { name: 'expired grant', expected: 'RESOURCE_SCOPE_DENIED', mutate: async (client, fixture) => { await client`UPDATE staff_grants SET active_from=statement_timestamp()-interval '2 hours',expires_at=statement_timestamp()-interval '1 minute' WHERE user_id=${fixture.staff.row.user_id}`; } },
    { name: 'stale staff session', expected: 'AUTH_REQUIRED', mutate: async (client, fixture) => { await client`UPDATE staff_sessions SET revoked_at=statement_timestamp() WHERE id=${fixture.staff.row.id}`; } },
    { name: 'stale reauthentication', expected: 'STEP_UP_REQUIRED', mutate: async (client, fixture) => { await client`UPDATE staff_sessions SET authenticated_at=statement_timestamp()-interval '16 minutes' WHERE id=${fixture.staff.row.id}`; } },
    { name: 'super admin without listing grant', expected: 'RESOURCE_SCOPE_DENIED', mutate: async (client, fixture) => { await client`UPDATE staff_grants SET role='SUPER_ADMIN',permission_scope='{"kind":"platform","id":"pachi","permissions":["admin:permissions_manage"]}'::jsonb WHERE user_id=${fixture.staff.row.user_id}`; } },
    { name: 'self review', expected: 'RESOURCE_SCOPE_DENIED', mutate: async (client, fixture, submissionId) => { await client`UPDATE provider_profiles SET user_id=${fixture.staff.row.user_id} WHERE user_id=${fixture.ownerId}`; await client`UPDATE listing_submissions SET submitted_by_user_id=${fixture.staff.row.user_id} WHERE id=${submissionId}`; } },
  ];
  for (const current of cases) {
    const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
    try {
      await client`TRUNCATE users RESTART IDENTITY CASCADE`;
      const fixture = await createFixture(client);
      const submissions = new ListingSubmissionStore(client, true);
      const moderation = new ListingModerationStore(client, submissions);
      const submitted = await submit(fixture, submissions);
      assert.ok(submitted.submission, current.name);
      await current.mutate(client, fixture, submitted.submission.id);
      await assert.rejects(moderation.decide(fixture.staff, fixture.listingId, decision(submitted.submission.id, submitted.submission.revisionId, submitted.readiness.revisionVersion, 'APPROVE_AND_PUBLISH')), { code: current.expected }, current.name);
    } finally {
      await client`TRUNCATE users RESTART IDENTITY CASCADE`;
      await client.end();
    }
  }
});

void integration('reject is terminal for the submitted episode and concurrent decisions serialize', async () => {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const fixture = await createFixture(client);
    const submissions = new ListingSubmissionStore(client, true);
    const moderation = new ListingModerationStore(client, submissions);
    const submitted = await submit(fixture, submissions);
    assert.ok(submitted.submission);
    const rejected = await moderation.decide(fixture.staff, fixture.listingId, decision(submitted.submission.id, submitted.submission.revisionId, submitted.readiness.revisionVersion, 'REJECT'));
    assert.equal(rejected.publication_status, 'REJECTED');
    assert.equal(rejected.moderation_status, 'REJECTED');
    await assert.rejects(moderation.decide(fixture.staff, fixture.listingId, decision(submitted.submission.id, submitted.submission.revisionId, submitted.readiness.revisionVersion, 'APPROVE_AND_PUBLISH')), { code: 'STALE_VERSION' });

    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const concurrentFixture = await createFixture(client);
    const concurrentSubmissions = new ListingSubmissionStore(client, true);
    const concurrentModeration = new ListingModerationStore(client, concurrentSubmissions);
    const concurrentSubmission = await submit(concurrentFixture, concurrentSubmissions);
    assert.ok(concurrentSubmission.submission);
    const outcomes = await Promise.allSettled([1, 2].map(() => concurrentModeration.decide(concurrentFixture.staff, concurrentFixture.listingId, decision(concurrentSubmission.submission!.id, concurrentSubmission.submission!.revisionId, concurrentSubmission.readiness.revisionVersion, 'APPROVE_AND_PUBLISH'))));
    assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ['fulfilled', 'rejected']);
    assert.equal((await client`SELECT count(*)::int AS count FROM listing_revision_moderation_actions WHERE listing_id=${concurrentFixture.listingId}`)[0]?.count, 1);
  } finally {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});

type Fixture = { ownerId: string; listingId: string; staff: StaffPrincipal; revisionId: string; offeringVersionId: string };

async function createFixture(client: ReturnType<typeof createDatabase>['client']): Promise<Fixture> {
  const users = await client<{id:string}[]>`INSERT INTO users(account_state,display_name) VALUES ('ACTIVE','Synthetic owner'),('ACTIVE','Synthetic moderator') RETURNING id`;
  const ownerId = users[0]!.id;
  const moderatorId = users[1]!.id;
  await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${ownerId},'+237690001001',now(),1)`;
  const profile = await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name,state,verification_status) VALUES (${ownerId},ARRAY['OWNER'],'Synthetic owner','ACTIVE','VERIFIED') RETURNING id`;
  const account = await client<{id:string}[]>`INSERT INTO provider_accounts(provider_profile_id,state) VALUES (${profile[0]!.id},'ACTIVE') RETURNING id`;
  const identity = await client<{id:string}[]>`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${moderatorId},'https://synthetic.staff','moderator','LOCAL_TEST') RETURNING id`;
  const originJti = randomUUID();
  const session = await client<{id:string}[]>`INSERT INTO staff_sessions(user_id,identity_id,issuer,app_client_id,origin_jti,security_version,authenticated_at,mfa_method,last_seen_at,absolute_expires_at,idle_expires_at,token_expires_at,access_token_ciphertext,refresh_token_ciphertext) VALUES (${moderatorId},${identity[0]!.id},'https://synthetic.staff','synthetic-client',${originJti},0,statement_timestamp(),'COGNITO_REQUIRED_TOTP',statement_timestamp(),statement_timestamp()+interval '1 hour',statement_timestamp()+interval '30 minutes',statement_timestamp()+interval '10 minutes',decode('00','hex'),decode('00','hex')) RETURNING id`;
  const scope = { kind: 'region', id: 'Littoral', permissions: ['listing:moderate'] };
  await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${moderatorId},'LISTING_MODERATOR',${JSON.stringify(scope)}::jsonb,statement_timestamp()+interval '1 hour','synthetic','listing moderation integration')`;
  const properties = new PropertyDraftStore(client);
  const property = await properties.createProperty(ownerId, { propertyType:'APARTMENT', region:'Littoral', city:'Douala', neighborhood:'Akwa', bedrooms:2, relationshipType:'OWNER' });
  const draft = await properties.createDraft(ownerId, { propertyId:property.id, purpose:'RENT', title:'Synthetic listing', description:'A complete synthetic listing for moderation', amountMinor:200000, availableFrom:'2026-10-01' });
  const verificationCase = await client<{id:string}[]>`INSERT INTO verification_cases(provider_profile_id,applicant_user_id,verification_type,state,policy_version,idempotency_key,submitted_at,valid_until) VALUES (${profile[0]!.id},${ownerId},'PROVIDER_IDENTITY','VERIFIED','provider-identity-synthetic-v1',${randomUUID()},statement_timestamp(),statement_timestamp()+interval '1 year') RETURNING id`;
  await client`INSERT INTO verification_claims(provider_profile_id,claim_type,status,source_case_id,valid_from,valid_until) VALUES (${profile[0]!.id},'PROVIDER_IDENTITY','VERIFIED',${verificationCase[0]!.id},statement_timestamp(),statement_timestamp()+interval '1 year')`;
  const asset = await client<{id:string}[]>`INSERT INTO media_assets(owner_provider_account_id,classification,storage_reference,lifecycle,original_mime,original_bytes,derivative_manifest) VALUES (${account[0]!.id},'PUBLIC_MARKETPLACE',${randomUUID()},'READY','image/png',128,${JSON.stringify({320:{mime:'image/webp',width:8,height:6,bytes:80}})}::jsonb) RETURNING id`;
  await client`INSERT INTO listing_media(listing_id,media_asset_id,display_order,is_cover,review_status,attached_by_user_id) VALUES (${draft.id},${asset[0]!.id},0,true,'APPROVED',${ownerId})`;
  await client`UPDATE offerings SET current_version_id=current_version_id WHERE listing_id=${draft.id}`;
  const relationship = await client<{id:string}[]>`SELECT provider_property_relationship_id AS id FROM listings WHERE id=${draft.id}`;
  await new AuthorityRiskStore(client).evaluate(relationship[0]!.id);
  const principal = await client<{authenticated_at:Date;absolute_expires_at:Date;idle_expires_at:Date;token_expires_at:Date}[]>`SELECT authenticated_at,absolute_expires_at,idle_expires_at,token_expires_at FROM staff_sessions WHERE id=${session[0]!.id}`;
  const staff = { row: { id:session[0]!.id, user_id:moderatorId, issuer:'https://synthetic.staff', app_client_id:'synthetic-client', origin_jti:originJti, authenticated_at:principal[0]!.authenticated_at, absolute_expires_at:principal[0]!.absolute_expires_at, idle_expires_at:principal[0]!.idle_expires_at, token_expires_at:principal[0]!.token_expires_at, identity_id:identity[0]!.id, access_token_ciphertext:Buffer.from([0]), refresh_token_ciphertext:Buffer.from([0]), display_name:'Synthetic moderator' }, grants: [] } as unknown as StaffPrincipal;
  return { ownerId, listingId:draft.id, staff, revisionId:draft.revisionId, offeringVersionId:draft.offeringVersionId };
}

async function submit(fixture: Fixture, submissions: ListingSubmissionStore, revisionId=fixture.revisionId, offeringVersionId=fixture.offeringVersionId) {
  return submissions.submit(fixture.ownerId, fixture.listingId, { revisionId, offeringVersionId, idempotencyKey:randomUUID(), requestId:randomUUID() });
}

function decision(submissionId: string, revisionId: string, expectedVersion: number, command: 'REQUEST_CHANGES' | 'REJECT' | 'APPROVE_AND_PUBLISH') {
  return { submissionId, revisionId, expectedVersion, command, reasonCode:command === 'REQUEST_CHANGES' ? 'CORRECTION_REQUIRED' : 'CONTENT_REVIEWED', reasonText:command === 'REQUEST_CHANGES' ? 'Listing needs a correction.' : 'Synthetic moderation decision recorded.', providerMessage:command === 'REQUEST_CHANGES' ? 'Please correct the listing details.' : undefined, idempotencyKey:randomUUID(), requestId:randomUUID() };
}
