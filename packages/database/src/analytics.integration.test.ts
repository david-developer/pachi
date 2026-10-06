import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import postgres from 'postgres';
import { createDatabase } from './client.js';
import { snapshotAnalyticsContext } from './analytics-context.js';
import {
  AnalyticsStore,
  ANALYTICS_CONSUMER,
  RESPONSE_FILTER_VERSION,
} from './analytics.js';
import { InteractionStore } from './interaction.js';
import { ConversationStore, responseTimeBucket } from './conversation.js';
import { fixtureFor, type Fixture } from './conversation-fixture.js';

if (!process.env.DATABASE_TEST_URL && process.env.CI === 'true')
  throw new Error('DATABASE_TEST_URL is required');
const integration = process.env.DATABASE_TEST_URL ? test : test.skip;
type Client = ReturnType<typeof createDatabase>['client'];
const secret = 'synthetic-explicit-analytics-key-0001';
const asOf = '2026-10-05T12:00:00.000Z';
const day = 86_400_000;
const context = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  environment: 'test',
  classification: 'TEST',
  region: 'Littoral',
  purpose: 'RENT',
  provider_types: ['OWNER'],
  verification_claim: 'PROVIDER_IDENTITY',
  verification_status: 'VERIFIED',
  ...overrides,
});
async function scenario(
  run: (
    client: Client,
    fixture: Fixture,
    store: AnalyticsStore,
  ) => Promise<void>,
) {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client`TRUNCATE job_receipts`;
    await run(
      client,
      await fixtureFor(client),
      new AnalyticsStore(client, secret),
    );
  } finally {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client`TRUNCATE job_receipts`;
    await client.end();
  }
}
async function contact(
  client: Client,
  f: Fixture,
  at: string,
  dimensions: Record<string, unknown> | null = context(),
  listingId = f.listingId,
) {
  const [listing] = await client<
    { provider_account_id: string }[]
  >`SELECT provider_account_id FROM listings WHERE id=${listingId}`;
  // CLOSED fixtures avoid manufacturing duplicate active Interactions. Measurement
  // concerns the eligible source contact, independently of later closure.
  const [i] = await client<
    { id: string }[]
  >`INSERT INTO interactions(listing_id,provider_account_id,seeker_user_id,state,initial_channel,opened_at,closed_at) VALUES (${listingId},${listing!.provider_account_id},${f.seekerId},'CLOSED','MESSAGE',${at},${at}) RETURNING id`;
  const [c] = await client<
    { id: string }[]
  >`INSERT INTO conversations(interaction_id) VALUES (${i!.id}) RETURNING id`;
  const [o] = await client<
    { id: string }[]
  >`INSERT INTO interaction_outbox(interaction_id,event_type,safe_payload) VALUES (${i!.id},'interaction_created',${JSON.stringify({ interaction_id: i!.id, ...(dimensions ? { analytics: dimensions } : {}) })}::jsonb) RETURNING id`;
  return { interactionId: i!.id, conversationId: c!.id, sourceId: o!.id, at };
}
async function reply(
  client: Client,
  f: Fixture,
  c: Awaited<ReturnType<typeof contact>>,
  duration: number,
  bucket = responseTimeBucket(duration),
  first = true,
) {
  const at = new Date(Date.parse(c.at) + duration).toISOString();
  const [m] = await client<
    { id: string }[]
  >`INSERT INTO messages(conversation_id,sender_user_id,sender_side,client_message_id,body,sent_at) VALUES (${c.conversationId},${f.providerUserId},'PROVIDER',${randomUUID()},'PRIVATE_MESSAGE_SENTINEL',${at}) RETURNING id`;
  await client`INSERT INTO communication_outbox(interaction_id,message_id,event_type,safe_payload,occurred_at) VALUES (${c.interactionId},${m!.id},'message_sent',${JSON.stringify({ message_id: m!.id, interaction_id: c.interactionId, conversation_id: c.conversationId, sender_user_id: f.providerUserId, sender_side: 'PROVIDER' })}::jsonb,${at})`;
  if (first)
    await client`INSERT INTO communication_outbox(interaction_id,message_id,event_type,safe_payload,occurred_at) VALUES (${c.interactionId},${m!.id},'provider_first_response',${JSON.stringify({ interaction_id: c.interactionId, response_time_bucket: bucket })}::jsonb,${at})`;
}
async function counts(client: Client) {
  return {
    events: (await client`SELECT count(*)::int AS n FROM analytics_events`)[0]!
      .n,
    receipts: (
      await client`SELECT count(*)::int AS n FROM job_receipts WHERE consumer_name=${ANALYTICS_CONSUMER}`
    )[0]!.n,
  };
}

