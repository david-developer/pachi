import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createDatabase } from './client.js';
import { viewingFixture } from './viewing-fixture.js';
import { ViewingStore } from './viewing.js';
import { BlockStore } from './block.js';
import { PublicListingStore } from './public-listing.js';
import { organizationAssignmentFixture } from './organization-assignment-fixture.js';
import { OrganizationAssignmentStore } from './organization-assignments.js';
import { PropertyDraftStore } from './property.js';

const url = process.env.DATABASE_TEST_URL;
if (url) {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, 'localhost');
  assert.equal(parsed.port, '5433');
  assert.equal(parsed.pathname, '/pachi_test');
}
const integration = url ? test : test.skip;
type Client = ReturnType<typeof createDatabase>['client'];
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Viewing = Awaited<ReturnType<ViewingStore['get']>>;
const expected = (viewing: Viewing) => ({ expected_version: viewing.version, expected_schedule_version: viewing.schedule_version });
const instructions = 'PRIVATE_VIEWING_GATE_81C3: meet by the staffed reception';

async function fixture() {
  const { client } = createDatabase(url!);
  await client`SET client_min_messages TO warning`;
  await client`TRUNCATE users RESTART IDENTITY CASCADE`;
  await client`UPDATE region_publication_controls SET enabled=true`;
  try {
    return {
      ...(await viewingFixture(client)), client,
      async close() {
        await client`UPDATE region_publication_controls SET enabled=true`;
        await client`TRUNCATE users RESTART IDENTITY CASCADE`;
        await client.end();
      },
    };
  } catch (error) { await client.end(); throw error; }
}
async function create(f: Fixture) {
  return (await f.store.create(f.actors.seeker, f.interaction.interaction_id, f.input, f.command())).viewing;
}
async function accept(f: Fixture, viewing: Viewing) {
  return (await f.store.accept(f.actors.provider, viewing.id, {
    ...expected(viewing), scheduled_start: viewing.proposed_start, scheduled_end: viewing.proposed_end, private_instructions: instructions,
  }, f.command())).viewing;
}
async function schedule(f: Fixture) {
  let viewing = await accept(f, await create(f));
  viewing = (await f.store.confirm(f.actors.seeker, viewing.id, expected(viewing), f.command())).viewing;
  return (await f.store.confirm(f.actors.provider, viewing.id, expected(viewing), f.command())).viewing;
}
async function effects(client: Client) {
  return (await client`SELECT
    (SELECT count(*)::int FROM viewings) AS viewings,
    (SELECT count(*)::int FROM viewing_events) AS events,
    (SELECT count(*)::int FROM viewing_command_receipts) AS receipts,
    (SELECT count(*)::int FROM viewing_outbox) AS outbox,
    (SELECT count(*)::int FROM viewing_scheduled_actions) AS jobs`)[0]!;
}

void integration('G3-F1 valid request derives participants and context, stores UTC and the exact 48-hour response deadline', async () => {
  const f = await fixture();
  try {
    const viewing = await create(f);
    assert.equal(viewing.interaction_id, f.interaction.interaction_id);
    assert.equal(viewing.listing_id, f.listingId);
    assert.equal(viewing.seeker_user_id, f.seekerId);
    assert.equal(viewing.provider_account_id, (await f.client`SELECT provider_account_id FROM interactions WHERE id=${f.interaction.interaction_id}`)[0]!.provider_account_id);
    assert.equal(viewing.state, 'REQUESTED');
    assert.equal(viewing.version, 1);
    assert.equal(viewing.schedule_version, 1);
    assert.equal(viewing.proposed_start, f.input.proposed_start);
    assert.equal(viewing.display_timezone, 'Africa/Douala');
    assert.equal(viewing.private_instructions, null);
    assert.equal(viewing.actor_side, 'SEEKER');
    const durable = (await f.client`SELECT extract(epoch FROM response_deadline-created_at)::int AS seconds FROM viewings WHERE id=${viewing.id}`)[0]!;
    assert.equal(durable.seconds, 48 * 60 * 60);
    assert.deepEqual(await effects(f.client), { viewings: 1, events: 1, receipts: 1, outbox: 1, jobs: 1 });
    const provider = await f.store.get(f.actors.provider, viewing.id);
    assert.equal(provider.actor_side, 'PROVIDER');
    assert.equal(provider.can_accept, true);
    assert.equal(provider.can_decline, true);
    assert.equal((await f.store.list(f.actors.seeker, { interaction_id: f.interaction.interaction_id })).items[0]?.id, viewing.id);
  } finally { await f.close(); }
});

void integration('G3-F1 proposed start is the earlier deadline and timezone preserves a valid non-default display zone', async () => {
  const f = await fixture();
  try {
    const t = (await f.client<{ start: Date; end: Date }[]>`SELECT statement_timestamp()+interval '2 hours' AS start,statement_timestamp()+interval '3 hours' AS end`)[0]!;
    const viewing = (await f.store.create(f.actors.seeker, f.interaction.interaction_id, {
      proposed_start: new Date(t.start).toISOString(), proposed_end: new Date(t.end).toISOString(), display_timezone: 'Europe/Istanbul',
    }, f.command())).viewing;
    assert.equal(viewing.response_deadline, new Date(t.start).toISOString());
    assert.equal(viewing.display_timezone, 'Europe/Istanbul');
    assert.equal(viewing.proposed_start, new Date(t.start).toISOString());
  } finally { await f.close(); }
});

