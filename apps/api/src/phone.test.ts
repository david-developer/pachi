import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalSmsSink, normalizeCameroonPhone } from './phone.js';

void test('normalizes Cameroon E.164 input and rejects other destinations', () => {
  assert.equal(normalizeCameroonPhone('+237 690 000 001'), '+237690000001');
  assert.throws(() => normalizeCameroonPhone('+2250100000000'));
  assert.throws(() => normalizeCameroonPhone('+237000000000'));
});

void test('local SMS sink is forbidden in production and exposes synthetic deliveries only to tests', async () => {
  assert.throws(() => new LocalSmsSink('production'));
  const sink = new LocalSmsSink('test');
  await sink.sendOtp({ destination: '+237690000001', purpose: 'PHONE_OWNERSHIP', code: '123456', expiresInMinutes: 5, idempotencyKey: 'challenge' });
  assert.deepEqual(sink.deliveries, [{ destination: '+237690000001', code: '123456', idempotencyKey: 'challenge' }]);
  await assert.rejects(() => sink.sendOtp({ destination: '+237000000000', purpose: 'PHONE_OWNERSHIP', code: '123456', expiresInMinutes: 5, idempotencyKey: 'failed' }));
});
