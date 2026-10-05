import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase, IdentityError, ProviderStore, ProviderVerificationStore } from '@pachi/database';

const baseline = '670bbaf82b23f9bfb78610c038811753b66f01d6';
if (!process.env.DATABASE_TEST_URL && process.env.CI === 'true') {
  throw new Error('DATABASE_TEST_URL is required for G2 acceptance');
}
const integration = process.env.DATABASE_TEST_URL ? test : test.skip;

// Incomplete acceptance: stop at the first required workflow that cannot run.
// Do not replace unique evidence with fixed samples or manufacture later states.
void integration('G2 recorded individual-provider marketplace vertical-slice acceptance', async () => {
  const databaseUrl = process.env.DATABASE_TEST_URL;
  assert.ok(databaseUrl);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.hostname, 'localhost');
  assert.equal(parsed.port, '5433');
  assert.equal(parsed.pathname, '/pachi_test');
  const { client } = createDatabase(databaseUrl);
  let stage = 'provider_prerequisites';
  try {
    await client`SET client_min_messages TO warning`;
    await client`TRUNCATE users, job_receipts RESTART IDENTITY CASCADE`;
    const users = await client<{ id: string }[]>`INSERT INTO users(account_state) VALUES ('ACTIVE') RETURNING id`;
    const applicant = users[0];
    assert.ok(applicant);
    await client`INSERT INTO phone_contacts(user_id, normalized_e164, verified_at, verification_version)
      VALUES (${applicant.id}, '+237690009991', statement_timestamp(), 1)`;
    const prerequisite = await client<{ account_state: string; current_phone: boolean }[]>`
      SELECT account_state, EXISTS(SELECT 1 FROM phone_contacts
        WHERE user_id = users.id AND verified_at IS NOT NULL AND replaced_at IS NULL
        AND normalized_e164 ~ '^\\+237[0-9]{9}$') AS current_phone
      FROM users WHERE id = ${applicant.id}`;
    assert.deepEqual(prerequisite[0], { account_state: 'ACTIVE', current_phone: true });
    const provider = await new ProviderStore(client).onboard(applicant.id, {
      providerTypes: ['OWNER'], displayName: 'Synthetic G2 Owner', serviceArea: 'Littoral',
    });
    assert.equal(provider.state, 'DRAFT');
    assert.equal(provider.verificationStatus, 'NOT_VERIFIED');
    assert.deepEqual(provider.providerTypes, ['OWNER']);

    stage = 'provider_verification_unique_evidence_submission';
    const verification = new ProviderVerificationStore(client, 'g2-isolated-synthetic-evidence-key-v1', true);
    const privateEvidence = `PACHI_SYNTHETIC_GOVERNMENT_ID_V1_${randomUUID()}`;
    try {
      await verification.submit(applicant.id, {
        idempotencyKey: `g2_${randomUUID()}`, capacity: 'OWNER',
        governmentId: privateEvidence, liveSelfie: 'PACHI_SYNTHETIC_LIVE_SELFIE_V1',
        requestId: randomUUID(), syntheticEnabled: true,
      });
    } catch (error) {
      if (!(error instanceof IdentityError) || error.code !== 'EVIDENCE_POLICY_UNAVAILABLE') throw error;
      const state = await client<{
        profile_state: string; account_state: string; verification_status: string;
        case_count: number; evidence_count: number; claim_count: number;
      }[]>`SELECT p.state AS profile_state, a.state AS account_state, p.verification_status,
        (SELECT count(*)::int FROM verification_cases WHERE provider_profile_id = p.id) AS case_count,
        (SELECT count(*)::int FROM verification_evidence e JOIN verification_cases c ON c.id = e.case_id
          WHERE c.provider_profile_id = p.id) AS evidence_count,
        (SELECT count(*)::int FROM verification_claims WHERE provider_profile_id = p.id) AS claim_count
        FROM provider_profiles p JOIN provider_accounts a ON a.provider_profile_id = p.id
        WHERE p.id = ${provider.profileId}`;
      assert.deepEqual(state[0], {
        profile_state: 'DRAFT', account_state: 'DRAFT', verification_status: 'NOT_VERIFIED',
        case_count: 0, evidence_count: 0, claim_count: 0,
      });
      const counts = await client<Record<string, number>[]>`SELECT
        (SELECT count(*)::int FROM listing_revision_moderation_outbox WHERE event_type = 'LISTING_PUBLISHED') AS listing_published,
        (SELECT count(*)::int FROM interactions) AS interactions,
        (SELECT count(*)::int FROM conversations) AS conversations,
        (SELECT count(*)::int FROM messages) AS messages,
        (SELECT count(*)::int FROM interaction_outbox WHERE event_type = 'interaction_created') AS interaction_created,
        (SELECT count(*)::int FROM communication_outbox WHERE event_type = 'message_sent') AS message_sent,
        (SELECT count(*)::int FROM communication_outbox WHERE event_type = 'provider_first_response') AS provider_first_response,
        (SELECT count(*)::int FROM analytics_events) AS analytics_events,
        (SELECT count(*)::int FROM job_receipts) AS analytics_job_receipts,
        (SELECT count(*)::int FROM message_receipts) AS message_recipient_receipts`;
      assert.ok(counts[0]);
      assert.ok(Object.values(counts[0]).every(count => count === 0));
      console.log(`G2_ACCEPTANCE_RESULT=${JSON.stringify({
        status: 'BLOCKED', baseline, classification: 'TEST', stage,
        code: error.code, provider: state[0], counts: counts[0], downstream: 'NOT_RUN',
      })}`);
      throw new Error('G2 BLOCKED: unique synthetic verification evidence is rejected by the merged fixed-sample intake policy');
    }
    // A policy change requires separately authorized implementation and a complete
    // journey before this diagnostic can become a passing acceptance harness.
    throw new Error('G2 BLOCKED: verification intake changed; complete acceptance requires renewed review');
  } finally {
    await client`TRUNCATE users, job_receipts RESTART IDENTITY CASCADE`;
    await client.end();
  }
});
