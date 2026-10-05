import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from './client.js';
import { ProviderStore } from './provider.js';

const url = process.env.DATABASE_URL;
if (!url && process.env.CI === 'true') throw new Error('DATABASE_URL is required for organization invariant tests');
if (url) {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, 'localhost');
  assert.equal(parsed.port, '5433');
  assert.equal(parsed.pathname, '/pachi_test');
}
const integration = url ? test : test.skip;

async function fixture(twoOwners = false) {
  const { client } = createDatabase(url);
  const organizationId = randomUUID();
  const users = [randomUUID(), randomUUID()];
  const contacts = [randomUUID(), randomUUID()];
  const memberships = [randomUUID(), randomUUID()];
  await client.begin(async tx => {
    for (let index = 0; index < users.length; index++) {
      await tx`INSERT INTO users(id,account_state) VALUES (${users[index]!},'ACTIVE')`;
      await tx`INSERT INTO phone_contacts(id,user_id,normalized_e164,verified_at,verification_version)
        VALUES (${contacts[index]!},${users[index]!},${`+237${randomInt(650000000, 699999999)}`},transaction_timestamp(),1)`;
    }
    await tx`INSERT INTO organizations(id,state,legal_name,public_name,organization_type,created_by_user_id,onboarding_contact_id,onboarding_completed_at)
      VALUES (${organizationId},'ACTIVE','Invariant fixture','Invariant fixture','REAL_ESTATE_AGENCY',${users[0]!},${contacts[0]!},transaction_timestamp())`;
    await tx`INSERT INTO provider_accounts(kind,organization_id,state) VALUES ('ORGANIZATION',${organizationId},'ACTIVE')`;
    await tx`INSERT INTO organization_memberships(id,organization_id,user_id,role,state,changed_by,activated_at)
      VALUES (${memberships[0]!},${organizationId},${users[0]!},'OWNER','ACTIVE',${users[0]!},transaction_timestamp())`;
    if (twoOwners) await tx`INSERT INTO organization_memberships(id,organization_id,user_id,role,state,changed_by,activated_at)
      VALUES (${memberships[1]!},${organizationId},${users[1]!},'OWNER','ACTIVE',${users[0]!},transaction_timestamp())`;
  });
  return {
    client, organizationId, users, contacts, memberships,
    async close() {
      // Remove only this synthetic fixture, in one transaction. The deferred
      // owner check sees the organization removed rather than an ownerless row.
      await client.begin(async tx => {
        await tx`DELETE FROM provider_accounts WHERE organization_id=${organizationId}`;
        await tx`DELETE FROM organization_memberships WHERE organization_id=${organizationId}`;
        await tx`DELETE FROM organizations WHERE id=${organizationId}`;
        await tx`DELETE FROM provider_accounts WHERE provider_profile_id IN (SELECT id FROM provider_profiles WHERE user_id=ANY(${users}))`;
        await tx`DELETE FROM provider_profiles WHERE user_id=ANY(${users})`;
        await tx`DELETE FROM phone_contacts WHERE user_id=ANY(${users})`;
        await tx`DELETE FROM users WHERE id=ANY(${users})`;
      });
      await client.end();
    }
  };
}

void integration('organization ProviderAccount subject XOR, uniqueness and creator contact binding are relational', async () => {
  const f = await fixture();
  try {
    const [profile] = await f.client`INSERT INTO provider_profiles(user_id,provider_types,display_name)
      VALUES (${f.users[0]!},ARRAY['OWNER'],'Individual regression') RETURNING id`;
    assert.ok(profile);
    await f.client`INSERT INTO provider_accounts(provider_profile_id) VALUES (${profile.id})`;
    for (const values of [
      { kind: 'INDIVIDUAL', profile: null, organization: f.organizationId },
      { kind: 'ORGANIZATION', profile: profile.id, organization: f.organizationId },
      { kind: 'ORGANIZATION', profile: null, organization: null },
    ]) await assert.rejects(f.client`INSERT INTO provider_accounts(kind,provider_profile_id,organization_id)
      VALUES (${values.kind},${values.profile},${values.organization})`, { code: '23514' });
    await assert.rejects(f.client`INSERT INTO provider_accounts(kind,organization_id)
      VALUES ('ORGANIZATION',${f.organizationId})`, { code: '23505' });
    await assert.rejects(f.client`INSERT INTO provider_accounts(provider_profile_id)
      VALUES (${profile.id})`, { code: '23505' });
    await assert.rejects(f.client`INSERT INTO organizations(state,legal_name,public_name,organization_type,created_by_user_id,onboarding_contact_id,onboarding_completed_at)
      VALUES ('ACTIVE','Wrong binding','Wrong binding','REAL_ESTATE_AGENCY',${f.users[0]!},${f.contacts[1]!},transaction_timestamp())`, { code: '23503' });
    await assert.rejects(f.client`UPDATE organizations SET organization_type=NULL WHERE id=${f.organizationId}`, { code: '23514' });
    const accounts = await f.client`SELECT kind,provider_profile_id IS NOT NULL AS individual,organization_id IS NOT NULL AS organization
      FROM provider_accounts WHERE organization_id=${f.organizationId} OR provider_profile_id=${profile.id} ORDER BY kind`;
    assert.deepEqual(Array.from(accounts), [
      { kind: 'INDIVIDUAL', individual: true, organization: false },
      { kind: 'ORGANIZATION', individual: false, organization: true },
    ]);
  } finally { await f.close(); }
});

