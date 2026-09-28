import assert from 'node:assert/strict';
import test from 'node:test';
import { csrfValid, sameOrigin } from './csrf.js';
import { safeReturnTo, WEB_AUTH_SCOPE } from './oidc.js';
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
