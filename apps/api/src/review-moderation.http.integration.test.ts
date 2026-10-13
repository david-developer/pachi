import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { StaffStore, type StaffPrincipal, type ReviewModerationStore, type createDatabase } from '@pachi/database';
import type { ReviewModerationCommandResponse, ReviewModerationDetailResponse } from '@pachi/contracts';
import { StaffAuthService } from './staff.controller.js';
import { StaffReviewModerationController } from './staff-review-moderation.controller.js';
import { OrganizationOwnerNoStoreGuard } from './organization-owner.controller.js';
import { OrganizationExceptionFilter } from './organization-exception.filter.js';
import { requestIdMiddleware } from './logging.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';

const integration = process.env.DATABASE_TEST_URL ? test : test.skip;
type Fixture = { client: ReturnType<typeof createDatabase>['client']; staff: StaffPrincipal; caseId: string; reviewId: string; seekerId: string;
  moderation: ReviewModerationStore; start: () => Promise<void>; close: () => Promise<void>;
  makeStaff: (permissions?: string[], userId?: string, role?: string) => Promise<StaffPrincipal> };
type Call = (path: string, body?: unknown, principal?: StaffPrincipal | null, raw?: boolean) => Promise<Response>;
async function scenario(work: (f: Fixture, call: Call) => Promise<void>) {
  const { reviewModerationFixture } = await import(new URL('../../../packages/database/dist/review-moderation-fixture.js', import.meta.url).href);
  const f = await reviewModerationFixture(false) as Fixture;
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const verifier = new CognitoAccessTokenVerifier({ issuer: f.staff.row.issuer, getKey: async () => publicKey,
    allowedClientIds: new Set(['staff']), requiredScopes: new Set(['pachi/staff']), provider: 'LOCAL_TEST', strictStaff: true });
  @Module({ controllers: [StaffReviewModerationController], providers: [OrganizationOwnerNoStoreGuard,
    { provide: 'STAFF_AUTH_SERVICE', useValue: new StaffAuthService(new StaffStore(f.client), verifier) },
    { provide: 'REVIEW_MODERATION_STORE', useValue: f.moderation }] }) class TestApp {}
  const app = await NestFactory.create(TestApp, { logger: false }); app.setGlobalPrefix('v1');
  app.use(requestIdMiddleware); app.useGlobalFilters(new OrganizationExceptionFilter(app.getHttpAdapter()));
  await app.listen(0, '127.0.0.1');
  try {
    const address = app.getHttpServer().address() as { port: number }, base = `http://127.0.0.1:${address.port}/v1/staff/review-cases`;
    const call: Call = async (path, body, principal = f.staff, raw = false) => {
      const headers: Record<string, string> = { 'x-request-id': randomUUID(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
      if (principal) {
        const identity = (await f.client<{ subject: string }[]>`SELECT subject FROM auth_identities WHERE id=${principal.row.identity_id}`)[0]!;
        const token = await new SignJWT({ client_id: principal.row.app_client_id, origin_jti: principal.row.origin_jti, jti: randomUUID(), token_use: 'access', scope: 'pachi/staff' })
          .setProtectedHeader({ alg: 'RS256' }).setIssuer(principal.row.issuer).setSubject(identity.subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
        headers.authorization = `Bearer ${token}`;
      }
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers,
        ...(body === undefined ? {} : { body: raw ? String(body) : JSON.stringify(body) }) });
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
      return response;
    };
    await work(f, call);
  } finally { await app.close(); await f.close(); }
}
const purpose = 'REVIEW_MODERATION';
async function detail(f: Fixture, call: Call) { const response = await call(`/${f.caseId}?purpose=${purpose}`); assert.equal(response.status, 200); return response.json() as Promise<ReviewModerationDetailResponse>; }
function decision(d: ReviewModerationDetailResponse, command: string) { return { purpose, expected_version: d.case.version, expected_review_version: d.review.version,
  command, reason_code: command === 'RESTORE' ? 'ELIGIBILITY_RESTORED' : 'INVESTIGATION', reason_text: 'Synthetic justified review moderation decision', idempotency_key: randomUUID() }; }

void integration('G3-H1 HTTP queue is metadata-only and protected evidence requires actual case assignment', async () => scenario(async (f, call) => {
  const queue = await call(`?purpose=${purpose}`); assert.equal(queue.status, 200); const text = await queue.text(); assert.ok(text.includes(f.caseId));
  for (const confidential of ['HELD_REVIEW_CANARY', 'CONFIDENTIAL_REPORT_CONTEXT', 'reporter_user_id', 'rating', 'criteria', 'private_instructions']) assert.ok(!text.includes(confidential));
  assert.equal((await call(`/${f.caseId}?purpose=${purpose}`)).status, 403);
  const assigned = await call(`/${f.caseId}/assign`, { purpose, expected_version: 1, assigned_staff_user_id: f.staff.row.user_id, idempotency_key: randomUUID() }); assert.equal(assigned.status, 201);
  const d = await detail(f, call); assert.equal(d.review.text, 'HELD_REVIEW_CANARY'); assert.equal(d.actions.length, 1);
  const context = JSON.stringify(d); assert.ok(!context.includes('reporter_user_id')); assert.ok(!context.includes('CONFIDENTIAL_MEETING_CANARY'));
}));
void integration('G3-H1 HTTP current case grants and evidence permission cannot be replaced by a client role', async () => scenario(async (f, call) => {
  await f.start(); await f.client`UPDATE staff_grants SET permission_scope=${JSON.stringify({ kind: 'case', id: f.caseId, permissions: ['review:moderate', 'moderation:act'] })}::jsonb WHERE user_id=${f.staff.row.user_id}`;
  assert.equal((await call(`/${f.caseId}?purpose=${purpose}`)).status, 403);
  assert.equal((await call(`/${f.caseId}/assign`, { purpose, expected_version: 3, assigned_staff_user_id: f.staff.row.user_id, idempotency_key: randomUUID(), role: 'SUPER_ADMIN' })).status, 400);
  await f.client`UPDATE staff_grants SET permission_scope=${JSON.stringify({ kind: 'case', id: randomUUID(), permissions: ['review:moderate', 'evidence:read'] })}::jsonb WHERE user_id=${f.staff.row.user_id}`;
  assert.equal((await call(`/${f.caseId}?purpose=${purpose}`)).status, 403);
}));
for (const [name, change, expected] of [
  ['expired grant', 'grant', 403], ['stale session', 'session', 401], ['lost security version', 'security', 401], ['missing current step-up', 'stepup', 403],
] as const) void integration(`G3-H1 HTTP denies ${name} with a safe private error envelope`, async () => scenario(async (f, call) => {
  await f.start();
  if (change === 'grant') await f.client`UPDATE staff_grants SET active_from=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE user_id=${f.staff.row.user_id}`;
  if (change === 'session') await f.client`UPDATE staff_sessions SET revoked_at=statement_timestamp() WHERE id=${f.staff.row.id}`;
  if (change === 'security') await f.client`UPDATE users SET security_version=security_version+1 WHERE id=${f.staff.row.user_id}`;
  if (change === 'stepup') await f.client`UPDATE staff_sessions SET authenticated_at=statement_timestamp()-interval '16 minutes',absolute_expires_at=statement_timestamp()+interval '7 hours' WHERE id=${f.staff.row.id}`;
  const response = await call(`/${f.caseId}?purpose=${purpose}`); assert.equal(response.status, expected);
  const error = await response.json() as { code: string; request_id: string; message: string }; assert.ok(error.code); assert.equal(error.code, error.message); assert.match(error.request_id, /^[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(error).includes('HELD_REVIEW_CANARY')); if (change === 'stepup') assert.equal(error.code, 'STEP_UP_REQUIRED');
}));
void integration('G3-H1 HTTP own-account case conflict is denied even with current explicit grants', async () => scenario(async (f, call) => {
  const own = await f.makeStaff(['case:assign', 'report:triage', 'review:moderate', 'moderation:act', 'evidence:read'], f.seekerId);
  const queue = await call(`?purpose=${purpose}`, undefined, own); assert.equal(queue.status, 200); assert.deepEqual(await queue.json(), { items: [] });
  assert.equal((await call(`/${f.caseId}/assign`, { purpose, expected_version: 1, assigned_staff_user_id: own.row.user_id, idempotency_key: randomUUID() }, own)).status, 403);
}));
void integration('G3-H1 HTTP decisions retain immutable linked history and safe idempotent replay', async () => scenario(async (f, call) => {
  await f.start(); const first = decision(await detail(f, call), 'HIDE');
  const hiddenResponse = await call(`/${f.caseId}/decisions`, first); assert.equal(hiddenResponse.status, 201); const hidden = await hiddenResponse.json() as ReviewModerationCommandResponse;
  assert.equal(hidden.case.review_state, 'HIDDEN'); assert.ok(hidden.action.appeal_deadline); assert.equal(hidden.action.before_review_state, 'SUBMITTED_HELD');
  const retry = await call(`/${f.caseId}/decisions`, first); assert.equal(retry.status, 201); assert.equal((await retry.json() as ReviewModerationCommandResponse).replayed, true);
  assert.equal((await call(`/${f.caseId}/decisions`, { ...first, reason_text: 'Different attempted decision rationale' })).status, 409);
  assert.equal((await call(`/${f.caseId}/decisions`, { ...first, idempotency_key: randomUUID() })).status, 409);
  const restoration = { ...decision(await detail(f, call), 'RESTORE'), reverses_action_id: hidden.action.id };
  assert.equal((await call(`/${f.caseId}/decisions`, restoration)).status, 201); const restored = await detail(f, call); assert.equal(restored.review.state, 'SUBMITTED_HELD');
  assert.equal(restored.review.rating, 4); assert.equal(restored.review.text, 'HELD_REVIEW_CANARY'); assert.equal(restored.actions.at(-1)?.reverses_action_id, hidden.action.id);
}));
void integration('G3-H1 HTTP malformed input and missing purpose/auth fail without cacheable evidence', async () => scenario(async (f, call) => {
  assert.equal((await call(`?purpose=${purpose}`, undefined, null)).status, 401);
  assert.equal((await call('')).status, 400); assert.equal((await call('?purpose=GENERAL_BROWSING')).status, 400);
  assert.equal((await call(`/${f.caseId}?purpose=${purpose}&include_identity=true`)).status, 400);
  const malformed = await call(`/${f.caseId}/decisions`, '{"secret":"PRIVATE_INPUT_CANARY",', f.staff, true); assert.equal(malformed.status, 400); assert.ok(!(await malformed.text()).includes('PRIVATE_INPUT_CANARY'));
}));
for (const inactive of ['SUSPENDED', 'IDENTITY_UNLINKED'] as const) void integration(`G3-H1 HTTP ${inactive} assignee returns scoped denial without an ambiguous server error`, async () => scenario(async (f, call) => {
  const recipient = await f.makeStaff();
  if (inactive === 'SUSPENDED') await f.client`UPDATE users SET account_state='SUSPENDED' WHERE id=${recipient.row.user_id}`;
  else await f.client`UPDATE auth_identities SET unlinked_at=statement_timestamp() WHERE id=${recipient.row.identity_id}`;
  const response = await call(`/${f.caseId}/assign`, { purpose, expected_version: 1, assigned_staff_user_id: recipient.row.user_id, idempotency_key: randomUUID() });
  assert.equal(response.status, 403); assert.equal((await response.json() as { code: string }).code, 'RESOURCE_SCOPE_DENIED');
  assert.equal((await f.client<{ count: number }[]>`SELECT count(*)::integer AS count FROM review_moderation_actions`)[0]?.count, 0);
}));