for (const denial of ['other-seeker', 'provider-as-seeker', 'missing-interaction', 'unverified', 'limited', 'revoked-session', 'expired-session', 'security-version', 'wrong-session'] as const)
  void integration(`G3-F1 ${denial} cannot create viewing effects`, async () => {
    const f = await fixture();
    try {
      let actor = f.actors.seeker;
      let id = f.interaction.interaction_id;
      let code = 'CAPABILITY_RESTRICTED';
      if (denial === 'other-seeker') { actor = f.actors.other; code = 'RESOURCE_SCOPE_DENIED'; }
      if (denial === 'provider-as-seeker') { actor = f.actors.provider; code = 'RESOURCE_SCOPE_DENIED'; }
      if (denial === 'missing-interaction') { id = randomUUID(); code = 'RESOURCE_SCOPE_DENIED'; }
      if (denial === 'unverified') await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${f.seekerId}`;
      if (denial === 'limited') await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${f.seekerId}`;
      if (denial === 'revoked-session') await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${actor.sessionId}`;
      if (denial === 'expired-session') await f.client`UPDATE security_sessions SET expires_at=statement_timestamp()-interval '1 second' WHERE id=${actor.sessionId}`;
      if (denial === 'security-version') await f.client`UPDATE users SET security_version=security_version+1 WHERE id=${actor.userId}`;
      if (denial === 'wrong-session') actor = { ...actor, sessionId: f.actors.other.sessionId };
      if (['revoked-session', 'expired-session', 'security-version', 'wrong-session'].includes(denial)) code = 'AUTH_REQUIRED';
      await assert.rejects(f.store.create(actor, id, f.input, f.command()), { code });
      assert.deepEqual(await effects(f.client), { viewings: 0, events: 0, receipts: 0, outbox: 0, jobs: 0 });
    } finally { await f.close(); }
  });

for (const loss of ['closed', 'restricted', 'unavailable', 'expired-listing', 'hidden', 'unapproved-revision', 'disabled-region', 'revoked-identity', 'authority-stale'] as const)
  void integration(`G3-F1 ${loss} interaction/listing denies new request without effects`, async () => {
    const f = await fixture();
    try {
      if (loss === 'closed') await f.client`UPDATE interactions SET state='CLOSED',closed_at=statement_timestamp(),version=version+1 WHERE id=${f.interaction.interaction_id}`;
      if (loss === 'restricted') await f.client`UPDATE interactions SET state='RESTRICTED',version=version+1 WHERE id=${f.interaction.interaction_id}`;
      if (loss === 'unavailable') await f.client`UPDATE listings SET market_status='RENTED' WHERE id=${f.listingId}`;
      if (loss === 'expired-listing') await f.client`UPDATE listings SET last_confirmed_at=statement_timestamp()-interval '31 days',expires_at=statement_timestamp()-interval '1 day' WHERE id=${f.listingId}`;
      if (loss === 'hidden') await f.client`UPDATE listings SET publication_status='HIDDEN' WHERE id=${f.listingId}`;
      if (loss === 'unapproved-revision') {
        const revision = (await f.client<{ id: string }[]>`INSERT INTO listing_revisions(listing_id,version,title,description,created_by_user_id)
          SELECT l.id,r.version+1,'Unapproved current viewing listing',r.description,${f.providerUserId}
          FROM listings l JOIN listing_revisions r ON r.id=l.current_revision_id WHERE l.id=${f.listingId} RETURNING id`)[0]!;
        await f.client`UPDATE listings SET current_revision_id=${revision.id} WHERE id=${f.listingId}`;
      }
      if (loss === 'disabled-region') await f.client`UPDATE region_publication_controls SET enabled=false WHERE region='Littoral'`;
      if (loss === 'revoked-identity') await f.client`UPDATE verification_claims SET revoked_at=statement_timestamp() WHERE provider_profile_id=(SELECT provider_profile_id FROM provider_accounts WHERE id=(SELECT provider_account_id FROM listings WHERE id=${f.listingId}))`;
      if (loss === 'authority-stale') await f.client`UPDATE authority_risk_source_clock SET version=version+1 WHERE singleton`;
      await assert.rejects(f.store.create(f.actors.seeker, f.interaction.interaction_id, f.input, f.command()), { code: 'CAPABILITY_RESTRICTED' });
      assert.equal((await effects(f.client)).viewings, 0);
      assert.equal((await effects(f.client)).outbox, 0);
    } finally { await f.close(); }
  });

for (const side of ['seeker', 'provider'] as const)
  void integration(`G3-F1 ${side} block denies request and response but preserves safe cancellation`, async () => {
    const f = await fixture();
    try {
      const viewing = await create(f);
      await new BlockStore(f.client, true).block(f.actors[side], 'interaction', f.interaction.interaction_id, f.command());
      await assert.rejects(f.store.accept(f.actors.provider, viewing.id, { ...expected(viewing), scheduled_start: viewing.proposed_start, scheduled_end: viewing.proposed_end, private_instructions: instructions }, f.command()), { code: 'CAPABILITY_RESTRICTED' });
      const cancelled = (await f.store.cancel(f.actors[side], viewing.id, { ...expected(viewing), reason: 'SAFETY' }, f.command())).viewing;
      assert.equal(cancelled.state, side === 'seeker' ? 'CANCELLED_BY_SEEKER' : 'CANCELLED_BY_PROVIDER');
      await assert.rejects(f.store.create(f.actors.seeker, f.interaction.interaction_id, f.input, f.command()), { code: 'CAPABILITY_RESTRICTED' });
      assert.equal((await effects(f.client)).events, 2);
    } finally { await f.close(); }
  });

for (const invalid of ['malformed-start', 'past', 'reversed', 'equal', 'invalid-zone', 'wrong-zone-case'] as const)
  void integration(`G3-F1 ${invalid} time range is rejected before persistence`, async () => {
    const f = await fixture();
    try {
      const input = { ...f.input };
      if (invalid === 'malformed-start') input.proposed_start = 'not-a-time';
      if (invalid === 'past') { input.proposed_start = '2000-01-01T01:00:00Z'; input.proposed_end = '2000-01-01T02:00:00Z'; }
      if (invalid === 'reversed') input.proposed_end = input.proposed_start.slice(0, 10) + 'T00:00:00Z';
      if (invalid === 'equal') input.proposed_end = input.proposed_start;
      if (invalid === 'invalid-zone') input.display_timezone = 'Mars/Olympus';
      if (invalid === 'wrong-zone-case') input.display_timezone = 'africa/douala';
      await assert.rejects(f.store.create(f.actors.seeker, f.interaction.interaction_id, input, f.command()), { code: 'INVALID_INPUT' });
      assert.equal((await effects(f.client)).viewings, 0);
    } finally { await f.close(); }
  });

void integration('G3-F1 durable create replay is effect-free, changed resource/body conflicts and duplicate active requests fail', async () => {
  const f = await fixture();
  try {
    const command = f.command();
    const first = await f.store.create(f.actors.seeker, f.interaction.interaction_id, f.input, command);
    const before = await effects(f.client);
    const replay = await f.store.create(f.actors.seeker, f.interaction.interaction_id, f.input, command);
    assert.equal(replay.replayed, true);
    assert.equal(replay.viewing.id, first.viewing.id);
    assert.deepEqual(await effects(f.client), before);
    await assert.rejects(f.store.create(f.actors.seeker, f.interaction.interaction_id, { ...f.input, display_timezone: 'Europe/Istanbul' }, command), { code: 'IDEMPOTENCY_KEY_REUSED' });
    await assert.rejects(f.store.create(f.actors.seeker, randomUUID(), f.input, command), { code: 'IDEMPOTENCY_KEY_REUSED' });
    await assert.rejects(f.store.create(f.actors.seeker, f.interaction.interaction_id, f.input, f.command()), { code: 'ACTIVE_VIEWING_EXISTS' });
    await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${f.actors.seeker.sessionId}`;
    await assert.rejects(f.store.create(f.actors.seeker, f.interaction.interaction_id, f.input, command), { code: 'AUTH_REQUIRED' });
    assert.deepEqual(await effects(f.client), before);
  } finally { await f.close(); }
});

