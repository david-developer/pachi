import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProviderPolicy, freshAuthentication } from './provider';
import { staffConfig } from './config';
const config = {
  poolId: 'eu-west-1_staff',
  clientId: 'staff',
  clientSecret: 'synthetic',
  callback: 'http://localhost:3002/api/auth/callback',
  origin: 'http://localhost:3002',
};
function evidence() {
  return {
    pool: {
      MfaConfiguration: 'ON',
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      Policies: {
        PasswordPolicy: { MinimumLength: 12 },
        SignInPolicy: { AllowedFirstAuthFactors: ['PASSWORD'] },
      },
    },
    mfa: { MfaConfiguration: 'ON', SoftwareTokenMfaConfiguration: { Enabled: true } },
    client: {
      ClientId: 'staff',
      ClientSecret: 'synthetic',
      SupportedIdentityProviders: ['COGNITO'],
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: ['openid', 'email', 'pachi/staff'],
      CallbackURLs: [config.callback],
      LogoutURLs: [config.origin],
      EnableTokenRevocation: true,
      RefreshTokenRotation: { Feature: 'ENABLED', RetryGracePeriodSeconds: 10 },
      ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH'],
      AccessTokenValidity: 5,
      TokenValidityUnits: { AccessToken: 'minutes' },
    },
    domain: { UserPoolId: config.poolId, ManagedLoginVersion: 2 },
    user: {
      Enabled: true,
      UserStatus: 'CONFIRMED',
      UserAttributes: [{ Name: 'sub', Value: 'subject' }],
      UserMFASettingList: ['SOFTWARE_TOKEN_MFA'],
    },
  };
}
void test('only inspected required-TOTP local managed login configuration proves MFA', () => {
  assert.doesNotThrow(() => assertProviderPolicy(evidence(), config, 'subject'));
  for (const change of [
    (s: ReturnType<typeof evidence>) => {
      s.pool.Policies.SignInPolicy.AllowedFirstAuthFactors.push('WEB_AUTHN');
    },
    (s: ReturnType<typeof evidence>) => {
      s.pool.MfaConfiguration = 'OPTIONAL';
    },
    (s: ReturnType<typeof evidence>) => {
      s.mfa.SoftwareTokenMfaConfiguration.Enabled = false;
    },
    (s: ReturnType<typeof evidence>) => {
      s.client.SupportedIdentityProviders.push('Google');
    },
    (s: ReturnType<typeof evidence>) => {
      s.client.ExplicitAuthFlows.push('ALLOW_CUSTOM_AUTH');
    },
    (s: ReturnType<typeof evidence>) => {
      s.domain.ManagedLoginVersion = 1;
    },
    (s: ReturnType<typeof evidence>) => {
      s.user.UserMFASettingList = [];
    },
    (s: ReturnType<typeof evidence>) => {
      s.user.UserAttributes.push({ Name: 'identities', Value: '[]' });
    },
    (s: ReturnType<typeof evidence>) => {
      s.client.CallbackURLs.push('https://evil.example');
    },
    (s: ReturnType<typeof evidence>) => {
      s.client.RefreshTokenRotation.Feature = 'DISABLED';
    },
    (s: ReturnType<typeof evidence>) => {
      s.user.Enabled = false;
    },
  ]) {
    const s = evidence();
    change(s);
    assert.throws(() => assertProviderPolicy(s, config, 'subject'), /MFA_UNPROVEN/);
  }
  assert.throws(() => assertProviderPolicy(evidence(), config, 'another-subject'));
});
void test('reauthentication must be signed, fresh and no earlier than server transaction', () => {
  const now = new Date('2026-09-26T12:00:00Z'),
    started = new Date(+now - 60_000);
  assert.equal(+freshAuthentication(+now / 1000, started, now), +now);
  for (const value of [undefined, true, '1780000000', +now / 1000 + 1, +started / 1000 - 1])
    assert.throws(() => freshAuthentication(value, started, now));
});
void test('staff config refuses shared consumer issuer/client/secret and unsafe origins', () => {
  const env = {
    STAFF_COGNITO_ISSUER: 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_staff',
    STAFF_COGNITO_CLIENT_ID: 'staff',
    STAFF_COGNITO_CLIENT_SECRET: 'synthetic',
    STAFF_COGNITO_DOMAIN: 'https://staff.auth.eu-west-1.amazoncognito.com',
    STAFF_ORIGIN: 'http://localhost:3002',
    STAFF_SESSION_SECRET: 'synthetic-staff-secret-with-at-least-32-characters',
    DATABASE_URL: 'postgresql://localhost/synthetic',
    PACHI_API_URL: 'http://localhost:3001',
  };
  assert.doesNotThrow(() => staffConfig(env));
  assert.throws(() => staffConfig({ ...env, COGNITO_ISSUER: env.STAFF_COGNITO_ISSUER }));
  assert.throws(() => staffConfig({ ...env, COGNITO_CLIENT_IDS: 'staff' }));
  assert.throws(() => staffConfig({ ...env, WEB_SESSION_SECRET: env.STAFF_SESSION_SECRET }));
  assert.throws(() => staffConfig({ ...env, STAFF_ORIGIN: 'http://evil.example' }));
  assert.throws(() => staffConfig({ ...env, STAFF_ORIGIN: 'https://staff.example/redirect' }));
});
