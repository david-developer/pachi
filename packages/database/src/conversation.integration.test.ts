import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from './client.js';
import { ConversationStore } from './conversation.js';
import { InteractionStore } from './interaction.js';
import { fixtureFor, type Fixture } from './conversation-fixture.js';

const integration = process.env.DATABASE_TEST_URL ? test : test.skip;
type Client = ReturnType<typeof createDatabase>['client'];
type Context = Fixture & { conversationId: string; interactionId: string };
async function scenario(
  run: (
    client: Client,
    fixture: Context,
    store: ConversationStore
  ) => Promise<void>
) {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const fixture = await fixtureFor(client);
    const inquiry = await new InteractionStore(
      client,
      true
    ).createOrReuseInquiry(fixture.seekerId, fixture.listingId, randomUUID());
    await run(
      client,
      {
        ...fixture,
        conversationId: inquiry.conversation_id,
        interactionId: inquiry.interaction_id
      },
      new ConversationStore(client, true)
    );
  } finally {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
}
const input = (body = 'Synthetic message') => ({
  client_message_id: randomUUID(),
  body
});

void integration(
  'messages persist text, converge concurrent retries and conflict across body/Conversation',
  () =>
    scenario(async (client, f, store) => {
      const request = input('<script>private text sentinel</script>');
      const sends = await Promise.all(
        Array.from({ length: 6 }, () =>
          store.send(f.seekerId, f.conversationId, request)
        )
      );
      assert.equal(new Set(sends.map((r) => r.message.id)).size, 1);
      assert.equal(sends.filter((r) => r.created).length, 1);
      assert.equal(sends[0]!.message.body, request.body);
      assert.equal((await store.send(f.seekerId, f.conversationId.toUpperCase(), {...request,client_message_id:request.client_message_id.toUpperCase()})).created,false);
      assert.equal(sends[0]!.message.receipts[0]!.read_at, null);
      await assert.rejects(
        store.send(f.seekerId, f.conversationId, {
          ...request,
          body: 'changed'
        }),
        { code: 'IDEMPOTENCY_KEY_REUSED' }
      );
      const other = await new InteractionStore(
        client,
        true
      ).createOrReuseInquiry(f.seekerId, f.otherListingId, randomUUID());
      await assert.rejects(
        store.send(f.seekerId, other.conversation_id, request),
        { code: 'IDEMPOTENCY_KEY_REUSED' }
      );
      assert.equal(
        (await client`SELECT count(*)::int AS n FROM messages`)[0]!.n,
        1
      );
      assert.equal(
        (
          await client`SELECT count(*)::int AS n FROM communication_outbox WHERE event_type='message_sent'`
        )[0]!.n,
        1
      );
      assert.equal(
        (
          await client`SELECT message_count FROM message_rate_limits WHERE scope='GLOBAL'`
        )[0]!.message_count,
        1
      );
      assert.equal(
        JSON.stringify(
          await client`SELECT safe_payload FROM communication_outbox`
        ).includes(request.body),
        false
      );
      await assert.rejects(
        client`UPDATE communication_outbox SET safe_payload=safe_payload||'{"body":"unsafe"}'::jsonb`,
        { code: '23514' }
      );
      const max = await store.send(
        f.seekerId,
        f.conversationId,
        input('😀'.repeat(4000))
      );
      assert.equal(Array.from(max.message.body!).length, 4000);
      for (const body of [
        '',
        ' \n\t',
        '\u00a0',
        '😀'.repeat(4001),
        '\u0000',
        '\ud800'
      ])
        await assert.rejects(
          store.send(f.seekerId, f.conversationId, input(body)),
          { code: 'INVALID_INPUT' }
        );
    })
);

