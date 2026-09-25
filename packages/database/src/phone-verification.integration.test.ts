import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from './client.js';
import { IdentityStore } from './identity.js';
import { PhoneVerificationStore, type PhoneChallenge } from './phone-verification.js';

if (!process.env.DATABASE_URL && process.env.CI === 'true') throw new Error('DATABASE_URL is required for CI database integration tests');
const integrationTest = process.env.DATABASE_URL ? test : test.skip;

void integrationTest('phone verification consumes one challenge and activates pending users', async () => {
  const { client } = createDatabase();
  const identity = new IdentityStore(client);
  const phone = new PhoneVerificationStore(client, 'synthetic-secret');
  await client`TRUNCATE audit_events, phone_otp_challenges, security_sessions, auth_identities, phone_contacts, email_contacts, users RESTART IDENTITY CASCADE`;
  try {
    const userRows = await client`INSERT INTO users DEFAULT VALUES RETURNING id`;
    const user = userRows[0];
    assert.ok(user);
    const userId = user.id;
    const challenge = await phone.createChallenge(userId, '+237690000001');
    await phone.markDelivery(challenge.id, true);
    const result = await phone.confirm(userId, '+237690000001', challenge.id, challenge.code);
    assert.equal(result.activated, true);
    await assert.rejects(() => phone.confirm(userId, '+237690000001', challenge.id, challenge.code));
    const current = await identity.currentUser(userId);
    assert.equal(current?.phoneVerified, true);
  } finally {
    await client`TRUNCATE audit_events, phone_otp_challenges, security_sessions, auth_identities, phone_contacts, email_contacts, users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});

void integrationTest('phone verification rejects wrong codes and duplicate ownership', async () => {
  const { client } = createDatabase();
  const phone = new PhoneVerificationStore(client, 'synthetic-secret');
  await client`TRUNCATE audit_events, phone_otp_challenges, security_sessions, auth_identities, phone_contacts, email_contacts, users RESTART IDENTITY CASCADE`;
  try {
    const users = await client`INSERT INTO users DEFAULT VALUES RETURNING id`;
    const other = await client`INSERT INTO users DEFAULT VALUES RETURNING id`;
    const firstUser = users[0];
    const secondUser = other[0];
    assert.ok(firstUser);
    assert.ok(secondUser);
    const first = firstUser.id;
    const second = secondUser.id;
    const challenge = await phone.createChallenge(first, '+237690000002');
    await phone.markDelivery(challenge.id, true);
    await assert.rejects(() => phone.confirm(first, '+237690000002', challenge.id, '000000'));
    await assert.rejects(() => phone.confirm(second, '+237690000002', challenge.id, challenge.code));
    const ownerChallenge = await phone.createChallenge(second, '+237690000003');
    await phone.markDelivery(ownerChallenge.id, true);
    await phone.confirm(second, '+237690000003', ownerChallenge.id, ownerChallenge.code);
    const attempted = await phone.createChallenge(first, '+237690000003');
    await phone.markDelivery(attempted.id, true);
    await assert.rejects(() => phone.confirm(first, '+237690000003', attempted.id, attempted.code));
  } finally {
    await client`TRUNCATE audit_events, phone_otp_challenges, security_sessions, auth_identities, phone_contacts, email_contacts, users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});

void integrationTest('phone verification enforces expiry, supersession, attempts, cooldown, and delivery state', async () => {
  const { client } = createDatabase();
  const phone = new PhoneVerificationStore(client, 'synthetic-secret');
  await client`TRUNCATE audit_events, phone_otp_challenges, security_sessions, auth_identities, phone_contacts, email_contacts, users RESTART IDENTITY CASCADE`;
  try {
    const users = await client`INSERT INTO users DEFAULT VALUES RETURNING id`;
    const user = users[0];
    assert.ok(user);
    const first = await phone.createChallenge(user.id, '+237690000004');
    await phone.markDelivery(first.id, true);
    await assert.rejects(() => phone.createChallenge(user.id, '+237690000004'));
    await client`UPDATE phone_otp_challenges SET created_at = now() - interval '61 seconds' WHERE id = ${first.id}`;
    const second = await phone.createChallenge(user.id, '+237690000004');
    await phone.markDelivery(second.id, true);
    const wrongCode = second.code === '999999' ? '888888' : '999999';
    await assert.rejects(() => phone.confirm(user.id, '+237690000004', first.id, first.code));
    await assert.rejects(() => phone.confirm(user.id, '+237690000004', second.id, wrongCode));
    await assert.rejects(() => phone.confirm(user.id, '+237690000004', second.id, wrongCode));
    await assert.rejects(() => phone.confirm(user.id, '+237690000004', second.id, wrongCode));
    await assert.rejects(() => phone.confirm(user.id, '+237690000004', second.id, wrongCode));
    await assert.rejects(() => phone.confirm(user.id, '+237690000004', second.id, wrongCode));
    const locked = await client`SELECT attempts, status FROM phone_otp_challenges WHERE id = ${second.id}`;
    assert.equal(locked[0]?.attempts, 5);
    assert.equal(locked[0]?.status, 'LOCKED');
    await assert.rejects(() => phone.confirm(user.id, '+237690000004', second.id, second.code));

    await client`UPDATE phone_otp_challenges SET created_at = now() - interval '61 seconds' WHERE id = ${second.id}`;
    const expired = await phone.createChallenge(user.id, '+237690000005');
    await phone.markDelivery(expired.id, true);
    await client`UPDATE phone_otp_challenges SET expires_at = now() - interval '1 second' WHERE id = ${expired.id}`;
    await assert.rejects(() => phone.confirm(user.id, '+237690000005', expired.id, expired.code));

    await client`UPDATE phone_otp_challenges SET created_at = now() - interval '61 seconds' WHERE id = ${expired.id}`;
    const failed = await phone.createChallenge(user.id, '+237690000006');
    await phone.markDelivery(failed.id, false, 'DELIVERY_FAILED');
    await assert.rejects(() => phone.confirm(user.id, '+237690000006', failed.id, failed.code));
    const contacts = await client`SELECT count(*)::int AS count FROM phone_contacts WHERE user_id = ${user.id}`;
    assert.equal(contacts[0]?.count, 0);

    const rateLimitedPhone = '+237690000008';
    for (let send = 0; send < 5; send += 1) {
      await client`UPDATE phone_otp_challenges SET created_at = now() - interval '61 seconds' WHERE user_id = ${user.id} AND normalized_e164 = ${rateLimitedPhone}`;
      await phone.createChallenge(user.id, rateLimitedPhone);
    }
    await client`UPDATE phone_otp_challenges SET created_at = now() - interval '61 seconds' WHERE user_id = ${user.id} AND normalized_e164 = ${rateLimitedPhone}`;
    await assert.rejects(() => phone.createChallenge(user.id, rateLimitedPhone));
  } finally {
    await client`TRUNCATE audit_events, phone_otp_challenges, security_sessions, auth_identities, phone_contacts, email_contacts, users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});

void integrationTest('concurrent requests and suspended accounts cannot bypass phone ownership rules', async () => {
  const { client } = createDatabase();
  const phone = new PhoneVerificationStore(client, 'synthetic-secret');
  await client`TRUNCATE audit_events, phone_otp_challenges, security_sessions, auth_identities, phone_contacts, email_contacts, users RESTART IDENTITY CASCADE`;
  try {
    const users = await client`INSERT INTO users DEFAULT VALUES RETURNING id`;
    const user = users[0];
    assert.ok(user);
    const results = await Promise.allSettled([
      phone.createChallenge(user.id, '+237690000007'),
      phone.createChallenge(user.id, '+237690000007')
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const challenge = results.find((result): result is PromiseFulfilledResult<PhoneChallenge> => result.status === 'fulfilled')?.value;
    assert.ok(challenge);
    await phone.markDelivery(challenge.id, true);
    await client`UPDATE users SET account_state = 'SUSPENDED' WHERE id = ${user.id}`;
    await assert.rejects(() => phone.confirm(user.id, '+237690000007', challenge.id, challenge.code));
    const contacts = await client`SELECT count(*)::int AS count FROM phone_contacts WHERE user_id = ${user.id}`;
    assert.equal(contacts[0]?.count, 0);
  } finally {
    await client`TRUNCATE audit_events, phone_otp_challenges, security_sessions, auth_identities, phone_contacts, email_contacts, users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});
