import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { CognitoAccessTokenVerifier, TokenVerificationError } from './token-verifier.js';

const issuer = 'https://local.test/issuer';
const clientId = 'local-client';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'local-key';
const getKey = createLocalJWKSet({ keys: [publicJwk] });
const verifier = new CognitoAccessTokenVerifier({ issuer, getKey, allowedClientIds: new Set([clientId]), requiredScopes: new Set(['pachi/account']), provider: 'LOCAL_TEST' });

async function token(overrides: Record<string, unknown> = {}) {
  const expiration = typeof overrides.exp === 'number' ? overrides.exp : '5m';
  return new SignJWT({ client_id: clientId, origin_jti: 'family-1', jti: 'token-1', token_use: 'access', scope: 'openid pachi/account', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'local-key' })
    .setIssuer(issuer)
    .setSubject('synthetic-subject')
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(privateKey);
}

void test('accepts a signed access token with required claims', async () => {
  const claims = await verifier.verify(await token());
  assert.equal(claims.subject, 'synthetic-subject');
  assert.deepEqual(claims.scopes, ['openid', 'pachi/account']);
});

void test('rejects wrong token type, client, issuer, scope, signature and expiry', async (suite) => {
  await suite.test('ID token', async () => assert.rejects(async () => verifier.verify(await token({ token_use: 'id' })), TokenVerificationError));
  await suite.test('client', async () => assert.rejects(async () => verifier.verify(await token({ client_id: 'other-client' })), TokenVerificationError));
  await suite.test('issuer', async () => assert.rejects(async () => new CognitoAccessTokenVerifier({ ...verifierOptions(), issuer: 'https://other.test/issuer' }).verify(await token()), TokenVerificationError));
  await suite.test('scope', async () => assert.rejects(async () => verifier.verify(await token({ scope: 'openid' })), TokenVerificationError));
  await suite.test('signature', async () => assert.rejects(async () => verifier.verify(`${await token()}.bad`), TokenVerificationError));
  await suite.test('expiry', async () => assert.rejects(async () => verifier.verify(await token({ exp: Math.floor(Date.now() / 1000) - 60 })), TokenVerificationError));
});

function verifierOptions() {
  return { getKey, allowedClientIds: new Set([clientId]), requiredScopes: new Set(['pachi/account']), provider: 'LOCAL_TEST' as const };
}