void integration('G3-F1 provider acceptance requires exact proposal and both explicit confirmations before private instructions appear', async () => {
  const f = await fixture();
  try {
    const requested = await create(f);
    await assert.rejects(f.store.accept(f.actors.other, requested.id, { ...expected(requested), scheduled_start: requested.proposed_start, scheduled_end: requested.proposed_end, private_instructions: instructions }, f.command()), { code: 'RESOURCE_SCOPE_DENIED' });
    await assert.rejects(f.store.accept(f.actors.provider, requested.id, { ...expected(requested), scheduled_start: requested.proposed_end, scheduled_end: new Date(Date.parse(requested.proposed_end) + 3600000).toISOString(), private_instructions: instructions }, f.command()), { code: 'INVALID_INPUT' });
    const acceptance = { ...expected(requested), scheduled_start: requested.proposed_start, scheduled_end: requested.proposed_end, private_instructions: instructions };
    const command = f.command();
    let viewing = (await f.store.accept(f.actors.provider, requested.id, acceptance, command)).viewing;
    assert.equal(viewing.state, 'ACCEPTED');
    assert.equal(viewing.provider_confirmed, false);
    assert.equal(viewing.seeker_confirmed, false);
    assert.equal(viewing.private_instructions, null);
    assert.equal((await f.store.get(f.actors.seeker, viewing.id)).private_instructions, null);
    const before = await effects(f.client);
    assert.equal((await f.store.accept(f.actors.provider, requested.id, acceptance, command)).replayed, true);
    assert.deepEqual(await effects(f.client), before);
    await assert.rejects(f.store.confirm(f.actors.seeker, viewing.id, { ...expected(viewing), expected_schedule_version: viewing.schedule_version + 1 }, f.command()), { code: 'STALE_SCHEDULE_VERSION' });
    viewing = (await f.store.confirm(f.actors.provider, viewing.id, expected(viewing), f.command())).viewing;
    assert.equal(viewing.state, 'ACCEPTED');
    assert.equal(viewing.provider_confirmed, true);
    assert.equal(viewing.seeker_confirmed, false);
    assert.equal(viewing.private_instructions, null);
    const confirmInput = expected(viewing), confirmCommand = f.command();
    viewing = (await f.store.confirm(f.actors.seeker, viewing.id, confirmInput, confirmCommand)).viewing;
    assert.equal(viewing.state, 'SCHEDULED');
    assert.equal(viewing.seeker_confirmed, true);
    assert.equal(viewing.provider_confirmed, true);
    assert.equal(viewing.private_instructions, instructions);
    assert.equal((await f.store.get(f.actors.provider, viewing.id)).private_instructions, instructions);
    const completed = await effects(f.client);
    assert.equal((await f.store.confirm(f.actors.seeker, viewing.id, confirmInput, confirmCommand)).replayed, true);
    assert.deepEqual(await effects(f.client), completed);
    assert.equal((await f.client`SELECT * FROM viewing_scheduled_actions WHERE state='PENDING'`).length, 0);
    const safe = [await f.client`SELECT * FROM viewing_events`, await f.client`SELECT * FROM viewing_outbox`, await f.client`SELECT * FROM viewing_command_receipts`, await f.client`SELECT * FROM audit_events WHERE target_type='Viewing'`];
    assert.equal(JSON.stringify(safe).includes(instructions), false);
    assert.equal(JSON.stringify(await new PublicListingStore(f.client, true).detail(f.listingId)).includes(instructions), false);
    await assert.rejects(f.store.get(f.actors.other, viewing.id), { code: 'RESOURCE_SCOPE_DENIED' });
  } finally { await f.close(); }
});

void integration('G3-F1 decline is terminal, reasoned, replay-safe and permits a new appointment episode', async () => {
  const f = await fixture();
  try {
    const viewing = await create(f);
    await assert.rejects(f.store.decline(f.actors.seeker, viewing.id, { ...expected(viewing), reason: 'OTHER' }, f.command()), { code: 'RESOURCE_SCOPE_DENIED' });
    const input = { ...expected(viewing), reason: 'TIME_UNSUITABLE' }, command = f.command();
    const declined = (await f.store.decline(f.actors.provider, viewing.id, input, command)).viewing;
    assert.equal(declined.state, 'DECLINED');
    assert.equal(declined.reason, input.reason);
    assert.equal((await f.store.decline(f.actors.provider, viewing.id, input, command)).replayed, true);
    await assert.rejects(f.store.confirm(f.actors.provider, viewing.id, expected(declined), f.command()), { code: 'INVALID_STATE' });
    const later = await create(f);
    assert.notEqual(later.id, viewing.id);
    assert.equal((await f.store.get(f.actors.seeker, viewing.id)).state, 'DECLINED');
    assert.equal((await effects(f.client)).events, 3);
    assert.equal((await f.store.list(f.actors.provider, { interaction_id: f.interaction.interaction_id })).items.length, 2);
  } finally { await f.close(); }
});

