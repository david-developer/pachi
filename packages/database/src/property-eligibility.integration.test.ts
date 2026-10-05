import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from './client.js';
import { PropertyDraftStore } from './property.js';
import { ProviderStore } from './provider.js';

const url = process.env.DATABASE_URL;
if (!url && process.env.CI === 'true') throw new Error('DATABASE_URL is required for provider eligibility regressions');
if (url) {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, 'localhost');
  assert.equal(parsed.port, '5433');
  assert.equal(parsed.pathname, '/pachi_test');
}
const integration = url ? test : test.skip;

for (const loss of ['replaced phone', 'unverified phone', 'suspended provider account'] as const) {
  void integration(`private draft operations deny a ${loss} without changing inventory`, async () => {
    const { client } = createDatabase(url);
    const userId = randomUUID();
    const phone = '+237699992001';
    try {
      await client`INSERT INTO users(id,account_state) VALUES (${userId},'ACTIVE')`;
      await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${userId},${phone},now(),1)`;
      const provider = await new ProviderStore(client).onboard(userId, { providerTypes: ['OWNER'], displayName: 'Eligibility regression' });
      const store = new PropertyDraftStore(client);
      const propertyInput = { propertyType: 'APARTMENT', region: 'Littoral', city: 'Douala', neighborhood: 'Akwa', relationshipType: 'OWNER' };
      const property = await store.createProperty(userId, propertyInput);
      const draft = await store.createDraft(userId, { propertyId: property.id, purpose: 'RENT', amountMinor: 100000 });
      if (loss === 'replaced phone') await client`UPDATE phone_contacts SET replaced_at=now() WHERE user_id=${userId}`;
      if (loss === 'unverified phone') await client`UPDATE phone_contacts SET verified_at=NULL WHERE user_id=${userId}`;
      if (loss === 'suspended provider account') await client`UPDATE provider_accounts SET state='SUSPENDED' WHERE id=${provider.accountId}`;
      for (const operation of [
        () => store.properties(userId),
        () => store.drafts(userId),
        () => store.draft(userId, draft.id),
        () => store.createProperty(userId, propertyInput),
        () => store.createDraft(userId, { propertyId: property.id, purpose: 'RENT', amountMinor: 200000 }),
        () => store.updateDraft(userId, draft.id, { title: 'Denied edit' }),
      ]) await assert.rejects(operation, { code: 'PROVIDER_ELIGIBILITY_REQUIRED' });
      const inventory = await client`SELECT
        (SELECT count(*)::int FROM properties WHERE created_by_user_id=${userId}) AS properties,
        (SELECT count(*)::int FROM listings WHERE created_by_user_id=${userId}) AS listings,
        (SELECT count(*)::int FROM listing_revisions WHERE created_by_user_id=${userId}) AS revisions`;
      assert.deepEqual(Array.from(inventory), [{ properties: 1, listings: 1, revisions: 1 }]);
    } finally {
      await client`DELETE FROM offerings WHERE listing_id IN (SELECT id FROM listings WHERE created_by_user_id=${userId})`;
      await client`UPDATE listings SET current_revision_id=NULL WHERE created_by_user_id=${userId}`;
      await client`DELETE FROM listings WHERE created_by_user_id=${userId}`;
      await client`DELETE FROM provider_property_relationships WHERE provider_account_id IN (SELECT id FROM provider_accounts WHERE provider_profile_id IN (SELECT id FROM provider_profiles WHERE user_id=${userId}))`;
      await client`DELETE FROM properties WHERE created_by_user_id=${userId}`;
      await client`DELETE FROM provider_accounts WHERE provider_profile_id IN (SELECT id FROM provider_profiles WHERE user_id=${userId})`;
      await client`DELETE FROM provider_profiles WHERE user_id=${userId}`;
      await client`DELETE FROM phone_contacts WHERE user_id=${userId}`;
      await client`DELETE FROM users WHERE id=${userId}`;
      await client.end();
    }
  });
}
