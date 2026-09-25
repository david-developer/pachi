import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from './config.js';

void test('rejects test issuer and missing Cognito configuration in production', () => {
  assert.throws(() => loadConfig({
    NODE_ENV: 'production', DATABASE_URL: 'postgresql://pachi:pachi_local_only@localhost:5432/pachi_local',
    COGNITO_ISSUER: 'https://local.test/issuer', COGNITO_JWKS_URI: 'https://local.test/jwks',
    COGNITO_CLIENT_IDS: 'local-client', AUTH_REQUIRED_SCOPES: 'pachi/account', AUTH_ALLOW_TEST_ISSUER: 'true'
  }));
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://pachi:pachi_local_only@localhost:5432/pachi_local' }));
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://pachi:pachi_local_only@localhost:5432/pachi_local', COGNITO_ISSUER: 'https://cognito.example/issuer', COGNITO_JWKS_URI: 'https://cognito.example/jwks', COGNITO_CLIENT_IDS: 'client', AUTH_REQUIRED_SCOPES: 'pachi/account', PHONE_OTP_HMAC_SECRET: 'configured', SMS_PROVIDER: 'local' }));
});
