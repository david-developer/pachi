import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { createDatabase, IdentityStore, LocalOrganizationInvitationSink, OrganizationStore } from '@pachi/database';
import type { OrganizationInvitation, OrganizationInvitationListResponse, OrganizationListResponse, OrganizationMember, OrganizationMemberListResponse, OrganizationSummary } from '@pachi/contracts';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { OrganizationController, OrganizationNoStoreGuard } from './organization.controller.js';
import { OrganizationExceptionFilter } from './organization-exception.filter.js';
import { requestIdMiddleware } from './logging.js';

if (!process.env.DATABASE_TEST_URL && process.env.CI === 'true') throw new Error('DATABASE_TEST_URL is required for organization lifecycle HTTP tests');
const integration = process.env.DATABASE_TEST_URL ? test : test.skip;
type Client = ReturnType<typeof createDatabase>['client'];
type Actor = 'owner' | 'recipient' | 'other' | 'missing-phone' | 'anonymous';
type Scenario = {
  client: Client;
  ids: Record<Exclude<Actor, 'anonymous'>, string>;
  phones: Record<Exclude<Actor, 'anonymous'>, string>;
  sink: LocalOrganizationInvitationSink;
  call: (actor: Actor, path: string, body?: unknown, key?: string | null) => Promise<Response>;
};
const organizationInput = { legal_name: 'Synthetic Legal Organization', public_name: 'Synthetic Homes', organization_type: 'REAL_ESTATE_AGENCY', public_phone_opt_in: false };
const orgPath = '/account/organizations';

async function scenario(run: (context: Scenario) => Promise<void>, deliver = true): Promise<void> {
  const url = new URL(process.env.DATABASE_TEST_URL!);
  assert.equal(url.hostname, 'localhost'); assert.equal(url.port, '5433'); assert.equal(url.pathname, '/pachi_test');
  const { client } = createDatabase(url.toString());
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const issuer = 'https://local.test/organization-lifecycle';
  const verifier = new CognitoAccessTokenVerifier({ issuer, getKey: async () => publicKey, allowedClientIds: new Set(['account']), requiredScopes: new Set(['pachi/account']), provider: 'LOCAL_TEST' });
  const sink = new LocalOrganizationInvitationSink();
  @Module({
    controllers: [OrganizationController],
    providers: [AuthGuard, OrganizationNoStoreGuard,
      { provide: 'AUTH_SERVICE', useValue: new AuthService(new IdentityStore(client), verifier) },
      { provide: 'ORGANIZATION_STORE', useValue: new OrganizationStore(client, deliver ? sink : undefined) }]
  })
  class TestApp {}
  const app = await NestFactory.create(TestApp, { logger: false });
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new OrganizationExceptionFilter(app.getHttpAdapter()));
  app.setGlobalPrefix('v1'); await app.listen(0, '127.0.0.1');
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const ids = {} as Scenario['ids'], phones = {} as Scenario['phones'], tokens: Record<string, string> = {};
    for (const [index, actor] of (['owner', 'recipient', 'other', 'missing-phone'] as const).entries()) {
      ids[actor] = randomUUID(); phones[actor] = `+23769998010${index}`;
      await client`INSERT INTO users(id,account_state) VALUES (${ids[actor]},'ACTIVE')`;
      if (actor !== 'missing-phone') await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${ids[actor]},${phones[actor]},statement_timestamp(),1)`;
      await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${ids[actor]},${issuer},${actor},'LOCAL_TEST')`;
      tokens[actor] = await new SignJWT({ client_id: 'account', origin_jti: randomUUID(), jti: randomUUID(), token_use: 'access', scope: 'pachi/account' }).setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setSubject(actor).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    }
    const base = await app.getUrl();
    const call: Scenario['call'] = async (actor, path, body, key = randomUUID()) => {
      const headers: Record<string, string> = {};
      if (actor !== 'anonymous') headers.authorization = `Bearer ${tokens[actor]}`;
      if (body !== undefined) { headers['content-type'] = 'application/json'; if (key !== null) headers['idempotency-key'] = key; }
      const response = await fetch(`${base}/v1${path}`, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return response;
    };
    await run({ client, ids, phones, sink, call });
  } finally {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await app.close(); await client.end();
  }
}