async function settleConcurrent<T>(tasks: Promise<T>[]): Promise<T[]> {
  // Observe every launched task before destructive scenario cleanup. Any
  // rejection still fails the test; successful siblings never conceal it.
  const outcomes = await Promise.allSettled(tasks);
  return outcomes.map((outcome) => {
    if (outcome.status === 'rejected') throw outcome.reason;
    return outcome.value;
  });
}

for (const mismatch of [false, true])
  void integration(
    mismatch
      ? 'stale analytics consumer rejects a conflicting receipt reference without overwriting it'
      : 'stale analytics consumer converges a matching receipt without counting it again',
    () =>
      scenario(async (client, f, store) => {
        const c = await contact(client, f, '2026-10-03T12:00:00Z');
        await reply(client, f, c, 240_000, 'LT_5M', false);
        assert.deepEqual(await store.processAnalyticsOnce(), {
          consumed: 2,
          deferred: 0,
        });
        const [event] = await client<
          { event_id: string; source_event_id: string }[]
        >`SELECT event_id,source_event_id FROM analytics_events WHERE event_name='message_sent'`;
        const [parent] = await client<{ event_id: string }[]>`
          SELECT event_id FROM analytics_events WHERE event_name='interaction_created'`;
        const reference = mismatch ? parent!.event_id : event!.event_id;
        assert.notEqual(parent!.event_id, event!.event_id);
        await client`DELETE FROM job_receipts WHERE source_stream='communication_outbox'`;

        const stale = postgres(process.env.DATABASE_TEST_URL!, {
          max: 1,
          prepare: false,
        });
        const gate = postgres(process.env.DATABASE_TEST_URL!, {
          max: 1,
          prepare: false,
        });
        const winner = postgres(process.env.DATABASE_TEST_URL!, {
          max: 1,
          prepare: false,
        });
        let release: (() => void) | undefined;
        let held: Promise<unknown> | undefined;
        let settled:
          | Promise<
              PromiseSettledResult<{ consumed: number; deferred: number }>[]
            >
          | undefined;
        try {
          await stale`SET application_name = 'g2-receipt-stale-consumer'`;
          await stale`SET statement_timeout = '10s'`;
          await gate`SET statement_timeout = '10s'`;
          await winner`SET statement_timeout = '10s'`;
          const stalePid = (
            await stale<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          )[0]!.pid;
          const gatePid = (
            await gate<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          )[0]!.pid;
          const winnerPid = (
            await winner<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          )[0]!.pid;
          assert.equal(new Set([stalePid, gatePid, winnerPid]).size, 3);

          let ready!: () => void;
          const arrived = new Promise<void>((resolve) => {
            ready = resolve;
          });
          const freed = new Promise<void>((resolve) => {
            release = resolve;
          });
          held = gate.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(920027)`;
            ready();
            await freed;
          });
          await Promise.race([arrived, held]);
          // TEST-only trigger pauses after source selection, before event insert.
          // The winner below models an acknowledgement committed after that read.
          await client`CREATE FUNCTION analytics_test_stale_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('application_name')='g2-receipt-stale-consumer' THEN PERFORM pg_advisory_xact_lock(920027); END IF; RETURN NEW; END $$`;
          await client`CREATE TRIGGER analytics_test_stale_receipt BEFORE INSERT ON analytics_events FOR EACH ROW EXECUTE FUNCTION analytics_test_stale_receipt()`;
          settled = Promise.allSettled([
            new AnalyticsStore(stale, secret).processAnalyticsOnce({
              streams: ['communication_outbox'],
            }),
          ]);
          const deadline = Date.now() + 5000;
          let waiting = false;
          while (Date.now() < deadline) {
            const rows = await client<{ waiting: boolean }[]>`
              SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=${stalePid} AND locktype='advisory' AND NOT granted)
                AND ${gatePid}=ANY(pg_blocking_pids(${stalePid})) AS waiting`;
            if (rows[0]!.waiting) {
              waiting = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(
            waiting,
            true,
            'stale consumer must reach the real connection barrier',
          );
          await winner`INSERT INTO job_receipts(consumer_name,source_stream,source_event_id,result_reference)
            VALUES (${ANALYTICS_CONSUMER},'communication_outbox',${event!.source_event_id},${reference})`;
          release!();
          await held;
          const [outcome] = await settled;
          assert.ok(outcome);
          if (mismatch) {
            assert.equal(outcome!.status, 'rejected');
            assert.match(
              (outcome as PromiseRejectedResult).reason.message,
              /^ANALYTICS_RECEIPT_MISMATCH$/,
            );
          } else {
            if (outcome!.status === 'rejected') throw outcome.reason;
            assert.deepEqual(outcome!.value, { consumed: 0, deferred: 0 });
          }
          const receipts = await client<{ result_reference: string }[]>`
            SELECT result_reference FROM job_receipts WHERE consumer_name=${ANALYTICS_CONSUMER}
              AND source_stream='communication_outbox' AND source_event_id=${event!.source_event_id}`;
          assert.equal(receipts.length, 1);
          assert.equal(receipts[0]!.result_reference, reference);
          assert.deepEqual(await counts(client), { events: 2, receipts: 2 });
          assert.equal(
            (
              await client`SELECT count(*)::int AS n FROM analytics_events WHERE source_stream='communication_outbox' AND source_event_id=${event!.source_event_id}`
            )[0]!.n,
            1,
          );
          assert.equal(
            (
              await client`SELECT count(*)::int AS n FROM communication_outbox WHERE published_at IS NOT NULL OR attempt_count<>0`
            )[0]!.n,
            0,
          );
          assert.equal(
            (
              await client`SELECT count(*)::int AS n FROM interaction_outbox WHERE delivered_at IS NOT NULL`
            )[0]!.n,
            0,
          );
          if (!mismatch) {
            await client`DELETE FROM job_receipts WHERE source_stream='communication_outbox'`;
            assert.deepEqual(
              await store.processAnalyticsOnce({
                streams: ['communication_outbox'],
              }),
              { consumed: 1, deferred: 0 },
            );
            assert.deepEqual(await counts(client), { events: 2, receipts: 2 });
            assert.equal(
              (
                await client`SELECT result_reference FROM job_receipts WHERE source_stream='communication_outbox'`
              )[0]!.result_reference,
              event!.event_id,
            );
            assert.deepEqual(await store.processAnalyticsOnce(), {
              consumed: 0,
              deferred: 0,
            });
          }
        } finally {
          release?.();
          if (held) await held;
          if (settled) await settled;
          await client`DROP TRIGGER IF EXISTS analytics_test_stale_receipt ON analytics_events`;
          await client`DROP FUNCTION IF EXISTS analytics_test_stale_receipt()`;
          await Promise.all([stale.end(), gate.end(), winner.end()]);
        }
      }),
  );

void integration(
  'G2 consumer converges concurrent business/source retries and restart without claiming delivery',
  () =>
    scenario(async (client, f, store) => {
      const inquiry = await new InteractionStore(
        client,
        true,
      ).createOrReuseInquiry(f.seekerId, f.listingId, randomUUID());
      const conversations = new ConversationStore(client, true);
      const request = {
        client_message_id: randomUUID(),
        body: 'PRIVATE_MESSAGE_SENTINEL',
      };
      await settleConcurrent(
        Array.from({ length: 5 }, () =>
          conversations.send(f.seekerId, inquiry.conversation_id, request),
        ),
      );
      await settleConcurrent(
        Array.from({ length: 5 }, () =>
          conversations.send(f.providerUserId, inquiry.conversation_id, {
            client_message_id: randomUUID(),
            body: 'Private provider reply',
          }),
        ),
      );
      const batches = await settleConcurrent(
        Array.from({ length: 6 }, () =>
          new AnalyticsStore(client, secret).processAnalyticsOnce({ limit: 1 }),
        ),
      );
      const remaining = await store.processAnalyticsOnce();
      assert.equal(
        batches.reduce((total, batch) => total + batch.consumed, 0) +
          remaining.consumed,
        8,
      );
      assert.deepEqual(await counts(client), { events: 8, receipts: 8 });
      assert.deepEqual(
        await new AnalyticsStore(client, secret).processAnalyticsOnce(),
        { consumed: 0, deferred: 0 },
      );
      const names =
        await client`SELECT event_name,count(*)::int AS n FROM analytics_events GROUP BY event_name ORDER BY event_name`;
      assert.deepEqual(
        names.map((r) => [r.event_name, r.n]),
        [
          ['interaction_created', 1],
          ['message_sent', 6],
          ['provider_first_response', 1],
        ],
      );
      const [contactEvent] =
        await client`SELECT * FROM analytics_events WHERE event_name='interaction_created'`;
      assert.equal(contactEvent!.classification, 'TEST');
      assert.equal(contactEvent!.purpose, 'RENT');
      assert.deepEqual(contactEvent!.provider_types, ['OWNER']);
      assert.equal(contactEvent!.verification_status, 'VERIFIED');
      assert.equal(
        contactEvent!.actor_pseudonym,
        createHmac('sha256', secret)
          .update(`pachi-analytics-user-v1:${f.seekerId}`)
          .digest('hex'),
      );
      assert.equal(
        (
          await client`SELECT count(*)::int AS n FROM communication_outbox WHERE published_at IS NOT NULL OR attempt_count<>0`
        )[0]!.n,
        0,
      );
      assert.equal(
        (
          await client`SELECT count(*)::int AS n FROM interaction_outbox WHERE delivered_at IS NOT NULL`
        )[0]!.n,
        0,
      );
      // Reconstructing a lost receipt still cannot rematerialize the globally unique source.
      await client`DELETE FROM job_receipts WHERE consumer_name=${ANALYTICS_CONSUMER}`;
      assert.deepEqual(await store.processAnalyticsOnce(), {
        consumed: 8,
        deferred: 0,
      });
      assert.deepEqual(await counts(client), { events: 8, receipts: 8 });
      assert.equal(
        (
          await client`SELECT count(*)::int AS n FROM job_receipts jr JOIN analytics_events ae ON ae.event_id=jr.result_reference AND ae.source_event_id=jr.source_event_id AND ae.source_stream=jr.source_stream`
        )[0]!.n,
        8,
      );
    }),
);

void integration(
  'communication defers out-of-order contacts, then inherits immutable source dimensions',
  () =>
    scenario(async (client, f, store) => {
      const c = await contact(client, f, '2026-10-03T12:00:00Z');
      await reply(client, f, c, 240_000);
      assert.deepEqual(
        await store.processAnalyticsOnce({ streams: ['communication_outbox'] }),
        { consumed: 0, deferred: 2 },
      );
      assert.deepEqual(await counts(client), { events: 0, receipts: 0 });
      await client`UPDATE properties SET region='Southwest',city='Changed city' WHERE id=(SELECT property_id FROM listings WHERE id=${f.listingId})`;
      await client`UPDATE provider_profiles SET provider_types=ARRAY['PROPERTY_MANAGER'],verification_status='REJECTED' WHERE user_id=${f.providerUserId}`;
      await store.processAnalyticsOnce({ streams: ['interaction_outbox'] });
      await store.processAnalyticsOnce({ streams: ['communication_outbox'] });
      const rows =
        await client`SELECT region,purpose,provider_types,verification_status,contact_event_id,dimension_provenance FROM analytics_events ORDER BY event_name`;
      for (const r of rows) {
        assert.equal(r.region, 'Littoral');
        assert.equal(r.purpose, 'RENT');
        assert.deepEqual(r.provider_types, ['OWNER']);
        assert.equal(r.verification_status, 'VERIFIED');
      }
      assert.equal(
        rows.filter(
          (r) =>
            r.contact_event_id !== null &&
            r.dimension_provenance === 'CONTACT_PROJECTION',
        ).length,
        2,
      );
    }),
);

void integration(
  'failed bucket validation and receipt writes roll back both analytics effects',
  () =>
    scenario(async (client, f, store) => {
      const c = await contact(client, f, '2026-10-03T12:00:00Z');
      await reply(client, f, c, 240_000, 'GT_24H');
      await store.processAnalyticsOnce({ streams: ['interaction_outbox'] });
      await assert.rejects(
        store.processAnalyticsOnce({ streams: ['communication_outbox'] }),
        /ANALYTICS_RESPONSE_BUCKET_MISMATCH/,
      );
      assert.deepEqual(await counts(client), { events: 1, receipts: 1 });
      await client`UPDATE communication_outbox SET safe_payload=jsonb_set(safe_payload,'{response_time_bucket}','"LT_5M"'::jsonb) WHERE event_type='provider_first_response'`;
      await client`CREATE FUNCTION analytics_test_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$`;
      await client`CREATE TRIGGER analytics_test_receipt_failure BEFORE INSERT ON job_receipts FOR EACH ROW EXECUTE FUNCTION analytics_test_receipt_failure()`;
      try {
        await assert.rejects(
          store.processAnalyticsOnce({ streams: ['communication_outbox'] }),
          /synthetic receipt failure/,
        );
        assert.deepEqual(await counts(client), { events: 1, receipts: 1 });
      } finally {
        await client`DROP TRIGGER analytics_test_receipt_failure ON job_receipts`;
        await client`DROP FUNCTION analytics_test_receipt_failure()`;
      }
      await store.processAnalyticsOnce();
      assert.deepEqual(await counts(client), { events: 3, receipts: 3 });
    }),
);

void integration(
  'exact timestamp duration agrees with every v1 bucket boundary including sub-millisecond precision',
  () =>
    scenario(async (client, f, store) => {
      const durations = [
        0, 299999, 300000, 899999, 900000, 3599999, 3600000, 14399999, 14400000,
        86399999, 86400000, 86400001,
      ];
      const expected = [
        'LT_5M',
        'LT_5M',
        'M5_TO_15M',
        'M5_TO_15M',
        'M15_TO_60M',
        'M15_TO_60M',
        'H1_TO_4H',
        'H1_TO_4H',
        'H4_TO_24H',
        'H4_TO_24H',
        'H4_TO_24H',
        'GT_24H',
      ];
      for (let n = 0; n < durations.length; n++) {
        const c = await contact(client, f, '2026-10-03T12:00:00Z');
        await reply(
          client,
          f,
          c,
          durations[n]!,
          expected[n]! as ReturnType<typeof responseTimeBucket>,
        );
      }
      // PostgreSQL precision survives JavaScript date decoding: just past 24h is late.
      const micro = await contact(client, f, '2026-10-03T12:00:00Z');
      await reply(client, f, micro, 86400001);
      await client`UPDATE communication_outbox SET occurred_at='2026-10-04T12:00:00.000001Z' WHERE interaction_id=${micro.interactionId}`;
      await store.processAnalyticsOnce();
      const r =
        await client`SELECT response_time_bucket,response_bucket_version,response_duration_ms FROM analytics_events WHERE event_name='provider_first_response' ORDER BY response_duration_ms`;
      for (let n = 0; n < 11; n++) {
        assert.equal(r[n]!.response_time_bucket, expected[n]);
        assert.equal(r[n]!.response_bucket_version, 1);
        assert.equal(r[n]!.response_duration_ms, durations[n]);
      }
      assert.equal(r[11]!.response_time_bucket, 'GT_24H');
      assert.equal(r[11]!.response_duration_ms, 86400000.001);
      assert.equal(r[12]!.response_duration_ms, 86400001);
    }),
);

void integration(
  'mature cohort reports exact numerator/denominator/unanswered/median and separated segments',
  () =>
    scenario(async (client, f, store) => {
      const old = '2026-10-03T12:00:00Z';
      const a = await contact(client, f, old);
      await reply(client, f, a, 240_000);
      await reply(client, f, a, 600_000, 'M5_TO_15M', false);
      const b = await contact(client, f, old);
      await reply(client, f, b, day);
      const c = await contact(client, f, old);
      await reply(client, f, c, day + 1);
      await contact(client, f, old);
      const south = context({
        region: 'Southwest',
        purpose: 'SALE',
        provider_types: ['INDEPENDENT_AGENT'],
        verification_status: 'NOT_VERIFIED',
      });
      // Distinct synthetic provider principal for the second segment.
      const [profile] = await client<
        { id: string }[]
      >`INSERT INTO provider_profiles(user_id,provider_types,display_name,state,verification_status) VALUES (${f.otherUserId},ARRAY['INDEPENDENT_AGENT'],'Second synthetic provider','ACTIVE','NOT_VERIFIED') RETURNING id`;
      const [account] = await client<
        { id: string }[]
      >`INSERT INTO provider_accounts(provider_profile_id,state) VALUES (${profile!.id},'ACTIVE') RETURNING id`;
      await client`UPDATE listings SET provider_account_id=${account!.id} WHERE id=${f.otherListingId}`;
      await contact(client, f, '2026-10-04T12:00:00Z', south, f.otherListingId); // Exactly mature, unanswered.
      const e = await contact(client, f, old, south, f.otherListingId);
      await reply(client, f, e, day - 1);
      await contact(client, f, '2026-10-04T12:00:01Z', south, f.otherListingId); // 23h59m59s, excluded.
      const syntheticExcluded = await contact(client, f, old, null);
      await reply(client, f, syntheticExcluded, 240_000);
      await Promise.all([
        store.processAnalyticsOnce(),
        new AnalyticsStore(client, secret).processAnalyticsOnce(),
      ]);
      assert.deepEqual(await store.processAnalyticsOnce(), {
        consumed: 0,
        deferred: 0,
      });
      const result = await store.providerResponseSummary({
        as_of: asOf,
        environment: 'test',
        classification: 'TEST',
      });
      assert.equal(result.numerator, 3);
      assert.equal(result.denominator, 6);
      assert.equal(result.unanswered_mature_contacts, 3);
      assert.equal(result.responded_mature_contacts, 3);
      assert.equal(result.late_responded_mature_contacts, 1);
      assert.equal(result.response_rate, 0.5);
      assert.equal(result.median_response_duration_ms, day - 1);
      assert.equal(result.median_sample_size, 3);
      assert.equal(result.sample_size, 6);
      assert.equal(result.filter_version, RESPONSE_FILTER_VERSION);
      assert.equal(result.observation_window_hours, 24);
      assert.equal(result.window_start, '2026-09-28T12:00:00.000Z');
      assert.equal(result.window_end, asOf);
      assert.equal(result.as_of, asOf);
      assert.equal(result.sample_threshold_status, 'NOT_YET_FROZEN');
      assert.equal(result.insufficient_sample, null);
      assert.equal(result.insufficient_sample_threshold, null);
      assert.equal(result.pilot_contact_minimum, 30);
      assert.equal(result.pilot_window_minimum_days, 14);
      assert.deepEqual(result.exclusions, {
        CLASSIFICATION_OR_ENVIRONMENT: 1,
        INCOMPLETE_SOURCE_CONTEXT: 1,
        IMMATURE_CONTACT: 1,
      });
      const littoral = await store.providerResponseSummary({
        as_of: asOf,
        environment: 'test',
        classification: 'TEST',
        segments: {
          region: 'Littoral',
          purpose: 'RENT',
          provider_type: 'OWNER',
          verification_claim: 'PROVIDER_IDENTITY',
          verification_status: 'VERIFIED',
        },
      });
      assert.equal(littoral.numerator, 2);
      assert.equal(littoral.denominator, 4);
      assert.equal(littoral.median_response_duration_ms, 43_320_000);
      const southwest = await store.providerResponseSummary({
        as_of: asOf,
        environment: 'test',
        classification: 'TEST',
        segments: {
          region: 'Southwest',
          purpose: 'SALE',
          provider_type: 'INDEPENDENT_AGENT',
          verification_status: 'NOT_VERIFIED',
          provider_account_id: account!.id,
        },
      });
      assert.equal(southwest.numerator, 1);
      assert.equal(southwest.denominator, 2);
      assert.equal(southwest.median_response_duration_ms, day - 1);
      const operational = await store.providerResponseSummary({ as_of: asOf });
      assert.equal(operational.numerator, 0);
      assert.equal(operational.denominator, 0);
      assert.equal(operational.response_rate, null);
      assert.equal(operational.median_response_duration_ms, null);
      assert.equal(operational.insufficient_sample, true);
      assert.equal(operational.exclusions.CLASSIFICATION_OR_ENVIRONMENT, 8);
      assert.equal(
        result.spam_filter_status,
        'AWAITING_APPROVED_DURABLE_SIGNAL',
      );
      await assert.rejects(
        store.providerResponseSummary({
          as_of: asOf,
          window_end: '2026-10-06T00:00:00Z',
        }),
        /INVALID_REPORT_WINDOW/,
      );
    }),
);

void integration(
  'contact maturity is inclusive exactly at 24h, and report window uses event time',
  () =>
    scenario(async (client, f, store) => {
      const at = '2026-10-03T12:00:00Z';
      const c = await contact(client, f, at);
      await reply(client, f, c, day);
      await store.processAnalyticsOnce();
      const report = (time: string) =>
        store.providerResponseSummary({
          as_of: time,
          environment: 'test',
          classification: 'TEST',
        });
      const before = await report('2026-10-04T11:59:59.999Z');
      assert.equal(before.denominator, 0);
      assert.equal(before.numerator, 0);
      const exact = await report('2026-10-04T12:00:00.000Z');
      assert.equal(exact.denominator, 1);
      assert.equal(exact.numerator, 1);
      assert.equal(exact.median_response_duration_ms, day);
      const after = await report('2026-10-04T12:00:00.001Z');
      assert.equal(after.denominator, 1);
      assert.equal(after.numerator, 1);
      const excluded = await store.providerResponseSummary({
        as_of: asOf,
        window_start: at,
        window_end: at.replace('12:00:00', '12:00:00.001'),
        environment: 'test',
        classification: 'TEST',
      });
      assert.equal(excluded.denominator, 1); // received_at is days later and irrelevant.
      const endExclusive = await store.providerResponseSummary({
        as_of: asOf,
        window_start: '2026-10-02T12:00:00Z',
        window_end: at,
        environment: 'test',
        classification: 'TEST',
      });
      assert.equal(endExclusive.denominator, 0);
      await contact(client, f, '2026-10-03T12:00:00.000001Z');
      await store.processAnalyticsOnce();
      assert.equal((await report('2026-10-04T12:00:00.000Z')).denominator, 1);
      const micro = await report('2026-10-04T12:00:00.000001Z');
      assert.equal(micro.denominator, 2);
      assert.equal(micro.numerator, 1);
      assert.equal(micro.as_of, '2026-10-04T12:00:00.000001Z');
      await assert.rejects(report('not-a-time'), /INVALID_REPORT_WINDOW/);
    }),
);

void integration(
  'publication normalization and hostile source/resource data never leak into analytics',
  () =>
    scenario(async (client, f, store) => {
      const sentinels = [
        'PRIVATE_MESSAGE_SENTINEL',
        '+237699999991',
        'private-email@example.invalid',
        'EXACT_PRIVATE_ADDRESS',
        '9.765432',
        '4.123456',
        'VERIFICATION_EVIDENCE_SENTINEL',
        'MODERATION_FREE_TEXT_SENTINEL',
        'AUTH_SUBJECT_SENTINEL',
        'AUTH_TOKEN_SENTINEL',
        'BLOCK_REASON_SENTINEL',
      ];
      const privateText = sentinels.join(' ');
      await client`UPDATE properties SET neighborhood=${sentinels[3]!},landmark=${sentinels.slice(1, 6).join(' ')} WHERE id=(SELECT property_id FROM listings WHERE id=${f.listingId})`;
      const [listing] =
        await client`SELECT approved_submission_id,approved_revision_id FROM listings WHERE id=${f.listingId}`;
      const [submission] =
        await client`SELECT * FROM listing_submissions WHERE id=${listing!.approved_submission_id}`;
      const [action] = await client<
        { id: string }[]
      >`INSERT INTO listing_revision_moderation_actions(listing_id,submission_id,listing_revision_id,offering_version_id,actor_user_id,command,reason_code,reason_text,prior_publication_status,publication_status,prior_moderation_status,moderation_status,media_snapshot,idempotency_key,request_id,created_at)
    VALUES (${f.listingId},${listing!.approved_submission_id},${listing!.approved_revision_id},${submission!.offering_version_id},${f.providerUserId},'APPROVE_AND_PUBLISH','APPROVED',${privateText},'PENDING_REVIEW','PUBLISHED','IN_REVIEW','APPROVED',${JSON.stringify(submission!.media_snapshot)}::jsonb,${randomUUID()},${randomUUID()},'2026-10-03T11:00:00Z') RETURNING id`;
      await client`INSERT INTO listing_revision_moderation_outbox(action_id,event_type,safe_payload) VALUES (${action!.id},'LISTING_PUBLISHED',${JSON.stringify({ listing_id: f.listingId, analytics: { ...context(), private_data: privateText }, private_data: privateText })}::jsonb)`;
      const [rejected] = await client<
        { id: string }[]
      >`INSERT INTO listing_revision_moderation_actions(listing_id,submission_id,listing_revision_id,offering_version_id,actor_user_id,command,reason_code,reason_text,prior_publication_status,publication_status,prior_moderation_status,moderation_status,media_snapshot,idempotency_key,request_id)
    SELECT listing_id,submission_id,listing_revision_id,offering_version_id,actor_user_id,'REJECT',reason_code,reason_text,'PENDING_REVIEW','REJECTED','IN_REVIEW','REJECTED',media_snapshot,${randomUUID()},${randomUUID()} FROM listing_revision_moderation_actions WHERE id=${action!.id} RETURNING id`;
      await client`INSERT INTO listing_revision_moderation_outbox(action_id,event_type,safe_payload) VALUES (${rejected!.id},'LISTING_REJECTED','{}'::jsonb)`;
      const c = await contact(client, f, '2026-10-03T12:00:00Z', {
        ...context(),
        private_data: privateText,
      });
      await client`UPDATE interaction_outbox SET safe_payload=safe_payload||${JSON.stringify({ private_data: privateText })}::jsonb WHERE id=${c.sourceId}`;
      await reply(client, f, c, 240_000);
      await client`UPDATE messages SET body=${privateText} WHERE conversation_id=${c.conversationId}`;
      await client`INSERT INTO block_relationships(blocker_user_id,blocked_user_id) VALUES (${f.seekerId},${f.providerUserId})`;
      await store.processAnalyticsOnce();
      const events =
        await client`SELECT * FROM analytics_events ORDER BY event_name`;
      assert.deepEqual(
        events.map((e) => e.event_name),
        [
          'interaction_created',
          'listing_published',
          'message_sent',
          'provider_first_response',
        ],
      );
      assert.deepEqual(await counts(client), { events: 4, receipts: 4 });
      const serialized = JSON.stringify(events);
      for (const sentinel of [...sentinels, f.seekerId, f.providerUserId])
        assert.equal(serialized.includes(sentinel), false, sentinel);
      assert.equal(
        (
          await client`SELECT delivered_at FROM listing_revision_moderation_outbox`
        )[0]!.delivered_at,
        null,
      );
      const published = events.find(
        (e) => e.event_name === 'listing_published',
      )!;
      assert.equal(
        new Date(published.occurred_at).toISOString(),
        '2026-10-03T11:00:00.000Z',
      );
      assert.equal(published.submission_id, listing!.approved_submission_id);
      assert.equal(published.revision_id, listing!.approved_revision_id);
      assert.equal(published.schema_version, 1);
      assert.equal(published.actor_pseudonym, null);
    }),
);

void integration(
  'source snapshots force synthetic claims to TEST even in an explicitly production-shaped environment',
  () =>
    scenario(async (client, f) => {
      const previousEnvironment = process.env.ANALYTICS_ENVIRONMENT,
        previousNode = process.env.NODE_ENV;
      try {
        process.env.ANALYTICS_ENVIRONMENT = 'production';
        process.env.NODE_ENV = 'production';
        const snapshot = await client.begin((tx) =>
          snapshotAnalyticsContext(tx, f.listingId, false),
        );
        assert.equal(snapshot.environment, 'production');
        assert.equal(snapshot.classification, 'TEST');
        assert.equal(snapshot.verification_status, 'VERIFIED');
        const inquiry = await new InteractionStore(
          client,
          true,
        ).createOrReuseInquiry(f.seekerId, f.listingId, randomUUID());
        const [source] =
          await client`SELECT safe_payload FROM interaction_outbox WHERE interaction_id=${inquiry.interaction_id}`;
        assert.equal(source!.safe_payload.analytics.classification, 'TEST');
      } finally {
        if (previousEnvironment === undefined)
          delete process.env.ANALYTICS_ENVIRONMENT;
        else process.env.ANALYTICS_ENVIRONMENT = previousEnvironment;
        if (previousNode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNode;
      }
    }),
);

void integration(
  'legacy dimensions stay unknown and malformed snapshots fail closed without receipts',
  () =>
    scenario(async (client, f, store) => {
      const legacy = await contact(client, f, '2026-10-03T12:00:00Z', null);
      await store.processAnalyticsOnce();
      const [event] =
        await client`SELECT * FROM analytics_events WHERE source_event_id=${legacy.sourceId}`;
      assert.equal(event!.environment, 'unknown');
      assert.equal(event!.classification, 'TEST');
      assert.equal(event!.exclusion_reason, 'INCOMPLETE_SOURCE_CONTEXT');
      assert.equal(event!.region, null);
      assert.equal(event!.purpose, null);
      assert.equal(event!.provider_types, null);
      assert.equal(event!.verification_status, null);
      await contact(
        client,
        f,
        '2026-10-03T12:00:00Z',
        context({ region: 'PRIVATE_ADDRESS_SENTINEL' }),
      );
      await assert.rejects(
        store.processAnalyticsOnce(),
        /ANALYTICS_INVALID_SOURCE_CONTEXT/,
      );
      assert.deepEqual(await counts(client), { events: 1, receipts: 1 });
    }),
);
