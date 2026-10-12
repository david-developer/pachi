// Synthetic TEST fixture only. Callers guard localhost:5433/pachi_test.
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { fixtureFor } from './conversation-fixture.js';
import { InteractionStore } from './interaction.js';
import { ViewingStore } from './viewing.js';

export async function viewingFixture(client: postgres.Sql) {
  const f = await fixtureFor(client);
  const actors = {} as Record<'seeker' | 'provider' | 'other', {
    userId: string; sessionId: string; securityVersion: number;
  }>;
  for (const [name, id] of [['seeker', f.seekerId], ['provider', f.providerUserId], ['other', f.otherUserId]] as const) {
    const session = (await client<{ id: string }[]>`INSERT INTO security_sessions(user_id,issuer,app_client_id,origin_jti,current_jti,expires_at)
      VALUES(${id},'https://local.test/viewing','account',${randomUUID()},${randomUUID()},statement_timestamp()+interval '1 hour') RETURNING id`)[0]!;
    actors[name] = { userId: id, sessionId: session.id, securityVersion: 0 };
  }
  const inquiries = new InteractionStore(client, true);
  const interaction = await inquiries.createOrReuseInquiry(f.seekerId, f.listingId, randomUUID());
  const time = (await client<{ start: Date; end: Date }[]>`SELECT statement_timestamp()+interval '72 hours' AS start,statement_timestamp()+interval '73 hours' AS end`)[0]!;
  const input = {
    proposed_start: new Date(time.start).toISOString(),
    proposed_end: new Date(time.end).toISOString(),
    display_timezone: 'Africa/Douala',
  };
  return {
    ...f, actors, inquiries, interaction, input,
    store: new ViewingStore(client, true),
    command: () => ({ idempotencyKey: randomUUID(), requestId: randomUUID() }),
  };
}
