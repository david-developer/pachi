import test from 'node:test';
import assert from 'node:assert/strict';
import type { AnalyticsStore } from '@pachi/database';
import {
  processAnalyticsOnce,
  runAnalyticsWorker,
} from './analytics-worker.js';

void test('analytics worker passes through one deterministic iteration', async () => {
  let calls = 0;
  const store = {
    processAnalyticsOnce: async () => {
      calls++;
      return { consumed: 2, deferred: 1 };
    },
  } as AnalyticsStore;
  assert.deepEqual(await processAnalyticsOnce(store), {
    consumed: 2,
    deferred: 1,
  });
  assert.equal(calls, 1);
});
void test('worker retries a failed iteration with redacted logging and stops on abort', async () => {
  const abort = new AbortController();
  let calls = 0;
  const logged: string[] = [];
  const previous = console.error;
  const store = {
    processAnalyticsOnce: async () => {
      calls++;
      if (calls === 1) throw new Error('PRIVATE_SOURCE_PAYLOAD');
      abort.abort();
      return { consumed: 1, deferred: 0 };
    },
  } as AnalyticsStore;
  console.error = (value: string) => {
    logged.push(value);
  };
  try {
    await runAnalyticsWorker({
      store,
      signal: abort.signal,
      pollMilliseconds: 1,
    });
  } finally {
    console.error = previous;
  }
  assert.equal(calls, 2);
  assert.deepEqual(logged, ['{"event":"analytics_consumption_failed"}']);
  await runAnalyticsWorker({
    store,
    signal: abort.signal,
    pollMilliseconds: 1,
  });
  assert.equal(calls, 2);
});
