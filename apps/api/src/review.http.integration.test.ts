import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { createDatabase, IdentityStore, OrganizationAssignmentStore, ReviewStore, ViewingAttendanceStore } from '@pachi/database';
import type {
  ReviewCommandResponse, ReviewEligibilityResponse, ReviewErrorResponse, ReviewOwn,
  ReviewPublishedListResponse, ReviewReportResponse, ViewingAttendanceCommandResponse,
  ViewingNoticeListResponse, ViewingResponse,
} from '@pachi/contracts';
import { ReviewController, PublicProviderReviewController, PublicListingReviewController } from './review.controller.js';
import { ViewingController } from './viewing.controller.js';
import { OrganizationOwnerNoStoreGuard } from './organization-owner.controller.js';
import { OrganizationExceptionFilter } from './organization-exception.filter.js';
import { requestIdMiddleware } from './logging.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';

process.env.NODE_ENV = 'test';
const integration = process.env.DATABASE_TEST_URL ? test : test.skip;
const held = 'SYNTHETIC_G3G1_HELD_PRIVATE_FEEDBACK <script>private()</script>';
const reportDetails = 'SYNTHETIC_G3G1_PRIVATE_REPORT_DETAILS';
type Client = ReturnType<typeof createDatabase>['client'];
type Call = (actor: string, path: string, body?: unknown, key?: string | null, raw?: boolean) => Promise<Response>;
type Fixture = {
  client: Client; seekerId: string; providerUserId: string; otherUserId: string; listingId: string;
  interaction: { interaction_id: string; conversation_id: string };
  register: (name: string, userId: string) => Promise<void>;
};
const expected = (v: ViewingResponse) => ({ expected_version: v.version, expected_schedule_version: v.schedule_version });
const responseExpected = (r: ViewingAttendanceCommandResponse) => ({ ...expected(r.viewing), expected_claim_version: r.claim.version });