for (const loss of ['hidden-listing', 'closed-interaction', 'limited-account', 'replaced-phone', 'blocked'] as const)
  void integration(`G3-F1 safe cancellation survives ${loss} and removes future instruction disclosure`, async () => {
    const f = await fixture();
    try {
      const viewing = await schedule(f);
      if (loss === 'hidden-listing') await f.client`UPDATE listings SET publication_status='HIDDEN' WHERE id=${f.listingId}`;
      if (loss === 'closed-interaction') await f.client`UPDATE interactions SET state='CLOSED',closed_at=statement_timestamp() WHERE id=${f.interaction.interaction_id}`;
      if (loss === 'limited-account') await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${f.seekerId}`;
      if (loss === 'replaced-phone') await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${f.seekerId}`;
      if (loss === 'blocked') await new BlockStore(f.client, true).block(f.actors.seeker, 'interaction', f.interaction.interaction_id, f.command());
      const limitedHistory = await f.store.get(f.actors.seeker, viewing.id);
      assert.equal(limitedHistory.state, 'SCHEDULED');
      assert.equal(limitedHistory.private_instructions, null);
      assert.equal(limitedHistory.can_cancel, true);
      const cancelled = (await f.store.cancel(f.actors.seeker, viewing.id, { ...expected(viewing), reason: 'SAFETY' }, f.command())).viewing;
      assert.equal(cancelled.state, 'CANCELLED_BY_SEEKER');
      assert.equal(cancelled.private_instructions, null);
      assert.equal((await f.store.get(f.actors.provider, viewing.id)).private_instructions, null);
      assert.equal((await f.store.get(f.actors.seeker, viewing.id)).private_instructions, null);
      assert.equal((await f.client`SELECT event_type FROM viewing_outbox WHERE event_type='viewing_cancelled'`).length, 1);
      const history = await f.client`SELECT * FROM viewing_events WHERE viewing_id=${viewing.id} ORDER BY sequence`;
      assert.equal(history.at(-1)?.new_state, 'CANCELLED_BY_SEEKER');
      assert.deepEqual(history.map(row => row.sequence), [1, 2, 3, 4, 5]);
    } finally { await f.close(); }
  });

void integration('G3-F1 stale command versions, wrong IDs and invalid transitions cannot change appointment history', async () => {
  const f = await fixture();
  try {
    const requested = await create(f);
    await assert.rejects(f.store.confirm(f.actors.seeker, requested.id, expected(requested), f.command()), { code: 'INVALID_STATE' });
    const accepted = await accept(f, requested), before = await effects(f.client);
    await assert.rejects(f.store.cancel(f.actors.seeker, accepted.id, { ...expected(requested), reason: 'PLANS_CHANGED' }, f.command()), { code: 'STALE_VERSION' });
    await assert.rejects(f.store.decline(f.actors.provider, accepted.id, { ...expected(accepted), reason: 'OTHER' }, f.command()), { code: 'INVALID_STATE' });
    await assert.rejects(f.store.cancel(f.actors.other, accepted.id, { ...expected(accepted), reason: 'OTHER' }, f.command()), { code: 'RESOURCE_SCOPE_DENIED' });
    await assert.rejects(f.store.get(f.actors.seeker, randomUUID()), { code: 'RESOURCE_SCOPE_DENIED' });
    await assert.rejects(f.store.list(f.actors.other, { interaction_id: f.interaction.interaction_id }), { code: 'RESOURCE_SCOPE_DENIED' });
    assert.deepEqual((await f.store.list(f.actors.other, {})).items, []);
    assert.deepEqual(await effects(f.client), before);
  } finally { await f.close(); }
});

for (const loss of ['provider-account', 'provider-profile', 'provider-identity', 'provider-authority'] as const)
  void integration(`G3-F1 current ${loss} loss hides scheduled instructions while preserving safe participant cancellation`, async () => {
    const f = await fixture();
    try {
      const viewing = await schedule(f);
      assert.equal((await f.store.get(f.actors.seeker, viewing.id)).private_instructions, instructions);
      if (loss === 'provider-account') await f.client`UPDATE provider_accounts SET state='SUSPENDED' WHERE id=${viewing.provider_account_id}`;
      if (loss === 'provider-profile') await f.client`UPDATE provider_profiles SET state='SUSPENDED' WHERE user_id=${f.providerUserId}`;
      if (loss === 'provider-identity') await f.client`UPDATE verification_claims SET revoked_at=statement_timestamp() WHERE provider_profile_id=(SELECT provider_profile_id FROM provider_accounts WHERE id=${viewing.provider_account_id})`;
      if (loss === 'provider-authority') await f.client`UPDATE provider_property_relationships SET authorization_status='REVOKED' WHERE id=(SELECT provider_property_relationship_id FROM listings WHERE id=${f.listingId})`;
      for (const actor of [f.actors.seeker, f.actors.provider]) {
        const history = await f.store.get(actor, viewing.id);
        assert.equal(history.state, 'SCHEDULED');
        assert.equal(history.private_instructions, null);
        assert.equal(history.can_cancel, true);
      }
      const cancelled = (await f.store.cancel(f.actors.seeker, viewing.id, { ...expected(viewing), reason: 'SAFETY' }, f.command())).viewing;
      assert.equal(cancelled.state, 'CANCELLED_BY_SEEKER');
      assert.equal(cancelled.private_instructions, null);
    } finally { await f.close(); }
  });