async function created(call: Scenario['call'], overrides = {}): Promise<OrganizationSummary> {
  const response = await call('owner', orgPath, { ...organizationInput, ...overrides });
  assert.equal(response.status, 201);
  return await response.json() as OrganizationSummary;
}
async function current(call: Scenario['call'], id: string): Promise<OrganizationSummary> {
  const response = await call('owner', `${orgPath}/${id}`); assert.equal(response.status, 200);
  return await response.json() as OrganizationSummary;
}
async function invitation(context: Scenario, org: OrganizationSummary, actor: 'recipient' | 'other' = 'recipient', role = 'AGENT'): Promise<OrganizationInvitation> {
  const now = await current(context.call, org.id);
  const response = await context.call('owner', `${orgPath}/${org.id}/invitations`, { recipient_phone: context.phones[actor], role, expected_version: now.version });
  assert.equal(response.status, 201);
  return await response.json() as OrganizationInvitation;
}
async function effects(client: Client, organizationId: string) {
  return (await client`SELECT
    (SELECT count(*)::int FROM organizations WHERE id=${organizationId}) AS organizations,
    (SELECT count(*)::int FROM provider_accounts WHERE organization_id=${organizationId}) AS principals,
    (SELECT count(*)::int FROM organization_memberships WHERE organization_id=${organizationId}) AS memberships,
    (SELECT count(*)::int FROM organization_invitations WHERE organization_id=${organizationId}) AS invitations,
    (SELECT count(*)::int FROM organization_actions WHERE organization_id=${organizationId}) AS actions,
    (SELECT count(*)::int FROM organization_outbox WHERE organization_id=${organizationId}) AS events,
    (SELECT count(*)::int FROM organization_command_receipts WHERE organization_id=${organizationId}) AS receipts`)[0]!;
}

void integration('organization HTTP atomically creates unverified principal, preserves retries and denies forged authority/current participation loss', () => scenario(async ({ call, client, ids, phones }) => {
  assert.equal((await call('anonymous', orgPath, organizationInput)).status, 401);
  assert.equal((await call('missing-phone', orgPath, organizationInput)).status, 403);
  assert.equal((await call('owner', orgPath, { ...organizationInput, owner_user_id: ids.other })).status, 400);
  assert.equal((await call('owner', orgPath, { ...organizationInput, business_verification: 'VERIFIED' })).status, 400);
  assert.equal((await call('owner', orgPath, organizationInput, null)).status, 400);
  assert.equal((await call('owner', orgPath, organizationInput, 'unsafe-key')).status, 400);
  const key = randomUUID();
  const result = await call('owner', orgPath, organizationInput, key); assert.equal(result.status, 201);
  const org = await result.json() as OrganizationSummary;
  assert.equal((await client`SELECT request_id FROM organization_actions WHERE organization_id=${org.id} AND action='ORGANIZATION_CREATED'`)[0]!.request_id, result.headers.get('x-request-id'));
  assert.equal(org.state, 'ACTIVE'); assert.equal(org.membership.role, 'OWNER'); assert.equal(org.membership.state, 'ACTIVE');
  assert.equal(org.business_verification, 'NOT_VERIFIED'); assert.equal(org.publication_eligible, false); assert.equal(org.public_contact.phone, null);
  const committed = await effects(client, org.id);
  assert.deepEqual(committed, { organizations: 1, principals: 1, memberships: 1, invitations: 0, actions: 1, events: 1, receipts: 1 });
  const retry = await call('owner', orgPath, organizationInput, key); assert.equal(retry.status, 201); assert.deepEqual(await retry.json(), org);
  assert.deepEqual(await effects(client, org.id), committed);
  assert.equal((await call('owner', orgPath, { ...organizationInput, public_name: 'Changed' }, key)).status, 409);
  const principal = await client`SELECT kind,provider_profile_id,organization_id FROM provider_accounts WHERE id=${org.provider_account_id}`;
  assert.deepEqual(principal[0], { kind: 'ORGANIZATION', provider_profile_id: null, organization_id: org.id });
  assert.equal((await call('owner', orgPath+'?limit=0')).status, 400);
  assert.equal((await call('owner', orgPath+'?cursor=invalid')).status, 400);
  assert.equal((await call('owner', orgPath+'?token=forbidden')).status, 400);
  assert.equal((await call('other', `${orgPath}/${org.id}`)).status, 404);
  assert.equal((await call('other', `${orgPath}/${randomUUID()}`)).status, 404);
  assert.deepEqual((await (await call('other', orgPath)).json() as OrganizationListResponse).organizations, []);
  const serialized = JSON.stringify(org);
  for (const secret of [organizationInput.legal_name, phones.owner, 'token_digest', 'session_id', 'evidence', 'legal_name']) assert.ok(!serialized.includes(secret));
  await client`UPDATE users SET account_state='LIMITED' WHERE id=${ids.owner}`;
  assert.equal((await call('owner', orgPath, organizationInput)).status, 403);
  await client`UPDATE users SET account_state='ACTIVE' WHERE id=${ids.owner}`;
  await client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${ids.owner}`;
  assert.equal((await call('owner', orgPath, organizationInput)).status, 403);
  await client`UPDATE phone_contacts SET replaced_at=NULL,verified_at=NULL WHERE user_id=${ids.owner}`;
  assert.equal((await call('owner', orgPath, organizationInput)).status, 403);
  await client`UPDATE phone_contacts SET verified_at=statement_timestamp() WHERE user_id=${ids.owner}`;
  await client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE user_id=${ids.owner}`;
  assert.equal((await call('owner', orgPath, organizationInput)).status, 401);
}));

