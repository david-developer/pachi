import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from './client.js';
import { IdentityError, IdentityStore, type VerifiedTokenClaims } from './identity.js';

const databaseUrl = process.env.DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

void integrationTest('bootstraps one user and session under concurrency', async () => {
  const { client } = createDatabase(databaseUrl);
  const store = new IdentityStore(client);
  await client`TRUNCATE security_sessions, auth_identities, phone_contacts, email_contacts, users RESTART IDENTITY CASCADE`;
  const claims = syntheticClaims();
  try {
    const principals = await Promise.all(Array.from({ length: 8 }, () => store.bootstrap(claims, 'integration-test')));
    assert.equal(new Set(principals.map((principal) => principal.userId)).size, 1);
    assert.equal(new Set(principals.map((principal) => principal.session.id)).size, 1);
    const users = await client`SELECT count(*)::int AS count FROM users`;
    const identities = await client`SELECT count(*)::int AS count FROM auth_identities`;
    const sessions = await client`SELECT count(*)::int AS count FROM security_sessions`;
    assert.equal(users[0]?.count, 1);
    assert.equal(identities[0]?.count, 1);
    assert.equal(sessions[0]?.count, 1);

    const firstPrincipal = principals[0];
    assert.ok(firstPrincipal);
    await store.revokeAllSessions(firstPrincipal.userId, 'test-revocation');
    await assert.rejects(() => store.bootstrap(claims), (error: unknown) => error instanceof IdentityError && error.code === 'SESSION_REVOKED');
  } finally {
    await client`TRUNCATE security_sessions, auth_identities, phone_contacts, email_contacts, users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});

function syntheticClaims(): VerifiedTokenClaims {
  const now = new Date();
  return {
    issuer: 'https://local.test/issuer', subject: `subject-${Date.now()}`, clientId: 'local-client',
    originJti: `family-${Date.now()}`, jti: `token-${Date.now()}`, issuedAt: now,
    expiresAt: new Date(now.getTime() + 300_000), scopes: ['pachi/account'], provider: 'LOCAL_TEST'
  };
}
