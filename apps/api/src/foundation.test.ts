import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from './config.js';
import { redact } from './logging.js';

void test('loads synthetic local configuration with defaults', () => {
  const config = loadConfig({ DATABASE_URL: 'postgresql://pachi:pachi_local_only@localhost:5432/pachi_local' });
  assert.equal(config.NODE_ENV, 'development');
  assert.equal(config.API_PORT, 3001);
});

void test('redacts secret-like structured fields', () => {
  assert.deepEqual(redact({ token: 'hidden', nested: { password: 'hidden' }, safe: 'visible' }), {
    token: '[REDACTED]', nested: { password: '[REDACTED]' }, safe: 'visible'
  });
});