void integration(
  'stable server sequence pages equal timestamps and inbox suppresses private listing revisions',
  () =>
    scenario(async (client, f, store) => {
      const sent = [];
      for (let i = 0; i < 5; i++)
        sent.push(
          (
            await store.send(
              f.seekerId,
              f.conversationId,
              input(`Message ${i}`)
            )
          ).message
        );
      await client`UPDATE messages SET sent_at='2026-10-05T00:00:00Z'`;
      const first = await store.messages(
        f.seekerId,
        f.conversationId,
        undefined,
        2
      );
      assert.equal(first.items.length, 2);
      assert.ok(first.next_cursor);
      const second = await store.messages(
        f.providerUserId,
        f.conversationId,
        first.next_cursor,
        2
      );
      const third = await store.messages(
        f.seekerId,
        f.conversationId,
        second.next_cursor!,
        2
      );
      assert.deepEqual(
        [...first.items, ...second.items, ...third.items].map((m) => m.id),
        sent.reverse().map((m) => m.id)
      );
      assert.equal(third.next_cursor, null);
      const other = await new InteractionStore(
        client,
        true
      ).createOrReuseInquiry(f.seekerId, f.otherListingId, randomUUID());
      const inbox = await store.inbox(f.providerUserId, undefined, 1);
      assert.equal(inbox.items.length, 1);
      assert.ok(inbox.next_cursor);
      const older = await store.inbox(f.providerUserId, inbox.next_cursor, 1);
      assert.equal(older.items.length, 1);
      assert.notEqual(
        older.items[0]!.conversation_id,
        inbox.items[0]!.conversation_id
      );
      assert.equal(older.next_cursor, null);
      assert.equal((await store.inbox(f.otherUserId)).items.length, 0);
      await client`UPDATE listings SET publication_status='DRAFT' WHERE id=${f.listingId}`;
      const invisible = (await store.inbox(f.seekerId)).items.find(
        (c) => c.conversation_id === f.conversationId
      )!;
      assert.equal(invisible.title, null);
      assert.equal(invisible.listing_visible, false);
      const revisions = await client<
        { id: string }[]
      >`INSERT INTO listing_revisions(listing_id,version,title,description,created_by_user_id) SELECT l.id,r.version+1,'PRIVATE_UNAPPROVED_MESSAGE_SENTINEL',r.description,l.created_by_user_id FROM listings l JOIN listing_revisions r ON r.id=l.current_revision_id WHERE l.id=${f.otherListingId} RETURNING id`;
      await client`UPDATE listings SET current_revision_id=${revisions[0]!.id} WHERE id=${f.otherListingId}`;
      const changed = (await store.inbox(f.providerUserId)).items.find(
        (c) => c.conversation_id === other.conversation_id
      )!;
      assert.equal(changed.title, null);
      assert.equal(changed.listing_visible, false);
      for (const value of ['', '0', '-1', '9223372036854775808', 'wrong'])
        await assert.rejects(
          store.messages(f.seekerId, f.conversationId, value),
          { code: 'INVALID_INPUT' }
        );
    })
);

void integration(
  'current authority denies unrelated/historical provider read/send without erasing seeker history',
  () =>
    scenario(async (client, f, store) => {
      await store.send(f.seekerId, f.conversationId, input());
      for (const id of [f.otherUserId, randomUUID()]) {
        await assert.rejects(store.messages(id, f.conversationId), {
          code: 'RESOURCE_SCOPE_DENIED'
        });
        await assert.rejects(store.send(id, f.conversationId, input()), {
          code: 'RESOURCE_SCOPE_DENIED'
        });
        await assert.rejects(
          store.acknowledge(id, f.conversationId, {
            message_ids: [randomUUID()],
            state: 'READ'
          }),
          { code: 'RESOURCE_SCOPE_DENIED' }
        );
      }
      await client`UPDATE provider_profiles SET user_id=${f.otherUserId} WHERE user_id=${f.providerUserId}`;
      assert.equal(
        (
          await client`SELECT count(*)::int AS n FROM interaction_participants WHERE user_id=${f.providerUserId}`
        )[0]!.n,
        1
      );
      await assert.rejects(store.messages(f.providerUserId, f.conversationId), {
        code: 'RESOURCE_SCOPE_DENIED'
      });
      await assert.rejects(
        store.send(f.providerUserId, f.conversationId, input()),
        { code: 'RESOURCE_SCOPE_DENIED' }
      );
      await assert.rejects(
        new InteractionStore(client, true).read(
          f.providerUserId,
          f.interactionId
        ),
        { code: 'RESOURCE_SCOPE_DENIED' }
      );
      assert.equal((await store.inbox(f.providerUserId)).items.length, 0);
      assert.equal((await store.inbox(f.otherUserId)).items.length, 1);
      assert.equal(
        (await store.messages(f.seekerId, f.conversationId)).items.length,
        1
      );
    })
);

