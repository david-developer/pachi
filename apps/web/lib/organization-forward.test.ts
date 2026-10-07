import assert from 'node:assert/strict';
import test from 'node:test';
import { forwardOrganizationRequest } from './organization-forward.js';

const input = () => new Request('http://localhost:3000/api/account/organization-invitations/accept?token=untrusted-url-token', {
  method: 'POST', headers: { origin: 'http://localhost:3000', 'x-csrf-token': 'synthetic-csrf', 'idempotency-key': 'synthetic-retry-key' },
  body: JSON.stringify({ token: 'PRIVATE_INVITATION_SENTINEL', expected_version: 1 })
});

void test('organization BFF rejects missing session and CSRF before sending a token command', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('must not call'); });
  const unauthenticated = await forwardOrganizationRequest(input(), 'organization-invitations/accept', {}, true);
  assert.equal(unauthenticated.status, 401);
  const rejected = await forwardOrganizationRequest(input(), 'organization-invitations/accept', { accessToken: 'server-access', csrfToken: 'wrong' }, true);
  assert.equal(rejected.status, 403);
  assert.equal(calls, 0);
});

void test('organization BFF preserves body versions and retry header without forwarding URL secrets or backend error text', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'http://localhost:3001/v1/account/organization-invitations/accept');
    assert.deepEqual(JSON.parse(init.body as string), { token: 'PRIVATE_INVITATION_SENTINEL', expected_version: 1 });
    assert.equal((init.headers as Record<string, string>)['idempotency-key'], 'synthetic-retry-key');
    assert.equal((init.headers as Record<string, string>).authorization, 'Bearer server-access');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal);
    return Response.json({ message: 'PRIVATE_INVITATION_SENTINEL', digest: 'PRIVATE_DIGEST' }, { status: 400 });
  });
  const response = await forwardOrganizationRequest(input(), 'organization-invitations/accept', { accessToken: 'server-access', csrfToken: 'synthetic-csrf' }, true);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { error: 'organization_request_failed' });
});

void test('organization BFF distinguishes authoritative disabled delivery from an ambiguous transport failure', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'DELIVERY_UNAVAILABLE' }, { status: 503 }));
  const disabled = await forwardOrganizationRequest(input(), 'organizations/fixture/invitations', { accessToken: 'server-access', csrfToken: 'synthetic-csrf' }, true);
  assert.deepEqual(await disabled.json(), { error: 'delivery_unavailable' });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('PRIVATE_PROVIDER_ERROR'); });
  const failed = await forwardOrganizationRequest(input(), 'organizations/fixture/invitations', { accessToken: 'server-access', csrfToken: 'synthetic-csrf' }, true);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'organization_unavailable' });
});

void test('organization BFF forwards only collection pagination query fields', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'http://localhost:3001/v1/account/organizations?cursor=page-two&limit=10');
    return Response.json({ organizations: [], next_cursor: null });
  });
  const request = new Request('http://localhost:3000/api/account/organizations?cursor=page-two&limit=10&token=PRIVATE_INVITATION_SENTINEL&role=OWNER');
  const response = await forwardOrganizationRequest(request, 'organizations', { accessToken: 'server-access' });
  assert.equal(response.status, 200);
});

void test('owner BFF conveys trusted step-up-required and final-owner protection safely with no-store', async t => {
  for (const [message,error] of [['STEP_UP_REQUIRED','step_up_required'],['FINAL_OWNER_PROTECTED','final_owner_protected']]) {
    t.mock.method(globalThis,'fetch',async()=>Response.json({message,private_evidence:'PRIVATE_SENTINEL'},{status:message==='STEP_UP_REQUIRED'?403:409}));
    const response=await forwardOrganizationRequest(input(),'organizations/fixture/members/fixture/privileged-role',{accessToken:'server-access',csrfToken:'synthetic-csrf'},true);
    assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(await response.json(),{error});
  }
});
