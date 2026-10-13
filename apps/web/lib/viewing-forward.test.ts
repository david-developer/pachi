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

void test('G3-F2 BFF forwards only participant notice and proposal pagination filters with server-only credentials',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{calls++;assert.equal(url,calls===1?'http://localhost:3001/v1/account/viewing-notices?viewing_id=appointment&cursor=page&limit=5':'http://localhost:3001/v1/account/viewings/appointment/reschedules?cursor=page&limit=5');assert.equal(init.cache,'no-store');assert.equal((init.headers as Record<string,string>).authorization,'Bearer server-only-token');return Response.json({items:[],next_cursor:null});});
  await forwardViewingRequest(new Request('http://localhost:3000/api/account/viewing-notices?viewing_id=appointment&cursor=page&limit=5&organization_id=untrusted'),'viewing-notices',{accessToken:'server-only-token'});
  await forwardViewingRequest(new Request('http://localhost:3000/api/account/viewings/appointment/reschedules?cursor=page&limit=5&role=OWNER'),'viewings/appointment/reschedules',{accessToken:'server-only-token'});assert.equal(calls,2);
});
void test('G3-F2 BFF preserves exact proposal versions and retry key and masks private backend conflict details',async(t)=>{
  const body={expected_version:5,expected_schedule_version:1,expected_proposal_version:2};t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{assert.equal(url,'http://localhost:3001/v1/account/viewings/appointment/reschedules/proposal/accept');assert.equal(init.body,JSON.stringify(body));assert.equal((init.headers as Record<string,string>)['idempotency-key'],key);return Response.json({code:'STALE_PROPOSAL_VERSION',message:'PRIVATE_MEETING_BACKEND_SENTINEL'},{status:409});});
  const request=new Request('http://localhost:3000/api/account/viewings/appointment/reschedules/proposal/accept',{method:'POST',headers:{origin:'http://localhost:3000','x-csrf-token':'synthetic','idempotency-key':key},body:JSON.stringify(body)});
  const response=await forwardViewingRequest(request,'viewings/appointment/reschedules/proposal/accept',{accessToken:'server-only-token',csrfToken:'synthetic'},true);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(await response.json(),{error:'request_conflict',code:'STALE_PROPOSAL_VERSION'});
});

void test('G3-F3 attendance BFF forwards exact claim versions, evidence reference and retry key with a private neutral conflict', async (t) => {
  const body = { expected_version: 6, expected_schedule_version: 2, expected_claim_version: 1, reason: 'OUTCOME_INCORRECT', evidence: [{ reference: key, kind: 'MESSAGE' }] };
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'http://localhost:3001/v1/account/viewings/appointment/attendance/claims/claim/dispute');
    assert.equal(init.body, JSON.stringify(body));
    assert.equal((init.headers as Record<string, string>)['idempotency-key'], key);
    assert.equal((init.headers as Record<string, string>).authorization, 'Bearer server-only-token');
    assert.equal(init.cache, 'no-store');
    return Response.json({ code: 'STALE_CLAIM_VERSION', message: 'PRIVATE_ATTENDANCE_EVIDENCE_SENTINEL' }, { status: 409 });
  });
  const request = new Request('http://localhost:3000/api/account/viewings/appointment/attendance/claims/claim/dispute', { method: 'POST', headers: { origin: 'http://localhost:3000', 'x-csrf-token': 'synthetic', 'idempotency-key': key }, body: JSON.stringify(body) });
  const result = await forwardViewingRequest(request, 'viewings/appointment/attendance/claims/claim/dispute', { accessToken: 'server-only-token', csrfToken: 'synthetic' }, true);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await result.json(), { error: 'request_conflict', code: 'STALE_CLAIM_VERSION' });
});

