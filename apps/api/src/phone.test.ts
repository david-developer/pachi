import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalSmsDevelopmentController, LocalSmsSink, normalizeCameroonPhone } from './phone.js';

void test('normalizes Cameroon E.164 input and rejects other destinations', () => {
  assert.equal(normalizeCameroonPhone('+237 690 000 001'), '+237690000001');
  assert.throws(() => normalizeCameroonPhone('+2250100000000'));
  assert.throws(() => normalizeCameroonPhone('+237000000000'));
});

void test('local SMS sink is forbidden in production and exposes synthetic deliveries only to tests', async () => {
  assert.throws(() => new LocalSmsSink('production'));
  const sink = new LocalSmsSink('test');
  const challengeId = '00000000-0000-4000-8000-000000000001';
  await sink.sendOtp({ destination: '+237690000001', purpose: 'PHONE_OWNERSHIP', code: '123456', expiresInMinutes: 5, idempotencyKey: challengeId });
  assert.deepEqual(sink.deliveries, [{ destination: '+237690000001', code: '123456', idempotencyKey: challengeId }]);
  await assert.rejects(() => sink.sendOtp({ destination: '+237000000000', purpose: 'PHONE_OWNERSHIP', code: '123456', expiresInMinutes: 5, idempotencyKey: 'failed' }));
  const controller = new LocalSmsDevelopmentController(sink);
  const request = { params: { challengeId }, socket: { remoteAddress: '127.0.0.1' } } as never;
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try { assert.deepEqual(controller.delivery(request), { destination: '+237690000001', code: '123456' }); }
  finally { if (previousEnvironment) process.env.NODE_ENV = previousEnvironment; }
  const remoteRequest = { params: { challengeId }, socket: { remoteAddress: '10.0.0.8' }, headers: { 'x-forwarded-for': '127.0.0.1' } } as never;
  process.env.NODE_ENV = 'development';
  assert.throws(() => controller.delivery(remoteRequest));
});