void integration('managed organizations cannot commit without an active owner or clear onboarding attribution', async () => {
  const f = await fixture();
  try {
    const ownerless = randomUUID();
    await assert.rejects(f.client.begin(async tx => {
      await tx`INSERT INTO organizations(id,state,legal_name,public_name,organization_type,created_by_user_id,onboarding_contact_id,onboarding_completed_at)
        VALUES (${ownerless},'ACTIVE','Ownerless fixture','Ownerless fixture','REAL_ESTATE_AGENCY',${f.users[0]!},${f.contacts[0]!},transaction_timestamp())`;
    }), { code: '23514' });
    assert.equal((await f.client`SELECT count(*)::int AS count FROM organizations WHERE id=${ownerless}`)[0]?.count, 0);
    await assert.rejects(f.client`UPDATE organizations SET onboarding_completed_at=NULL WHERE id=${f.organizationId}`, { code: 'P0001' });
    for (const command of ['suspend', 'revoke', 'demote', 'delete'] as const) {
      await assert.rejects(f.client.begin(async tx => {
        if (command === 'delete') await tx`DELETE FROM organization_memberships WHERE id=${f.memberships[0]!}`;
        else if (command === 'demote') await tx`UPDATE organization_memberships SET role='ANALYST' WHERE id=${f.memberships[0]!}`;
        else await tx`UPDATE organization_memberships SET state=${command === 'suspend' ? 'SUSPENDED' : 'REVOKED'} WHERE id=${f.memberships[0]!}`;
      }), { code: '23514' });
    }
    assert.equal((await f.client`SELECT count(*)::int AS count FROM organization_memberships
      WHERE organization_id=${f.organizationId} AND role='OWNER' AND state='ACTIVE'`)[0]?.count, 1);
  } finally { await f.close(); }
});

void integration('organization creators retain a separate stable individual provider principal through onboarding retries', async () => {
  const f = await fixture();
  try {
    const store = new ProviderStore(f.client);
    const input = { providerTypes: ['OWNER'] as const, displayName: 'Individual alongside organization' };
    const individual = await store.onboard(f.users[0]!, input);
    assert.deepEqual(await store.onboard(f.users[0]!, input), individual);
    assert.deepEqual(await store.get(f.users[0]!), individual);
    const accounts = await f.client`SELECT kind,provider_profile_id,organization_id FROM provider_accounts
      WHERE organization_id=${f.organizationId} OR provider_profile_id=${individual.profileId} ORDER BY kind`;
    assert.deepEqual(Array.from(accounts), [
      { kind: 'INDIVIDUAL', provider_profile_id: individual.profileId, organization_id: null },
      { kind: 'ORGANIZATION', provider_profile_id: null, organization_id: f.organizationId },
    ]);
    assert.equal((await f.client`SELECT state FROM organizations WHERE id=${f.organizationId}`)[0]?.state, 'ACTIVE');
  } finally { await f.close(); }
});

for (const isolation of ['READ COMMITTED', 'REPEATABLE READ'] as const) {
  for (const command of ['demote', 'suspend', 'revoke', 'delete'] as const) {
void integration(`${isolation} concurrent direct owner ${command} commands preserve one active owner`, async () => {
  const f = await fixture(true);
  try {
    let ready = 0;
    let release!: () => void;
    const bothReady = new Promise<void>(resolve => { release = resolve; });
    const mutate = (membershipId: string) => f.client.begin(async tx => {
      if (isolation === 'REPEATABLE READ') await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
      // Establish both snapshots before either write. Parent serialization must
      // force a conflicting old-snapshot writer to abort, not pass a stale check.
      await tx`SELECT id FROM organizations WHERE id=${f.organizationId}`;
      if (++ready === 2) release();
      await bothReady;
      if (command === 'demote') await tx`UPDATE organization_memberships SET role='ANALYST' WHERE id=${membershipId}`;
      else if (command === 'delete') await tx`DELETE FROM organization_memberships WHERE id=${membershipId}`;
      else await tx`UPDATE organization_memberships SET state=${command === 'suspend' ? 'SUSPENDED' : 'REVOKED'} WHERE id=${membershipId}`;
    });
    const results = await Promise.allSettled(f.memberships.map(mutate));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected');
    assert.equal((rejected.reason as { code: string }).code, isolation === 'REPEATABLE READ' ? '40001' : '23514');
    assert.equal((await f.client`SELECT count(*)::int AS count FROM organization_memberships
      WHERE organization_id=${f.organizationId} AND role='OWNER' AND state='ACTIVE'`)[0]?.count, 1);
  } finally { await f.close(); }
});
  }
}