void integration('organization HTTP private invitation delivery, exact acceptance retry, ordinary governance and privilege denial preserve history', () => scenario(async context => {
  const { call, client, ids, phones, sink } = context;
  const org = await created(call);
  const invitationKey = randomUUID(), invitationInput = { recipient_phone: phones.recipient, role: 'AGENT', expected_version: org.version };
  const invitationCreated = await call('owner', `${orgPath}/${org.id}/invitations`, invitationInput, invitationKey); assert.equal(invitationCreated.status, 201);
  const first = await invitationCreated.json() as OrganizationInvitation;
  const afterInvitation = await effects(client, org.id);
  const invitationRetry = await call('owner', `${orgPath}/${org.id}/invitations`, invitationInput, invitationKey); assert.equal(invitationRetry.status, 201); assert.deepEqual(await invitationRetry.json(), first);
  assert.deepEqual(await effects(client, org.id), afterInvitation);
  assert.equal((await call('owner', `${orgPath}/${org.id}/invitations`, { ...invitationInput, role: 'ANALYST' }, invitationKey)).status, 409);
  assert.equal(first.state, 'INVITED'); assert.equal(first.role, 'AGENT'); assert.equal(first.can_respond, false);
  const delivered = sink.read(ids.recipient, first.id); assert.ok(delivered);
  const inviteInput = { role: 'AGENT', expected_version: (await current(call, org.id)).version };
  const duplicateRecipient = await call('owner', `${orgPath}/${org.id}/invitations`, { ...inviteInput, recipient_phone: phones.recipient });
  const unknownRecipient = await call('owner', `${orgPath}/${org.id}/invitations`, { ...inviteInput, recipient_phone: '+237699980199' });
  assert.equal(duplicateRecipient.status, 404); assert.equal(unknownRecipient.status, 404);
  assert.deepEqual(await duplicateRecipient.json(), await unknownRecipient.json());
  assert.equal(sink.read(ids.other, first.id), null);
  const pendingResponse = await call('recipient', '/account/organization-invitations'); assert.equal(pendingResponse.status, 200);
  const pending = await pendingResponse.json() as OrganizationInvitationListResponse;
  assert.equal(pending.invitations[0]?.id, first.id); assert.equal(pending.invitations[0]?.can_respond, true);
  const managerView = await (await call('owner', `${orgPath}/${org.id}/invitations`)).json();
  const secretViews = JSON.stringify([org, first, pending, managerView]);
  for (const privateValue of [delivered.token, 'token_digest', phones.recipient, 'recipient_contact_id', 'session_id']) assert.ok(!secretViews.includes(privateValue));
  const rows = await client`SELECT token_digest,extract(epoch FROM expires_at-created_at)::int AS validity FROM organization_invitations WHERE id=${first.id}`;
  assert.equal(rows[0]!.validity, 7*24*3600); assert.match(String(rows[0]!.token_digest), /^[a-f0-9]{64}$/); assert.notEqual(rows[0]!.token_digest, delivered.token);
  const acceptPath = `/account/organization-invitations/${first.id}/accept`;
  const body = { token: delivered.token, expected_version: first.version };
  assert.equal((await call('other', acceptPath, body)).status, 404);
  assert.equal((await call('recipient', acceptPath+'?token=forbidden', body)).status, 400);
  assert.equal((await call('recipient', acceptPath, { ...body, user_id: ids.other })).status, 400);
  const key = randomUUID(); const accepted = await call('recipient', acceptPath, body, key); assert.equal(accepted.status, 201);
  const active = await accepted.json() as OrganizationInvitation; assert.equal(active.state, 'ACTIVE');
  const afterAcceptance = await effects(client, org.id);
  const retry = await call('recipient', acceptPath, body, key); assert.equal(retry.status, 201); assert.deepEqual(await retry.json(), active);
  assert.deepEqual(await effects(client, org.id), afterAcceptance);
  assert.equal((await call('recipient', acceptPath, body)).status, 409);
  assert.equal((await call('recipient', `${orgPath}/${org.id}/members`)).status, 404);
  const memberPage = await (await call('owner', `${orgPath}/${org.id}/members`)).json() as OrganizationMemberListResponse;
  const member = memberPage.members.find(row => row.id === first.membership_id); assert.ok(member);
  const memberBase = `${orgPath}/${org.id}/members/${member.id}`;
  for (const role of ['OWNER', 'ADMIN']) {
    assert.equal((await call('owner', memberBase+'/change-role', { role, expected_version: member.version })).status, 403);
    const fresh = await current(call, org.id);
    assert.equal((await call('owner', `${orgPath}/${org.id}/invitations`, { recipient_phone: phones.other, role, expected_version: fresh.version })).status, 403);
  }
  const ownerMember = org.membership;
  const ownerBase = `${orgPath}/${org.id}/members/${ownerMember.id}`;
  const ownerAttacks = await Promise.all(['suspend','revoke','change-role'].map(command => call('owner', ownerBase+'/'+command, { expected_version: ownerMember.version, ...(command==='change-role'?{role:'ANALYST'}:{}) })));
  assert.ok(ownerAttacks.every(response => response.status === 403));
  assert.equal((await client`SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id=${org.id} AND role='OWNER' AND state='ACTIVE'`)[0]!.n, 1);
  const roleKey = randomUUID();
  const changedResponse = await call('owner', memberBase+'/change-role', { role: 'ANALYST', expected_version: member.version }, roleKey); assert.equal(changedResponse.status, 201);
  const changed = await changedResponse.json() as OrganizationMember; assert.equal(changed.role, 'ANALYST');
  const roleEffects = await effects(client, org.id);
  const roleRetry = await call('owner', memberBase+'/change-role', { role: 'ANALYST', expected_version: member.version }, roleKey); assert.equal(roleRetry.status, 201); assert.deepEqual(await roleRetry.json(), changed);
  assert.deepEqual(await effects(client, org.id), roleEffects);
  assert.equal((await call('owner', memberBase+'/suspend', { expected_version: member.version })).status, 409);
  const suspendedResponse = await call('owner', memberBase+'/suspend', { expected_version: changed.version }); assert.equal(suspendedResponse.status, 201);
  const suspended = await suspendedResponse.json() as OrganizationMember; assert.equal(suspended.state, 'SUSPENDED');
  assert.equal((await call('recipient', `${orgPath}/${org.id}`)).status, 404);
  const restoredResponse = await call('owner', memberBase+'/reactivate', { expected_version: suspended.version }); assert.equal(restoredResponse.status, 201);
  const restored = await restoredResponse.json() as OrganizationMember; assert.equal(restored.state, 'ACTIVE');
  assert.equal((await call('recipient', `${orgPath}/${org.id}`)).status, 200);
  const revokedResponse = await call('owner', memberBase+'/revoke', { expected_version: restored.version }); assert.equal(revokedResponse.status, 201);
  assert.equal((await revokedResponse.json() as OrganizationMember).state, 'REVOKED');
  assert.equal((await call('recipient', `${orgPath}/${org.id}`)).status, 404);
  assert.equal((await call('recipient', acceptPath, body, key)).status, 404);
  assert.deepEqual((await (await call('recipient', orgPath)).json() as OrganizationListResponse).organizations, []);
  const sensitiveTables = await client`SELECT row_to_json(r)::text AS data FROM (SELECT safe_metadata FROM organization_actions UNION ALL SELECT safe_payload FROM organization_outbox UNION ALL SELECT safe_metadata FROM audit_events) r`;
  const recorded = JSON.stringify(sensitiveTables);
  for (const privateValue of [delivered.token, phones.recipient, phones.owner, organizationInput.legal_name]) assert.ok(!recorded.includes(privateValue));
  const denial = await client`SELECT count(*)::int AS n FROM organization_security_denials WHERE organization_id=${org.id}`;
  assert.ok(denial[0]!.n >= 7);
}));