void integration('G3-F1 failed outbox persistence rolls back appointment, audit, receipt and scheduled-action changes atomically', async () => {
  const f = await fixture();
  try {
    const requested = await create(f), before = await effects(f.client);
    const audits = (await f.client`SELECT count(*)::int AS count FROM audit_events WHERE target_type='Viewing'`)[0]!.count;
    await f.client.unsafe(`CREATE FUNCTION g3f1_test_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic transactional outbox failure'; END $$;
      CREATE TRIGGER g3f1_test_outbox_failure BEFORE INSERT ON viewing_outbox FOR EACH ROW EXECUTE FUNCTION g3f1_test_outbox_failure()`);
    await assert.rejects(accept(f, requested), { code: 'P0001' });
    assert.deepEqual(await effects(f.client), before);
    const unchanged = await f.store.get(f.actors.seeker, requested.id);
    assert.equal(unchanged.state, 'REQUESTED');
    assert.equal(unchanged.version, requested.version);
    assert.equal((await f.client`SELECT state FROM viewing_scheduled_actions WHERE viewing_id=${requested.id}`)[0]!.state, 'PENDING');
    assert.equal((await f.client`SELECT count(*)::int AS count FROM audit_events WHERE target_type='Viewing'`)[0]!.count, audits);
  } finally {
    await f.client.unsafe('DROP TRIGGER IF EXISTS g3f1_test_outbox_failure ON viewing_outbox; DROP FUNCTION IF EXISTS g3f1_test_outbox_failure()');
    await f.close();
  }
});

void integration('G3-F1 append-only events, receipts and outbox reject direct mutation and carry no private meeting text', async () => {
  const f = await fixture();
  try {
    await schedule(f);
    for (const table of ['viewing_events', 'viewing_command_receipts', 'viewing_outbox'] as const) {
      const rows = await f.client.unsafe(`SELECT * FROM ${table}`);
      assert.equal(JSON.stringify(rows).includes(instructions), false);
      await assert.rejects(f.client.unsafe(`DELETE FROM ${table}`));
    }
    assert.equal((await f.client`SELECT count(*)::int AS count FROM viewing_outbox WHERE event_type='viewing_scheduled'`)[0]!.count, 1);
    assert.equal((await f.client`SELECT count(*)::int AS count FROM viewing_events WHERE event_type='viewing_scheduled'`)[0]!.count, 1);
    assert.equal((await f.client`SELECT * FROM viewing_scheduled_actions WHERE state='PENDING'`).length, 0);
  } finally { await f.close(); }
});

void integration('G3-F1 historical provider attribution cannot preserve access after current ownership changes', async () => {
  const f = await fixture();
  try {
    const viewing = await schedule(f);
    await f.client`UPDATE provider_profiles SET user_id=${f.otherUserId} WHERE user_id=${f.providerUserId}`;
    const before = await effects(f.client);
    await assert.rejects(f.store.get(f.actors.provider, viewing.id), { code: 'RESOURCE_SCOPE_DENIED' });
    await assert.rejects(f.store.cancel(f.actors.provider, viewing.id, { ...expected(viewing), reason: 'OTHER' }, f.command()), { code: 'RESOURCE_SCOPE_DENIED' });
    assert.equal((await f.store.get(f.actors.other, viewing.id)).actor_side, 'PROVIDER');
    assert.equal((await f.store.get(f.actors.other, viewing.id)).private_instructions, null);
    assert.deepEqual(await effects(f.client), before);
  } finally { await f.close(); }
});

// These barriers observe the exact backend's PostgreSQL lock wait. They do not
// infer overlap from Promise.all or depend on a timer advancing a policy window.
async function waiting(client: Client, pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const found = await client`SELECT pid FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'`;
    if (found[0]) return;
  }
  throw new Error('Dedicated viewing command did not arrive at the database lock barrier');
}
function dedicated() {
  const client = postgres(url!, { max: 1, prepare: false });
  // Match createDatabase's parser/serializer configuration, as do the existing
  // listing lifecycle dedicated-connection tests.
  drizzle(client);
  return client;
}
function failureMessage(result: PromiseSettledResult<unknown>) {
  if (result.status === 'fulfilled') return undefined;
  const error = result.reason as { code?: unknown; name?: unknown; message?: unknown };
  return `${String(error.code ?? error.name ?? 'UNKNOWN')}: ${String(error.message ?? 'command failed')}`;
}

