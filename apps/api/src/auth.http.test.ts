import assert from 'node:assert/strict';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';

void test('protected HTTP account route returns 401 without or with invalid credentials', async () => {
  process.env.NODE_ENV = 'development';
  process.env.DATABASE_URL ??= 'postgresql://pachi:pachi_local_only@localhost:5432/pachi_local';
  process.env.AUTH_REQUIRED_SCOPES ??= 'pachi/account';
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const missing = await fetch(`${baseUrl}/v1/account/me`);
    assert.equal(missing.status, 401);
    const invalid = await fetch(`${baseUrl}/v1/account/me`, { headers: { authorization: 'Bearer invalid-test-token' } });
    assert.equal(invalid.status, 401);
    const bootstrap = await fetch(`${baseUrl}/v1/auth/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(bootstrap.status, 401);
    const phoneRequest = await fetch(`${baseUrl}/v1/account/phone/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+237690000001' }) });
    assert.equal(phoneRequest.status, 401);
    const live = await fetch(`${baseUrl}/v1/health/live`);
    assert.equal(live.status, 200);
  } finally {
    await app.close();
  }
});
