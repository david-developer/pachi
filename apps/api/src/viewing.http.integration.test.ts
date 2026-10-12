import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { createDatabase, IdentityStore, ViewingStore } from '@pachi/database';
import type { ViewingCommandResponse, ViewingCreateRequest, ViewingErrorResponse, ViewingListResponse, ViewingResponse } from '@pachi/contracts';
import { ViewingController } from './viewing.controller.js';
import { OrganizationOwnerNoStoreGuard } from './organization-owner.controller.js';
import { OrganizationExceptionFilter } from './organization-exception.filter.js';
import { requestIdMiddleware } from './logging.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';

process.env.NODE_ENV = 'test';
const integration = process.env.DATABASE_TEST_URL ? test : test.skip;
type Client = ReturnType<typeof createDatabase>['client'];
type Fixture = {
  client: Client;
  seekerId: string;
  providerUserId: string;
  listingId: string;
  interaction: { interaction_id: string };
  input: ViewingCreateRequest;
};
type Call = (actor: string, path: string, body?: unknown, key?: string | null, raw?: boolean) => Promise<Response>;
const versions = (v: ViewingResponse) => ({ expected_version: v.version, expected_schedule_version: v.schedule_version });

async function scenario(run: (call: Call, f: Fixture) => Promise<void>): Promise<void> {
  const url = process.env.DATABASE_TEST_URL!, parsed = new URL(url);
  assert.equal(parsed.hostname, 'localhost');
  assert.equal(parsed.port, '5433');
  assert.equal(parsed.pathname, '/pachi_test');
  const { client } = createDatabase(url);
  await client`SET client_min_messages TO warning`;
  await client`TRUNCATE users RESTART IDENTITY CASCADE`;
  await client`UPDATE region_publication_controls SET enabled=true`;
  const { viewingFixture } = await import(new URL('../../../packages/database/dist/viewing-fixture.js', import.meta.url).href);
  const f = await viewingFixture(client);
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const issuer = 'https://local.test/viewing-http';
  const tokens: Record<string, string> = {};
  for (const [name, userId] of [['seeker', f.seekerId], ['provider', f.providerUserId], ['other', f.otherUserId]] as const) {
    await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES(${userId},${issuer},${name},'LOCAL_TEST')`;
    tokens[name] = await new SignJWT({ client_id: 'account', origin_jti: randomUUID(), jti: randomUUID(), token_use: 'access', scope: 'pachi/account' })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setSubject(name).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  }
  const verifier = new CognitoAccessTokenVerifier({ issuer, getKey: async () => publicKey, allowedClientIds: new Set(['account']), requiredScopes: new Set(['pachi/account']), provider: 'LOCAL_TEST' });
  @Module({ controllers: [ViewingController], providers: [
    AuthGuard, OrganizationOwnerNoStoreGuard,
    { provide: 'AUTH_SERVICE', useValue: new AuthService(new IdentityStore(client), verifier) },
    { provide: 'VIEWING_STORE', useValue: new ViewingStore(client, true) },
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
    }, { ...f, client });
  } finally {
    await app.close();
    await client`UPDATE region_publication_controls SET enabled=true`;
    await client.end();
  }
}
async function error(response: Response, status: number, category?: string): Promise<void> {
  assert.equal(response.status, status);
  const value = await response.json() as ViewingErrorResponse;
  assert.equal(value.statusCode, status);
  assert.equal(value.code, value.message);
  assert.equal(value.request_id, response.headers.get('x-request-id'));
  assert.match(value.request_id, /^[0-9a-f-]{36}$/);
  if (category) assert.equal(value.code, category);
  assert.deepEqual(Object.keys(value).sort(), ['code', 'message', 'request_id', 'statusCode']);
}
async function command(response: Response): Promise<ViewingCommandResponse> {
  assert.equal(response.status, 201);
  return response.json() as Promise<ViewingCommandResponse>;
}

void integration('G3-F1 HTTP validates authentication, neutral scope, strict commands, future UTC ranges and IANA timezone', () => scenario(async (call, f) => {
  const path = `/interactions/${f.interaction.interaction_id}/viewings`;
  await error(await call('anonymous', '/viewings'), 401, 'AUTH_REQUIRED');
  await error(await call('other', path, f.input), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('seeker', `/viewings/${randomUUID()}`), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('seeker', '/viewings/invalid'), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('seeker', path, '{ malformed', randomUUID(), true), 400, 'INVALID_INPUT');
  for (const input of [{ ...f.input, provider_account_id: randomUUID() }, { ...f.input, display_timezone: 'Invalid/Timezone' }, { ...f.input, display_timezone: 'africa/douala' }, { ...f.input, proposed_start: '2026-02-30T12:00:00Z' }, { ...f.input, proposed_start: '2000-01-01T12:00:00Z' }, { ...f.input, proposed_end: f.input.proposed_start }, { ...f.input, proposed_start: '2030-01-01T12:00:00' }, []])
    await error(await call('seeker', path, input), 400, 'INVALID_INPUT');
  await error(await call('seeker', path, f.input, null), 400, 'INVALID_IDEMPOTENCY_KEY');
  await error(await call('seeker', path, f.input, 'invalid'), 400, 'INVALID_IDEMPOTENCY_KEY');
  for (const query of ['limit=0', 'limit=51', 'cursor=invalid', 'extra=true', 'interaction_id=invalid'])
    await error(await call('seeker', `/viewings?${query}`), 400, 'INVALID_INPUT');
  await f.client`UPDATE phone_contacts SET verified_at=NULL WHERE user_id=${f.seekerId}`;
  await error(await call('seeker', path, f.input), 403);
}));

void integration('G3-F1 HTTP persists one request, requires both confirmations and reveals private instructions only while scheduled', () => scenario(async (call, f) => {
  const requestPath = `/interactions/${f.interaction.interaction_id}/viewings`, key = randomUUID();
  const initial = await command(await call('seeker', requestPath, f.input, key));
  assert.equal(initial.viewing.state, 'REQUESTED');
  assert.equal(initial.viewing.display_timezone, 'Africa/Douala');
  assert.equal(initial.viewing.private_instructions, null);
  assert.equal(initial.replayed, false);
  const replay = await command(await call('seeker', requestPath, f.input, key));
  assert.equal(replay.viewing.id, initial.viewing.id);
  assert.equal(replay.replayed, true);
  await error(await call('seeker', requestPath, { ...f.input, display_timezone: 'UTC' }, key), 409, 'IDEMPOTENCY_KEY_REUSED');
  await error(await call('seeker', requestPath, f.input), 409, 'ACTIVE_VIEWING_EXISTS');
  const path = `/viewings/${initial.viewing.id}`;
  await error(await call('other', path), 404, 'RESOURCE_UNAVAILABLE');
  await error(await call('other', `${path}/accept`, { ...versions(initial.viewing), scheduled_start: f.input.proposed_start, scheduled_end: f.input.proposed_end, private_instructions: 'Safe private meeting guidance' }), 404, 'RESOURCE_UNAVAILABLE');
  const incoming = await (await call('provider', '/viewings')).json() as ViewingListResponse;
  assert.equal(incoming.items.length, 1);
  assert.equal(incoming.can_request, null);
  assert.equal(incoming.items[0]!.private_instructions, null);
  const acceptance = { ...versions(initial.viewing), scheduled_start: f.input.proposed_start, scheduled_end: f.input.proposed_end, private_instructions: 'Meet inside the staffed reception at the private entrance.' };
  const acceptKey = randomUUID();
  const accepted = await command(await call('provider', `${path}/accept`, acceptance, acceptKey));
  assert.equal(accepted.viewing.state, 'ACCEPTED');
  assert.equal(accepted.viewing.seeker_confirmed, false);
  assert.equal(accepted.viewing.provider_confirmed, false);
  assert.equal(accepted.viewing.private_instructions, null);
  assert.equal((await command(await call('provider', `${path}/accept`, acceptance, acceptKey))).replayed, true);
  await error(await call('provider', `${path}/confirm`, versions(initial.viewing)), 409, 'STALE_VERSION');
  await error(await call('provider', `${path}/confirm`, { ...versions(accepted.viewing), expected_schedule_version: accepted.viewing.schedule_version + 1 }), 409, 'STALE_SCHEDULE_VERSION');
  const providerConfirmed = await command(await call('provider', `${path}/confirm`, versions(accepted.viewing)));
  assert.equal(providerConfirmed.viewing.state, 'ACCEPTED');
  assert.equal(providerConfirmed.viewing.provider_confirmed, true);
  assert.equal(providerConfirmed.viewing.private_instructions, null);
  const seekerBefore = await (await call('seeker', path)).json() as ViewingResponse;
  assert.equal(seekerBefore.private_instructions, null);
  const scheduled = await command(await call('seeker', `${path}/confirm`, versions(providerConfirmed.viewing)));
  assert.equal(scheduled.viewing.state, 'SCHEDULED');
  assert.equal(scheduled.viewing.private_instructions, acceptance.private_instructions);
  assert.equal(scheduled.viewing.seeker_confirmed, true);
  assert.equal(scheduled.viewing.provider_confirmed, true);
  assert.equal((await (await call('provider', path)).json() as ViewingResponse).private_instructions, acceptance.private_instructions);
  await f.client`INSERT INTO block_relationships(blocker_user_id,blocked_provider_account_id) VALUES(${f.seekerId},${scheduled.viewing.provider_account_id})`;
  const blocked = await (await call('seeker', path)).json() as ViewingResponse;
  assert.equal(blocked.private_instructions, null);
  assert.equal(blocked.can_cancel, true);
  await f.client`UPDATE listings SET market_status='RENTED' WHERE id=${f.listingId}`;
  await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${f.seekerId}`;
  await f.client`UPDATE phone_contacts SET verified_at=NULL,replaced_at=statement_timestamp() WHERE user_id=${f.seekerId}`;
  const cancelKey = randomUUID(), cancellation = { ...versions(scheduled.viewing), reason: 'PLANS_CHANGED' };
  const cancelled = await command(await call('seeker', `${path}/cancel`, cancellation, cancelKey));
  assert.equal(cancelled.viewing.state, 'CANCELLED_BY_SEEKER');
  assert.equal(cancelled.viewing.private_instructions, null);
  assert.equal((await command(await call('seeker', `${path}/cancel`, cancellation, cancelKey))).replayed, true);
  assert.equal((await (await call('provider', path)).json() as ViewingResponse).private_instructions, null);
}));

