import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, bootstrap } from './api.js';

void test('bootstrap correlates the API request and bounds an unavailable API wait', async (t) => {
  const timeout = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 10_000);
    return timeout.signal;
  });
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal((init.headers as Record<string, string>)['x-request-id'], 'synthetic-request');
    assert.equal((init.headers as Record<string, string>).authorization, 'Bearer synthetic-access');
    assert.equal(init.signal, timeout.signal);
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      timeout.abort(new DOMException('Timed out', 'TimeoutError'));
    });
  });
  await assert.rejects(bootstrap('synthetic-access', 'synthetic-request'), { name: 'TimeoutError' });
});

void test('bootstrap exposes only status for a failed API response', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('private response must not appear in errors', { status: 401 }));
  await assert.rejects(bootstrap('synthetic-access'), (error: unknown) => error instanceof ApiError && error.status === 401 && error.message === 'API_401');
});