async function scenario(run: (call: Call, f: Fixture, logs: string[]) => Promise<void>): Promise<void> {
  const url = process.env.DATABASE_TEST_URL!, parsed = new URL(url);
  assert.equal(parsed.hostname, 'localhost'); assert.equal(parsed.port, '5433'); assert.equal(parsed.pathname, '/pachi_test');
  const { client } = createDatabase(url);
  await client`SET client_min_messages TO warning`;
  await client`TRUNCATE users RESTART IDENTITY CASCADE`;
  await client`UPDATE region_publication_controls SET enabled=true`;
  const { viewingFixture } = await import(new URL('../../../packages/database/dist/viewing-fixture.js', import.meta.url).href);
  const fixture = await viewingFixture(client);
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const issuer = 'https://local.test/review-http', tokens: Record<string, string> = {};
  const register = async (name: string, userId: string) => {
    await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES(${userId},${issuer},${name},'LOCAL_TEST')`;
    tokens[name] = await new SignJWT({ client_id: 'account', origin_jti: randomUUID(), jti: randomUUID(), token_use: 'access', scope: 'pachi/account' })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setSubject(name).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  };
  for (const [name, id] of [['seeker', fixture.seekerId], ['provider', fixture.providerUserId], ['other', fixture.otherUserId]] as const)
    await register(name, id);
  const verifier = new CognitoAccessTokenVerifier({ issuer, getKey: async () => publicKey, allowedClientIds: new Set(['account']), requiredScopes: new Set(['pachi/account']), provider: 'LOCAL_TEST' });
  @Module({ controllers: [ReviewController, PublicProviderReviewController, PublicListingReviewController, ViewingController], providers: [
    AuthGuard, OrganizationOwnerNoStoreGuard,
    { provide: 'AUTH_SERVICE', useValue: new AuthService(new IdentityStore(client), verifier) },
    { provide: 'VIEWING_STORE', useValue: new ViewingAttendanceStore(client, true) },
    { provide: 'REVIEW_STORE', useValue: new ReviewStore(client, true) },
  ] })
  class TestApp {}
  const logs: string[] = [], originalLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  const app = await NestFactory.create(TestApp, { logger: false });
  app.use(requestIdMiddleware); app.useGlobalFilters(new OrganizationExceptionFilter(app.getHttpAdapter()));
  app.setGlobalPrefix('v1'); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/v1`;
  try {
    await run(async (actor, path, body, key = randomUUID(), raw = false) => {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { ...(tokens[actor] ? { authorization: `Bearer ${tokens[actor]}` } : {}), 'content-type': 'application/json',
          ...(key ? { 'idempotency-key': key } : {}), 'x-request-id': held },
        ...(body === undefined ? {} : { body: raw ? String(body) : JSON.stringify(body) }) });
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.match(response.headers.get('x-request-id')!, /^[0-9a-f-]{36}$/);
      return response;
    }, { ...fixture, client, register }, logs);
    assert.equal(logs.join('\n').includes(held), false);
    assert.equal(logs.join('\n').includes(reportDetails), false);
    for (const id of [fixture.seekerId, fixture.providerUserId, fixture.listingId])
      assert.equal(logs.join('\n').includes(id), false);
  } finally {
    await app.close(); console.log = originalLog;
    await client`UPDATE region_publication_controls SET enabled=true`;
    await client`TRUNCATE users RESTART IDENTITY CASCADE`; await client.end();
  }
}
async function value<T>(response: Response, status = 201): Promise<T> {
  assert.equal(response.status, status, `Unexpected HTTP status ${response.status}`);
  return response.json() as Promise<T>;
}
async function error(response: Response, status: number, code?: string): Promise<void> {
  assert.equal(response.status, status);
  const body = await response.json() as ReviewErrorResponse;
  assert.deepEqual(Object.keys(body).sort(), ['code', 'message', 'request_id', 'statusCode']);
  assert.equal(body.code, body.message); assert.equal(body.statusCode, status);
  assert.equal(body.request_id, response.headers.get('x-request-id'));
  if (code) assert.equal(body.code, code);
}
// Retained elapsed schedules exercise real F3 confirmation without sleeps or production clock changes.
async function scheduled(call: Call, f: Fixture, interactionId = f.interaction.interaction_id,
  providerUserId = f.providerUserId, reader = 'seeker'): Promise<ViewingResponse> {
  const row = (await f.client<{ id: string }[]>`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,
    proposed_start,proposed_end,display_timezone,response_deadline,created_at,updated_at)
    SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.seeker_user_id,
      statement_timestamp()-interval '3 hours',statement_timestamp()-interval '2 hours','Africa/Douala',
      statement_timestamp()-interval '5 days',statement_timestamp()-interval '7 days',statement_timestamp()-interval '7 days'
    FROM interactions i WHERE i.id=${interactionId} RETURNING id`)[0]!;
  await f.client`UPDATE viewings SET state='ACCEPTED',scheduled_start=proposed_start,scheduled_end=proposed_end,
    private_instructions='SYNTHETIC_PRIVATE_REVIEW_MEETING_GUIDANCE',accepted_by_user_id=${providerUserId},accepted_at=created_at+interval '1 hour',version=version+1 WHERE id=${row.id}`;
  await f.client`UPDATE viewings SET state='SCHEDULED',seeker_confirmed=true,provider_confirmed=true,version=version+1 WHERE id=${row.id}`;
  return value<ViewingResponse>(await call(reader, `/account/viewings/${row.id}`), 200);
}
async function completed(call: Call, f: Fixture, interactionId = f.interaction.interaction_id,
  providerUserId = f.providerUserId, provider = 'provider', seeker = 'seeker') {
  const v = await scheduled(call, f, interactionId, providerUserId, seeker), path = `/account/viewings/${v.id}/attendance`;
  const claim = await value<ViewingAttendanceCommandResponse>(await call(seeker, path + '/completion', expected(v)));
  const completion = await value<ViewingAttendanceCommandResponse>(await call(provider, `${path}/claims/${claim.claim.id}/confirm`, responseExpected(claim)));
  const seekerContext = await value<ReviewEligibilityResponse>(await call(seeker, `/account/viewings/${v.id}/reviews`), 200);
  const providerContext = await value<ReviewEligibilityResponse>(await call(provider, `/account/viewings/${v.id}/reviews`), 200);
  assert.ok(seekerContext.eligibility?.can_submit); assert.ok(providerContext.eligibility?.can_submit);
  return { v: completion.viewing, completion, seekerContext, providerContext };
}
const submitPath = (r: ReviewEligibilityResponse) => `/account/review-eligibilities/${r.eligibility!.id}/submit`;
const input = (r: ReviewEligibilityResponse, rating = 4) => ({ expected_version: r.eligibility!.version, rating, text: held });

