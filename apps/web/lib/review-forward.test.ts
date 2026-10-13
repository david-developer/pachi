import assert from 'node:assert/strict';
import test from 'node:test';
import { forwardReviewRequest } from './review-forward.js';

const key = '00000000-0000-4000-8000-000000000001';
const session = { accessToken: 'server-only-synthetic-token', csrfToken: 'synthetic' };
const request = (body: unknown, headers: Record<string, string> = {}) => new Request('http://localhost:3000/api/account/review-eligibilities/slot/submit', { method: 'POST', headers: { origin: 'http://localhost:3000', 'x-csrf-token': 'synthetic', 'idempotency-key': key, ...headers }, body: JSON.stringify(body) });

void test('G3-G1 private review BFF requires current session, same origin, CSRF, durable key and bounded valid content', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('must not forward'); });
  const valid = { expected_version: 1, rating: 5, text: 'Safe synthetic feedback' };
  for (const [actor, input, status] of [
    [{}, request(valid), 401], [session, request(valid, { origin: 'https://foreign.invalid' }), 403],
    [session, request(valid, { 'x-csrf-token': 'wrong' }), 403], [session, request(valid, { 'idempotency-key': 'invalid' }), 400],
    [session, request({ ...valid, rating: 0 }), 400], [session, request({ ...valid, rating: 5.5 }), 400],
    [session, request({ ...valid, expected_version: 0 }), 400], [session, request({ ...valid, text: '😀'.repeat(2001) }), 400],
    [session, request({ ...valid, author_user_id: key }), 400], [session, request({ ...valid, criteria: { protected_trait: 5 } }), 400],
    [session, request({ ...valid, criteria: { communication: 6 } }), 400]
  ] as const) {
    const result = await forwardReviewRequest(input, 'account/review-eligibilities/slot/submit', actor, true);
    assert.equal(result.status, status); assert.equal(result.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(calls, 0);
});

void test('G3-G1 review BFF preserves exact version, Unicode body and retry key and masks all backend private errors', async t => {
  const payload = { expected_version: 7, rating: 3, text: '😀'.repeat(2000), criteria: { communication: 4 } };
  const seen: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'http://localhost:3001/v1/account/review-eligibilities/slot/submit'); assert.equal(init.method, 'POST'); assert.equal(init.cache, 'no-store');
    assert.equal((init.headers as Record<string, string>).authorization, `Bearer ${session.accessToken}`); assert.equal((init.headers as Record<string, string>)['idempotency-key'], key);
    seen.push(String(init.body)); return Response.json({ code: 'STALE_VERSION', message: 'PRIVATE_REVIEW_BACKEND_SENTINEL', rating: 1, text: 'PRIVATE_HELD_REVIEW' }, { status: 409 });
  });
  for (let i = 0; i < 2; i++) {
    const response = await forwardReviewRequest(request(payload), 'account/review-eligibilities/slot/submit', session, true);
    assert.deepEqual(await response.json(), { error: 'request_conflict', code: 'STALE_VERSION' });
  }
  assert.equal(seen[0], seen[1]); assert.deepEqual(JSON.parse(seen[0]!), payload);
});

void test('G3-G1 edit, withdrawal and bounded report intake keep fixed private paths and exclude client authority metadata', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { calls++; assert.equal(init.cache, 'no-store'); return Response.json({ review: { id: key }, replayed: false }); });
  for (const [path, body] of [
    ['account/reviews/review/edit', { expected_version: 2, rating: 4, text: '' }],
    ['account/reviews/review/withdraw', { expected_version: 3 }],
    ['account/reviews/review/report', { reason: 'PRIVACY_EXPOSURE', details: '😀'.repeat(2000) }]
  ] as const) assert.equal((await forwardReviewRequest(request(body), path, session, true)).status, 200);
  for (const [path, body] of [
    ['account/reviews/review/withdraw', { expected_version: 3, rating: 1 }],
    ['account/reviews/review/report', { reason: 'UNRESTRICTED_OVERRIDE' }],
    ['account/reviews/review/report', { reason: 'THREATS', details: '😀'.repeat(2001) }],
    ['account/reviews/review/report', { reason: 'THREATS', reporter_id: key }]
  ] as const) assert.equal((await forwardReviewRequest(request(body), path, session, true)).status, 400);
  assert.equal(calls, 3);
});

void test('G3-G1 private projections forward only guarded seeker context and pagination; public reads contain no bearer credentials', async t => {
  const seen: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    seen.push(url); assert.equal(init.cache, 'no-store');
    if (url.includes('/account/')) assert.equal((init.headers as Record<string, string>).authorization, `Bearer ${session.accessToken}`);
    else assert.equal((init.headers as Record<string, string>).authorization, undefined);
    return Response.json({ items: [], reputation: { count: 0, average: null } });
  });
  const input = new Request(`http://localhost:3000/api/account/seekers/seeker/reviews?interaction_id=${key}&cursor=safe&limit=3&author_id=private&held=true`);
  assert.equal((await forwardReviewRequest(input, 'account/seekers/seeker/reviews', session)).status, 200);
  assert.equal((await forwardReviewRequest(new Request(`http://localhost:3000/api/account/providers/provider/reviews?interaction_id=${key}`), 'account/providers/provider/reviews', session)).status, 200);
  assert.equal((await forwardReviewRequest(new Request('http://localhost:3000/api/public/providers/provider/reviews?held=true'), 'providers/provider/reviews', {})).status, 200);
  assert.equal((await forwardReviewRequest(new Request('http://localhost:3000/api/public/listings/listing/reviews'), 'public/listings/listing/reviews', {})).status, 200);
  assert.deepEqual(seen, [`http://localhost:3001/v1/account/seekers/seeker/reviews?interaction_id=${key}&cursor=safe&limit=3`, `http://localhost:3001/v1/account/providers/provider/reviews?interaction_id=${key}`, 'http://localhost:3001/v1/providers/provider/reviews', 'http://localhost:3001/v1/public/listings/listing/reviews']);
  for (const query of ['limit=51', 'limit=1&limit=2', 'interaction_id=not-uuid', `interaction_id=${key}&interaction_id=${key}`])
    assert.equal((await forwardReviewRequest(new Request(`http://localhost:3000/api/account/seekers/seeker/reviews?${query}`), 'account/seekers/seeker/reviews', session)).status, 400);
  assert.equal(seen.length, 4);
});

void test('G3-G1 BFF masks transport failure and arbitrary backend codes and never exposes private errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'PRIVATE_SECRET_CODE', message: 'PRIVATE_REVIEW_BACKEND_SENTINEL' }, { status: 403 }));
  const denied = await forwardReviewRequest(new Request('http://localhost:3000/api/account/reviews/review'), 'account/reviews/review', session);
  assert.deepEqual(await denied.json(), { error: 'review_unavailable' }); assert.equal(denied.headers.get('cache-control'), 'private, no-store');
  t.mock.method(globalThis, 'fetch', async () => { throw Error('PRIVATE_TRANSPORT_SENTINEL'); });
  const unavailable = await forwardReviewRequest(new Request('http://localhost:3000/api/account/reviews/review'), 'account/reviews/review', session);
  assert.equal(unavailable.status, 503); assert.deepEqual(await unavailable.json(), { error: 'review_unavailable' });
  assert.equal((await forwardReviewRequest(request({ expected_version: 1 }), 'account/reviews/review/override', session, true)).status, 404);
});
