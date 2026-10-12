import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { createDatabase, IdentityStore, OrganizationAssignmentStore, ViewingAttendanceStore } from '@pachi/database';
import type {
  ViewingResponse, ViewingCreateRequest, ViewingAttendanceCommandResponse, ViewingAttendanceResponse,
  ViewingAttendanceCaseResponse, ViewingNoticeListResponse, ViewingErrorResponse,
} from '@pachi/contracts';
import { ViewingController } from './viewing.controller.js';
import { OrganizationOwnerNoStoreGuard } from './organization-owner.controller.js';
import { OrganizationExceptionFilter } from './organization-exception.filter.js';
import { requestIdMiddleware } from './logging.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';

process.env.NODE_ENV = 'test';
const integration = process.env.DATABASE_TEST_URL ? test : test.skip;
const guidance = 'SYNTHETIC_HTTP_F3_PRIVATE_GUIDANCE: private reception';
type Client = ReturnType<typeof createDatabase>['client'];
type Call = (actor: string, path: string, body?: unknown, key?: string | null, raw?: boolean) => Promise<Response>;
type Fixture = {
  client: Client;
  seekerId: string;
  providerUserId: string;
  otherUserId: string;
  listingId: string;
  interaction: { interaction_id: string; conversation_id: string };
  input: ViewingCreateRequest;
  register: (name: string, userId: string) => Promise<void>;
};
const versions = (v: ViewingResponse) => ({ expected_version: v.version, expected_schedule_version: v.schedule_version });
const responseVersions = (r: ViewingAttendanceCommandResponse) => ({ ...versions(r.viewing), expected_claim_version: r.claim.version });

async function scenario(run: (call: Call, fixture: Fixture) => Promise<void>): Promise<void> {
  const url = process.env.DATABASE_TEST_URL!, parsed = new URL(url);
  assert.equal(parsed.hostname, 'localhost');
  assert.equal(parsed.port, '5433');
  assert.equal(parsed.pathname, '/pachi_test');
  const { client } = createDatabase(url);
  await client`SET client_min_messages TO warning`;
  await client`TRUNCATE users RESTART IDENTITY CASCADE`;
  await client`UPDATE region_publication_controls SET enabled=true`;
  const { viewingFixture } = await import(new URL('../../../packages/database/dist/viewing-fixture.js', import.meta.url).href);
  const fixture = await viewingFixture(client);
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const issuer = 'https://local.test/viewing-attendance-http', tokens: Record<string, string> = {};
  const register = async (name: string, userId: string) => {
    await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES(${userId},${issuer},${name},'LOCAL_TEST')`;
    tokens[name] = await new SignJWT({ client_id: 'account', origin_jti: randomUUID(), jti: randomUUID(), token_use: 'access', scope: 'pachi/account' })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setSubject(name).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  };
  for (const [name, userId] of [['seeker', fixture.seekerId], ['provider', fixture.providerUserId], ['other', fixture.otherUserId]] as const)
    await register(name, userId);
  const verifier = new CognitoAccessTokenVerifier({ issuer, getKey: async () => publicKey, allowedClientIds: new Set(['account']), requiredScopes: new Set(['pachi/account']), provider: 'LOCAL_TEST' });
  @Module({ controllers: [ViewingController], providers: [
    AuthGuard, OrganizationOwnerNoStoreGuard,
    { provide: 'AUTH_SERVICE', useValue: new AuthService(new IdentityStore(client), verifier) },
    { provide: 'VIEWING_STORE', useValue: new ViewingAttendanceStore(client, true) },
  ] })
  class TestApp {}
  const app = await NestFactory.create(TestApp, { logger: false });
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new OrganizationExceptionFilter(app.getHttpAdapter()));
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/v1/account`;
  try {
    await run(async (actor, path, body, key = randomUUID(), raw = false) => {
      const response = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(tokens[actor] ? { authorization: `Bearer ${tokens[actor]}` } : {}), 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
        ...(body === undefined ? {} : { body: raw ? String(body) : JSON.stringify(body) }),
      });
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      return response;
    }, { ...fixture, client, register });
  } finally {
    await app.close();
    await client`UPDATE region_publication_controls SET enabled=true`;
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
}

