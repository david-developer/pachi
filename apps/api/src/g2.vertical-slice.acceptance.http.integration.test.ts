import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import {
  ANALYTICS_CONSUMER, AnalyticsStore, AuthorityRiskStore, ConversationStore,
  createDatabase, IdentityError, IdentityStore, InteractionStore, ListingMediaStore,
  ListingModerationStore, ListingPhotoReviewStore, ListingSubmissionStore,
  PropertyDraftStore, ProviderStore, ProviderVerificationStore, PublicListingStore,
  readAuthorityRisk, responseTimeBucket, type InteractionResult, type PublicListingSearch,
  type StaffRole, type StaffScope, StaffStore,
} from '@pachi/database';
import type {
  ConversationListResponse, MessageListResponse, MessageSendResponse, PublicListing,
} from '@pachi/contracts';
import { LocalPrivateMediaStorage, processOneMediaJob, type MalwareScanner } from '@pachi/media';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { ConversationController } from './conversation.controller.js';
import { InteractionController } from './interaction.controller.js';
import { PublicListingController } from './public-listing.controller.js';
import { StaffAuthService } from './staff.controller.js';
import { StaffListingModerationController } from './staff-listing-moderation.controller.js';

const baseline = '670bbaf82b23f9bfb78610c038811753b66f01d6';
const samples = {
  GOVERNMENT_ID: 'PACHI_SYNTHETIC_GOVERNMENT_ID_V1',
  LIVE_SELFIE: 'PACHI_SYNTHETIC_LIVE_SELFIE_V1',
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQyPPDihgGUgIADmopQfEhRyEAAAAASUVORK5CYII=', 'base64');
if (!process.env.DATABASE_TEST_URL && process.env.CI === 'true') throw new Error('DATABASE_TEST_URL is required for G2 acceptance');
const integration = process.env.DATABASE_TEST_URL ? test : test.skip;

// One journey. Only auth identities/contacts and historical participant scaffolding
// use fixture SQL. Every successful business transition uses a merged command.
void integration('G2 recorded individual-provider marketplace vertical-slice acceptance', async () => {
  const databaseUrl = process.env.DATABASE_TEST_URL;
  assert.ok(databaseUrl);
  const parsed = new URL(databaseUrl);
  assert.equal(`${parsed.hostname}:${parsed.port}${parsed.pathname}`, 'localhost:5433/pachi_test');
  const savedEnvironment = { NODE_ENV: process.env.NODE_ENV, ANALYTICS_ENVIRONMENT: process.env.ANALYTICS_ENVIRONMENT };
  process.env.NODE_ENV = 'test'; process.env.ANALYTICS_ENVIRONMENT = 'test';
  const { client } = createDatabase(databaseUrl);
  const mediaRoot = await mkdtemp(join(tmpdir(), 'pachi-g2-acceptance-'));
  const storage = new LocalPrivateMediaStorage(mediaRoot);
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const issuer = 'https://local.test/g2-acceptance';
  const accountVerifier = new CognitoAccessTokenVerifier({ issuer, getKey: async () => publicKey, allowedClientIds: new Set(['g2-account']), requiredScopes: new Set(['pachi/account']), provider: 'LOCAL_TEST' });
  const staffVerifier = new CognitoAccessTokenVerifier({ issuer, getKey: async () => publicKey, allowedClientIds: new Set(['g2-staff']), requiredScopes: new Set(['pachi/staff']), provider: 'LOCAL_TEST', strictStaff: true });
  const staffStore = new StaffStore(client, 'g2-synthetic-staff-encryption-secret-v1');
  const staffAuth = new StaffAuthService(staffStore, staffVerifier);
  const submissions = new ListingSubmissionStore(client, true);
  const moderation = new ListingModerationStore(client, submissions);
  @Module({
    controllers: [PublicListingController, InteractionController, ConversationController, StaffListingModerationController],
    providers: [
      AuthGuard,
      { provide: 'AUTH_SERVICE', useValue: new AuthService(new IdentityStore(client), accountVerifier) },
      { provide: 'STAFF_AUTH_SERVICE', useValue: staffAuth },
      { provide: 'PUBLIC_LISTING_STORE', useValue: new PublicListingStore(client, true) },
      { provide: 'INTERACTION_STORE', useValue: new InteractionStore(client, true) },
      { provide: 'CONVERSATION_STORE', useValue: new ConversationStore(client, true) },
      { provide: 'LISTING_MODERATION_STORE', useValue: moderation },
      { provide: 'LOCAL_PRIVATE_MEDIA_STORAGE', useValue: storage },
    ],
  })
  class AcceptanceApp {}
  const app = await NestFactory.create(AcceptanceApp, { logger: false });
  app.setGlobalPrefix('v1'); await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const base = `http://127.0.0.1:${address.port}/v1`;
  let stage = 'provider_prerequisites';
  const noLeak = (value: unknown, forbidden: string[]) => {
    const serialized = JSON.stringify(value);
    for (const text of forbidden) assert.ok(!serialized.includes(text), 'Private data escaped its permitted projection');
  };
  const call = async <T>(path: string, expected: number, token?: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, expected, `Unexpected HTTP status at ${stage}`);
    return await response.json() as T;
  };
  try {
    await client`SET client_min_messages TO warning`;
    await client`TRUNCATE users, job_receipts RESTART IDENTITY CASCADE`;
    const makeActor = async (phone?: string) => {
      const [user] = await client<{ id: string }[]>`INSERT INTO users(account_state) VALUES ('ACTIVE') RETURNING id`;
      assert.ok(user);
      const subject = `g2-synthetic-${randomUUID()}`;
      await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${user.id},${issuer},${subject},'LOCAL_TEST')`;
      if (phone) await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${user.id},${phone},statement_timestamp(),1)`;
      return { id: user.id, subject };
    };
    const tokenFor = async (subject: string, staff = false) => new SignJWT({ client_id: staff ? 'g2-staff' : 'g2-account', origin_jti: randomUUID(), jti: randomUUID(), token_use: 'access', scope: staff ? 'pachi/staff' : 'pachi/account' }).setProtectedHeader({ alg: 'RS256' }).setSubject(subject).setIssuer(issuer).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const phone = '+237690009991';
    const owner = await makeActor(phone);
    const email = `synthetic-${randomUUID()}@example.invalid`;
    await client`INSERT INTO email_contacts(user_id,normalized_email,verified_at) VALUES (${owner.id},${email},statement_timestamp())`;
    const provider = await new ProviderStore(client).onboard(owner.id, { providerTypes: ['OWNER'], displayName: 'Synthetic G2 Owner', serviceArea: 'Littoral' });
    assert.deepEqual(provider.providerTypes, ['OWNER']);
    const checkActor = async (id: string) => {
      const [state] = await client<{ active: boolean; current_phone: boolean }[]>`SELECT account_state='ACTIVE' AS active, EXISTS(SELECT 1 FROM phone_contacts WHERE user_id=users.id AND verified_at IS NOT NULL AND replaced_at IS NULL AND normalized_e164 ~ '^\\+237[0-9]{9}$') AS current_phone FROM users WHERE id=${id}`;
      assert.deepEqual(state, { active: true, current_phone: true });
    };
    await checkActor(owner.id);
    const ownerToken = await tokenFor(owner.subject);
    const privateValues = [phone, email, owner.subject, ownerToken, ...Object.values(samples)];

    stage = 'provider_verification_fixed_sample_intake';
    const verification = new ProviderVerificationStore(client, 'g2-isolated-synthetic-evidence-key-v1', true);
    const verificationInput = { idempotencyKey: `g2_${randomUUID()}`, capacity: 'OWNER', governmentId: samples.GOVERNMENT_ID, liveSelfie: samples.LIVE_SELFIE, requestId: randomUUID(), syntheticEnabled: true };
    // E01: arbitrary evidence is denied, intentionally, without business writes.
    await assert.rejects(verification.submit(owner.id, { ...verificationInput, governmentId: 'actual-private-document' }), { code: 'EVIDENCE_POLICY_UNAVAILABLE' });
    const verificationCounts = async () => ({
      cases: (await client`SELECT count(*)::int AS n FROM verification_cases`)[0]!.n,
      evidence: (await client`SELECT count(*)::int AS n FROM verification_evidence`)[0]!.n,
      claims: (await client`SELECT count(*)::int AS n FROM verification_claims`)[0]!.n,
    });
    assert.deepEqual(await verificationCounts(), { cases: 0, evidence: 0, claims: 0 });
    const submittedCase = await verification.submit(owner.id, verificationInput);
    assert.equal(submittedCase.state, 'PENDING');
    assert.equal(submittedCase.policy_version, 'provider-identity-synthetic-v1');
    assert.deepEqual(await verificationCounts(), { cases: 1, evidence: 2, claims: 0 });
    const evidence = await client<{ evidence_type: keyof typeof samples; mime_type: string; sha256: string; encrypted_content: Buffer }[]>`SELECT evidence_type,mime_type,sha256,encrypted_content FROM verification_evidence WHERE case_id=${submittedCase.id} ORDER BY evidence_type`;
    assert.deepEqual(evidence.map(row => row.evidence_type), ['GOVERNMENT_ID', 'LIVE_SELFIE']);
    for (const row of evidence) {
      assert.equal(row.mime_type, 'application/x-pachi-synthetic');
      assert.ok(Buffer.isBuffer(row.encrypted_content) && row.encrypted_content.length > 0, 'Encrypted evidence missing');
      assert.ok(row.sha256 === createHash('sha256').update(samples[row.evidence_type]).digest('hex'), 'Evidence hash mismatch');
      for (const sample of Object.values(samples)) assert.ok(!row.encrypted_content.includes(Buffer.from(sample)), 'Plaintext found in ciphertext');
    }
    noLeak({ provider, submittedCase, own: await verification.own(owner.id), evidence: evidence.map(({ evidence_type, mime_type, sha256 }) => ({ evidence_type, mime_type, sha256 })) }, Object.values(samples));

    stage = 'provider_verification_scoped_staff_review';
    const makeStaff = async (role: StaffRole, scope: StaffScope) => {
      const actor = await makeActor();
      await staffStore.provision({ operator: 'g2-isolated-test', userId: actor.id, issuer, subject: actor.subject, role, scope, reason: 'Synthetic G2 scoped acceptance grant', expiresAt: new Date(Date.now() + 3600_000) });
      const token = await tokenFor(actor.subject, true);
      await staffStore.register(await staffVerifier.verify(token), new Date(), 'synthetic-staff-access', 'synthetic-staff-refresh');
      const principal = await staffAuth.principal(`Bearer ${token}`);
      assert.equal(principal.row.user_id, actor.id);
      assert.ok(Date.now() - +principal.row.authenticated_at < 900_000);
      privateValues.push(actor.subject, token);
      return { ...actor, token, principal };
    };
    const officer = await makeStaff('VERIFICATION_OFFICER', { kind: 'case', id: submittedCase.id, permissions: ['provider:verify', 'evidence:read'] });
    const admin = await makeStaff('SUPER_ADMIN', { kind: 'platform', id: 'pachi', permissions: ['admin:permissions_manage'] });
    assert.notEqual(officer.id, owner.id);
    const assigned = await verification.assign(admin.principal, submittedCase.id, officer.id, submittedCase.version, randomUUID());
    assert.equal(assigned.version, 2);
    for (const kind of ['GOVERNMENT_ID', 'LIVE_SELFIE'] as const) {
      const reviewed = await verification.evidence(await staffAuth.principal(`Bearer ${officer.token}`), submittedCase.id, kind, randomUUID());
      assert.ok(reviewed.content === samples[kind], 'Authorized evidence decryption mismatch');
      assert.equal(reviewed.mime_type, 'application/x-pachi-synthetic');
    }
    const verified = await verification.decide(await staffAuth.principal(`Bearer ${officer.token}`), submittedCase.id, { expectedVersion: assigned.version, outcome: 'VERIFIED', reasonCode: 'EVIDENCE_ACCEPTED', requestId: randomUUID() });
    assert.equal(verified.state, 'VERIFIED');
    assert.ok(verified.valid_until && Date.parse(verified.valid_until) > Date.now());
    assert.deepEqual(await verificationCounts(), { cases: 1, evidence: 2, claims: 1 });
    const [verifiedState] = await client`SELECT p.state AS profile_state,a.state AS account_state,p.verification_status,
      EXISTS(SELECT 1 FROM verification_claims WHERE provider_profile_id=p.id AND source_case_id=${submittedCase.id} AND claim_type='PROVIDER_IDENTITY' AND status='VERIFIED' AND revoked_at IS NULL AND valid_from<=statement_timestamp() AND valid_until>statement_timestamp()) AS current_claim
      FROM provider_profiles p JOIN provider_accounts a ON a.provider_profile_id=p.id WHERE p.id=${provider.profileId}`;
    assert.deepEqual(verifiedState, { profile_state: 'ACTIVE', account_state: 'ACTIVE', verification_status: 'VERIFIED', current_claim: true });
    assert.equal((await client`SELECT count(*)::int AS n FROM verification_decisions WHERE case_id=${submittedCase.id} AND reviewer_user_id=${officer.id} AND outcome='VERIFIED' AND reason_code='EVIDENCE_ACCEPTED'`)[0]!.n, 1);
    assert.equal((await client`SELECT count(*)::int AS n FROM audit_events WHERE target_id=${submittedCase.id} AND action IN ('PROVIDER_VERIFICATION_SUBMITTED','PROVIDER_VERIFICATION_ASSIGNED','VERIFICATION_EVIDENCE_ACCESSED','PROVIDER_VERIFICATION_DECIDED')`)[0]!.n, 5);
    noLeak({ verified, provider: await new ProviderStore(client).get(owner.id) }, Object.values(samples));

    stage = 'property_listing_offering';
    const properties = new PropertyDraftStore(client);
    const privateLandmark = `G2_PRIVATE_LANDMARK_${randomUUID()}`;
    privateValues.push(privateLandmark);
    const property = await properties.createProperty(owner.id, { propertyType: 'APARTMENT', region: 'Littoral', city: 'Douala', neighborhood: 'Akwa', landmark: privateLandmark, relationshipType: 'OWNER' });
    assert.equal(property.authorizationStatus, 'DECLARED');
    await assert.rejects(properties.createDraft(owner.id, { propertyId: property.id, purpose: 'RENT', title: 'Synthetic G2 flat', amountMinor: 200000, minimumNights: 2 }), { code: 'OFFERING_TERMS_INVALID' });
    assert.equal((await client`SELECT count(*)::int AS n FROM listings`)[0]!.n, 0);
    const initialDraft = await properties.createDraft(owner.id, { propertyId: property.id, purpose: 'RENT', title: 'Synthetic G2 flat', description: 'Synthetic public apartment for the recorded G2 journey', amountMinor: 200000, availableFrom: '2026-10-01' });
    const draft = await properties.updateDraft(owner.id, initialDraft.id, { title: 'Synthetic G2 current flat', description: 'Current approved public description', depositAmountMinor: 200000, minimumLeaseMonths: 6 });
    assert.notEqual(draft.revisionId, initialDraft.revisionId);
    assert.notEqual(draft.offeringVersionId, initialDraft.offeringVersionId);
    assert.equal(draft.pricingPeriod, 'MONTHLY'); assert.equal(draft.purpose, 'RENT');
    const blocked = await submissions.readiness(owner.id, draft.id);
    assert.equal(blocked.canSubmit, false);
    for (const code of ['PROPERTY_SPECIFICATION_REQUIRED', 'MEDIA_REQUIRED', 'PROPERTY_RISK_HOLD_EVALUATION_UNAVAILABLE']) assert.equal(blocked.checks.find(c => c.code === code)?.status, 'BLOCKED');
    await properties.updateSpecifications(owner.id, property.id, { expectedVersion: property.version, bedrooms: 2, bathrooms: 1 });

    stage = 'authority_risk_current_clear';
    const evaluation = await new AuthorityRiskStore(client).evaluate(property.relationshipId);
    assert.equal(evaluation.outcome, 'CLEAR');
    const [authority] = await client`SELECT e.relationship_id,e.principal_id,(e.relationship_version=r.authority_version AND e.principal_version=a.authority_principal_version AND e.source_version=c.version) AS current_versions
      FROM authority_risk_evaluations e JOIN provider_property_relationships r ON r.id=e.relationship_id JOIN provider_accounts a ON a.id=r.provider_account_id CROSS JOIN authority_risk_source_clock c WHERE e.relationship_id=${property.relationshipId}`;
    assert.equal(authority!.relationship_id, property.relationshipId); assert.equal(authority!.principal_id, provider.accountId); assert.equal(authority!.current_versions, true);
    assert.equal((await readAuthorityRisk(client, property.relationshipId, provider.accountId)).status, 'CLEAR');
    const beforeMedia = await submissions.readiness(owner.id, draft.id);
    assert.equal(beforeMedia.checks.find(c => c.code === 'PROPERTY_SPECIFICATION_REQUIRED')?.status, 'READY');
    assert.equal(beforeMedia.checks.find(c => c.code === 'PROPERTY_RISK_HOLD_EVALUATION_UNAVAILABLE')?.status, 'READY');
    assert.equal(beforeMedia.canSubmit, false);

    const publicPath = `/public/listings/${draft.id}`;
    const searchPath = '/public/listings?purpose=RENT&region=Littoral&city=Douala&min_price=100000';
    const invisible = async (mediaId?: string) => {
      await call(publicPath, 404);
      const search = await call<PublicListingSearch>(searchPath, 200);
      assert.equal(search.items.length, 0);
      if (mediaId) await call(`${publicPath}/media/${mediaId}/variants/320`, 404);
    };
    await invisible();
    stage = 'media_quarantine_processing';
    const media = new ListingMediaStore(client);
    const upload = await media.createUploadIntent(owner.id, draft.id);
    assert.equal((await client`SELECT lifecycle FROM media_assets WHERE id=${upload.assetId}`)[0]!.lifecycle, 'UPLOAD_AUTHORIZED');
    await storage.putQuarantine(upload.storageReference, png);
    await media.completeUpload(owner.id, upload.assetId, { mime: 'image/png', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') });
    const quarantined = (await media.media(owner.id, draft.id))[0]!;
    assert.equal(quarantined.state, 'UPLOADED_QUARANTINED'); assert.equal(quarantined.reviewStatus, 'NOT_REVIEWED');
    await invisible(quarantined.id);
    let scans = 0;
    const scanner: MalwareScanner = { scan: async (bytes) => { assert.ok(bytes.equals(png), 'Scanner received unexpected bytes'); scans++; return 'CLEAN'; } };
    assert.equal(await processOneMediaJob(media, storage, scanner), true);
    assert.equal(scans, 1);
    const processed = (await media.media(owner.id, draft.id))[0]!;
    assert.equal(processed.state, 'READY'); assert.equal(processed.reviewStatus, 'NOT_REVIEWED');
    assert.deepEqual(processed.variants.map(v => v.variantWidth), [320, 640, 1280, 1920]);
    await invisible(processed.id);
    const ordered = await media.reorder(owner.id, draft.id, [upload.assetId], upload.assetId);
    assert.equal(ordered[0]!.displayOrder, 0); assert.equal(ordered[0]!.isCover, true);
    assert.equal((await submissions.readiness(owner.id, draft.id)).checks.find(c => c.code === 'MEDIA_CONTENT_APPROVAL_REQUIRED')?.status, 'BLOCKED');

    stage = 'scoped_photo_approval';
    const moderator = await makeStaff('LISTING_MODERATOR', { kind: 'region', id: 'Littoral', permissions: ['listing:moderate'] });
    assert.notEqual(moderator.id, owner.id);
    const photos = new ListingPhotoReviewStore(client);
    const queue = await photos.queue(moderator.principal);
    assert.equal(queue.length, 1); assert.equal(queue[0]!.id, processed.id);
    const preview = await photos.preview(await staffAuth.principal(`Bearer ${moderator.token}`), processed.id, 320, randomUUID(), (reference, width) => storage.readVariant(reference, width));
    assert.equal(preview.mime, 'image/webp'); assert.ok(preview.bytes.length > 0);
    assert.equal((await photos.decide(await staffAuth.principal(`Bearer ${moderator.token}`), processed.id, { mediaAssetId: upload.assetId, expectedVersion: queue[0]!.version, outcome: 'APPROVED', reasonCode: 'CONTENT_REVIEWED', requestId: randomUUID(), idempotencyKey: randomUUID() })).status, 'APPROVED');
    await invisible(processed.id);

    stage = 'exact_submission_readiness';
    const ready = await submissions.readiness(owner.id, draft.id);
    assert.equal(ready.canSubmit, true); assert.ok(ready.checks.length > 0 && ready.checks.every(c => c.status === 'READY'));
    const submission = await submissions.submit(owner.id, draft.id, { revisionId: draft.revisionId, offeringVersionId: draft.offeringVersionId, idempotencyKey: randomUUID(), requestId: randomUUID() });
    assert.ok(submission.submission);
    assert.equal(submission.submission.revisionId, draft.revisionId); assert.equal(submission.submission.offeringVersionId, draft.offeringVersionId);
    assert.deepEqual(submission.submission.mediaSnapshot, [{ listing_media_id: processed.id, media_asset_id: upload.assetId, display_order: 0, is_cover: true }]);

    stage = 'staff_exact_revision_publication';
    const moderationNote = `G2_PRIVATE_MODERATION_${randomUUID()}`;
    privateValues.push(moderationNote);
    const moderationQueue = await call<{ submissions: Array<{ submission_id: string; revision_id: string }> }>('/staff/listing-revisions', 200, moderator.token);
    assert.equal(moderationQueue.submissions.length, 1); assert.equal(moderationQueue.submissions[0]!.submission_id, submission.submission.id);
    const decision = { submission_id: submission.submission.id, revision_id: draft.revisionId, expected_version: ready.revisionVersion, command: 'APPROVE_AND_PUBLISH', reason_code: 'CONTENT_REVIEWED', reason_text: moderationNote, idempotency_key: randomUUID() };
    const decisionPath = `/staff/listing-revisions/${draft.id}/decision`;
    await call(decisionPath, 201, moderator.token, decision);
    await call(decisionPath, 201, moderator.token, decision);
    const [published] = await client`SELECT publication_status,moderation_status,approved_revision_id,current_revision_id,approved_submission_id,expires_at>statement_timestamp() AS fresh,public_location_mode FROM listings WHERE id=${draft.id}`;
    assert.equal(published!.publication_status, 'PUBLISHED'); assert.equal(published!.moderation_status, 'APPROVED');
    assert.equal(published!.approved_revision_id, draft.revisionId); assert.equal(published!.current_revision_id, draft.revisionId); assert.equal(published!.approved_submission_id, submission.submission.id); assert.equal(published!.fresh, true);
    assert.equal(published!.public_location_mode, 'NEIGHBORHOOD_ONLY');
    assert.equal((await client`SELECT count(*)::int AS n FROM listing_revision_moderation_actions`)[0]!.n, 1);

    stage = 'anonymous_discovery_and_privacy';
    const search = await call<PublicListingSearch>(searchPath, 200);
    assert.equal(search.items.length, 1); assert.equal(search.items[0]!.id, draft.id);
    const detail = await call<PublicListing>(publicPath, 200);
    assert.equal(detail.id, draft.id); assert.equal(detail.title, draft.title); assert.equal(detail.description, draft.description);
    assert.deepEqual(detail.location, { region: 'Littoral', city: 'Douala', neighborhood: 'Akwa' });
    assert.deepEqual(detail.media.map(item => item.id), [processed.id]); assert.equal(detail.media[0]!.is_cover, true);
    noLeak({ search, detail }, [...privateValues, upload.storageReference, initialDraft.revisionId, 'private_address', 'landmark', 'latitude', 'longitude', 'coordinates', 'provider_account_id', 'verification_case_id', 'encrypted_content', 'authority_risk', 'reason_text']);
    const publicImage = await fetch(`${base}${publicPath}/media/${processed.id}/variants/320`);
    assert.equal(publicImage.status, 200); assert.ok(publicImage.headers.get('content-type')?.startsWith('image/webp')); assert.ok((await publicImage.arrayBuffer()).byteLength > 0);

    stage = 'seeker_inquiry_and_replay';
    const seeker = await makeActor('+237690009992');
    const unrelated = await makeActor('+237690009993');
    await checkActor(seeker.id); await checkActor(unrelated.id);
    const seekerToken = await tokenFor(seeker.subject); const otherToken = await tokenFor(unrelated.subject);
    privateValues.push(seeker.subject, unrelated.subject, seekerToken, otherToken);
    const inquiryKey = randomUUID();
    const inquiryPath = `/account/listings/${draft.id}/inquiry`;
    const inquiry = await call<InteractionResult>(inquiryPath, 201, seekerToken, {}, { 'idempotency-key': inquiryKey });
    const inquiryReplay = await call<InteractionResult>(inquiryPath, 201, seekerToken, {}, { 'idempotency-key': inquiryKey });
    assert.equal(inquiry.state, 'OPEN'); assert.equal(inquiry.created, true); assert.equal(inquiryReplay.created, false);
    assert.equal(inquiryReplay.interaction_id, inquiry.interaction_id); assert.equal(inquiryReplay.conversation_id, inquiry.conversation_id);
    const [context] = await client`SELECT provider_account_id,seeker_user_id,listing_id FROM interactions WHERE id=${inquiry.interaction_id}`;
    assert.equal(context!.provider_account_id, provider.accountId); assert.equal(context!.seeker_user_id, seeker.id); assert.equal(context!.listing_id, draft.id);
    const conversationPath = `/account/conversations/${inquiry.conversation_id}`;
    const rates = () => client`SELECT sender_user_id,scope,window_start,message_count FROM message_rate_limits ORDER BY sender_user_id,scope`;
    const sendReplay = async (token: string, body: string, side: 'SEEKER' | 'PROVIDER', recipient: string) => {
      const input = { client_message_id: randomUUID(), body };
      const sent = await call<MessageSendResponse>(`${conversationPath}/messages`, 201, token, input);
      assert.equal(sent.created, true); assert.equal(sent.message.sender_side, side);
      const ratesBefore = await rates();
      const replay = await call<MessageSendResponse>(`${conversationPath}/messages`, 201, token, input);
      assert.equal(replay.created, false); assert.equal(replay.message.id, sent.message.id);
      assert.deepEqual(await rates(), ratesBefore);
      const receipts = await client`SELECT recipient_user_id FROM message_receipts WHERE message_id=${sent.message.id}`;
      assert.equal(receipts.length, 1); assert.equal(receipts[0]!.recipient_user_id, recipient);
      return sent;
    };
    stage = 'seeker_message_and_replay';
    const seekerBody = `G2_SEEKER_PRIVATE_MESSAGE_${randomUUID()}`;
    const providerBody = `G2_PROVIDER_PRIVATE_MESSAGE_${randomUUID()}`;
    privateValues.push(seekerBody, providerBody);
    const seekerMessage = await sendReplay(seekerToken, seekerBody, 'SEEKER', owner.id);
    assert.equal((await client`SELECT count(*)::int AS n FROM messages`)[0]!.n, 1);
    assert.equal((await client`SELECT count(*)::int AS n FROM communication_outbox WHERE event_type='message_sent'`)[0]!.n, 1);

    stage = 'provider_inbox_reply_and_replay';
    const inbox = await call<ConversationListResponse>('/account/conversations', 200, ownerToken);
    assert.equal(inbox.items.length, 1); assert.equal(inbox.items[0]!.conversation_id, inquiry.conversation_id); assert.equal(inbox.items[0]!.interaction_id, inquiry.interaction_id);
    const providerHistory = await call<MessageListResponse>(`${conversationPath}/messages`, 200, ownerToken);
    assert.equal(providerHistory.items.length, 1); assert.ok(providerHistory.items[0]!.body === seekerBody);
    await call(`${conversationPath}/receipts`, 201, ownerToken, { message_ids: [seekerMessage.message.id], state: 'READ' });
    const providerMessage = await sendReplay(ownerToken, providerBody, 'PROVIDER', seeker.id);
    const seekerHistory = await call<MessageListResponse>(`${conversationPath}/messages`, 200, seekerToken);
    assert.equal(seekerHistory.items.length, 2); assert.ok(seekerHistory.items.some(m => m.id === providerMessage.message.id && m.body === providerBody)); assert.ok(seekerHistory.items.some(m => m.id === seekerMessage.message.id && m.body === seekerBody));
    await call(`${conversationPath}/receipts`, 201, seekerToken, { message_ids: [providerMessage.message.id], state: 'READ' });
    assert.equal((await rates()).length, 4); assert.ok((await rates()).every(row => row.message_count === 1));

    stage = 'unrelated_and_historical_participant_denials';
    const denyOther = async () => {
      await call(`${conversationPath}/messages`, 404, otherToken);
      await call(`${conversationPath}/messages`, 404, otherToken, { client_message_id: randomUUID(), body: 'Harmless denied synthetic message' });
      await call(`${conversationPath}/receipts`, 404, otherToken, { message_ids: [seekerMessage.message.id], state: 'READ' });
      const otherInbox = await call<ConversationListResponse>('/account/conversations', 200, otherToken);
      assert.equal(otherInbox.items.length, 0);
    };
    await denyOther();
    // Historical membership is test scaffolding, never an authority grant.
    await client`INSERT INTO interaction_participants(interaction_id,user_id,side,left_at) VALUES (${inquiry.interaction_id},${unrelated.id},'PROVIDER',statement_timestamp())`;
    await denyOther();

    stage = 'analytics_consumption_and_deduplication';
    const flags = async () => ({
      publication: await client`SELECT id,delivered_at FROM listing_revision_moderation_outbox ORDER BY id`,
      contact: await client`SELECT id,delivered_at FROM interaction_outbox ORDER BY id`,
      communication: await client`SELECT id,published_at,attempt_count FROM communication_outbox ORDER BY id`,
    });
    const sourceFlags = await flags();
    assert.equal(sourceFlags.publication.length, 1); assert.equal(sourceFlags.contact.length, 1); assert.equal(sourceFlags.communication.length, 3);
    assert.ok(sourceFlags.publication.every(row => row.delivered_at === null) && sourceFlags.contact.every(row => row.delivered_at === null) && sourceFlags.communication.every(row => row.published_at === null && row.attempt_count === 0));
    const analytics = new AnalyticsStore(client, 'g2-test-only-explicit-pseudonym-secret-v1');
    let consumed = 0; let drained = false;
    for (let i = 0; i < 10; i++) {
      const result = await analytics.processAnalyticsOnce({ limit: 100 }); consumed += result.consumed;
      if (result.consumed === 0 && result.deferred === 0) { drained = true; break; }
    }
    assert.equal(drained, true); assert.equal(consumed, 5);
    const events = await client`SELECT * FROM analytics_events ORDER BY event_name,event_id`;
    assert.equal(events.length, 5);
    assert.deepEqual(events.map(row => row.event_name), ['interaction_created', 'listing_published', 'message_sent', 'message_sent', 'provider_first_response']);
    assert.ok(events.every(row => row.classification === 'TEST' && row.environment === 'test' && row.region === 'Littoral' && row.purpose === 'RENT' && row.exclusion_reason === null));
    const receipts = await client`SELECT * FROM job_receipts WHERE consumer_name=${ANALYTICS_CONSUMER}`;
    assert.equal(receipts.length, 5);
    assert.equal(new Set(receipts.map(row => `${row.source_stream}:${row.source_event_id}`)).size, 5);
    for (const event of events) assert.ok(receipts.some(row => row.source_stream === event.source_stream && row.source_event_id === event.source_event_id && row.result_reference === event.event_id));
    assert.deepEqual(await analytics.processAnalyticsOnce(), { consumed: 0, deferred: 0 });
    assert.deepEqual(await flags(), sourceFlags);
    assert.deepEqual(await client`SELECT * FROM analytics_events ORDER BY event_name,event_id`, events);

    stage = 'analytics_privacy_and_mature_response_metric';
    noLeak(events, [...privateValues, 'actual-private-document', 'phone', 'email', 'body', 'private_address', 'landmark', 'latitude', 'longitude', 'coordinates', 'encrypted_content', 'government_id', 'live_selfie', 'reason_text', 'blocker_user_id', 'blocked_user_id']);
    const [contactMatchesSource] = await client`SELECT ae.occurred_at=i.opened_at AS exact_source_time
      FROM analytics_events ae JOIN interactions i ON i.id=ae.interaction_id
      WHERE ae.event_name='interaction_created' AND i.id=${inquiry.interaction_id}`;
    assert.equal(contactMatchesSource!.exact_source_time, true);
    const [times] = await client<{ contact_at: string; as_of: string; window_start: string; window_end: string; duration_ms: number; bucket: string }[]>`SELECT
      to_char(c.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS contact_at,
      to_char((c.occurred_at+interval '24 hours') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS as_of,
      to_char((c.occurred_at-interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS window_start,
      to_char((c.occurred_at+interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS window_end,
      (extract(epoch FROM r.occurred_at-c.occurred_at)*1000)::float8 AS duration_ms,r.safe_payload->>'response_time_bucket' AS bucket
      FROM (SELECT o.interaction_id,i.opened_at AS occurred_at FROM interaction_outbox o JOIN interactions i ON i.id=o.interaction_id WHERE o.event_type='interaction_created') c
      JOIN communication_outbox r ON r.interaction_id=c.interaction_id AND r.event_type='provider_first_response' WHERE c.interaction_id=${inquiry.interaction_id}`;
    assert.ok(times && times.duration_ms >= 0 && times.duration_ms <= 86400_000);
    const metric = await analytics.providerResponseSummary({ as_of: times.as_of, window_start: times.window_start, window_end: times.window_end, environment: 'test', classification: 'TEST', segments: { region: 'Littoral', purpose: 'RENT', provider_account_id: provider.accountId } });
    assert.equal(metric.denominator, 1); assert.equal(metric.numerator, 1); assert.equal(metric.response_rate, 1);
    assert.equal(metric.unanswered_mature_contacts, 0); assert.equal(metric.late_responded_mature_contacts, 0); assert.equal(metric.median_sample_size, 1);
    assert.equal(metric.median_response_duration_ms, times.duration_ms); assert.equal(metric.filter_version, 'provider-response-v1'); assert.equal(metric.classification, 'TEST');
    const firstResponse = events.find(row => row.event_name === 'provider_first_response')!;
    assert.equal(firstResponse.response_duration_ms, times.duration_ms); assert.equal(firstResponse.response_time_bucket, responseTimeBucket(times.duration_ms)); assert.equal(times.bucket, firstResponse.response_time_bucket); assert.equal(firstResponse.response_bucket_version, 1);

    stage = 'final_cross_journey_cardinalities';
    const [counts] = await client`SELECT
      (SELECT count(*)::int FROM listing_revision_moderation_outbox WHERE event_type='LISTING_PUBLISHED') AS listing_published,
      (SELECT count(*)::int FROM interactions) AS interactions,(SELECT count(*)::int FROM conversations) AS conversations,
      (SELECT count(*)::int FROM messages) AS messages,(SELECT count(*)::int FROM interaction_outbox WHERE event_type='interaction_created') AS interaction_created,
      (SELECT count(*)::int FROM communication_outbox WHERE event_type='message_sent') AS message_sent,
      (SELECT count(*)::int FROM communication_outbox WHERE event_type='provider_first_response') AS provider_first_response,
      (SELECT count(*)::int FROM analytics_events) AS analytics_events,
      (SELECT count(*)::int FROM job_receipts WHERE consumer_name=${ANALYTICS_CONSUMER}) AS analytics_job_receipts,
      (SELECT count(*)::int FROM message_receipts) AS message_recipient_receipts`;
    assert.deepEqual(counts, { listing_published: 1, interactions: 1, conversations: 1, messages: 2, interaction_created: 1, message_sent: 2, provider_first_response: 1, analytics_events: 5, analytics_job_receipts: 5, message_recipient_receipts: 2 });
    console.log(`G2_ACCEPTANCE_RESULT=${JSON.stringify({ status: 'PASS_CANDIDATE', baseline, classification: 'TEST', region: 'Littoral', purpose: 'RENT', verification_policy: 'provider-identity-synthetic-v1', fixed_sample_intake: 'PASS', arbitrary_evidence_denial: 'PASS', encrypted_evidence: 'PASS', scoped_evidence_read: 'PASS', provider_verification: 'VERIFIED', authority: 'CLEAR', media: 'READY_APPROVED', readiness: 'READY', publication: 'PUBLISHED_APPROVED', interaction: 'OPEN', counts, retries: 'PASS', authorization_negatives: { unrelated: 'DENIED', historical_participant: 'DENIED' }, privacy: 'PASS', source_flags: 'UNCHANGED', metric: { N: metric.numerator, D: metric.denominator, rate: metric.response_rate, unanswered: metric.unanswered_mature_contacts, late: metric.late_responded_mature_contacts, median_sample_size: metric.median_sample_size, median_ms: metric.median_response_duration_ms, filter_version: metric.filter_version, bucket: firstResponse.response_time_bucket, bucket_version: 1 } })}`);
  } catch (error) {
    const status = error instanceof IdentityError ? 'BLOCKED' : 'FAIL';
    console.log(`G2_ACCEPTANCE_RESULT=${JSON.stringify({ status, baseline, classification: 'TEST', stage, code: error instanceof IdentityError ? error.code : 'ACCEPTANCE_INVARIANT_FAILED' })}`);
    // Do not let assertion payloads or causes print private evidence/message data.
    throw new Error(`G2 ${status} at ${stage}`);
  } finally {
    await app.close();
    await client`TRUNCATE users, job_receipts RESTART IDENTITY CASCADE`;
    await client.end();
    await rm(mediaRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
