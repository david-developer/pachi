import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import {
  ConversationStore,
  createDatabase,
  IdentityStore,
  InteractionStore,
  type MessageLimits
} from '@pachi/database';
import type {
  ConversationListResponse,
  MessageListResponse,
  MessageSendResponse,
  ReceiptResponse
} from '@pachi/contracts';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { InteractionController } from './interaction.controller.js';
import { ConversationController } from './conversation.controller.js';
import { fixtureFor, type Fixture } from './conversation-fixture.js';

const integration = process.env.DATABASE_TEST_URL ? test : test.skip;
type FixtureContext = Fixture & {
  conversationId: string;
  interactionId: string;
};
type Client = ReturnType<typeof createDatabase>['client'];
async function httpScenario(
  run: (
    client: Client,
    f: FixtureContext,
    call: (
      actor: 'seeker' | 'provider' | 'other' | 'anonymous',
      path: string,
      body?: unknown
    ) => Promise<Response>
  ) => Promise<void>,
  limits: Partial<MessageLimits> = {}
) {
  const { client } = createDatabase(process.env.DATABASE_TEST_URL!);
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const issuer = 'https://local.test/conversation';
  const verifier = new CognitoAccessTokenVerifier({
    issuer,
    getKey: async () => publicKey,
    allowedClientIds: new Set(['account']),
    requiredScopes: new Set(['pachi/account']),
    provider: 'LOCAL_TEST'
  });
  @Module({
    controllers: [InteractionController, ConversationController],
    providers: [
      AuthGuard,
      {
        provide: 'AUTH_SERVICE',
        useValue: new AuthService(new IdentityStore(client), verifier)
      },
      {
        provide: 'INTERACTION_STORE',
        useValue: new InteractionStore(client, true)
      },
      {
        provide: 'CONVERSATION_STORE',
        useValue: new ConversationStore(client, true, limits)
      }
    ]
  })
  class TestApp {}
  const app = await NestFactory.create(TestApp, { logger: false });
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const fixture = await fixtureFor(client);
    const tokens: Record<string, string> = {};
    for (const [actor, id] of [
      ['seeker', fixture.seekerId],
      ['provider', fixture.providerUserId],
      ['other', fixture.otherUserId]
    ]) {
      await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${id!},${issuer},${actor!},'LOCAL_TEST')`;
      tokens[actor!] = await new SignJWT({
        client_id: 'account',
        origin_jti: randomUUID(),
        jti: randomUUID(),
        token_use: 'access',
        scope: 'pachi/account'
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject(actor!)
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
    }
    const address = app.getHttpServer().address();
    const base = `http://127.0.0.1:${address.port}/v1/account`;
    const created = await fetch(
      `${base}/listings/${fixture.listingId}/inquiry`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.seeker}`,
          'idempotency-key': randomUUID()
        }
      }
    );
    assert.equal(created.status, 201);
    const inquiry = (await created.json()) as {
      conversation_id: string;
      interaction_id: string;
    };
    const call = (
      actor: 'seeker' | 'provider' | 'other' | 'anonymous',
      path: string,
      body?: unknown
    ) =>
      fetch(`${base}/conversations${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(actor === 'anonymous'
            ? {}
            : { authorization: `Bearer ${tokens[actor]}` }),
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    await run(
      client,
      {
        ...fixture,
        conversationId: inquiry.conversation_id,
        interactionId: inquiry.interaction_id
      },
      call
    );
  } finally {
    await app.close();
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
}
const input = (body = 'Synthetic HTTP message') => ({
  client_message_id: randomUUID(),
  body
});

void integration(
  'signed Conversation HTTP inquiry/send/provider inbox/reply/retry/history/receipt and safe events',
  () =>
    httpScenario(async (client, f, call) => {
      const path = `/${f.conversationId}/messages`;
      const request = input('<script>HTTP_PRIVATE_MESSAGE</script>');
      assert.equal((await call('anonymous', path, request)).status, 401);
      const first = await call('seeker', path, request);
      assert.equal(first.status, 201);
      const sent = (await first.json()) as MessageSendResponse;
      assert.equal(sent.created, true);
      const replay = await call('seeker', path, request);
      assert.equal(replay.status, 201);
      const replayed = (await replay.json()) as MessageSendResponse;
      assert.equal(replayed.created, false);
      assert.deepEqual(replayed.message, sent.message);
      assert.equal(
        (await call('seeker', path, { ...request, body: 'Different' })).status,
        409
      );
      const inboxResponse = await call('provider', '');
      assert.equal(inboxResponse.status, 200);
      const inbox = (await inboxResponse.json()) as ConversationListResponse;
      assert.equal(inbox.items[0]!.conversation_id, f.conversationId);
      assert.equal(inbox.items[0]!.interaction_id, f.interactionId);
      const reply = input('HTTP provider persisted reply');
      const replies = await Promise.all([
        call('provider', path, reply),
        call('provider', path, reply),
        call('provider', path, input('HTTP concurrent later reply'))
      ]);
      assert.deepEqual(
        replies.map((r) => r.status),
        [201, 201, 201]
      );
      const history = await call('seeker', `${path}?limit=1`);
      assert.equal(history.status, 200);
      const page = (await history.json()) as MessageListResponse;
      assert.equal(page.items.length, 1);
      assert.ok(page.next_cursor);
      const next = (await (
        await call('seeker', `${path}?limit=2&cursor=${page.next_cursor}`)
      ).json()) as MessageListResponse;
      assert.equal(next.items.length, 2);
      assert.equal(next.next_cursor, null);
      const all = [...page.items, ...next.items];
      assert.equal(new Set(all.map((m) => m.id)).size, 3);
      assert.ok(all.some((m) => m.body === reply.body));
      assert.ok(BigInt(all[0]!.sequence) > BigInt(all[1]!.sequence));
      const delivered = await call(
        'provider',
        `/${f.conversationId}/receipts`,
        { message_ids: [sent.message.id], state: 'DELIVERED' }
      );
      assert.equal(delivered.status, 201);
      const receipt = (await delivered.json()) as ReceiptResponse;
      assert.ok(receipt.receipts[0]!.delivered_at);
      assert.equal(receipt.receipts[0]!.read_at, null);
      const read = (await (
        await call('provider', `/${f.conversationId}/receipts`, {
          message_ids: [sent.message.id],
          state: 'READ'
        })
      ).json()) as ReceiptResponse;
      assert.ok(read.receipts[0]!.read_at);
      assert.equal(
        (
          await call('seeker', `/${f.conversationId}/receipts`, {
            message_ids: [sent.message.id],
            state: 'READ'
          })
        ).status,
        404
      );
      assert.equal((await call('other', path)).status, 404);
      assert.equal((await call('other', path, input())).status, 404);
      assert.equal(
        (
          await call('other', `/${f.conversationId}/receipts`, {
            message_ids: [sent.message.id],
            state: 'READ'
          })
        ).status,
        404
      );
      assert.equal(
        ((await (await call('other', '')).json()) as ConversationListResponse)
          .items.length,
        0
      );
      const events =
        await client`SELECT event_type,safe_payload FROM communication_outbox`;
      assert.equal(
        events.filter((e) => e.event_type === 'message_sent').length,
        3
      );
      assert.equal(
        events.filter((e) => e.event_type === 'provider_first_response').length,
        1
      );
      assert.equal(
        JSON.stringify(events).includes('HTTP_PRIVATE_MESSAGE'),
        false
      );
      const serialized = JSON.stringify({ sent, inbox, page, next });
      for (const field of [
        'provider_account_id',
        'provider_profile_id',
        'phone',
        'email',
        'private_address',
        'verification',
        'authority',
        'latitude',
        'longitude',
        'blocker',
        'outbox'
      ])
        assert.equal(serialized.includes(field), false, field);
      await client`UPDATE provider_profiles SET user_id=${f.otherUserId} WHERE user_id=${f.providerUserId}`;
      assert.equal((await call('provider', path)).status, 404);
      assert.equal((await call('provider', path, input())).status, 404);
      assert.equal(
        (
          (await (
            await call('provider', '')
          ).json()) as ConversationListResponse
        ).items.length,
        0
      );
    })
);

void integration(
  'signed message HTTP rejects malformed/blank/oversized input, safe CLOSED/RESTRICTED/block denials',
  () =>
    httpScenario(async (client, f, call) => {
      const path = `/${f.conversationId}/messages`;
      for (const body of [
        null,
        {},
        input(''),
        input(' \n\t'),
        input('😀'.repeat(4001)),
        { ...input(), client_message_id: 'bad' },
        { ...input(), sender_user_id: f.providerUserId },
        { ...input(), body: 4 }
      ])
        assert.equal((await call('seeker', path, body)).status, 400);
      const sent = await call('seeker', path, input());
      assert.equal(sent.status, 201);
      await client`UPDATE interactions SET state='CLOSED',closed_at=statement_timestamp() WHERE id=${f.interactionId}`;
      assert.equal((await call('seeker', path, input())).status, 409);
      assert.equal((await call('seeker', path)).status, 200);
      await client`UPDATE interactions SET state='RESTRICTED',closed_at=NULL WHERE id=${f.interactionId}`;
      const restricted = await call('seeker', path, input());
      assert.equal(restricted.status, 403);
      const restrictedBody = await restricted.text();
      assert.ok(restrictedBody.includes('Messaging is not available'));
      assert.equal(restrictedBody.includes('RESTRICTED'), false);
      assert.equal(
        ((await (await call('provider', path)).json()) as MessageListResponse)
          .can_send,
        false
      );
      await client`UPDATE interactions SET state='OPEN' WHERE id=${f.interactionId}`;
      const blocks = await client<
        { id: string }[]
      >`INSERT INTO block_relationships(blocker_user_id,blocked_user_id) VALUES (${f.providerUserId},${f.seekerId}) RETURNING id`;
      const blocked = await call('seeker', path, input());
      assert.equal(blocked.status, 403);
      assert.equal(await blocked.text(), restrictedBody);
      assert.equal((await call('provider', path, input())).status, 403);
      assert.equal(
        ((await (await call('seeker', path)).json()) as MessageListResponse)
          .items.length,
        1
      );
      await client`UPDATE block_relationships SET revoked_at=statement_timestamp() WHERE id=${blocks[0]!.id}`;
      await client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${f.seekerId}`;
      const phone = await call('seeker', path, input());
      assert.equal(phone.status, 403);
      assert.equal(await phone.text(), restrictedBody);
      assert.equal(
        (await call('seeker', `${path}?cursor=invalid`)).status,
        400
      );
      assert.equal(
        (
          await call('provider', `/${f.conversationId}/receipts`, {
            message_ids: [],
            state: 'READ'
          })
        ).status,
        400
      );
    })
);

void integration(
  'signed HTTP rate limit is 429, retries do not consume shared units',
  () =>
    httpScenario(
      async (client, f, call) => {
        const path = `/${f.conversationId}/messages`;
        const request = input();
        assert.equal((await call('seeker', path, request)).status, 201);
        const results = await Promise.all(
          Array.from({ length: 5 }, () => call('seeker', path, input()))
        );
        assert.equal(results.filter((r) => r.status === 201).length, 1);
        assert.equal(results.filter((r) => r.status === 429).length, 4);
        assert.equal((await call('seeker', path, request)).status, 201);
        assert.equal(
          (
            await client`SELECT message_count FROM message_rate_limits WHERE scope='GLOBAL'`
          )[0]!.message_count,
          2
        );
        assert.equal(
          (
            await client`SELECT count(*)::int AS n FROM communication_outbox WHERE event_type='message_sent'`
          )[0]!.n,
          2
        );
      },
      { conversation: 2, global: 2, windowSeconds: 3600 }
    )
);