async function value<T>(response: Response, status = 201): Promise<T> {
  assert.equal(response.status, status, `Unexpected HTTP status ${response.status}`);
  return response.json() as Promise<T>;
}
async function error(response: Response, status: number, code?: string): Promise<void> {
  assert.equal(response.status, status);
  const body = await response.json() as ViewingErrorResponse;
  assert.deepEqual(Object.keys(body).sort(), ['code', 'message', 'request_id', 'statusCode']);
  assert.equal(body.statusCode, status);
  assert.equal(body.code, body.message);
  assert.equal(body.request_id, response.headers.get('x-request-id'));
  assert.match(body.request_id, /^[0-9a-f-]{36}$/);
  if (code) assert.equal(body.code, code);
}

// Backdated retained transitions represent elapsed appointments without sleeping,
// weakening a guard, modifying a production clock or touching development data.
async function scheduled(call: Call, f: Fixture, startMinutes = -120, endMinutes = -60,
  interactionId = f.interaction.interaction_id, providerActor = f.providerUserId, actor = 'seeker'): Promise<ViewingResponse> {
  const row = (await f.client<{ id: string }[]>`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,
    proposed_start,proposed_end,display_timezone,response_deadline,created_at,updated_at)
    SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.seeker_user_id,
      statement_timestamp()+${startMinutes}*interval '1 minute',statement_timestamp()+${endMinutes}*interval '1 minute','Africa/Douala',
      statement_timestamp()+${startMinutes}*interval '1 minute',statement_timestamp()-interval '30 hours',statement_timestamp()-interval '30 hours'
    FROM interactions i WHERE i.id=${interactionId} RETURNING id`)[0]!;
  await f.client`UPDATE viewings SET state='ACCEPTED',scheduled_start=proposed_start,scheduled_end=proposed_end,private_instructions=${guidance},
    accepted_by_user_id=${providerActor},accepted_at=created_at+interval '1 hour',version=version+1,updated_at=created_at+interval '1 hour' WHERE id=${row.id}`;
  await f.client`UPDATE viewings SET state='SCHEDULED',seeker_confirmed=true,provider_confirmed=true,version=version+1,
    updated_at=created_at+interval '2 hours' WHERE id=${row.id}`;
  return value<ViewingResponse>(await call(actor, `/viewings/${row.id}`), 200);
}
async function effects(f: Fixture) {
  return (await f.client`SELECT (SELECT count(*)::int FROM viewing_attendance_claims) AS claims,
    (SELECT count(*)::int FROM viewing_review_eligibilities) AS eligibility,
    (SELECT count(*)::int FROM viewing_no_show_events WHERE invalidated_at IS NULL) AS no_shows`)[0]!;
}