void integration('G3-G1 HTTP hides held contents, criteria and reciprocal submission state from every counterparty projection', () => scenario(async (call, f) => {
  const { v, seekerContext, providerContext } = await completed(call, f);
  const submitted = await value<ReviewCommandResponse>(await call('provider', submitPath(providerContext),
    { ...input(providerContext), criteria: { communication: 3, appointment_attendance: 5 } }));
  assert.equal(submitted.review.state, 'SUBMITTED_HELD');
  assert.equal((await value<ReviewOwn>(await call('provider', `/account/reviews/${submitted.review.id}`), 200)).text, held);
  await error(await call('seeker', `/account/reviews/${submitted.review.id}`), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('other', `/account/reviews/${submitted.review.id}`), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('anonymous', `/account/reviews/${submitted.review.id}`), 401, 'AUTH_REQUIRED');
  const after = await value<ReviewEligibilityResponse>(await call('seeker', `/account/viewings/${v.id}/reviews`), 200);
  assert.deepEqual(after, seekerContext);
  assert.deepEqual(Object.keys(after).sort(), ['actor_side', 'eligibility', 'interaction_id', 'own_review', 'viewing_id']);
  const notices = await value<ViewingNoticeListResponse>(await call('seeker', `/account/viewing-notices?viewing_id=${v.id}`), 200);
  assert.equal(notices.items.some(n => n.event_type === 'review_submitted'), false);
  assert.equal(JSON.stringify(notices).includes(held), false);
  const providerPage = await value<ReviewPublishedListResponse>(await call('anonymous', `/providers/${v.provider_account_id}/reviews`), 200);
  const seekerPage = await value<ReviewPublishedListResponse>(await call('provider', `/account/seekers/${f.seekerId}/reviews?interaction_id=${v.interaction_id}`), 200);
  for (const page of [providerPage, seekerPage]) assert.deepEqual(page, { items: [], next_cursor: null, reputation: { count: 0, average: null } });
  await error(await call('seeker', `/account/reviews/${submitted.review.id}/report`, { reason: 'HARASSMENT' }), 404, 'RESOURCE_UNAVAILABLE');
}));

void integration('G3-G1 HTTP reciprocal reveal locks edits, exposes safe reputation and withdrawal removes only its contribution', () => scenario(async (call, f) => {
  const { v, seekerContext, providerContext } = await completed(call, f);
  const first = await value<ReviewCommandResponse>(await call('seeker', submitPath(seekerContext), input(seekerContext)));
  const edited = await value<ReviewCommandResponse>(await call('seeker', `/account/reviews/${first.review.id}/edit`,
    { expected_version: first.review.version, rating: 5, text: 'Useful viewing', criteria: { listing_accuracy: 4 } }));
  assert.equal(edited.review.version, first.review.version + 1);
  const second = await value<ReviewCommandResponse>(await call('provider', submitPath(providerContext), input(providerContext, 3)));
  assert.equal(second.review.state, 'PUBLISHED');
  const own = await value<ReviewOwn>(await call('seeker', `/account/reviews/${first.review.id}`), 200);
  assert.equal(own.state, 'PUBLISHED'); assert.equal(own.can_edit, false);
  await error(await call('seeker', `/account/reviews/${own.id}/edit`, { expected_version: own.version, rating: 1 }), 409, 'REVIEW_UNAVAILABLE');
  const providerPage = await value<ReviewPublishedListResponse>(await call('anonymous', `/providers/${v.provider_account_id}/reviews`), 200);
  assert.deepEqual(providerPage.reputation, { count: 1, average: null }); assert.equal(providerPage.items[0]!.rating, 5);
  assert.equal(providerPage.items[0]!.text, null);
  const scoped = await value<ReviewPublishedListResponse>(await call('seeker', `/account/providers/${v.provider_account_id}/reviews?interaction_id=${v.interaction_id}`), 200);
  assert.equal(scoped.items[0]!.text, 'Useful viewing');
  await error(await call('other', `/account/providers/${v.provider_account_id}/reviews?interaction_id=${v.interaction_id}`), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('seeker', `/account/providers/${randomUUID()}/reviews?interaction_id=${v.interaction_id}`), 404, 'RESOURCE_UNAVAILABLE');
  assert.equal(providerPage.items[0]!.event_label, 'VALIDATED_COMPLETED_VIEWING');
  assert.match(providerPage.items[0]!.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(providerPage.items[0]!).sort(), ['author_display_name', 'author_role', 'criteria', 'date', 'direction', 'event_label', 'id', 'provider_identity_verified', 'rating', 'text']);
  const listingPage = await value<ReviewPublishedListResponse>(await call('anonymous', `/public/listings/${f.listingId}/reviews`), 200);
  assert.deepEqual(listingPage, providerPage);
  await error(await call('other', `/account/seekers/${f.seekerId}/reviews?interaction_id=${v.interaction_id}`), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('provider', `/account/seekers/${f.seekerId}/reviews`), 404, 'RESOURCE_UNAVAILABLE');
  assert.equal((await value<ReviewPublishedListResponse>(await call('seeker', `/account/seekers/${f.seekerId}/reviews`), 200)).reputation.count, 1);
  const withdrawn = await value<ReviewCommandResponse>(await call('seeker', `/account/reviews/${own.id}/withdraw`, { expected_version: own.version }));
  assert.equal(withdrawn.review.state, 'WITHDRAWN');
  assert.equal((await value<ReviewPublishedListResponse>(await call('anonymous', `/providers/${v.provider_account_id}/reviews`), 200)).reputation.count, 0);
  assert.equal((await value<ReviewPublishedListResponse>(await call('seeker', `/account/seekers/${f.seekerId}/reviews`), 200)).reputation.count, 1);
  const consumed = await value<ReviewEligibilityResponse>(await call('seeker', `/account/viewings/${v.id}/reviews`), 200);
  await error(await call('seeker', submitPath(consumed), input(consumed)), 409, 'REVIEW_UNAVAILABLE');
  await f.client`UPDATE listings SET publication_status='ARCHIVED' WHERE id=${f.listingId}`;
  await error(await call('anonymous', `/public/listings/${f.listingId}/reviews`), 404, 'RESOURCE_UNAVAILABLE');
}));