for (const sameKey of [false, true])
  void integration(`G3-F1 controlled concurrent ${sameKey ? 'identical retries' : 'distinct requests'} creates exactly one active appointment`, async () => {
    const f = await fixture(), a = dedicated(), b = dedicated(), gate = dedicated();
    let release!: () => void;
    let holder: Promise<unknown> | undefined;
    const pending: Promise<PromiseSettledResult<Awaited<ReturnType<ViewingStore['create']>>>[]>[] = [];
    try {
      const aPid = (await a<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      const bPid = (await b<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      assert.notEqual(aPid, bPid);
      let ready!: () => void;
      const held = new Promise<void>(r => { ready = r; }), free = new Promise<void>(r => { release = r; });
      holder = gate.begin(async tx => { await tx`LOCK TABLE viewings IN SHARE MODE`; ready(); await free; });
      await held;
      const input = f.command();
      pending.push(Promise.allSettled([new ViewingStore(a, true).create(f.actors.seeker, f.interaction.interaction_id, f.input, input)]));
      await waiting(f.client, aPid);
      pending.push(Promise.allSettled([new ViewingStore(b, true).create(f.actors.seeker, f.interaction.interaction_id, f.input, sameKey ? input : f.command())]));
      await waiting(f.client, bPid);
      release(); await holder;
      const one = (await pending[0]!)[0]!, two = (await pending[1]!)[0]!;
      assert.equal(one.status, 'fulfilled', failureMessage(one));
      if (sameKey) {
        assert.equal(two.status, 'fulfilled', failureMessage(two));
        assert.equal((two as PromiseFulfilledResult<Awaited<ReturnType<ViewingStore['create']>>>).value.replayed, true);
        assert.equal((two as PromiseFulfilledResult<Awaited<ReturnType<ViewingStore['create']>>>).value.viewing.id, (one as PromiseFulfilledResult<Awaited<ReturnType<ViewingStore['create']>>>).value.viewing.id);
      } else {
        assert.equal(two.status, 'rejected');
        assert.equal((two as PromiseRejectedResult).reason.code, 'ACTIVE_VIEWING_EXISTS');
      }
      assert.deepEqual(await effects(f.client), { viewings: 1, events: 1, receipts: 1, outbox: 1, jobs: 1 });
    } finally {
      release?.(); await holder?.catch(() => {}); await Promise.all(pending);
      await Promise.all([a.end(), b.end(), gate.end()]); await f.close();
    }
  });

void integration('G3-F1 concurrent joint confirmations reject the stale writer and schedule once after current-version agreement', async () => {
  const f = await fixture(), a = dedicated(), b = dedicated(), gate = dedicated();
  let release!: () => void;
  let holder: Promise<unknown> | undefined;
  const pending: Promise<PromiseSettledResult<Awaited<ReturnType<ViewingStore['confirm']>>>[]>[] = [];
  try {
    const accepted = await accept(f, await create(f));
    const aPid = (await a<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    const bPid = (await b<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    let ready!: () => void;
    const held = new Promise<void>(r => { ready = r; }), free = new Promise<void>(r => { release = r; });
    holder = gate.begin(async tx => { await tx`LOCK TABLE viewing_events IN SHARE MODE`; ready(); await free; });
    await held;
    pending.push(Promise.allSettled([new ViewingStore(a, true).confirm(f.actors.seeker, accepted.id, expected(accepted), f.command())]));
    await waiting(f.client, aPid);
    pending.push(Promise.allSettled([new ViewingStore(b, true).confirm(f.actors.provider, accepted.id, expected(accepted), f.command())]));
    await waiting(f.client, bPid);
    release(); await holder;
    const one = (await pending[0]!)[0]!, two = (await pending[1]!)[0]!;
    assert.equal(one.status, 'fulfilled', failureMessage(one));
    assert.equal(two.status, 'rejected');
    assert.equal((two as PromiseRejectedResult).reason.code, 'STALE_VERSION');
    const current = await f.store.get(f.actors.provider, accepted.id);
    assert.equal(current.state, 'ACCEPTED');
    assert.equal(current.seeker_confirmed, true);
    assert.equal(current.provider_confirmed, false);
    const scheduled = (await f.store.confirm(f.actors.provider, current.id, expected(current), f.command())).viewing;
    assert.equal(scheduled.state, 'SCHEDULED');
    assert.equal((await f.client`SELECT * FROM viewing_outbox WHERE event_type='viewing_scheduled'`).length, 1);
    assert.equal((await effects(f.client)).events, 4);
  } finally {
    release?.(); await holder?.catch(() => {}); await Promise.all(pending);
    await Promise.all([a.end(), b.end(), gate.end()]); await f.close();
  }
});

async function historicalRequest(client: Client, interactionId: string, proposedStartIsEarlier = false) {
  const rows = await client<{ id: string }[]>`INSERT INTO viewings(interaction_id,listing_id,provider_account_id,seeker_user_id,requested_by_user_id,
    proposed_start,proposed_end,display_timezone,response_deadline,created_at,updated_at)
    SELECT i.id,i.listing_id,i.provider_account_id,i.seeker_user_id,i.seeker_user_id,
      CASE WHEN ${proposedStartIsEarlier} THEN statement_timestamp()-interval '2 days' ELSE statement_timestamp()+interval '1 day' END,
      CASE WHEN ${proposedStartIsEarlier} THEN statement_timestamp()-interval '2 days'+interval '1 hour' ELSE statement_timestamp()+interval '25 hours' END,
      'Africa/Douala',
      CASE WHEN ${proposedStartIsEarlier} THEN statement_timestamp()-interval '2 days' ELSE statement_timestamp()-interval '1 day' END,
      statement_timestamp()-interval '3 days',statement_timestamp()-interval '3 days'
    FROM interactions i WHERE i.id=${interactionId} RETURNING id`;
  // Use a separate statement after INSERT; its immutable deadline remains the
  // original exact database timestamp rather than an application-clock estimate.
  await client`INSERT INTO viewing_scheduled_actions(viewing_id,expected_schedule_version,due_at)
    SELECT id,schedule_version,response_deadline FROM viewings WHERE id=${rows[0]!.id}`;
  return rows[0]!.id;
}

for (const earlierStart of [false, true])
  void integration(`G3-F1 deterministic ${earlierStart ? 'proposed-start' : '48-hour'} expiry is terminal, idempotent and forbids retroactive acceptance`, async () => {
    const f = await fixture();
    try {
      const id = await historicalRequest(f.client, f.interaction.interaction_id, earlierStart);
      const requested = await f.store.get(f.actors.provider, id);
      await assert.rejects(f.store.accept(f.actors.provider, id, { ...expected(requested), scheduled_start: requested.proposed_start, scheduled_end: requested.proposed_end, private_instructions: instructions }, f.command()), { code: 'REQUEST_EXPIRED' });
      assert.equal((await f.store.expireOnce()).expired, 1);
      const expired = await f.store.get(f.actors.seeker, id);
      assert.equal(expired.state, 'EXPIRED');
      assert.equal(expired.reason, 'RESPONSE_DEADLINE_ELAPSED');
      assert.equal((await f.store.expireOnce()).expired, 0);
      assert.deepEqual(await effects(f.client), { viewings: 1, events: 1, receipts: 0, outbox: 1, jobs: 1 });
      assert.equal((await f.client`SELECT state FROM viewing_scheduled_actions WHERE viewing_id=${id}`)[0]!.state, 'PROCESSED');
      const later = await create(f);
      assert.notEqual(later.id, id);
    } finally { await f.close(); }
  });

void integration('G3-F1 expiry holds the viewing lock, competing acceptance fails and another worker skips it without duplicate effects', async () => {
  const f = await fixture(), workerClient = dedicated(), acceptClient = dedicated(), gate = dedicated();
  let release!: () => void;
  let holder: Promise<unknown> | undefined;
  const pending: Promise<PromiseSettledResult<unknown>[]>[] = [];
  try {
    const id = await historicalRequest(f.client, f.interaction.interaction_id);
    const requested = await f.store.get(f.actors.provider, id);
    const workerPid = (await workerClient<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    const acceptPid = (await acceptClient<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    let ready!: () => void;
    const held = new Promise<void>(r => { ready = r; }), free = new Promise<void>(r => { release = r; });
    holder = gate.begin(async tx => { await tx`LOCK TABLE viewing_events IN SHARE MODE`; ready(); await free; });
    await held;
    pending.push(Promise.allSettled([new ViewingStore(workerClient, true).expireOnce()]));
    await waiting(f.client, workerPid);
    pending.push(Promise.allSettled([new ViewingStore(acceptClient, true).accept(f.actors.provider, id, {
      ...expected(requested), scheduled_start: requested.proposed_start, scheduled_end: requested.proposed_end, private_instructions: instructions,
    }, f.command())]));
    await waiting(f.client, acceptPid);
    assert.equal((await f.store.expireOnce()).expired, 0);
    release(); await holder;
    const worker = (await pending[0]!)[0]!, acceptance = (await pending[1]!)[0]!;
    assert.equal(worker.status, 'fulfilled', failureMessage(worker));
    assert.equal((worker as PromiseFulfilledResult<{ expired: number }>).value.expired, 1);
    assert.equal(acceptance.status, 'rejected');
    assert.equal((acceptance as PromiseRejectedResult).reason.code, 'STALE_VERSION');
    assert.equal((await f.store.get(f.actors.seeker, id)).state, 'EXPIRED');
    assert.equal((await f.store.expireOnce()).expired, 0);
    assert.equal((await f.client`SELECT * FROM viewing_outbox WHERE event_type='viewing_expired'`).length, 1);
    assert.equal((await f.client`SELECT * FROM viewing_command_receipts`).length, 0);
  } finally {
    release?.(); await holder?.catch(() => {}); await Promise.all(pending);
    await Promise.all([workerClient.end(), acceptClient.end(), gate.end()]); await f.close();
  }
});

void integration('G3-F1 acceptance holds the viewing lock and a due stale worker cannot expire the accepted appointment', async () => {
  const f = await fixture(), acceptClient = dedicated(), gate = dedicated();
  let release!: () => void;
  let holder: Promise<unknown> | undefined;
  let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    const requested = await create(f);
    // A stale scheduling row is deliberately due early. The immutable viewing
    // deadline, actual lock/state and schedule version remain authoritative.
    await f.client`UPDATE viewing_scheduled_actions SET due_at=statement_timestamp()-interval '1 second' WHERE viewing_id=${requested.id}`;
    const acceptPid = (await acceptClient<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    let ready!: () => void;
    const held = new Promise<void>(r => { ready = r; }), free = new Promise<void>(r => { release = r; });
    holder = gate.begin(async tx => { await tx`LOCK TABLE viewing_events IN SHARE MODE`; ready(); await free; });
    await held;
    pending = Promise.allSettled([new ViewingStore(acceptClient, true).accept(f.actors.provider, requested.id, {
      ...expected(requested), scheduled_start: requested.proposed_start, scheduled_end: requested.proposed_end, private_instructions: instructions,
    }, f.command())]);
    await waiting(f.client, acceptPid);
    assert.equal((await f.store.expireOnce()).expired, 0);
    release(); await holder;
    const accepted = (await pending)[0]!;
    assert.equal(accepted.status, 'fulfilled', failureMessage(accepted));
    assert.equal((await f.store.expireOnce()).expired, 0);
    assert.equal((await f.store.get(f.actors.seeker, requested.id)).state, 'ACCEPTED');
    assert.equal((await f.client`SELECT * FROM viewing_outbox WHERE event_type='viewing_expired'`).length, 0);
    assert.equal((await effects(f.client)).events, 2);
  } finally {
    release?.(); await holder?.catch(() => {}); await pending;
    await Promise.all([acceptClient.end(), gate.end()]); await f.close();
  }
});

void integration('G3-F1 changed Interaction listing context denies reads and committed receipt replay without private disclosure', async () => {
  const f=await fixture();
  try {
    const key=f.command();
    let v=(await f.store.create(f.actors.seeker,f.interaction.interaction_id,f.input,key)).viewing;
    v=await accept(f,v);
    v=(await f.store.confirm(f.actors.seeker,v.id,expected(v),f.command())).viewing;
    v=(await f.store.confirm(f.actors.provider,v.id,expected(v),f.command())).viewing;
    assert.equal(v.private_instructions,instructions);
    const before=await effects(f.client);
    await f.client`UPDATE interactions SET listing_id=${f.otherListingId} WHERE id=${f.interaction.interaction_id}`;
    for(const actor of [f.actors.seeker,f.actors.provider]) await assert.rejects(f.store.get(actor,v.id),{code:'RESOURCE_SCOPE_DENIED'});
    await assert.rejects(f.store.create(f.actors.seeker,f.interaction.interaction_id,f.input,key),{code:'RESOURCE_SCOPE_DENIED'});
    assert.equal((await f.store.list(f.actors.seeker)).items.length,0);
    assert.deepEqual(await effects(f.client),before);
  }finally{await f.close();}
});

void integration('G3-F1 early stale expiry action restores the canonical deadline without closing a valid request', async () => {
  const f=await fixture();
  try{
    const v=await create(f),before=await effects(f.client);
    await f.client`UPDATE viewing_scheduled_actions SET due_at=statement_timestamp()-interval '1 second' WHERE viewing_id=${v.id}`;
    assert.deepEqual(await f.store.expireOnce(),{expired:0,skipped:0});
    const job=(await f.client`SELECT state,due_at FROM viewing_scheduled_actions WHERE viewing_id=${v.id}`)[0]!;
    assert.equal(job.state,'PENDING');
    assert.equal(new Date(job.due_at as string).toISOString(),v.response_deadline);
    assert.equal((await f.store.get(f.actors.seeker,v.id)).state,'REQUESTED');
    assert.deepEqual(await effects(f.client),before);
  }finally{await f.close();}
});

void integration('G3-F1 controlled seeker read and existing property writer share a consistent provider-before-listing lock order', async () => {
  const f=await fixture(),reader=dedicated(),writer=dedicated(),gate=dedicated();
  let release!:()=>void;
  let holder:Promise<unknown>|undefined;
  const pending:Promise<PromiseSettledResult<unknown>[]>[]=[];
  try{
    const v=await create(f);
    const property=(await f.client<{id:string;version:number}[]>`SELECT p.id,p.version FROM properties p JOIN listings l ON l.property_id=p.id WHERE l.id=${f.listingId}`)[0]!;
    const readerPid=(await reader<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    const writerPid=(await writer<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    let ready!:()=>void;
    const held=new Promise<void>(r=>{ready=r;}),free=new Promise<void>(r=>{release=r;});
    holder=gate.begin(async tx=>{await tx`SELECT id FROM interactions WHERE id=${f.interaction.interaction_id} FOR UPDATE`;ready();await free;});
    await held;
    pending.push(Promise.allSettled([new ViewingStore(reader,true).get(f.actors.seeker,v.id)]));
    await waiting(f.client,readerPid);
    pending.push(Promise.allSettled([new PropertyDraftStore(writer).updateSpecifications(f.providerUserId,property.id,{expectedVersion:property.version,bedrooms:3})]));
    await waiting(f.client,writerPid);
    release();await holder;
    const read=(await pending[0]!)[0]!,write=(await pending[1]!)[0]!;
    assert.equal(read.status,'fulfilled',failureMessage(read));
    assert.equal(write.status,'rejected');
    assert.equal((write as PromiseRejectedResult).reason.code,'PROPERTY_EDIT_STATE_INVALID');
    assert.equal((await f.client`SELECT version FROM properties WHERE id=${property.id}`)[0]!.version,property.version);
    assert.equal((await effects(f.client)).events,1);
  }finally{release?.();await holder?.catch(()=>{});await Promise.all(pending);await Promise.all([reader.end(),writer.end(),gate.end()]);await f.close();}
});

void integration('G3-F1 expired organization assignment cannot authorize viewing history or safe cancellation', async () => {
  const f=await fixture();
  try{
    const org=await organizationAssignmentFixture(f.client),resource=org.resource('INTERACTION');
    await f.client`INSERT INTO organization_resource_assignments(organization_id,provider_account_id,membership_id,resource_type,interaction_id,
      assigned_by_user_id,assigned_by_membership_id,grant_request_id,created_at,effective_at,valid_until,version)
      VALUES(${resource.organizationId},${org.org.provider_account_id},${org.memberships.agent},'INTERACTION',${resource.resourceId},${org.actors.owner.userId},${org.memberships.owner},${randomUUID()},
        statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',1)`;
    const id=await historicalRequest(f.client,resource.resourceId);
    await assert.rejects(f.store.get(org.actors.agent,id),{code:'RESOURCE_SCOPE_DENIED'});
    assert.equal((await f.store.list(org.actors.agent)).items.length,0);
    await assert.rejects(f.store.cancel(org.actors.agent,id,{expected_version:1,expected_schedule_version:1,reason:'SAFETY'},org.command()),{code:'RESOURCE_SCOPE_DENIED'});
    assert.equal((await effects(f.client)).events,0);
  }finally{await f.close();}
});

void integration('G3-F1 organization reads and safe cancellation require current exact interaction assignment; historical participants never confer access', async () => {
  const f = await fixture();
  try {
    const org = await organizationAssignmentFixture(f.client);
    const assignments = new OrganizationAssignmentStore(f.client);
    const resource = org.resource('INTERACTION');
    const assigned = await assignments.assign(org.actors.owner, resource, org.memberships.agent, { ...org.command(), expectedVersion: 0 });
    const id = await historicalRequest(f.client, org.interactionIds[0]!);
    assert.equal((await f.store.get(org.actors.agent, id)).actor_side, 'PROVIDER');
    await assert.rejects(f.store.get(org.actors.manager, id), { code: 'RESOURCE_SCOPE_DENIED' });
    await assert.rejects(f.store.get(org.actors.analyst, id), { code: 'RESOURCE_SCOPE_DENIED' });
    await assignments.revoke(org.actors.owner, resource, assigned.id, { ...org.command(), expectedVersion: assigned.version });
    await assert.rejects(f.store.get(org.actors.agent, id), { code: 'RESOURCE_SCOPE_DENIED' });
    await assert.rejects(f.store.list(org.actors.agent, { interaction_id: org.interactionIds[0]! }), { code: 'RESOURCE_SCOPE_DENIED' });
    // Listing assignment never substitutes for the exact Interaction scope.
    await assignments.assign(org.actors.owner, org.resource('LISTING'), org.memberships.agent, { ...org.command(), expectedVersion: 0 });
    await assert.rejects(f.store.cancel(org.actors.agent, id, { expected_version: 1, expected_schedule_version: 1, reason: 'SAFETY' }, org.command()), { code: 'RESOURCE_SCOPE_DENIED' });
    const replacement = await assignments.assign(org.actors.owner, resource, org.memberships.agent, { ...org.command(), expectedVersion: assigned.version + 1 });
    assert.notEqual(replacement.id, assigned.id);
    const viewing = await f.store.get(org.actors.agent, id);
    const cancelled = (await f.store.cancel(org.actors.agent, id, { ...expected(viewing), reason: 'SAFETY' }, org.command())).viewing;
    assert.equal(cancelled.state, 'CANCELLED_BY_PROVIDER');
    const events = await f.client`SELECT membership_id,assignment_id FROM viewing_events WHERE viewing_id=${id}`;
    assert.equal(events[0]!.membership_id, org.memberships.agent);
    assert.equal(events[0]!.assignment_id, replacement.id);
    assert.equal((await f.client`SELECT user_id FROM interaction_participants WHERE interaction_id=${org.interactionIds[0]!}`)[0]!.user_id, org.actors.agent.userId);
    await f.client`UPDATE organization_memberships SET state='REVOKED',version=version+1 WHERE id=${org.memberships.agent}`;
    await assert.rejects(f.store.get(org.actors.agent, id), { code: 'RESOURCE_SCOPE_DENIED' });
  } finally { await f.close(); }
});