void integration('G3-F3 HTTP completion requires counterparty confirmation, creates eligibility once and holds it on a later dispute', () => scenario(async (call, f) => {
  const v = await scheduled(call, f), path = `/viewings/${v.id}/attendance`;
  const r = await value<ViewingAttendanceCommandResponse>(await call('seeker', path + '/completion', versions(v)));
  assert.equal(r.claim.claimant_user_id, f.seekerId);
  assert.equal(r.claim.claimant_side, 'SEEKER');
  assert.equal(r.claim.claim_type, 'COMPLETION');
  assert.equal(r.claim.state, 'PENDING');
  assert.equal(r.attendance.state, 'AWAITING_VALIDATION');
  assert.equal(r.viewing.state, 'SCHEDULED');
  assert.equal(r.attendance.outcome, null);
  assert.equal(r.attendance.review_eligibility_created, false);
  assert.equal(Date.parse(r.claim.response_deadline) - Date.parse(r.claim.notice_available_at), 48 * 3600000);
  assert.deepEqual(await effects(f), { claims: 1, eligibility: 0, no_shows: 0 });
  await error(await call('seeker', `${path}/claims/${r.claim.id}/confirm`, responseVersions(r)), 403, 'SELF_CONFIRMATION_DENIED');
  const other = await value<ViewingAttendanceResponse>(await call('provider', path), 200);
  assert.equal(other.claims[0]!.can_confirm, true);
  const key = randomUUID(), input = responseVersions(r);
  const confirmed = await value<ViewingAttendanceCommandResponse>(await call('provider', `${path}/claims/${r.claim.id}/confirm`, input, key));
  assert.equal(confirmed.viewing.state, 'COMPLETED');
  assert.equal(confirmed.claim.state, 'CONFIRMED');
  assert.equal(confirmed.attendance.review_eligibility_created, true);
  assert.deepEqual(await effects(f), { claims: 1, eligibility: 2, no_shows: 0 });
  assert.equal((await value<ViewingAttendanceCommandResponse>(await call('provider', `${path}/claims/${r.claim.id}/confirm`, input, key))).replayed, true);
  assert.deepEqual(await effects(f), { claims: 1, eligibility: 2, no_shows: 0 });
  const notices = await value<ViewingNoticeListResponse>(await call('provider', `/viewing-notices?viewing_id=${v.id}`), 200);
  assert.ok(notices.items.length > 0);
  assert.equal(JSON.stringify(notices).includes(guidance), false);
  assert.equal(JSON.stringify(notices).includes(v.scheduled_start!), false);
  assert.equal(notices.items.every(n => n.inbox_state === 'AVAILABLE' && n.external_state === 'NOT_ENABLED'), true);
  await error(await call('other', `/viewing-notices?viewing_id=${v.id}`), 404, 'RESOURCE_UNAVAILABLE');
  const disputed = await value<ViewingAttendanceCommandResponse>(await call('provider', `${path}/claims/${r.claim.id}/dispute`, {
    ...responseVersions(confirmed), reason: 'OUTCOME_INCORRECT',
  }));
  assert.equal(disputed.viewing.state, 'DISPUTED');
  assert.equal(disputed.attendance.review_eligibility_created, false);
  const eligibility = await f.client`SELECT state FROM viewing_review_eligibilities WHERE viewing_id=${v.id}`;
  assert.equal(eligibility.length, 2);
  assert.equal(eligibility.every(row => row.state === 'HELD'), true);
  const replay = await value<ViewingAttendanceCommandResponse>(await call('provider', `${path}/claims/${r.claim.id}/confirm`, input, key));
  assert.equal(replay.replayed, true);
  assert.equal(replay.attendance.state, 'DISPUTED');
  assert.equal(replay.viewing.private_instructions, null);
}));

void integration('G3-F3 HTTP denies premature claims and validates no-show without normal review eligibility', () => scenario(async (call, f) => {
  const v = await scheduled(call, f, -10, 50), path = `/viewings/${v.id}/attendance`;
  await error(await call('seeker', path + '/completion', versions(v)), 409, 'CLAIM_TOO_EARLY');
  await error(await call('provider', path + '/no-show', { ...versions(v), absent_side: 'SEEKER' }), 409, 'CLAIM_TOO_EARLY');
  assert.deepEqual(await effects(f), { claims: 0, eligibility: 0, no_shows: 0 });
  await f.client`UPDATE interactions SET state='CLOSED',closed_at=statement_timestamp() WHERE id=${v.interaction_id}`;
  const otherInteraction = (await f.client<{ id: string }[]>`INSERT INTO interactions(listing_id,seeker_user_id,provider_account_id,state,initial_channel)
    SELECT listing_id,seeker_user_id,provider_account_id,'OPEN','MESSAGE' FROM interactions WHERE id=${v.interaction_id} RETURNING id`)[0]!;
  await f.client`INSERT INTO conversations(interaction_id) VALUES(${otherInteraction.id})`;
  // Each retained episode has its own active appointment; scope uses the same immutable participants.
  const old = await scheduled(call, f, -31, 29, otherInteraction.id), oldPath = `/viewings/${old.id}/attendance`;
  const r = await value<ViewingAttendanceCommandResponse>(await call('provider', oldPath + '/no-show', { ...versions(old), absent_side: 'SEEKER' }));
  assert.equal(r.attendance.state, 'AWAITING_VALIDATION');
  assert.equal(r.claim.claimed_outcome, 'SEEKER_NO_SHOW');
  assert.equal(r.claim.claimant_user_id, f.providerUserId);
  assert.equal((await effects(f)).no_shows, 0);
  const confirmed = await value<ViewingAttendanceCommandResponse>(await call('seeker', `${oldPath}/claims/${r.claim.id}/confirm`, responseVersions(r)));
  assert.equal(confirmed.viewing.state, 'SEEKER_NO_SHOW');
  assert.equal(confirmed.attendance.review_eligibility_created, false);
  assert.deepEqual(await effects(f), { claims: 1, eligibility: 0, no_shows: 1 });
}));