void integration('G3-G1 HTTP identical submit retries persist one review; changed retries, stale eligibility and wrong direction deny', () => scenario(async (call, f) => {
  const { seekerContext, providerContext } = await completed(call, f), key = randomUUID(), body = input(seekerContext);
  await error(await call('seeker', submitPath(seekerContext), { ...body, expected_version: body.expected_version + 1 }), 409, 'STALE_VERSION');
  await error(await call('provider', submitPath(seekerContext), body), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('seeker', submitPath(seekerContext), { ...body, criteria: { appointment_attendance: 4 } }), 400, 'INVALID_INPUT');
  await error(await call('provider', submitPath(providerContext), { ...input(providerContext), criteria: { listing_accuracy: 4 } }), 400, 'INVALID_INPUT');
  const responses = await Promise.all([call('seeker', submitPath(seekerContext), body, key), call('seeker', submitPath(seekerContext), body, key)]);
  const results = await Promise.all(responses.map(r => value<ReviewCommandResponse>(r)));
  assert.equal(results[0]!.review.id, results[1]!.review.id); assert.equal(results.filter(r => r.replayed).length, 1);
  assert.equal((await f.client`SELECT count(*)::int AS n FROM reviews`)[0]!.n, 1);
  await error(await call('seeker', submitPath(seekerContext), { ...body, rating: 1 }, key), 409, 'IDEMPOTENCY_KEY_REUSED');
  await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE user_id=${f.seekerId}`;
  await error(await call('seeker', submitPath(seekerContext), body, key), 401, 'AUTH_REQUIRED');
}));

void integration('G3-G1 HTTP validates strict Unicode content, versions, reports and pagination and redacts parser/request correlation', () => scenario(async (call, f, logs) => {
  const { v, seekerContext } = await completed(call, f), path = submitPath(seekerContext), body = input(seekerContext);
  for (const bad of [{ ...body, rating: 0 }, { ...body, rating: 6 }, { ...body, rating: 2.5 }, { ...body, rating: '3' },
    { ...body, expected_version: '1' }, { ...body, expected_version: 0 }, { ...body, target_id: f.providerUserId },
    { ...body, text: '😀'.repeat(2001) }, { ...body, text: null }, { ...body, criteria: { legal_identity: 5 } },
    { ...body, criteria: { communication: 0 } }, { ...body, criteria: [] }, []])
    await error(await call('seeker', path, bad), 400, 'INVALID_INPUT');
  await error(await call('seeker', path, '{"text":"' + held, randomUUID(), true), 400, 'INVALID_INPUT');
  await error(await call('seeker', path, body, null), 400, 'INVALID_IDEMPOTENCY_KEY');
  await error(await call('seeker', `/account/viewings/${v.id}/reviews?other_slot=true`), 400, 'INVALID_INPUT');
  await error(await call('seeker', `/account/viewings/${randomUUID()}/reviews`), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('anonymous', '/providers/private-identifier/reviews?rating=' + encodeURIComponent(held)), 400, 'INVALID_INPUT');
  await error(await call('seeker', `/account/providers/${v.provider_account_id}/reviews?interaction_id=invalid`), 400, 'INVALID_INPUT');
  await error(await call('seeker', `/account/providers/${v.provider_account_id}/reviews`, '{"text":"' + held, randomUUID(), true), 400, 'INVALID_INPUT');
  for (const query of ['limit=0', 'limit=51', 'limit=1&limit=2', 'cursor=invalid', 'state=SUBMITTED_HELD'])
    await error(await call('anonymous', `/providers/${v.provider_account_id}/reviews?${query}`), 400, 'INVALID_INPUT');
  const accepted = await value<ReviewCommandResponse>(await call('seeker', path, { ...body, text: '😀'.repeat(2000) }));
  assert.equal(Array.from(accepted.review.text!).length, 2000);
  await error(await call('seeker', `/account/reviews/${accepted.review.id}?author_id=${f.seekerId}`), 400, 'INVALID_INPUT');
  for (const report of [{ reason: 'invalid' }, { reason: 'OTHER', details: '😀'.repeat(2001) }, { reason: 'OTHER', reporter_id: f.otherUserId }])
    await error(await call('seeker', `/account/reviews/${accepted.review.id}/report`, report), 400, 'INVALID_INPUT');
  assert.equal(logs.join('\n').includes('private-identifier'), false);
  assert.equal(logs.join('\n').includes('😀'), false);
}));

void integration('G3-G1 HTTP private reports are immutable idempotent intake and do not automatically hide published reviews', () => scenario(async (call, f) => {
  const { v, seekerContext, providerContext } = await completed(call, f);
  const first = await value<ReviewCommandResponse>(await call('seeker', submitPath(seekerContext), input(seekerContext)));
  await value<ReviewCommandResponse>(await call('provider', submitPath(providerContext), input(providerContext)));
  const path = `/account/reviews/${first.review.id}/report`, key = randomUUID(), body = { reason: 'PRIVACY_EXPOSURE', details: reportDetails };
  const r = await value<ReviewReportResponse>(await call('provider', path, body, key));
  assert.equal(r.report.state, 'OPEN'); assert.equal(r.report.review_status, 'PENDING_REVIEW');
  assert.deepEqual(Object.keys(r.report).sort(), ['created_at', 'id', 'review_id', 'review_status', 'state']);
  const replay = await value<ReviewReportResponse>(await call('provider', path, body, key));
  assert.equal(replay.report.id, r.report.id); assert.equal(replay.replayed, true);
  await error(await call('provider', path, { ...body, reason: 'THREATS' }, key), 409, 'IDEMPOTENCY_KEY_REUSED');
  const published = await value<ReviewPublishedListResponse>(await call('anonymous', `/providers/${v.provider_account_id}/reviews`), 200);
  assert.equal(published.reputation.count, 1); assert.equal(published.items[0]!.id, first.review.id);
  assert.equal(JSON.stringify(published).includes(reportDetails), false);
  await assert.rejects(f.client`UPDATE review_reports SET details='changed' WHERE id=${r.report.id}`);
  await error(await call('anonymous', path, body), 401, 'AUTH_REQUIRED');
  await error(await call('other', `/account/reviews/${randomUUID()}/report`, body), 404, 'RESOURCE_UNAVAILABLE');
}));

void integration('G3-G1 HTTP rejects current unverified/restricted submission and preserves author withdrawal privacy', () => scenario(async (call, f) => {
  const { v, seekerContext, providerContext } = await completed(call, f);
  await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${f.providerUserId} AND replaced_at IS NULL`;
  await error(await call('provider', submitPath(providerContext), input(providerContext)), 403, 'CAPABILITY_RESTRICTED');
  await f.client`UPDATE phone_contacts SET replaced_at=NULL WHERE user_id=${f.providerUserId}`;
  const first = await value<ReviewCommandResponse>(await call('seeker', submitPath(seekerContext), input(seekerContext)));
  await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${f.seekerId}`;
  await error(await call('seeker', `/account/reviews/${first.review.id}/edit`, { expected_version: first.review.version, rating: 2 }), 403, 'CAPABILITY_RESTRICTED');
  const withdrawn = await value<ReviewCommandResponse>(await call('seeker', `/account/reviews/${first.review.id}/withdraw`, { expected_version: first.review.version }));
  assert.equal(withdrawn.review.state, 'WITHDRAWN');
  assert.equal((await value<ReviewPublishedListResponse>(await call('anonymous', `/providers/${v.provider_account_id}/reviews`), 200)).reputation.count, 0);
  assert.equal(JSON.stringify(await value<ReviewEligibilityResponse>(await call('provider', `/account/viewings/${v.id}/reviews`), 200)).includes(held), false);
}));

void integration('G3-G1 HTTP historical attendance dispute removes published content immediately while retaining a newer appointment', () => scenario(async (call, f) => {
  const { v, completion, seekerContext, providerContext } = await completed(call, f);
  await value<ReviewCommandResponse>(await call('seeker', submitPath(seekerContext), input(seekerContext)));
  await value<ReviewCommandResponse>(await call('provider', submitPath(providerContext), input(providerContext)));
  const newer = await scheduled(call, f);
  const disputed = await value<ViewingAttendanceCommandResponse>(await call('provider',
    `/account/viewings/${v.id}/attendance/claims/${completion.claim.id}/dispute`, { ...responseExpected(completion), reason: 'OUTCOME_INCORRECT' }));
  assert.equal(disputed.attendance.state, 'DISPUTED');
  assert.equal((await value<ViewingResponse>(await call('seeker', `/account/viewings/${newer.id}`), 200)).state, 'SCHEDULED');
  for (const path of [`/providers/${v.provider_account_id}/reviews`, `/account/seekers/${f.seekerId}/reviews`]) {
    const page = await value<ReviewPublishedListResponse>(await call('seeker', path), 200);
    assert.deepEqual(page.reputation, { count: 0, average: null }); assert.equal(page.items.length, 0);
  }
  const context = await value<ReviewEligibilityResponse>(await call('seeker', `/account/viewings/${v.id}/reviews`), 200);
  assert.equal(context.eligibility!.can_submit, false);
  const next = await value<ReviewEligibilityResponse>(await call('seeker', `/account/viewings/${newer.id}/reviews`), 200);
  assert.equal(next.eligibility, null);
}));

void integration('G3-G1 HTTP organization reassignment never transfers held authorship or permits a replacement principal slot', () => scenario(async (call, f) => {
  const { organizationAssignmentFixture } = await import(new URL('../../../packages/database/dist/organization-assignment-fixture.js', import.meta.url).href);
  const org = await organizationAssignmentFixture(f.client), assignments = new OrganizationAssignmentStore(f.client), resource = org.resource('INTERACTION');
  const assignment = await assignments.assign(org.actors.owner, resource, org.memberships.agent, { ...org.command(), expectedVersion: 0 });
  await f.register('org-seeker', org.actors.unrelated.userId); await f.register('agent', org.actors.agent.userId); await f.register('manager', org.actors.manager.userId);
  const { v, providerContext } = await completed(call, f, resource.resourceId, org.actors.agent.userId, 'agent', 'org-seeker');
  const submitted = await value<ReviewCommandResponse>(await call('agent', submitPath(providerContext), input(providerContext)));
  assert.equal(submitted.review.target_type, 'USER');
  await assignments.revoke(org.actors.owner, resource, assignment.id, { ...org.command(), expectedVersion: assignment.version });
  await assignments.assign(org.actors.owner, resource, org.memberships.manager, { ...org.command(), expectedVersion: 0 });
  await error(await call('agent', `/account/viewings/${v.id}/reviews`), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('agent', `/account/reviews/${submitted.review.id}`), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('manager', `/account/reviews/${submitted.review.id}`), 404, 'RESOURCE_UNAVAILABLE');
  const successor = await value<ReviewEligibilityResponse>(await call('manager', `/account/viewings/${v.id}/reviews`), 200);
  assert.equal(successor.own_review, null); assert.equal(successor.eligibility!.state, 'CONSUMED'); assert.equal(successor.eligibility!.can_submit, false);
  assert.equal(JSON.stringify(successor).includes(held), false);
  await error(await call('manager', submitPath(successor), input(successor)), 409, 'REVIEW_UNAVAILABLE');
  assert.equal((await f.client`SELECT count(*)::int AS n FROM reviews WHERE direction='PROVIDER_TO_SEEKER'`)[0]!.n, 1);
}));
