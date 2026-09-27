import assert from 'node:assert/strict';
import test from 'node:test';
import { revokeRefreshToken, revokeLocalThenProvider, safeRevocationFailure } from './revocation';
const provider = { issuer: 'https://issuer.example', domain: 'https://staff.example',
  clientId: 'synthetic-client', clientSecret: 'synthetic-secret' };
void test('Cognito revocation uses Basic auth, form refresh token and accepts an empty 200', async () => {
  await revokeRefreshToken(provider, 'synthetic-old-refresh', async (input, init) => {
    assert.equal(String(input), 'https://staff.example/oauth2/revoke');
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    const auth = headers.get('authorization')!;
    assert.ok(auth.startsWith('Basic '));
    assert.deepEqual(Buffer.from(auth.slice(6), 'base64').toString().split(':').map(decodeURIComponent),
      [provider.clientId, provider.clientSecret]);
    assert.match(headers.get('content-type')!, /application\/x-www-form-urlencoded/);
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get('token'), 'synthetic-old-refresh');
    assert.equal(body.has('client_secret'), false);
    return new Response(null, { status: 200 });
  });
});
void test('provider rejection has safe status/code without leaking its arbitrary response', async () => {
  try {
    await revokeRefreshToken(provider, 'synthetic-refresh', async () =>
      Response.json({ error: 'invalid_client', error_description: 'PRIVATE synthetic-secret' }, { status: 401 }));
    assert.fail('must reject');
  } catch (error) {
    assert.deepEqual(safeRevocationFailure(error), { reason: 'invalid_client', http_status: 401 });
  }
});
void test('old session invalidation precedes provider call and failure permits caller cleanup without revoking replacement', async () => {
  const active = new Set(['old', 'new']);
  const reports: Record<string, unknown>[] = [];
  await revokeLocalThenProvider('old', async (id) => {
    active.delete(id); return 'synthetic-old-token';
  }, async (refresh) => {
    assert.equal(active.has('old'), false);
    assert.equal(active.has('new'), true);
    assert.equal(refresh, 'synthetic-old-token');
    throw new Error('PRIVATE token and headers');
  }, (event) => reports.push(event));
  assert.deepEqual([...active], ['new']);
  assert.equal(reports[0]?.stage, 'provider_revoke_failed');
  assert.ok(!JSON.stringify(reports).includes('PRIVATE'));
});
