import test from 'node:test';
import assert from 'node:assert/strict';
import { responseTimeBucket, RESPONSE_BUCKET_VERSION } from './conversation.js';
void test('first-response bucket v1 is deterministic at every boundary including 24 hours', () => {
  assert.equal(RESPONSE_BUCKET_VERSION, 1);
  const boundaries = [300_000, 900_000, 3600_000, 14400_000, 86400_000];
  const before = ['LT_5M', 'M5_TO_15M', 'M15_TO_60M', 'H1_TO_4H', 'H4_TO_24H'];
  const at = ['M5_TO_15M', 'M15_TO_60M', 'H1_TO_4H', 'H4_TO_24H', 'H4_TO_24H'];
  const after = ['M5_TO_15M', 'M15_TO_60M', 'H1_TO_4H', 'H4_TO_24H', 'GT_24H'];
  boundaries.forEach((boundary, i) => {
    assert.equal(responseTimeBucket(boundary - 1), before[i]);
    assert.equal(responseTimeBucket(boundary), at[i]);
    assert.equal(responseTimeBucket(boundary + 1), after[i]);
  });
  assert.equal(responseTimeBucket(0), 'LT_5M');
});