void integration('G3-F3 HTTP enforces strict attendance DTOs, opaque evidence, current authentication and neutral resource scope', () => scenario(async (call, f) => {
  const v = await scheduled(call, f), path = `/viewings/${v.id}/attendance`, input = versions(v);
  for (const route of [path, path + '/case']) {
    await error(await call('anonymous', route), 401, 'AUTH_REQUIRED');
    await error(await call('other', route), 404, 'RESOURCE_UNAVAILABLE');
  }
  await error(await call('other', path + '/completion', input), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('anonymous', path + '/completion', input), 401, 'AUTH_REQUIRED');
  await error(await call('seeker', '/viewings/invalid/attendance'), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('seeker', path + '/completion', '{malformed', randomUUID(), true), 400, 'INVALID_INPUT');
  for (const body of [{ ...input, claimant_user_id: f.providerUserId }, { ...input, expected_version: '3' }, { ...input, expected_schedule_version: 0 }, []])
    await error(await call('seeker', path + '/completion', body), 400, 'INVALID_INPUT');
  await error(await call('seeker', path + '/completion', input, null), 400, 'INVALID_IDEMPOTENCY_KEY');
  await error(await call('seeker', path + '/no-show', { ...input, absent_side: 'OTHER' }), 400, 'INVALID_INPUT');
  await error(await call('seeker', path + '/no-show', { ...input, absent_side: ['PROVIDER'] }), 400, 'INVALID_INPUT');
  for (const query of ['limit=0', 'limit=51', 'cursor=invalid', 'provider_account_id=anything'])
    await error(await call('seeker', `${path}?${query}`), 400, 'INVALID_INPUT');
  await error(await call('seeker', path + '/case?case_id=' + randomUUID()), 400, 'INVALID_INPUT');
  const r = await value<ViewingAttendanceCommandResponse>(await call('seeker', path + '/completion', input));
  const dispute = { ...responseVersions(r), reason: 'OUTCOME_INCORRECT' };
  for (const body of [{ ...dispute, reason: 'private free text' }, { ...dispute, reason: ['OTHER'] }, { ...dispute, evidence: [{ reference: 'https://private.invalid/address', kind: 'MESSAGE' }] },
    { ...dispute, evidence: [{ reference: randomUUID(), kind: 'DOCUMENT' }] }, { ...dispute, evidence: [{ reference: randomUUID(), kind: 'MESSAGE', note: guidance }] },
    { ...dispute, evidence: Array.from({ length: 6 }, () => ({ reference: randomUUID(), kind: 'MESSAGE' })) }])
    await error(await call('provider', `${path}/claims/${r.claim.id}/dispute`, body), 400, 'INVALID_INPUT');
  await error(await call('provider', `${path}/claims/${randomUUID()}/confirm`, responseVersions(r)), 404, 'RESOURCE_UNAVAILABLE');
  const foreignInteraction = (await f.client<{ id: string }[]>`INSERT INTO interactions(listing_id,seeker_user_id,provider_account_id,state,initial_channel)
    VALUES(${v.listing_id},${f.otherUserId},${v.provider_account_id},'OPEN','MESSAGE') RETURNING id`)[0]!;
  const foreignConversation = (await f.client<{ id: string }[]>`INSERT INTO conversations(interaction_id) VALUES(${foreignInteraction.id}) RETURNING id`)[0]!;
  const foreignViewing = await scheduled(call, f, -120, -60, foreignInteraction.id, f.providerUserId, 'other');
  const foreignClaim = await value<ViewingAttendanceCommandResponse>(await call('provider', `/viewings/${foreignViewing.id}/attendance/completion`, versions(foreignViewing)));
  await error(await call('provider', `${path}/claims/${foreignClaim.claim.id}/confirm`, responseVersions(r)), 404, 'RESOURCE_UNAVAILABLE');
  const foreignMessage = (await f.client<{ id: string }[]>`INSERT INTO messages(conversation_id,sender_user_id,sender_side,client_message_id,body)
    VALUES(${foreignConversation.id},${f.otherUserId},'SEEKER',${randomUUID()},${guidance}) RETURNING id`)[0]!;
  await error(await call('provider', `${path}/claims/${r.claim.id}/dispute`, { ...dispute,
    evidence: [{ reference: foreignMessage.id, kind: 'MESSAGE' }] }), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('provider', `${path}/claims/${r.claim.id}/dispute`, { ...dispute,
    evidence: [{ reference: foreignMessage.id, kind: 'MESSAGE' }, { reference: foreignMessage.id, kind: 'MESSAGE' }] }), 400, 'INVALID_INPUT');
  await error(await call('provider', `${path}/claims/${r.claim.id}/confirm`, { ...responseVersions(r), expected_claim_version: 2 }), 409, 'STALE_CLAIM_VERSION');
  await error(await call('provider', `${path}/claims/${r.claim.id}/confirm`, { ...responseVersions(r), expected_schedule_version: 2 }), 409, 'STALE_SCHEDULE_VERSION');
  await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE user_id=${f.providerUserId}`;
  await error(await call('provider', `${path}/claims/${r.claim.id}/confirm`, responseVersions(r)), 401, 'AUTH_REQUIRED');
}));

void integration('G3-F3 HTTP competing claims preserve exact history, freeze eligibility and expose only pending moderation status', () => scenario(async (call, f) => {
  const v = await scheduled(call, f), path = `/viewings/${v.id}/attendance`;
  const first = await value<ViewingAttendanceCommandResponse>(await call('provider', path + '/no-show', { ...versions(v), absent_side: 'SEEKER' }));
  const r = await value<ViewingAttendanceCommandResponse>(await call('seeker', path + '/completion', versions(first.viewing)));
  assert.equal(r.viewing.state, 'DISPUTED');
  assert.equal(r.attendance.state, 'DISPUTED');
  assert.equal(r.attendance.outcome, null);
  assert.equal(r.attendance.claims.length, 2);
  assert.equal(r.attendance.claims.every(c => !c.can_confirm), true);
  assert.deepEqual(await effects(f), { claims: 2, eligibility: 0, no_shows: 0 });
  const status = await value<ViewingAttendanceCaseResponse>(await call('provider', path + '/case'), 200);
  assert.equal(status.case!.state, 'OPEN');
  assert.equal(status.case!.review_status, 'PENDING_REVIEW');
  assert.deepEqual(Object.keys(status.case!).sort(), ['id', 'opened_at', 'review_status', 'state']);
  assert.equal(JSON.stringify(status).includes(guidance), false);
  const page = await value<ViewingAttendanceResponse>(await call('seeker', path + '?limit=1'), 200);
  assert.equal(page.claims.length, 1);
  assert.ok(page.next_cursor);
  const second = await value<ViewingAttendanceResponse>(await call('seeker', path + '?limit=1&cursor=' + page.next_cursor), 200);
  assert.equal(second.claims.length, 1);
  assert.notEqual(second.claims[0]!.id, page.claims[0]!.id);
}));

void integration('G3-F3 HTTP concurrent identical retries persist one claim and reject changed retry semantics', () => scenario(async (call, f) => {
  const v = await scheduled(call, f), path = `/viewings/${v.id}/attendance`, key = randomUUID(), input = versions(v);
  const responses = await Promise.all([call('seeker', path + '/completion', input, key), call('seeker', path + '/completion', input, key)]);
  const results = await Promise.all(responses.map(r => value<ViewingAttendanceCommandResponse>(r)));
  assert.equal(results[0]!.claim.id, results[1]!.claim.id);
  assert.equal(results.filter(r => r.replayed).length, 1);
  assert.deepEqual(await effects(f), { claims: 1, eligibility: 0, no_shows: 0 });
  await error(await call('seeker', path + '/completion', { ...input, expected_version: input.expected_version + 1 }, key), 409, 'IDEMPOTENCY_KEY_REUSED');
  await error(await call('seeker', path + '/no-show', { ...input, absent_side: 'PROVIDER' }, key), 409, 'IDEMPOTENCY_KEY_REUSED');
  await error(await call('provider', path + '/completion', input), 409, 'STALE_VERSION');
  const current = results[0]!;
  await error(await call('seeker', `/viewings/${v.id}/cancel`, { ...versions(current.viewing), reason: 'SAFETY' }), 409, 'ATTENDANCE_PENDING');
  const changed = new Date(Date.parse(v.scheduled_start!) + 86400000).toISOString();
  await error(await call('provider', `/viewings/${v.id}/reschedules`, { ...versions(current.viewing), proposed_start: changed,
    proposed_end: new Date(Date.parse(changed) + 3600000).toISOString() }), 409, 'ATTENDANCE_PENDING');
}));

void integration('G3-F3 HTTP blocked restricted participants retain safe reporting and private evidence references while confirmation stays denied', () => scenario(async (call, f) => {
  const v = await scheduled(call, f), path = `/viewings/${v.id}/attendance`;
  const r = await value<ViewingAttendanceCommandResponse>(await call('seeker', path + '/completion', versions(v)));
  const message = (await f.client<{ id: string }[]>`INSERT INTO messages(conversation_id,sender_user_id,sender_side,client_message_id,body)
    VALUES(${f.interaction.conversation_id},${f.seekerId},'SEEKER',${randomUUID()},${guidance}) RETURNING id`)[0]!;
  await f.client`INSERT INTO block_relationships(blocker_user_id,blocked_provider_account_id) VALUES(${f.seekerId},${v.provider_account_id})`;
  await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${f.providerUserId}`;
  await f.client`UPDATE interactions SET state='RESTRICTED' WHERE id=${v.interaction_id}`;
  await error(await call('provider', `${path}/claims/${r.claim.id}/confirm`, responseVersions(r)), 403, 'CAPABILITY_RESTRICTED');
  await error(await call('provider', path + '/completion', versions(r.viewing)), 403, 'CAPABILITY_RESTRICTED');
  await error(await call('provider', `${path}/claims/${r.claim.id}/dispute`, { ...responseVersions(r), reason: 'SAFETY', evidence: [{ reference: randomUUID(), kind: 'MESSAGE' }] }), 404, 'RESOURCE_UNAVAILABLE');
  const disputed = await value<ViewingAttendanceCommandResponse>(await call('provider', `${path}/claims/${r.claim.id}/dispute`, {
    ...responseVersions(r), reason: 'SAFETY', evidence: [{ reference: message.id, kind: 'MESSAGE' }],
  }));
  assert.equal(disputed.viewing.state, 'DISPUTED');
  assert.equal(disputed.viewing.private_instructions, null);
  assert.equal(JSON.stringify(disputed.attendance).includes(message.id), false);
  assert.equal(JSON.stringify(disputed.attendance).includes(guidance), false);
  assert.deepEqual(await effects(f), { claims: 1, eligibility: 0, no_shows: 0 });
  await f.client`UPDATE listings SET market_status='RENTED' WHERE id=${f.listingId}`;
  const history = await value<ViewingAttendanceResponse>(await call('seeker', path), 200);
  assert.equal(history.state, 'DISPUTED');
  assert.equal(history.case!.review_status, 'PENDING_REVIEW');
}));

