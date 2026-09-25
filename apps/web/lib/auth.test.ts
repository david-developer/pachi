import assert from 'node:assert/strict';
import test from 'node:test';
import { csrfValid, sameOrigin } from './csrf.js';
import { cognitoLogoutUrl, safeReturnTo, WEB_AUTH_SCOPE } from './oidc.js';
import { sessionOptions } from './session.js';

void test('rejects open redirects and accepts local relative return paths', () => {
  assert.equal(safeReturnTo('/account'), '/account');
  assert.equal(safeReturnTo('https://evil.example'), '/');
  assert.equal(safeReturnTo('//evil.example'), '/');
  assert.equal(safeReturnTo(null), '/');
});

void test('requires same-origin CSRF header', async () => {
  const request = new Request('http://localhost:3000/api/account/phone/request', { method: 'POST', headers: { origin: 'http://localhost:3000', 'x-csrf-token': 'csrf' } });
  assert.equal(sameOrigin(request), true);
  assert.equal(await csrfValid(request, 'csrf'), true);
  assert.equal(await csrfValid(request, 'wrong'), false);
  const crossOrigin = new Request(request.url, { method: 'POST', headers: { origin: 'https://evil.example', 'x-csrf-token': 'csrf' } });
  assert.equal(await csrfValid(crossOrigin, 'csrf'), false);
});

void test('session cookie is encrypted, HttpOnly, SameSite, and path scoped', () => {
  assert.equal(sessionOptions.cookieName, 'pachi_web_session');
  assert.equal(sessionOptions.cookieOptions.httpOnly, true);
  assert.equal(sessionOptions.cookieOptions.sameSite, 'lax');
  assert.equal(sessionOptions.cookieOptions.path, '/');
});

void test('requests the API-required participation scope', () => {
  assert.match(WEB_AUTH_SCOPE, /openid/);
  assert.match(WEB_AUTH_SCOPE, /pachi\/account/);
});

void test('builds Cognito managed logout URL separately from the local sign-out URI', () => {
  const previous = { domain: process.env.COGNITO_DOMAIN, client: process.env.COGNITO_CLIENT_ID, logout: process.env.COGNITO_LOGOUT_URI };
  process.env.COGNITO_DOMAIN = 'https://eu-west-1rdgl0xcsm.auth.eu-west-1.amazoncognito.com';
  process.env.COGNITO_CLIENT_ID = 'test-client';
  process.env.COGNITO_LOGOUT_URI = 'http://localhost:3000';
  try {
    const url = new URL(cognitoLogoutUrl() ?? '');
    assert.equal(url.origin, 'https://eu-west-1rdgl0xcsm.auth.eu-west-1.amazoncognito.com');
    assert.equal(url.pathname, '/logout');
    assert.equal(url.searchParams.get('client_id'), 'test-client');
    assert.equal(url.searchParams.get('logout_uri'), 'http://localhost:3000');
  } finally {
    if (previous.domain) process.env.COGNITO_DOMAIN = previous.domain; else delete process.env.COGNITO_DOMAIN;
    if (previous.client) process.env.COGNITO_CLIENT_ID = previous.client; else delete process.env.COGNITO_CLIENT_ID;
    if (previous.logout) process.env.COGNITO_LOGOUT_URI = previous.logout; else delete process.env.COGNITO_LOGOUT_URI;
  }
});
