import assert from 'node:assert/strict';
import test from 'node:test';
import { forwardViewingRequest } from './viewing-forward.js';

const key = '00000000-0000-4000-8000-000000000001';
const input = (origin = 'http://localhost:3000', body = JSON.stringify({ expected_version: 2, expected_schedule_version: 1 })) =>
  new Request('http://localhost:3000/api/account/viewings/id/confirm?provider_id=private', {
    method: 'POST', headers: { origin, 'x-csrf-token': 'synthetic', 'idempotency-key': key }, body
  });

void test('viewing BFF denies anonymous, mismatched CSRF and cross-origin mutations without forwarding', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('must not forward'); });
  for (const [session, request, status] of [
    [{}, input(), 401],
    [{ accessToken: 'server-only-token', csrfToken: 'different' }, input(), 403],
    [{ accessToken: 'server-only-token', csrfToken: 'synthetic' }, input('https://different.invalid'), 403],
    [{ accessToken: 'server-only-token', csrfToken: 'synthetic' }, input('http://localhost:3000', '{'), 400]
  ] as const) {
    const response = await forwardViewingRequest(request, 'viewings/id/confirm', session, true);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(calls, 0);
});

void test('viewing BFF forwards exact versions, private body and durable retry key, but masks backend errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'http://localhost:3001/v1/account/viewings/id/confirm');
    assert.equal(init.body, JSON.stringify({ expected_version: 2, expected_schedule_version: 1 }));
    const headers = init.headers as Record<string, string>;
    assert.equal(headers['idempotency-key'], key);
    assert.equal(headers.authorization, 'Bearer server-only-token');
    assert.equal(init.cache, 'no-store');
    return Response.json({ code: 'STALE_SCHEDULE_VERSION', message: 'PRIVATE_BACKEND_SENTINEL' }, { status: 409 });
  });
  const response = await forwardViewingRequest(input(), 'viewings/id/confirm', { accessToken: 'server-only-token', csrfToken: 'synthetic' }, true);
  assert.deepEqual(await response.json(), { error: 'request_conflict', code: 'STALE_SCHEDULE_VERSION' });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

void test('viewing inbox forwards only supported query filters and keeps successful responses private', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'http://localhost:3001/v1/account/viewings?interaction_id=interaction&cursor=page&limit=10');
    assert.equal(init.cache, 'no-store');
    return Response.json({ items: [], next_cursor: null, can_request: true });
  });
  const response = await forwardViewingRequest(new Request('http://localhost:3000/api/account/viewings?interaction_id=interaction&cursor=page&limit=10&seeker_id=private'), 'viewings', { accessToken: 'server-only-token' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { items: [], next_cursor: null, can_request: true });
});

void test('viewing BFF transport errors return a safe unavailable response', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('PRIVATE_FAILURE_SENTINEL'); });
  const response = await forwardViewingRequest(new Request('http://localhost:3000/api/account/viewings'), 'viewings', { accessToken: 'server-only-token' });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { error: 'viewing_unavailable' });
});