void integration('G3-F3 HTTP late no-show dispute invalidates the validated operational event without creating a star-review slot', () => scenario(async (call, f) => {
  const v = await scheduled(call, f), path = `/viewings/${v.id}/attendance`;
  const r = await value<ViewingAttendanceCommandResponse>(await call('provider', path + '/no-show', { ...versions(v), absent_side: 'SEEKER' }));
  const confirmed = await value<ViewingAttendanceCommandResponse>(await call('seeker', `${path}/claims/${r.claim.id}/confirm`, responseVersions(r)));
  const disputed = await value<ViewingAttendanceCommandResponse>(await call('seeker', `${path}/claims/${r.claim.id}/dispute`, { ...responseVersions(confirmed), reason: 'OUTCOME_INCORRECT' }));
  assert.equal(disputed.viewing.state, 'DISPUTED');
  assert.equal(disputed.attendance.state, 'DISPUTED');
  assert.deepEqual(await effects(f), { claims: 1, eligibility: 0, no_shows: 0 });
  assert.equal((await f.client`SELECT count(*)::int AS count FROM viewing_no_show_events WHERE invalidated_at IS NOT NULL`)[0]!.count, 1);
}));

void integration('G3-F3 HTTP revoked organization assignment removes attendance and case access even for retained historical participants', () => scenario(async (call, f) => {
  const { organizationAssignmentFixture } = await import(new URL('../../../packages/database/dist/organization-assignment-fixture.js', import.meta.url).href);
  const org = await organizationAssignmentFixture(f.client), assignments = new OrganizationAssignmentStore(f.client);
  const resource = org.resource('INTERACTION');
  const assigned = await assignments.assign(org.actors.owner, resource, org.memberships.agent, { ...org.command(), expectedVersion: 0 });
  await f.register('agent', org.actors.agent.userId);
  const v = await scheduled(call, f, -120, -60, resource.resourceId, org.actors.agent.userId, 'agent'), path = `/viewings/${v.id}/attendance`;
  const current = await value<ViewingAttendanceResponse>(await call('agent', path), 200);
  assert.equal(current.actor_side, 'PROVIDER');
  await assignments.revoke(org.actors.owner, resource, assigned.id, { ...org.command(), expectedVersion: assigned.version });
  await assignments.assign(org.actors.owner, org.resource('LISTING'), org.memberships.agent, { ...org.command(), expectedVersion: 0 });
  await error(await call('agent', path), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('agent', path + '/case'), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('agent', path + '/completion', versions(v)), 404, 'RESOURCE_UNAVAILABLE');
}));

