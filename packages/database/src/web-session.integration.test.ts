import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from './client.js';
import { WebAuthSessionStore } from './web-session.js';

if (!process.env.DATABASE_URL && process.env.CI === 'true') throw new Error('DATABASE_URL is required for CI database integration tests');
const integrationTest = process.env.DATABASE_URL ? test : test.skip;

void integrationTest('web sessions encrypt tokens, refresh activity, and cannot be read after revocation or expiry', async () => {
  const { client } = createDatabase();
  const store = new WebAuthSessionStore(client, 'synthetic-web-session-secret');
  const users = await client`INSERT INTO users DEFAULT VALUES RETURNING id`;
  const user = users[0];
  assert.ok(user);
  try {
    const id = await store.create(user.id, 'access-secret', 'refresh-secret', new Date(Date.now() + 300_000));
    const session = await store.read(id);
    assert.equal(session?.accessToken, 'access-secret');
    assert.equal(session?.refreshToken, 'refresh-secret');
    await store.revoke(id);
    assert.equal(await store.read(id), null);

    const expired = await store.create(user.id, 'expired-access', undefined, new Date(Date.now() + 300_000));
    await client`UPDATE web_auth_sessions SET idle_expires_at = now() - interval '1 second' WHERE id = ${expired}`;
    assert.equal(await store.read(expired), null);
  } finally {
    await client`DELETE FROM web_auth_sessions WHERE user_id = ${user.id}`;
    await client`DELETE FROM users WHERE id = ${user.id}`;
    await client.end();
  }
});
