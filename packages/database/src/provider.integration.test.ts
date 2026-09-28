import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from './client.js';
import { ProviderStore } from './provider.js';

if (!process.env.DATABASE_URL && process.env.CI === 'true') throw new Error('DATABASE_URL is required for CI database integration tests');
const integrationTest = process.env.DATABASE_URL ? test : test.skip;

void integrationTest('provider onboarding is retry-safe and requires active phone-confirmed users', async () => {
  const { client } = createDatabase();
  const store = new ProviderStore(client);
  const users = await client`INSERT INTO users (account_state) VALUES ('ACTIVE') RETURNING id`;
  const user = users[0]; assert.ok(user);
  try {
    await client`INSERT INTO phone_contacts (user_id, normalized_e164, verified_at, verification_version) VALUES (${user.id}, '+237690000009', now(), 1)`;
    const input = { providerTypes: ['OWNER', 'PROPERTY_MANAGER'] as const, displayName: 'Douala Homes', serviceArea: 'Littoral' };
    const first = await store.onboard(user.id, input);
    const second = await store.onboard(user.id, input);
    assert.equal(first.profileId, second.profileId);
    assert.equal(first.accountId, second.accountId);
    assert.deepEqual(second.providerTypes, ['OWNER', 'PROPERTY_MANAGER']);
    assert.equal(second.state, 'DRAFT');
    assert.equal(second.verificationStatus, 'NOT_VERIFIED');
    const count = await client`SELECT count(*)::int AS count FROM provider_profiles WHERE user_id = ${user.id}`;
    assert.equal(count[0]?.count, 1);
  } finally {
    await client`DELETE FROM provider_accounts WHERE provider_profile_id IN (SELECT id FROM provider_profiles WHERE user_id = ${user.id})`;
    await client`DELETE FROM provider_profiles WHERE user_id = ${user.id}`;
    await client`DELETE FROM phone_contacts WHERE user_id = ${user.id}`;
    await client`DELETE FROM users WHERE id = ${user.id}`;
    await client.end();
  }
});