void integration('organization HTTP invitation terminal episodes, replaced contact, role support and scoped pagination', () => scenario(async context => {
  const { call, client, ids, sink } = context;
  const org = await created(call);
  const first = await invitation(context, org, 'recipient', 'LISTING_MANAGER');
  const token = sink.read(ids.recipient, first.id)!.token;
  await client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${ids.recipient}`;
  assert.equal((await call('recipient', `/account/organization-invitations/${first.id}/accept`, { token, expected_version: first.version })).status, 403);
  await client`UPDATE phone_contacts SET replaced_at=NULL WHERE user_id=${ids.recipient}`;
  const declined = await call('recipient', `/account/organization-invitations/${first.id}/decline`, { token, expected_version: first.version }); assert.equal(declined.status, 201);
  assert.equal((await declined.json() as OrganizationInvitation).state, 'DECLINED');
  assert.equal((await call('recipient', `/account/organization-invitations/${first.id}/accept`, { token, expected_version: first.version })).status, 409);
  const second = await invitation(context, org, 'recipient', 'ANALYST');
  assert.notEqual(second.membership_id, first.membership_id);
  const secondToken = sink.read(ids.recipient, second.id)!.token;
  const revoked = await call('owner', `${orgPath}/${org.id}/invitations/${second.id}/revoke`, { expected_version: second.version }); assert.equal(revoked.status, 201);
  assert.equal((await revoked.json() as OrganizationInvitation).state, 'REVOKED');
  assert.equal((await call('recipient', `/account/organization-invitations/${second.id}/accept`, { token: secondToken, expected_version: second.version })).status, 409);
  const expired = await invitation(context, org);
  const expiredToken = sink.read(ids.recipient, expired.id)!.token;
  // Isolated fixture changes only the deadline, preserving the exact seven-day interval.
  await client`UPDATE organization_invitations SET created_at=transaction_timestamp()-interval '168 hours',expires_at=transaction_timestamp() WHERE id=${expired.id}`;
  assert.equal((await call('recipient', `/account/organization-invitations/${expired.id}/accept`, { token: expiredToken, expected_version: expired.version })).status, 409);
  assert.equal((await client`SELECT state FROM organization_invitations WHERE id=${expired.id}`)[0]!.state, 'EXPIRED');
  const foreign = await created(call, { public_name: 'Another Organization' });
  const third = await invitation(context, org);
  assert.equal((await call('owner', `${orgPath}/${foreign.id}/invitations/${third.id}/revoke`, { expected_version: third.version })).status, 404);
  const firstPage = await (await call('owner', `${orgPath}/${org.id}/invitations?limit=1`)).json() as OrganizationInvitationListResponse;
  assert.equal(firstPage.invitations.length, 1); assert.ok(firstPage.next_cursor);
  const secondPage = await (await call('owner', `${orgPath}/${org.id}/invitations?limit=1&cursor=${encodeURIComponent(firstPage.next_cursor)}`)).json() as OrganizationInvitationListResponse;
  assert.equal(secondPage.invitations.length, 1); assert.notEqual(secondPage.invitations[0]!.id, firstPage.invitations[0]!.id);
  assert.equal((await call('other', `${orgPath}/${org.id}/invitations`)).status, 404);
  assert.equal((await call('other', `${orgPath}/${org.id}/members`)).status, 404);
}));

void integration('organization HTTP default delivery adapter denies invitation before all business effects', () => scenario(async context => {
  const { call, client, phones } = context; const org = await created(call);
  const before = await effects(client, org.id);
  const response = await call('owner', `${orgPath}/${org.id}/invitations`, { recipient_phone: phones.recipient, role: 'AGENT', expected_version: org.version });
  assert.equal(response.status, 503); assert.equal((await response.json() as {message:string}).message, 'DELIVERY_UNAVAILABLE');
  assert.deepEqual(await effects(client, org.id), before);
  const now = await current(call, org.id); assert.equal(now.version, org.version);
}, false));

void integration('organization HTTP concurrent acceptance and accept versus revoke serialize one attributable outcome', () => scenario(async context => {
  const { call, client, ids, sink } = context;
  const org = await created(call);
  const first = await invitation(context, org);
  const token = sink.read(ids.recipient, first.id)!.token;
  const path = `/account/organization-invitations/${first.id}/accept`;
  const body = { token, expected_version: first.version }, key = randomUUID();
  const accepted = await Promise.all([call('recipient', path, body, key), call('recipient', path, body, key)]);
  assert.ok(accepted.every(response => response.status === 201));
  assert.deepEqual(await accepted[0]!.json(), await accepted[1]!.json());
  assert.equal((await client`SELECT count(*)::int AS n FROM organization_actions WHERE invitation_id=${first.id} AND action='INVITATION_ACCEPTED'`)[0]!.n, 1);
  const second = await invitation(context, org, 'other');
  const otherToken = sink.read(ids.other, second.id)!.token;
  const raced = await Promise.all([
    call('other', `/account/organization-invitations/${second.id}/accept`, { token: otherToken, expected_version: second.version }),
    call('owner', `${orgPath}/${org.id}/invitations/${second.id}/revoke`, { expected_version: second.version })
  ]);
  assert.deepEqual(raced.map(response => response.status).sort(), [201, 409]);
  const outcome = await client`SELECT state FROM organization_invitations WHERE id=${second.id}`;
  assert.ok(['ACTIVE', 'REVOKED'].includes(String(outcome[0]!.state)));
  assert.equal((await client`SELECT count(*)::int AS n FROM organization_actions WHERE invitation_id=${second.id} AND action IN ('INVITATION_ACCEPTED','INVITATION_REVOKED')`)[0]!.n, 1);
  assert.equal((await client`SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id=${org.id} AND user_id=${ids.other} AND state IN ('ACTIVE','INVITED','SUSPENDED')`)[0]!.n, outcome[0]!.state === 'ACTIVE' ? 1 : 0);
}));

void integration('organization HTTP concurrent onboarding and payload conflicts create one attributable principal per actor/key', () => scenario(async ({ call, client }) => {
  const key = randomUUID();
  const responses = await Promise.all([call('owner', orgPath, organizationInput, key), call('owner', orgPath, organizationInput, key)]);
  assert.ok(responses.every(response => response.status === 201));
  const org = await responses[0]!.json() as OrganizationSummary;
  assert.deepEqual(await responses[1]!.json(), org);
  assert.deepEqual(await effects(client, org.id), { organizations: 1, principals: 1, memberships: 1, invitations: 0, actions: 1, events: 1, receipts: 1 });
  const conflicting = await call('owner', orgPath, { ...organizationInput, legal_name: 'Another Legal Name' }, key);
  assert.equal(conflicting.status, 409); assert.equal((await conflicting.json() as { message: string }).message, 'IDEMPOTENCY_KEY_REUSED');
  const separate = await call('other', orgPath, organizationInput, key); assert.equal(separate.status, 201);
  const otherOrg = await separate.json() as OrganizationSummary; assert.notEqual(otherOrg.id, org.id);
  assert.equal((await call('owner', `${orgPath}/${otherOrg.id}`)).status, 404);
  assert.equal((await call('other', `${orgPath}/${org.id}`)).status, 404);
  assert.deepEqual(await effects(client, org.id), { organizations: 1, principals: 1, memberships: 1, invitations: 0, actions: 1, events: 1, receipts: 1 });
}));

void integration('organization HTTP ordinary role and lifecycle races reject stale writes and protect ADMIN targets', () => scenario(async context => {
  const { call, client, ids, sink } = context;
  const org = await created(call), invite = await invitation(context, org);
  const token = sink.read(ids.recipient, invite.id)!.token;
  const accepted = await call('recipient', `/account/organization-invitations/${invite.id}/accept`, { token, expected_version: invite.version }); assert.equal(accepted.status, 201);
  const members = await (await call('owner', `${orgPath}/${org.id}/members`)).json() as OrganizationMemberListResponse;
  const member = members.members.find(row => row.id === invite.membership_id)!;
  const base = `${orgPath}/${org.id}/members/${member.id}`;
  const roles = await Promise.all(['LISTING_MANAGER', 'ANALYST'].map(role => call('owner', base+'/change-role', { role, expected_version: member.version })));
  assert.deepEqual(roles.map(response => response.status).sort(), [201, 409]);
  const currentMember = await roles.find(response => response.status === 201)!.json() as OrganizationMember;
  assert.equal(currentMember.version, member.version+1);
  const lifecycle = await Promise.all(['suspend', 'revoke'].map(command => call('owner', base+'/'+command, { expected_version: currentMember.version })));
  assert.deepEqual(lifecycle.map(response => response.status).sort(), [201, 409]);
  const outcome = await lifecycle.find(response => response.status === 201)!.json() as OrganizationMember;
  assert.ok(['SUSPENDED', 'REVOKED'].includes(outcome.state)); assert.equal(outcome.version, currentMember.version+1);
  assert.equal((await call('recipient', `${orgPath}/${org.id}`)).status, 404);
  assert.equal((await call('recipient', `${orgPath}/${org.id}/invitations`, { recipient_phone: context.phones.other, role: 'AGENT', expected_version: (await current(call, org.id)).version })).status, 404);
  assert.equal((await client`SELECT count(*)::int AS n FROM organization_actions WHERE membership_id=${member.id} AND action='MEMBER_ROLE_CHANGED'`)[0]!.n, 1);
  assert.equal((await client`SELECT count(*)::int AS n FROM organization_actions WHERE membership_id=${member.id} AND action IN ('MEMBER_SUSPENDED','MEMBER_REVOKED')`)[0]!.n, 1);
  // A protected legacy ADMIN fixture exercises negative governance only; no
  // privileged appointment endpoint or successful privileged operation exists.
  const adminRows = await client<{ id: string }[]>`INSERT INTO organization_memberships(organization_id,user_id,role,state,changed_by,activated_at) VALUES (${org.id},${ids.other},'ADMIN','ACTIVE',${ids.owner},transaction_timestamp()) RETURNING id`;
  for (const command of ['change-role', 'suspend', 'reactivate', 'revoke']) {
    const response = await call('owner', `${orgPath}/${org.id}/members/${adminRows[0]!.id}/${command}`, { expected_version: 1, ...(command === 'change-role' ? { role: 'AGENT' } : {}) });
    assert.equal(response.status, 403); assert.equal((await response.json() as { message: string }).message, 'PRIVILEGED_GOVERNANCE_UNAVAILABLE');
  }
  assert.deepEqual((await client`SELECT role,state,version FROM organization_memberships WHERE id=${adminRows[0]!.id}`)[0], { role: 'ADMIN', state: 'ACTIVE', version: 1 });
  assert.equal((await client`SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id=${org.id} AND role='OWNER' AND state='ACTIVE'`)[0]!.n, 1);
}));

void integration('organization HTTP invitations reject unverified recipients and a replaced contact even after fresh verification', () => scenario(async context => {
  const { call, client, ids, phones, sink } = context;
  const org = await created(call);
  const input = { recipient_phone: phones.recipient, role: 'AGENT', expected_version: org.version };
  await client`UPDATE phone_contacts SET verified_at=NULL WHERE user_id=${ids.recipient}`;
  const unavailable = await call('owner', `${orgPath}/${org.id}/invitations`, input); assert.equal(unavailable.status, 404);
  assert.deepEqual(await unavailable.json(), await (await call('owner', `${orgPath}/${org.id}/invitations`, { ...input, recipient_phone: '+237699980199' })).json());
  await client`UPDATE phone_contacts SET verified_at=transaction_timestamp() WHERE user_id=${ids.recipient}`;
  const invite = await invitation(context, org), token = sink.read(ids.recipient, invite.id)!.token;
  const before = await effects(client, org.id);
  await client`UPDATE phone_contacts SET verification_version=verification_version+1 WHERE user_id=${ids.recipient}`;
  const changedVersion = await call('recipient', `/account/organization-invitations/${invite.id}/accept`, { token, expected_version: invite.version }); assert.equal(changedVersion.status, 404);
  assert.deepEqual(await effects(client, org.id), before);
  await client`UPDATE phone_contacts SET replaced_at=transaction_timestamp() WHERE user_id=${ids.recipient}`;
  await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${ids.recipient},${phones.recipient},transaction_timestamp(),1)`;
  const pending = await (await call('recipient', '/account/organization-invitations')).json() as OrganizationInvitationListResponse;
  assert.deepEqual(pending.invitations, []);
  const denied = await call('recipient', `/account/organization-invitations/${invite.id}/accept`, { token, expected_version: invite.version });
  assert.equal(denied.status, 404); assert.equal((await denied.json() as { message: string }).message, 'RESOURCE_UNAVAILABLE');
  assert.deepEqual(await effects(client, org.id), before);
  const revoke = await call('owner', `${orgPath}/${org.id}/invitations/${invite.id}/revoke`, { expected_version: invite.version }); assert.equal(revoke.status, 201);
  const reinvite = await invitation(context, org); assert.notEqual(reinvite.membership_id, invite.membership_id);
  const renewed = await call('recipient', `/account/organization-invitations/${reinvite.id}/accept`, { token: sink.read(ids.recipient, reinvite.id)!.token, expected_version: reinvite.version }); assert.equal(renewed.status, 201);
}));

