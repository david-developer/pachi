import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { NestFactory } from '@nestjs/core';
import { createDatabase } from '@pachi/database';

if (!process.env.DATABASE_TEST_URL && process.env.CI === 'true') throw new Error('DATABASE_TEST_URL is required for provider HTTP integration tests');
const integrationTest = process.env.DATABASE_TEST_URL ? test : test.skip;

void integrationTest('provider onboarding HTTP wiring supports success, retry, and cross-user isolation', async () => {
  const databaseUrl = process.env.DATABASE_TEST_URL;
  assert.ok(databaseUrl);
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'provider-test-key';
  const jwksServer = createServer((_request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  const address = jwksServer.address();
  assert.ok(address && typeof address === 'object');
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.COGNITO_ISSUER = 'http://127.0.0.1/provider-test';
  process.env.COGNITO_JWKS_URI = `http://127.0.0.1:${address.port}/jwks`;
  process.env.COGNITO_CLIENT_IDS = 'provider-test-client';
  process.env.AUTH_REQUIRED_SCOPES = 'pachi/account';
  const { AppModule } = await import('./app.module.js');
  const { authDatabaseClient } = await import('./auth.module.js');
  const { client } = createDatabase(databaseUrl);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');
  const apiAddress = app.getHttpServer().address();
  assert.ok(apiAddress && typeof apiAddress === 'object');
  const base = `http://127.0.0.1:${apiAddress.port}`;
  try {
    await client`TRUNCATE provider_accounts, provider_profiles, phone_contacts, security_sessions, auth_identities, users RESTART IDENTITY CASCADE`;
    const users = await client`INSERT INTO users (account_state) VALUES ('ACTIVE'), ('ACTIVE') RETURNING id`;
    const first = users[0]; const second = users[1]; assert.ok(first); assert.ok(second);
    await client`INSERT INTO phone_contacts (user_id, normalized_e164, verified_at, verification_version) VALUES (${first.id}, '+237690000010', now(), 1), (${second.id}, '+237690000011', now(), 1)`;
    await client`INSERT INTO auth_identities (user_id, issuer, subject, provider) VALUES (${first.id}, 'http://127.0.0.1/provider-test', ${first.id}, 'COGNITO'), (${second.id}, 'http://127.0.0.1/provider-test', ${second.id}, 'COGNITO')`;
    const makeToken = async (subject: string, family: string) => new SignJWT({ client_id: 'provider-test-client', origin_jti: family, jti: `${family}-token`, token_use: 'access', scope: 'pachi/account' }).setProtectedHeader({ alg: 'RS256', kid: 'provider-test-key' }).setIssuer('http://127.0.0.1/provider-test').setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const firstToken = await makeToken(first.id, 'family-first');
    const secondToken = await makeToken(second.id, 'family-second');
    const post = async (token: string, body: unknown) => fetch(`${base}/v1/account/provider/onboard`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const firstResponse = await post(firstToken, { provider_types: ['OWNER', 'PROPERTY_MANAGER'], display_name: 'Test Homes', service_area: 'Littoral' });
    const firstBody = await firstResponse.text();
    console.log(JSON.stringify({ event: 'provider_http_test_response', status: firstResponse.status, body: firstBody.slice(0, 500) }));
    assert.equal(firstResponse.status, 201, `provider onboarding response: ${firstBody}`);
    const firstResult = JSON.parse(firstBody) as { profile_id: string; account_id: string; state: string; verification_status: string };
    assert.equal(firstResult.state, 'DRAFT'); assert.equal(firstResult.verification_status, 'NOT_VERIFIED');
    const retry = await post(firstToken, { provider_types: ['OWNER', 'PROPERTY_MANAGER'], display_name: 'Test Homes', service_area: 'Littoral' });
    assert.equal(retry.status, 201);
    const retryResult = await retry.json() as { profile_id: string; account_id: string };
    assert.equal(retryResult.profile_id, firstResult.profile_id); assert.equal(retryResult.account_id, firstResult.account_id);
    const crossUser = await fetch(`${base}/v1/account/provider`, { headers: { authorization: `Bearer ${secondToken}` } });
    assert.equal(crossUser.status, 200); assert.deepEqual(await crossUser.json(), { provider: null });
  } finally {
    await client`TRUNCATE provider_accounts, provider_profiles, phone_contacts, security_sessions, auth_identities, users RESTART IDENTITY CASCADE`;
    await client.end(); await app.close(); await authDatabaseClient.end(); await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  }
});