void test('G3-F3 attendance BFF rejects substituted authority, invalid versions and unbounded or private evidence before forwarding', async (t) => {
  let forwarded = 0;
  t.mock.method(globalThis, 'fetch', async () => { forwarded++; throw Error('must not forward'); });
  const valid = { expected_version: 6, expected_schedule_version: 2, expected_claim_version: 1, reason: 'OTHER' };
  for (const body of [
    { ...valid, claimant_user_id: key }, { ...valid, expected_schedule_version: 0 }, { ...valid, expected_claim_version: 1.5 },
    { ...valid, reason: ['OTHER'] }, { ...valid, evidence: [{ reference: key, kind: 'PHOTO' }] },
    { ...valid, evidence: [{ reference: 'private note', kind: 'MESSAGE' }] },
    { ...valid, evidence: [{ reference: key, kind: 'MESSAGE', text: 'PRIVATE_EVIDENCE_SENTINEL' }] },
    { ...valid, evidence: [{ reference: key, kind: 'MESSAGE' }, { reference: key, kind: 'MESSAGE' }] },
    { ...valid, evidence: Array.from({ length: 6 }, () => ({ reference: key, kind: 'MESSAGE' })) }
  ]) {
    const request = new Request('http://localhost:3000/api/account/viewings/appointment/attendance/claims/claim/dispute', { method: 'POST', headers: { origin: 'http://localhost:3000', 'x-csrf-token': 'synthetic' }, body: JSON.stringify(body) });
    const result = await forwardViewingRequest(request, 'viewings/appointment/attendance/claims/claim/dispute', { accessToken: 'server-only-token', csrfToken: 'synthetic' }, true);
    assert.equal(result.status, 400); assert.equal(result.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await result.json(), { error: 'invalid_request' });
  }
  assert.equal(forwarded, 0);
});

void test('G3-F3 attendance reads forward bounded pagination only and keep the pending case private', async (t) => {
  const seen: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { seen.push(url); return Response.json({ case: { state: 'OPEN', review_status: 'PENDING_REVIEW' } }); });
  const session = { accessToken: 'server-only-token' };
  const result = await forwardViewingRequest(new Request('http://localhost:3000/api/account/viewings/appointment/attendance?cursor=page&limit=50&provider_id=untrusted'), 'viewings/appointment/attendance', session);
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'private, no-store');
  await forwardViewingRequest(new Request('http://localhost:3000/api/account/viewings/appointment/attendance/case?evidence=private'), 'viewings/appointment/attendance/case', session);
  assert.deepEqual(seen, ['http://localhost:3001/v1/account/viewings/appointment/attendance?cursor=page&limit=50', 'http://localhost:3001/v1/account/viewings/appointment/attendance/case']);
  for (const query of ['limit=51', 'limit=1&limit=2', 'limit=-1']) {
    const response = await forwardViewingRequest(new Request(`http://localhost:3000/api/account/viewings/appointment/attendance?${query}`), 'viewings/appointment/attendance', session);
    assert.equal(response.status, 400);
  }
  assert.equal(seen.length, 2);
});

void test('G3-F3 attendance mutations require current server session, same origin and matching CSRF before forwarding', async (t) => {
  let forwarded = 0;
  t.mock.method(globalThis, 'fetch', async () => { forwarded++; throw Error('must not forward'); });
  for (const [session, origin, token, status] of [
    [{}, 'http://localhost:3000', 'synthetic', 401],
    [{ accessToken: 'server-only-token', csrfToken: 'synthetic' }, 'https://foreign.invalid', 'synthetic', 403],
    [{ accessToken: 'server-only-token', csrfToken: 'synthetic' }, 'http://localhost:3000', 'wrong', 403]
  ] as const) {
    const request = new Request('http://localhost:3000/api/account/viewings/appointment/attendance/completion', { method: 'POST', headers: { origin, 'x-csrf-token': token }, body: JSON.stringify({ expected_version: 1, expected_schedule_version: 1 }) });
    const result = await forwardViewingRequest(request, 'viewings/appointment/attendance/completion', session, true);
    assert.equal(result.status, status); assert.equal(result.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(forwarded, 0);
});