void integration('organization HTTP independent acceptance keys consume one token and expiry maintenance converges with a denied accept', () => scenario(async context => {
  const { call, client, ids, sink } = context;
  const org = await created(call), first = await invitation(context, org);
  const firstToken = sink.read(ids.recipient, first.id)!.token;
  const responses = await Promise.all([call('recipient', `/account/organization-invitations/${first.id}/accept`, { token: firstToken, expected_version: first.version }), call('recipient', `/account/organization-invitations/${first.id}/accept`, { token: firstToken, expected_version: first.version })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  assert.equal((await client`SELECT count(*)::int AS n FROM organization_actions WHERE invitation_id=${first.id} AND action='INVITATION_ACCEPTED'`)[0]!.n, 1);
  assert.equal((await client`SELECT count(*)::int AS n FROM organization_command_receipts WHERE organization_id=${org.id} AND operation='ACCEPT_INVITATION'`)[0]!.n, 1);
  const expired = await invitation(context, org, 'other'), token = sink.read(ids.other, expired.id)!.token;
  await client`UPDATE organization_invitations SET created_at=transaction_timestamp()-interval '168 hours',expires_at=transaction_timestamp() WHERE id=${expired.id}`;
  const expiredView = await (await call('other', '/account/organization-invitations')).json() as OrganizationInvitationListResponse;
  assert.equal(expiredView.invitations[0]?.state, 'EXPIRED'); assert.equal(expiredView.invitations[0]?.can_respond, false);
  const maintenance = new OrganizationStore(client);
  const [accept] = await Promise.all([call('other', `/account/organization-invitations/${expired.id}/accept`, { token, expected_version: expired.version }), maintenance.expireInvitations()]);
  assert.equal(accept.status, 409);
  assert.equal((await client`SELECT state FROM organization_invitations WHERE id=${expired.id}`)[0]!.state, 'EXPIRED');
  assert.equal((await client`SELECT state FROM organization_memberships WHERE id=${expired.membership_id}`)[0]!.state, 'EXPIRED');
  assert.equal((await client`SELECT count(*)::int AS n FROM organization_actions WHERE invitation_id=${expired.id} AND action='INVITATION_EXPIRED'`)[0]!.n, 1);
  assert.equal((await client`SELECT count(*)::int AS n FROM organization_outbox WHERE safe_payload->>'invitation_id'=${expired.id} AND event_type='INVITATION_EXPIRED'`)[0]!.n, 1);
  const after = await effects(client, org.id); assert.equal(await maintenance.expireInvitations(), 0); assert.deepEqual(await effects(client, org.id), after);
}));
