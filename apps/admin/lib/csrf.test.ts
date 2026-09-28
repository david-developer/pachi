import assert from 'node:assert/strict';
import test from 'node:test';
import { sameStaffOrigin, staffCsrfValid } from './csrf';
void test('staff mutations require configured origin and matching session CSRF, not marketplace origin', () => {
  const origin = 'http://localhost:3002';
  const request = (
    from: string | undefined,
    token: string | undefined,
    url = origin + '/api/auth/logout',
  ) =>
    new Request(url, {
      method: 'POST',
      headers: { ...(from ? { origin: from } : {}), ...(token ? { 'x-csrf-token': token } : {}) },
    });
  assert.ok(staffCsrfValid(request(origin, 'synthetic'), origin, 'synthetic'));
  for (const from of [undefined, 'http://localhost:3000', 'https://evil.example', 'null'])
    assert.equal(staffCsrfValid(request(from, 'synthetic'), origin, 'synthetic'), false);
  assert.equal(staffCsrfValid(request(origin, 'wrong'), origin, 'synthetic'), false);
  assert.equal(staffCsrfValid(request(origin, undefined), origin, undefined), false);
  assert.equal(
    sameStaffOrigin(request(origin, 'synthetic', 'https://evil.example/api/auth/logout'), origin),
    false,
  );
});
