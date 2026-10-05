import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from './client.js';
import { IdentityStore } from './identity.js';
import { LocalOrganizationInvitationSink, OrganizationStore } from './organization-lifecycle.js';
import type { OrganizationActor } from './organization-lifecycle.js';

const url = process.env.DATABASE_URL;
if (!url && process.env.CI === 'true') throw new Error('DATABASE_URL is required for organization store tests');
if (url) {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, 'localhost');
  assert.equal(parsed.port, '5433');
  assert.equal(parsed.pathname, '/pachi_test');
}
const integration = url ? test : test.skip;
const command = () => ({ idempotencyKey: randomUUID(), requestId: randomUUID() });
const profile = { legalName: 'Synthetic Legal Organization', publicName: 'Synthetic Homes', organizationType: 'REAL_ESTATE_AGENCY', publicPhoneOptIn: false };

async function fixture() {
  const { client } = createDatabase(url);
  await client`TRUNCATE users RESTART IDENTITY CASCADE`;
  const sink = new LocalOrganizationInvitationSink();
  const store = new OrganizationStore(client, sink);
  const actors = {} as Record<'owner' | 'recipient', OrganizationActor>;
  for (const [index, name] of (['owner', 'recipient'] as const).entries()) {
    const principal = await new IdentityStore(client).bootstrap({
      issuer: 'https://local.test/organization-store', subject: name, clientId: 'account',
      originJti: randomUUID(), jti: randomUUID(), issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 300000), scopes: ['pachi/account'], provider: 'LOCAL_TEST',
    });
    actors[name] = { userId: principal.userId, sessionId: principal.session.id, securityVersion: principal.session.securityVersion };
    await client`UPDATE users SET account_state='ACTIVE' WHERE id=${principal.userId}`;
    await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version)
      VALUES (${principal.userId},${`+23769998110${index}`},transaction_timestamp(),1)`;
  }
  return {
    client, store, sink, actors,
    async close() { await client`TRUNCATE users RESTART IDENTITY CASCADE`; await client.end(); },
  };
}

async function effects(client: ReturnType<typeof createDatabase>['client']) {
  const [result] = await client`SELECT
    (SELECT count(*)::int FROM organizations) AS organizations,
    (SELECT count(*)::int FROM provider_accounts) AS principals,
    (SELECT count(*)::int FROM organization_memberships) AS memberships,
    (SELECT count(*)::int FROM organization_invitations) AS invitations,
    (SELECT count(*)::int FROM organization_actions) AS actions,
    (SELECT count(*)::int FROM organization_outbox) AS events,
    (SELECT count(*)::int FROM organization_command_receipts) AS receipts,
    (SELECT count(*)::int FROM audit_events) AS audits`;
  return result;
}

void integration('concurrent organization retries normalize UUID key and actor casing to one committed effect', async () => {
  const f = await fixture();
  try {
    const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const input = { ...profile, idempotencyKey: key, requestId: randomUUID() };
    const variants = await Promise.all([
      f.store.create(f.actors.owner, input),
      f.store.create({ ...f.actors.owner, userId: f.actors.owner.userId.toUpperCase() }, { ...input, idempotencyKey: key.toUpperCase(), requestId: randomUUID() }),
    ]);
    assert.deepEqual(variants[1], variants[0]);
    assert.deepEqual(await effects(f.client), {
      organizations: 1, principals: 1, memberships: 1, invitations: 0,
      actions: 1, events: 1, receipts: 1, audits: 1,
    });
    const committed = await effects(f.client);
    assert.deepEqual(await f.store.create(f.actors.owner, { ...input, idempotencyKey: key.toUpperCase(), requestId: randomUUID() }), variants[0]);
    assert.deepEqual(await effects(f.client), committed);
  } finally { await f.close(); }
});

for (const loss of ['expired session', 'revoked session', 'stale security version', 'inactive account', 'unverified phone', 'replaced phone'] as const) {
  void integration(`organization Store rechecks ${loss} after actor capture and before retry or mutation`, async () => {
    const f = await fixture();
    try {
      const input = { ...profile, ...command() };
      const org = await f.store.create(f.actors.owner, input);
      const before = await effects(f.client);
      const actor = f.actors.owner;
      if (loss === 'expired session') await f.client`UPDATE security_sessions SET expires_at=transaction_timestamp()-interval '1 second' WHERE id=${actor.sessionId}`;
      if (loss === 'revoked session') await f.client`UPDATE security_sessions SET revoked_at=transaction_timestamp() WHERE id=${actor.sessionId}`;
      if (loss === 'stale security version') await f.client`UPDATE users SET security_version=security_version+1 WHERE id=${actor.userId}`;
      if (loss === 'inactive account') await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${actor.userId}`;
      if (loss === 'unverified phone') await f.client`UPDATE phone_contacts SET verified_at=NULL WHERE user_id=${actor.userId}`;
      if (loss === 'replaced phone') await f.client`UPDATE phone_contacts SET replaced_at=transaction_timestamp() WHERE user_id=${actor.userId}`;
      const code = ['expired session', 'revoked session', 'stale security version'].includes(loss) ? 'AUTH_REQUIRED' : 'CAPABILITY_RESTRICTED';
      for (const operation of [
        () => f.store.create(actor, input),
        () => f.store.create(actor, { ...profile, ...command() }),
        () => f.store.get(actor, org.id),
        () => f.store.list(actor),
        () => f.store.invite(actor, org.id, { ...command(), role: 'AGENT', recipientPhone: '+237699981101', expectedVersion: org.version }),
        () => f.store.mutateMember(actor, org.id, org.membership.id, { ...command(), command: 'REVOKE', expectedVersion: org.membership.version }),
      ]) await assert.rejects(operation, { code });
      assert.deepEqual(await effects(f.client), before);
    } finally { await f.close(); }
  });
}

