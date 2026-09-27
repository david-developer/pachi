import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProviderPolicy, freshAuthentication, settledFreshAuthentication, AUTH_TIME_CLOCK_SETTLE_MS, AuthenticationFreshnessError } from './provider';
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

void test('freshness diagnostics distinguish invalid, prior, future and expired signed times without weakening checks', () => {
  const now = new Date('2026-09-26T12:00:00.500Z');
  const seconds = Math.floor(+now / 1000);
  const cases = [
    [undefined, new Date(+now - 1000), 'AUTH_TIME_INVALID'],
    [seconds - 2, new Date(+now - 1000), 'AUTH_TIME_BEFORE_TRANSACTION'],
    [seconds + 1, new Date(+now - 1000), 'AUTH_TIME_IN_FUTURE'],
    [seconds - 600, new Date(+now - 700000), 'AUTH_TIME_TOO_OLD'],
  ] as const;
  for (const [value, started, reason] of cases) {
    assert.throws(() => freshAuthentication(value, started, now), (e: unknown) =>
      e instanceof AuthenticationFreshnessError && e.reason === reason && e.message === 'MFA_UNPROVEN');
  }
  assert.equal(+freshAuthentication(seconds, now, now), seconds * 1000);
});

void test('bounded clock settling preserves signed time and strict session/step-up anchors', async () => {
  const base = Date.parse('2026-09-26T12:00:00Z');
  for (const ahead of [1000, AUTH_TIME_CLOCK_SETTLE_MS]) {
    let now = base;
    const signed = (base + ahead) / 1000;
    const result = await settledFreshAuthentication(signed, new Date(base - 10000),
      () => new Date(now), async (ms) => { assert.equal(ms, ahead); now += ms; });
    assert.equal(+result, signed * 1000);
    assert.ok(+result <= now); // StaffStore's strict future guard still holds.
    assert.equal(+result + 8 * 3600000 - now, 8 * 3600000);
    assert.equal(+result + 900000 - now, 900000);
    // Processing delay cannot renew the original authentication/step-up anchor.
    now += 60000;
    assert.equal(+result + 900000 - now, 840000);
  }
  let waits = 0;
  const clock = () => new Date(base);
  const wait = async () => { waits++; };
  await assert.rejects(settledFreshAuthentication((base + 3000) / 1000,
    new Date(base - 10000), clock, wait), { reason: 'AUTH_TIME_IN_FUTURE' });
  assert.equal(waits, 0);
  await assert.rejects(settledFreshAuthentication((base + 1000) / 1000,
    new Date(base - 10000), clock, wait), { reason: 'AUTH_TIME_IN_FUTURE' });
  for (const value of [undefined, null, true, '123', NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(settledFreshAuthentication(value, new Date(base - 10000), clock, wait),
      { reason: 'AUTH_TIME_INVALID' });
  await assert.rejects(settledFreshAuthentication((base - 601000) / 1000,
    new Date(base - 700000), clock, wait), { reason: 'AUTH_TIME_TOO_OLD' });
  assert.equal(+await settledFreshAuthentication((base - 600000) / 1000,
    new Date(base - 700000), clock, wait), base - 600000);
});
