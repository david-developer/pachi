import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { developmentEnvironment } from './dev-environment.mjs';

function fixture(t, extra = '') {
  const directory = mkdtempSync(join(tmpdir(), 'pachi-startup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'apps/web'), { recursive: true });
  writeFileSync(join(directory, '.env'), `DATABASE_URL=postgresql://synthetic:synthetic@localhost:5432/pachi_local
COGNITO_ISSUER=https://cognito-idp.eu-west-1.amazonaws.com/synthetic
COGNITO_JWKS_URI=https://cognito-idp.eu-west-1.amazonaws.com/synthetic/.well-known/jwks.json
COGNITO_CLIENT_IDS=synthetic
AUTH_REQUIRED_SCOPES=pachi/account
COGNITO_CLIENT_SECRET=root-synthetic
${extra}`);
  writeFileSync(join(directory, 'apps/web/.env'), `COGNITO_CLIENT_ID=synthetic
COGNITO_CLIENT_SECRET=web-synthetic
COGNITO_REDIRECT_URI=http://localhost:3000/api/auth/callback
PACHI_API_URL=http://localhost:3001
WEB_SESSION_SECRET=synthetic-session-secret-for-startup-tests
`);
  return pathToFileURL(`${directory}/`);
}

test('dirty test shell cannot replace file settings or inject runtime hooks', (t) => {
  const environment = developmentEnvironment(fixture(t), 'api', {
    PATH: '/synthetic/bin', DATABASE_URL: 'postgresql://localhost:5433/pachi_test',
    DATABASE_TEST_URL: 'postgresql://localhost:5433/pachi_test', CI: 'true', NODE_ENV: 'test',
    AUTH_ALLOW_TEST_ISSUER: 'true', COGNITO_ISSUER: 'https://local.test/issuer',
    NODE_OPTIONS: '--require synthetic', __NEXT_PROCESSED_ENV: 'true'
  });
  assert.equal(new URL(environment.DATABASE_URL).pathname, '/pachi_local');
  assert.equal(environment.NODE_ENV, 'development');
  assert.equal(environment.AUTH_ALLOW_TEST_ISSUER, 'false');
  for (const key of ['CI', 'DATABASE_TEST_URL', 'NODE_OPTIONS', '__NEXT_PROCESSED_ENV']) assert.equal(environment[key], undefined);
  assert.equal(environment.PATH, '/synthetic/bin');
});

test('web preserves its existing file secret, independent of API root settings', (t) => {
  const root = fixture(t);
  assert.equal(developmentEnvironment(root, 'web', {}).COGNITO_CLIENT_SECRET, 'web-synthetic');
  assert.equal(developmentEnvironment(root, 'api', {}).COGNITO_CLIENT_SECRET, 'root-synthetic');
});

test('missing verifier and explicit test targets fail before launching services', (t) => {
  assert.throws(() => developmentEnvironment(fixture(t, 'COGNITO_ISSUER=\n'), 'api', {}), /Missing COGNITO_ISSUER/);
  assert.throws(() => developmentEnvironment(fixture(t, 'DATABASE_URL=postgresql://localhost:5433/pachi_test\n'), 'web', {}), /require localhost:5432/);
  assert.throws(() => developmentEnvironment(fixture(t, 'AUTH_ALLOW_TEST_ISSUER=true\n'), 'api', {}), /cannot enable the test issuer/);
});