void integration('G3-F1 HTTP decline preserves history, permits another episode and rejects stale or unrelated commands', () => scenario(async (call, f) => {
  const requestPath = `/interactions/${f.interaction.interaction_id}/viewings`;
  const first = await command(await call('seeker', requestPath, f.input));
  const path = `/viewings/${first.viewing.id}`;
  await error(await call('provider', `${path}/decline`, { ...versions(first.viewing), reason: 'TIME_UNSUITABLE', seeker_user_id: f.seekerId }), 400, 'INVALID_INPUT');
  await error(await call('provider', `${path}/decline`, { ...versions(first.viewing), expected_version: '1', reason: 'TIME_UNSUITABLE' }), 400, 'INVALID_INPUT');
  const declined = await command(await call('provider', `${path}/decline`, { ...versions(first.viewing), reason: 'TIME_UNSUITABLE' }));
  assert.equal(declined.viewing.state, 'DECLINED');
  assert.equal(declined.viewing.reason, 'TIME_UNSUITABLE');
  const history = await (await call('seeker', `/viewings?interaction_id=${f.interaction.interaction_id}`)).json() as ViewingListResponse;
  assert.equal(history.can_request, true);
  assert.equal(history.items[0]!.state, 'DECLINED');
  const second = await command(await call('seeker', requestPath, f.input));
  assert.notEqual(second.viewing.id, first.viewing.id);
  await error(await call('provider', `${path}/cancel`, { ...versions(declined.viewing), reason: 'TIME_UNSUITABLE' }), 409, 'INVALID_STATE');
  await error(await call('other', `/viewings?interaction_id=${f.interaction.interaction_id}`), 404, 'RESOURCE_UNAVAILABLE');
  await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE user_id=${f.providerUserId}`;
  await error(await call('provider', `/viewings/${second.viewing.id}`), 401, 'AUTH_REQUIRED');
}));

void integration('G3-F1 HTTP listing availability, freshness and restrictions fail closed without deleting participant history', () => scenario(async (call, f) => {
  const path = `/interactions/${f.interaction.interaction_id}/viewings`;
  await f.client`UPDATE listings SET market_status='RENTED' WHERE id=${f.listingId}`;
  await error(await call('seeker', path, f.input), 403, 'CAPABILITY_RESTRICTED');
  await f.client`UPDATE listings SET market_status='AVAILABLE',last_confirmed_at=statement_timestamp()-interval '31 days',expires_at=statement_timestamp()-interval '1 day' WHERE id=${f.listingId}`;
  await error(await call('seeker', path, f.input), 403, 'CAPABILITY_RESTRICTED');
  await f.client`UPDATE listings SET last_confirmed_at=statement_timestamp(),expires_at=statement_timestamp()+interval '30 days' WHERE id=${f.listingId}`;
  const requested = await command(await call('seeker', path, f.input));
  await f.client`UPDATE interactions SET state='RESTRICTED' WHERE id=${f.interaction.interaction_id}`;
  const current = await call('seeker', `/viewings/${requested.viewing.id}`);
  assert.equal(current.status, 200);
  const history = await current.json() as ViewingResponse;
  assert.equal(history.state, 'REQUESTED');
  const cancelled = await command(await call('seeker', `/viewings/${history.id}/cancel`, { ...versions(history), reason: 'SAFETY' }));
  assert.equal(cancelled.viewing.state, 'CANCELLED_BY_SEEKER');
}));