void integration(
  'sender eligibility is current across account, replaced phone, profile, account and verified claim',
  () =>
    scenario(async (client, f, store) => {
      const pending = input();
      await store.send(f.seekerId, f.conversationId, pending);
      for (const state of [
        'PENDING_PHONE',
        'LIMITED',
        'SUSPENDED',
        'DEACTIVATED',
        'DELETION_PENDING',
        'DELETED'
      ]) {
        await client`UPDATE users SET account_state=${state} WHERE id=${f.seekerId}`;
        await assert.rejects(
          store.send(f.seekerId, f.conversationId, pending),
          { code: 'CAPABILITY_RESTRICTED' }
        );
      }
      await client`UPDATE users SET account_state='ACTIVE' WHERE id=${f.seekerId}`;
      await client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${f.seekerId}`;
      await assert.rejects(store.send(f.seekerId, f.conversationId, input()), {
        code: 'CAPABILITY_RESTRICTED'
      });
      await client`UPDATE phone_contacts SET replaced_at=NULL,verified_at=NULL WHERE user_id=${f.seekerId}`;
      await assert.rejects(store.send(f.seekerId, f.conversationId, input()), {
        code: 'CAPABILITY_RESTRICTED'
      });
      for (const table of ['provider_profiles', 'provider_accounts']) {
        await client.unsafe(`UPDATE ${table} SET state='RESTRICTED'`);
        assert.equal(
          (await store.messages(f.providerUserId, f.conversationId)).can_send,
          false
        );
        await assert.rejects(
          store.send(f.providerUserId, f.conversationId, input()),
          { code: 'CAPABILITY_RESTRICTED' }
        );
        await client.unsafe(`UPDATE ${table} SET state='ACTIVE'`);
      }
      await assert.rejects(
        new ConversationStore(client, false).send(
          f.providerUserId,
          f.conversationId,
          input()
        ),
        { code: 'CAPABILITY_RESTRICTED' }
      );
      await client`UPDATE verification_claims SET revoked_at=statement_timestamp()`;
      await assert.rejects(
        store.send(f.providerUserId, f.conversationId, input()),
        { code: 'CAPABILITY_RESTRICTED' }
      );
    })
);

void integration(
  'CLOSED and RESTRICTED retain history and receipts while denying fresh/retried sends',
  () =>
    scenario(async (client, f, store) => {
      const request = input();
      const first = await store.send(f.seekerId, f.conversationId, request);
      for (const state of ['CLOSED', 'RESTRICTED']) {
        await client`UPDATE interactions SET state=${state},closed_at=CASE WHEN ${state}='CLOSED' THEN statement_timestamp() ELSE NULL END WHERE id=${f.interactionId}`;
        for (const actor of [f.seekerId, f.providerUserId]) {
          const history = await store.messages(actor, f.conversationId);
          assert.equal(history.items[0]!.id, first.message.id);
          assert.equal(history.can_send, false);
          await assert.rejects(store.send(actor, f.conversationId, request), {
            code:
              state === 'CLOSED'
                ? 'CONVERSATION_CLOSED'
                : 'CAPABILITY_RESTRICTED'
          });
        }
        const read = await store.acknowledge(
          f.providerUserId,
          f.conversationId,
          { message_ids: [first.message.id], state: 'READ' }
        );
        assert.ok(read.receipts[0]!.read_at);
      }
      assert.equal(
        (await client`SELECT count(*)::int AS n FROM messages`)[0]!.n,
        1
      );
    })
);

void integration(
  'active blocks in either direction preserve evidence, deny both sides and revocation permits send',
  () =>
    scenario(async (client, f, store) => {
      const request = input();
      await store.send(f.seekerId, f.conversationId, request);
      for (const direction of [
        'provider-account',
        'provider-user',
        'seeker-user'
      ]) {
        const rows = await client<
          { id: string }[]
        >`INSERT INTO block_relationships(blocker_user_id,blocked_user_id,blocked_provider_account_id) VALUES (${direction === 'seeker-user' ? f.providerUserId : f.seekerId},${direction === 'provider-user' ? f.providerUserId : direction === 'seeker-user' ? f.seekerId : null},${direction === 'provider-account' ? (await client`SELECT provider_account_id FROM interactions WHERE id=${f.interactionId}`)[0]!.provider_account_id : null}) RETURNING id`;
        for (const actor of [f.seekerId, f.providerUserId]) {
          await assert.rejects(store.send(actor, f.conversationId, input()), {
            code: 'CAPABILITY_RESTRICTED'
          });
          assert.equal(
            (await store.messages(actor, f.conversationId)).can_send,
            false
          );
        }
        await assert.rejects(
          store.send(f.seekerId, f.conversationId, request),
          { code: 'CAPABILITY_RESTRICTED' }
        );
        assert.equal(
          (await store.messages(f.seekerId, f.conversationId)).items.length >=
            1,
          true
        );
        await client`UPDATE block_relationships SET revoked_at=statement_timestamp() WHERE id=${rows[0]!.id}`;
        await store.send(f.providerUserId, f.conversationId, input());
      }
      await assert.rejects(
        client`INSERT INTO block_relationships(blocker_user_id) VALUES (${f.seekerId})`,
        { code: '23514' }
      );
      await client`INSERT INTO block_relationships(blocker_user_id,blocked_user_id) VALUES (${f.seekerId},${f.providerUserId})`;
      await assert.rejects(
        client`INSERT INTO block_relationships(blocker_user_id,blocked_user_id) VALUES (${f.seekerId},${f.providerUserId})`,
        { code: '23505' }
      );
    })
);

void integration(
  'shared PostgreSQL fixed-window limits reject concurrent overflow and replay consumes no unit',
  () =>
    scenario(async (client, f) => {
      const another = createDatabase(process.env.DATABASE_TEST_URL!);
      try {
        const stores = [
          new ConversationStore(client, true, {
            conversation: 3,
            global: 4,
            windowSeconds: 3600
          }),
          new ConversationStore(another.client, true, {
            conversation: 3,
            global: 4,
            windowSeconds: 3600
          })
        ];
        const results = await Promise.allSettled(
          Array.from({ length: 10 }, (_, i) =>
            stores[i % 2]!.send(
              f.seekerId,
              f.conversationId,
              input(`Concurrent ${i}`)
            )
          )
        );
        const successes = results.filter(
          (
            r
          ): r is PromiseFulfilledResult<
            Awaited<ReturnType<ConversationStore['send']>>
          > => r.status === 'fulfilled'
        );
        assert.equal(successes.length, 3);
        for (const failure of results.filter((r) => r.status === 'rejected'))
          assert.equal(
            (failure.reason as { code: string }).code,
            'RATE_LIMITED'
          );
        const retry = successes[0]!.value.message;
        assert.equal(
          (
            await stores[1]!.send(f.seekerId, f.conversationId, {
              client_message_id: retry.client_message_id,
              body: retry.body!
            })
          ).created,
          false
        );
        const other = await new InteractionStore(
          client,
          true
        ).createOrReuseInquiry(f.seekerId, f.otherListingId, randomUUID());
        await stores[1]!.send(f.seekerId, other.conversation_id, input());
        await assert.rejects(
          stores[0]!.send(f.seekerId, other.conversation_id, input()),
          { code: 'RATE_LIMITED' }
        );
        assert.equal(
          (
            await client`SELECT message_count FROM message_rate_limits WHERE sender_user_id=${f.seekerId} AND scope='GLOBAL'`
          )[0]!.message_count,
          4
        );
        await client`UPDATE message_rate_limits SET window_start=window_start-interval '2 hours'`;
        await stores[0]!.send(
          f.seekerId,
          f.conversationId,
          input('Next window')
        );
        assert.equal(
          (
            await client`SELECT message_count FROM message_rate_limits WHERE scope='GLOBAL'`
          )[0]!.message_count,
          1
        );
      } finally {
        await another.client.end();
      }
    })
);

void integration(
  'first concurrent provider replies emit one first response and one safe event per new Message',
  () =>
    scenario(async (client, f, store) => {
      await client`UPDATE interactions SET opened_at=statement_timestamp()-interval '3 hours' WHERE id=${f.interactionId}`;
      const request = input('Private provider response sentinel');
      const replies = await Promise.all([
        store.send(f.providerUserId, f.conversationId, request),
        store.send(f.providerUserId, f.conversationId, request),
        ...Array.from({ length: 4 }, () =>
          store.send(f.providerUserId, f.conversationId, input())
        )
      ]);
      const events = await client<
        {
          event_type: string;
          safe_payload: Record<string, string>;
          message_id: string;
          schema_version: number;
        }[]
      >`SELECT event_type,safe_payload,message_id,schema_version FROM communication_outbox`;
      const first = events.filter(
        (e) => e.event_type === 'provider_first_response'
      );
      assert.equal(first.length, 1);
      assert.equal(first[0]!.safe_payload.response_time_bucket, 'H1_TO_4H');
      assert.equal(first[0]!.schema_version, 1);
      assert.equal(
        events.filter((e) => e.event_type === 'message_sent').length,
        5
      );
      assert.deepEqual(Object.keys(first[0]!.safe_payload).sort(), [
        'interaction_id',
        'response_time_bucket'
      ]);
      assert.equal(JSON.stringify(events).includes(request.body), false);
      const earliest = (
        await store.messages(f.seekerId, f.conversationId)
      ).items.at(-1)!;
      assert.equal(first[0]!.message_id, earliest.id);
      assert.equal(new Set(replies.map((r) => r.message.id)).size, 5);
      assert.equal(
        (await store.messages(f.seekerId, f.conversationId)).items.length,
        5
      );
    })
);

void integration(
  'recipient-scoped receipts are monotonic, idempotent, READ implies DELIVERED and sender cannot receipt',
  () =>
    scenario(async (client, f, store) => {
      const seeker = await store.send(f.seekerId, f.conversationId, input());
      const provider = await store.send(
        f.providerUserId,
        f.conversationId,
        input()
      );
      await assert.rejects(
        store.acknowledge(f.seekerId, f.conversationId, {
          message_ids: [seeker.message.id],
          state: 'READ'
        }),
        { code: 'RESOURCE_SCOPE_DENIED' }
      );
      const delivered = await store.acknowledge(
        f.providerUserId,
        f.conversationId,
        { message_ids: [seeker.message.id], state: 'DELIVERED' }
      );
      assert.ok(delivered.receipts[0]!.delivered_at);
      assert.equal(delivered.receipts[0]!.read_at, null);
      const read = await store.acknowledge(f.providerUserId, f.conversationId, {
        message_ids: [seeker.message.id],
        state: 'READ'
      });
      assert.equal(
        read.receipts[0]!.delivered_at,
        delivered.receipts[0]!.delivered_at
      );
      assert.ok(read.receipts[0]!.read_at);
      assert.deepEqual(
        await store.acknowledge(f.providerUserId, f.conversationId, {
          message_ids: [seeker.message.id],
          state: 'DELIVERED'
        }),
        read
      );
      assert.deepEqual(
        await store.acknowledge(f.providerUserId, f.conversationId, {
          message_ids: [seeker.message.id],
          state: 'READ'
        }),
        read
      );
      const direct = await store.acknowledge(f.seekerId, f.conversationId, {
        message_ids: [provider.message.id],
        state: 'READ'
      });
      assert.equal(
        direct.receipts[0]!.delivered_at,
        direct.receipts[0]!.read_at
      );
      await assert.rejects(
        store.acknowledge(f.seekerId, f.conversationId, {
          message_ids: [provider.message.id, seeker.message.id],
          state: 'READ'
        }),
        { code: 'RESOURCE_SCOPE_DENIED' }
      );
    })
);