void integration('G3-F3 HTTP advertisement closure and region suppression retain elapsed attendance validation while new appointments remain denied', () => scenario(async (call, f) => {
  const v = await scheduled(call, f), path = `/viewings/${v.id}/attendance`;
  await f.client`UPDATE listings SET publication_status='ARCHIVED',market_status='RENTED',
    last_confirmed_at=statement_timestamp()-interval '31 days',expires_at=statement_timestamp()-interval '1 day' WHERE id=${f.listingId}`;
  await f.client`UPDATE region_publication_controls SET enabled=false WHERE region='Littoral'`;
  const state = await value<ViewingAttendanceResponse>(await call('seeker', path), 200);
  assert.equal(state.can_claim_completion, true);
  const claim = await value<ViewingAttendanceCommandResponse>(await call('seeker', path + '/completion', versions(v)));
  assert.equal(claim.attendance.state, 'AWAITING_VALIDATION');
  assert.equal(claim.viewing.private_instructions, null);
  const pending = await value<ViewingAttendanceResponse>(await call('provider', path), 200);
  assert.equal(pending.claims[0]!.id, claim.claim.id);
  assert.equal(pending.claims[0]!.can_confirm, true);
  const confirmed = await value<ViewingAttendanceCommandResponse>(await call('provider', `${path}/claims/${claim.claim.id}/confirm`, responseVersions(claim)));
  assert.equal(confirmed.attendance.state, 'COMPLETED');
  assert.equal(confirmed.attendance.review_eligibility_created, true);
  assert.equal(confirmed.viewing.private_instructions, null);
  await error(await call('seeker', `/interactions/${v.interaction_id}/viewings`, f.input), 403, 'CAPABILITY_RESTRICTED');
  const history = await value<ViewingAttendanceResponse>(await call('seeker', path), 200);
  assert.equal(history.claims.length, 1);
  assert.equal(history.claims[0]!.id, claim.claim.id);
  assert.equal(history.claims[0]!.state, 'CONFIRMED');
  assert.equal(history.outcome, 'COMPLETED');
  assert.deepEqual(await effects(f), { claims: 1, eligibility: 2, no_shows: 0 });
}));
