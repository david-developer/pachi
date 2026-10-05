import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { BadRequestException, Controller, Module, Post, UnauthorizedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { OrganizationController, OrganizationNoStoreGuard } from './organization.controller.js';
import { OrganizationExceptionFilter } from './organization-exception.filter.js';
import { requestIdMiddleware } from './logging.js';

@Controller('unrelated-probe')
class ExistingErrorProbe { @Post() fail(): never { throw new BadRequestException('existing-safe-message'); } }
@Module({
  controllers: [OrganizationController, ExistingErrorProbe],
  providers: [AuthGuard, OrganizationNoStoreGuard,
    { provide: 'AUTH_SERVICE', useValue: { authenticate: async (authorization: string | undefined) => {
      if (authorization === 'Bearer isolated-parser-test') return { userId: randomUUID(), session: { id: randomUUID(), securityVersion: 1 } };
      throw new UnauthorizedException('AUTH_REQUIRED');
    } } },
    // Unexpected database/adapter exceptions must never expose raw details.
    { provide: 'ORGANIZATION_STORE', useValue: { create: async () => { throw new Error('PACHI_TOK private invitation adapter failure'); } } }]
})
class ErrorTestApp {}

void test('organization parser errors are private and uncacheable; correlation headers/logs cannot carry invitation secrets', async () => {
  const baseline = await NestFactory.create(ErrorTestApp, { logger: false });
  baseline.setGlobalPrefix('v1'); await baseline.listen(0, '127.0.0.1');
  const sentinel = 'PACHI_TOK';
  const raw = `{"token":${sentinel}}`;
  try {
    const response = await fetch(`${await baseline.getUrl()}/v1/account/organization-invitations/${randomUUID()}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
    assert.equal(response.status, 400);
    // Installed Nest parser exposed this fragment before the namespace filter.
    assert.ok((await response.text()).includes(sentinel));
    assert.equal(response.headers.get('cache-control'), null);
  } finally { await baseline.close(); }

  const logs: string[] = [], priorLog = console.log;
  console.log = (value: unknown) => { logs.push(String(value)); };
  const app = await NestFactory.create(ErrorTestApp, { logger: false });
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new OrganizationExceptionFilter(app.getHttpAdapter()));
  app.setGlobalPrefix('v1'); await app.listen(0, '127.0.0.1');
  try {
    const base = await app.getUrl();
    const malformed = await fetch(`${base}/v1/account/organization-invitations/${randomUUID()}/accept`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': sentinel }, body: raw });
    assert.equal(malformed.status, 400); assert.equal(malformed.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await malformed.json(), { statusCode: 400, message: 'INVALID_INPUT' });
    assert.match(malformed.headers.get('x-request-id')!, /^[a-f0-9-]{36}$/); assert.notEqual(malformed.headers.get('x-request-id'), sentinel);
    const correlation = randomUUID();
    const unauthorized = await fetch(`${base}/v1/account/organizations`, { headers: { 'x-request-id': correlation } });
    assert.equal(unauthorized.status, 401); assert.equal(unauthorized.headers.get('cache-control'), 'no-store');
    assert.equal(unauthorized.headers.get('x-request-id'), correlation); assert.deepEqual(await unauthorized.json(), { statusCode: 401, message: 'AUTH_REQUIRED' });
    const unknown = await fetch(`${base}/v1/account/organizations/${sentinel}/unsupported-action`);
    assert.equal(unknown.status, 404); assert.equal(unknown.headers.get('cache-control'), 'no-store'); assert.deepEqual(await unknown.json(), { statusCode: 404, message: 'RESOURCE_UNAVAILABLE' });
    const mixedCase = await fetch(`${base}/V1/ACCOUNT/ORGANIZATION-INVITATIONS/${sentinel}/ACCEPT`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': sentinel }, body: raw });
    assert.equal(mixedCase.status, 400); assert.equal(mixedCase.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await mixedCase.json(), { statusCode: 400, message: 'INVALID_INPUT' });
    assert.match(mixedCase.headers.get('x-request-id')!, /^[a-f0-9-]{36}$/);
    const mixedCaseAuthenticated = await fetch(`${base}/V1/ACCOUNT/ORGANIZATIONS`);
    assert.equal(mixedCaseAuthenticated.status, 401);
    const unexpected = await fetch(`${base}/v1/account/organizations`, { method: 'POST', headers: { authorization: 'Bearer isolated-parser-test', 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify({ legal_name: 'Synthetic Org', public_name: 'Synthetic Org', organization_type: 'REAL_ESTATE_AGENCY', public_phone_opt_in: false }) });
    assert.equal(unexpected.status, 500); assert.equal(unexpected.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await unexpected.json(), { statusCode: 500, message: 'INTERNAL_ERROR' });
    const existing = await fetch(`${base}/v1/unrelated-probe`, { method: 'POST', headers: { 'x-request-id': 'legacy.request.id' } });
    assert.equal(existing.status, 400); assert.equal(existing.headers.get('x-request-id'), 'legacy.request.id');
    assert.equal((await existing.json() as { message: string }).message, 'existing-safe-message');
    assert.ok(!logs.join('\n').includes(sentinel));
  } finally { await app.close(); console.log = priorLog; }
});