void integration('organization Store denies onboarding before effects when an authenticated active account has no phone contact', async () => {
  const f = await fixture();
  try {
    await f.client`DELETE FROM phone_contacts WHERE user_id=${f.actors.owner.userId}`;
    const before = await effects(f.client);
    await assert.rejects(f.store.create(f.actors.owner, { ...profile, ...command() }), { code: 'CAPABILITY_RESTRICTED' });
    assert.deepEqual(await effects(f.client), before);
  } finally { await f.close(); }
});

for (const changed of ['contact identity', 'verification version'] as const) {
  void integration(`organization invitation remains bound to its captured recipient ${changed}`, async () => {
    const f = await fixture();
    try {
      const org = await f.store.create(f.actors.owner, { ...profile, ...command() });
      const invite = await f.store.invite(f.actors.owner, org.id, { ...command(), role: 'AGENT', recipientPhone: '+237699981101', expectedVersion: org.version });
      const secret = f.sink.read(f.actors.recipient.userId, invite.id)!;
      const before = await effects(f.client);
      if (changed === 'contact identity') {
        await f.client.begin(async tx => {
          await tx`UPDATE phone_contacts SET replaced_at=transaction_timestamp() WHERE user_id=${f.actors.recipient.userId}`;
          await tx`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version)
            VALUES (${f.actors.recipient.userId},'+237699981102',transaction_timestamp(),1)`;
        });
      } else await f.client`UPDATE phone_contacts SET verification_version=verification_version+1 WHERE user_id=${f.actors.recipient.userId}`;
      for (const response of ['ACCEPT', 'DECLINE'] as const) {
        await assert.rejects(f.store.respondInvitation(f.actors.recipient, invite.id, { ...command(), command: response, token: secret.token, expectedVersion: invite.version }), { code: 'RESOURCE_SCOPE_DENIED' });
      }
      assert.deepEqual((await f.store.invitations(f.actors.recipient)).invitations, []);
      assert.equal((await f.client`SELECT state FROM organization_invitations WHERE id=${invite.id}`)[0]?.state, 'INVITED');
      assert.deepEqual(await effects(f.client), before);
    } finally { await f.close(); }
  });
}

void integration('denied privileged commands bind idempotency to request content without losing independent audit effects', async () => {
  const f = await fixture();
  try {
    const first = await f.store.create(f.actors.owner, { ...profile, ...command() });
    const second = await f.store.create(f.actors.owner, { ...profile, publicName: 'Second Organization', ...command() });
    const input = { ...command(), role: 'OWNER', recipientPhone: '+237699981101', expectedVersion: first.version };
    await assert.rejects(f.store.invite(f.actors.owner, first.id, input), { code: 'PRIVILEGED_GOVERNANCE_UNAVAILABLE' });
    const deniedEffects = await effects(f.client);
    await assert.rejects(f.store.invite(f.actors.owner, first.id, { ...input, requestId: randomUUID() }), { code: 'PRIVILEGED_GOVERNANCE_UNAVAILABLE' });
    assert.deepEqual(await effects(f.client), deniedEffects);
    for (const change of [
      () => f.store.invite(f.actors.owner, first.id, { ...input, role: 'ADMIN' }),
      () => f.store.invite(f.actors.owner, first.id, { ...input, recipientPhone: '+237699981102' }),
      () => f.store.invite(f.actors.owner, second.id, input),
    ]) await assert.rejects(change, { code: 'IDEMPOTENCY_KEY_REUSED' });
    assert.deepEqual(await effects(f.client), deniedEffects);
    await assert.rejects(f.store.invite(f.actors.owner, second.id, { ...input, ...command() }), { code: 'PRIVILEGED_GOVERNANCE_UNAVAILABLE' });
    const denials = await f.client`SELECT organization_id,request_hash FROM organization_security_denials ORDER BY organization_id`;
    assert.equal(denials.length, 2);
    assert.ok(denials.every(row => /^[0-9a-f]{64}$/.test(row.request_hash)));
    assert.equal(new Set(denials.map(row => row.organization_id)).size, 2);
    assert.equal((await f.client`SELECT count(*)::int AS count FROM audit_events WHERE action='ORGANIZATION_PRIVILEGED_OPERATION_DENIED'`)[0]?.count, 2);
    assert.equal((await f.client`SELECT count(*)::int AS count FROM organization_invitations`)[0]?.count, 0);
    const memberInput = { ...command(), command: 'SUSPEND' as const, expectedVersion: first.membership.version };
    await assert.rejects(f.store.mutateMember(f.actors.owner, first.id, first.membership.id, memberInput), { code: 'PRIVILEGED_GOVERNANCE_UNAVAILABLE' });
    await assert.rejects(f.store.mutateMember(f.actors.owner, first.id, first.membership.id, { ...memberInput, requestId: randomUUID() }), { code: 'PRIVILEGED_GOVERNANCE_UNAVAILABLE' });
    const memberDeniedEffects = await effects(f.client);
    await assert.rejects(f.store.mutateMember(f.actors.owner, second.id, second.membership.id, memberInput), { code: 'IDEMPOTENCY_KEY_REUSED' });
    assert.deepEqual(await effects(f.client), memberDeniedEffects);
    await assert.rejects(f.store.mutateMember(f.actors.owner, second.id, second.membership.id, { ...memberInput, ...command() }), { code: 'PRIVILEGED_GOVERNANCE_UNAVAILABLE' });
    assert.equal((await f.client`SELECT count(*)::int AS count FROM audit_events WHERE action='ORGANIZATION_PRIVILEGED_OPERATION_DENIED'`)[0]?.count, 4);
  } finally { await f.close(); }
});
