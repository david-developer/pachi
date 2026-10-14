import { expect, test, type Page } from '@playwright/test';
import type { ReviewModerationAction, ReviewModerationDetailResponse, ReviewModerationQueueItem } from '@pachi/contracts';
const caseId = '00000000-0000-4000-8000-000000000801', reviewId = '00000000-0000-4000-8000-000000000802';
const staffId = '00000000-0000-4000-8000-000000000803', actionId = '00000000-0000-4000-8000-000000000804';
const at = '2026-10-13T12:00:00.000Z';
function hold() { let release!: () => void, arrived!: () => void; return { wait: new Promise<void>(r => { release = r; }), arrived: new Promise<void>(r => { arrived = r; }), release: () => release(), notify: () => arrived() }; }
async function fixture(page: Page) {
  const item: ReviewModerationQueueItem = { id: caseId, review_id: reviewId, reason: 'PRIVACY_EXPOSURE', severity: 'HIGH', state: 'TRIAGED', version: 2,
    review_state: 'SUBMITTED_HELD', review_version: 1, opened_at: at, last_report_at: at, report_count: 1, assigned_staff_user_id: staffId,
    age_seconds: 300, due_at: at, overdue: false, next_action: 'BEGIN_INVESTIGATION' };
  const detail: ReviewModerationDetailResponse = { case: item, review: { id: reviewId, state: 'SUBMITTED_HELD', version: 1, rating: 4, text: 'SYNTHETIC_PERMITTED_REVIEW', criteria: {}, published_at: null },
    revisions: [{ version: 1, rating: 4, text: 'SYNTHETIC_PERMITTED_REVIEW', criteria: {}, created_at: at }],
    reports: [{ id: actionId, reason: 'PRIVACY_EXPOSURE', details: 'Synthetic private reporting context', created_at: at }], actions: [] };
  const state = { item, detail, queueStatus: 200, detailStatus: 200, nextStatus: 0, abortNext: false, empty: false, queueHold: null as ReturnType<typeof hold> | null,
    detailHold: null as ReturnType<typeof hold> | null, effects: 0, bodies: [] as Record<string, unknown>[], receipts: new Map<string, ReviewModerationAction>() };
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === '/api/session') return route.fulfill({ json: { csrf: 'synthetic-csrf', session: { user_id: staffId, display_name: 'Synthetic review staff', grants: [{ role: 'TRUST_SAFETY_MODERATOR', scope: { kind: 'case', id: caseId,
      permissions: ['case:assign', 'report:triage', 'review:moderate', 'moderation:act', 'evidence:read'] }, expires_at: '2031-01-01T00:00:00Z' }], absolute_expires_at: at, idle_expires_at: at, reauthentication_expires_at: at } } });
    expect(path).toContain('/api/review-cases');
    if (request.method() === 'GET') {
      expect(url.searchParams.get('purpose')).toBe('REVIEW_MODERATION');
      if (path === '/api/review-cases') {
        const gate = state.queueHold; state.queueHold = null; if (gate) { gate.notify(); await gate.wait; }
        return route.fulfill({ status: state.queueStatus, json: state.queueStatus === 200 ? { items: state.empty ? [] : [state.item] } : { code: 'RESOURCE_SCOPE_DENIED', message: 'PRIVATE_ERROR_SENTINEL' } });
      }
      const snapshot = structuredClone(state.detail), gate = state.detailHold; state.detailHold = null; if (gate) { gate.notify(); await gate.wait; }
      return route.fulfill({ status: state.detailStatus, json: state.detailStatus === 200 ? { ...snapshot, reporter_user_id: 'PRIVATE_REPORTER_SENTINEL', private_instructions: 'PRIVATE_MEETING_SENTINEL', identity_document: 'PRIVATE_IDENTITY_SENTINEL' } : { code: state.detailStatus === 403 ? 'STEP_UP_REQUIRED' : 'RESOURCE_SCOPE_DENIED', message: 'PRIVATE_ERROR_SENTINEL' } });
    }
    expect(request.headers()['x-csrf-token']).toBe('synthetic-csrf');
    const body = request.postDataJSON() as Record<string, unknown>; state.bodies.push(body); expect(body.purpose).toBe('REVIEW_MODERATION');
    if (state.nextStatus) { const status = state.nextStatus; state.nextStatus = 0; return route.fulfill({ status, json: { code: 'STALE_VERSION', message: 'PRIVATE_ERROR_SENTINEL' } }); }
    const prior = state.receipts.get(String(body.idempotency_key));
    const action: ReviewModerationAction = prior ?? { id: actionId, case_id: caseId, review_id: reviewId, actor_user_id: staffId, assigned_staff_user_id: staffId,
      command: path.endsWith('/assign') ? 'ASSIGN' : body.command as ReviewModerationAction['command'], reason_code: path.endsWith('/assign') ? 'CASE_ASSIGNMENT' : body.reason_code as ReviewModerationAction['reason_code'],
      reason_text: String(body.reason_text ?? 'Scoped case assignment'), before_case_state: state.item.state, after_case_state: path.endsWith('/assign') ? 'TRIAGED' : body.command === 'BEGIN_INVESTIGATION' ? 'UNDER_REVIEW' : 'ACTION_REQUIRED',
      before_review_state: state.detail.review.state, after_review_state: body.command === 'HIDE' ? 'HIDDEN' : state.detail.review.state, case_version: state.item.version + 1,
      review_version: state.detail.review.version + (body.command === 'HIDE' ? 1 : 0), reverses_action_id: null, policy_version: 'review-moderation-v1', request_id: actionId, created_at: at,
      notice_available_at: body.command === 'HIDE' ? at : null, appeal_deadline: body.command === 'HIDE' ? '2026-11-12T12:00:00.000Z' : null };
    if (!prior) { state.effects++; state.receipts.set(String(body.idempotency_key), action); state.item = { ...state.item, assigned_staff_user_id: path.endsWith('/assign') ? String(body.assigned_staff_user_id) : state.item.assigned_staff_user_id, version: action.case_version, state: action.after_case_state, review_state: action.after_review_state, review_version: action.review_version };
      state.detail = { ...state.detail, case: state.item, review: { ...state.detail.review, state: action.after_review_state, version: action.review_version }, actions: [...state.detail.actions, action] }; }
    if (state.abortNext) { state.abortNext = false; return route.abort('failed'); }
    return route.fulfill({ status: 201, json: { case: state.item, action, replayed: !!prior } });
  });
  return state;
}
async function ready(page: Page) { await page.goto('/review-cases'); await expect(page.getByRole('button', { name: `Open case ${caseId}`, exact: true })).toBeEnabled(); }
async function open(page: Page) { await page.getByRole('button', { name: `Open case ${caseId}`, exact: true }).click(); await expect(page.getByRole('region', { name: 'Assigned review case' })).toBeVisible(); }
async function decide(page: Page) { await page.getByLabel('Internal decision rationale').fill('Synthetic justified safety decision'); await page.getByRole('button', { name: 'Record moderation decision' }).click(); }

test('G3-H1 queue exposes metadata, assigned detail/history and immutable decisions without confidential reporter projections', async ({ page }) => {
  await fixture(page); await ready(page); await expect(page.getByRole('list', { name: 'Authorized review case queue' })).toContainText('Queue age: 5 minutes');
  await expect(page.locator('main')).not.toContainText('SYNTHETIC_PERMITTED_REVIEW'); await open(page);
  await expect(page.getByRole('region', { name: 'Assigned review case' })).toContainText('SYNTHETIC_PERMITTED_REVIEW');
  await expect(page.locator('main')).not.toContainText('PRIVATE_REPORTER_SENTINEL'); await expect(page.locator('main')).not.toContainText('PRIVATE_MEETING_SENTINEL'); await expect(page.locator('main')).not.toContainText('PRIVATE_IDENTITY_SENTINEL');
  await decide(page); await expect(page.getByRole('list', { name: 'Immutable moderation action history' })).toContainText('begin investigation');
  await page.getByRole('combobox', { name: 'Moderation action', exact: true }).selectOption('HIDE'); await page.getByLabel('Decision reason').selectOption('PRIVACY_PROTECTION'); await decide(page);
  await expect(page.getByRole('list', { name: 'Immutable moderation action history' })).toContainText('Appeal eligible until');
  await expect(page.getByRole('region', { name: 'Assigned review case' }).getByText(/Rating 4 · Review version/)).toBeVisible();
});
test('G3-H1 assignment sends explicit purpose, expected case version and a single retry key', async ({ page }) => {
  const state = await fixture(page); await ready(page); await page.getByLabel('Staff user ID for assignment or claim').fill(staffId); await page.getByRole('button', { name: `Assign case ${caseId}`, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Case action saved' })).toBeVisible(); expect(state.bodies[0]).toMatchObject({ expected_version: 2, assigned_staff_user_id: staffId, purpose: 'REVIEW_MODERATION' });
});
test('G3-H1 ambiguous persisted decision retries the identical payload and records one effect', async ({ page }) => {
  const state = await fixture(page); await ready(page); await open(page); state.abortNext = true; await decide(page);
  await expect(page.getByRole('button', { name: 'Retry pending case action' })).toBeVisible(); await page.getByRole('button', { name: 'Retry pending case action' }).click();
  await expect(page.getByRole('region', { name: 'Assigned review case' })).toBeVisible(); expect(state.effects).toBe(1); expect(state.bodies[1]).toEqual(state.bodies[0]);
});
test('G3-H1 concurrent decision clears protected context and requires a refreshed version', async ({ page }) => {
  const state = await fixture(page); await ready(page); await open(page); state.nextStatus = 409; await decide(page);
  await expect(page.locator('main').getByRole('alert')).toContainText('case or review changed'); await expect(page.getByRole('region', { name: 'Assigned review case' })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('PRIVATE_ERROR_SENTINEL'); await page.getByRole('button', { name: 'Refresh case queue' }).click(); await open(page);
});
test('G3-H1 expired MFA and unrelated-case denial expose safe states without evidence', async ({ page }) => {
  const state = await fixture(page); await ready(page); state.detailStatus = 403; await page.getByRole('button', { name: `Open case ${caseId}`, exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('Sign in again with MFA'); await expect(page.locator('main')).not.toContainText('SYNTHETIC_PERMITTED_REVIEW');
  state.detailStatus = 404; await page.getByRole('button', { name: `Open case ${caseId}`, exact: true }).click(); await expect(page.locator('main').getByRole('alert')).toContainText('current assignment');
});
test('G3-H1 loading, empty, forbidden and completed queue states stay usable', async ({ page }) => {
  const state = await fixture(page), gate = hold(); state.queueHold = gate; await page.goto('/review-cases'); await gate.arrived; await expect(page.getByRole('status')).toContainText('Loading review cases'); gate.release();
  await expect(page.getByRole('button', { name: 'Refresh case queue' })).toBeEnabled(); state.empty = true; await page.getByRole('button', { name: 'Refresh case queue' }).click(); await expect(page.getByText('No authorized review cases match these filters.')).toBeVisible();
  state.empty = false; state.item = { ...state.item, state: 'CLOSED', next_action: 'COMPLETED' }; state.detail.case = state.item; await page.getByRole('button', { name: 'Refresh case queue' }).click(); await open(page);
  await expect(page.getByText('Case completed. Its decisions and evidence are retained.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Record moderation decision' })).toHaveCount(0);
  state.queueStatus = 403; await page.getByRole('button', { name: 'Refresh case queue' }).click(); await expect(page.locator('main').getByRole('alert')).toContainText('current assignment'); await expect(page.getByRole('region', { name: 'Assigned review case' })).toHaveCount(0);
});
test('G3-H1 a delayed evidence read cannot repopulate a refreshed empty queue', async ({ page }) => {
  const state = await fixture(page); await ready(page); const gate = hold(); state.detailHold = gate; await page.getByRole('button', { name: `Open case ${caseId}`, exact: true }).click(); await gate.arrived;
  state.empty = true; await page.getByRole('button', { name: 'Refresh case queue' }).click(); await expect(page.getByText('No authorized review cases match these filters.')).toBeVisible(); gate.release();
  await expect(page.getByRole('region', { name: 'Assigned review case' })).toHaveCount(0); await expect(page.locator('main')).not.toContainText('SYNTHETIC_PERMITTED_REVIEW');
});
test('G3-H1 a new report reopens a completed case through an explicit assigned investigation decision', async ({ page }) => {
  const state = await fixture(page); state.item = { ...state.item, state: 'CLOSED', next_action: 'BEGIN_INVESTIGATION', report_count: 2 }; state.detail.case = state.item;
  await ready(page); await open(page); await expect(page.getByRole('combobox', { name: 'Moderation action', exact: true })).toHaveValue('BEGIN_INVESTIGATION');
  await decide(page); await expect(page.getByRole('list', { name: 'Immutable moderation action history' })).toContainText('begin investigation');
  expect(state.bodies[0]?.command).toBe('BEGIN_INVESTIGATION'); expect(state.item.review_state).toBe('SUBMITTED_HELD');
});
test('G3-H1 explicit self-claim uses the server-projected staff identity and the same scoped assignment command', async ({ page }) => {
  const state = await fixture(page); state.item = { ...state.item, state: 'OPEN', assigned_staff_user_id: null, next_action: 'ASSIGN', version: 1 }; state.detail.case = state.item;
  await ready(page); await page.getByRole('button', { name: `Claim case ${caseId}`, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Case action saved' })).toBeVisible();
  expect(state.bodies[0]).toMatchObject({ purpose: 'REVIEW_MODERATION', expected_version: 1, assigned_staff_user_id: staffId });
  await expect(page.getByRole('button', { name: `Claim case ${caseId}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Authorized review case queue' })).toContainText(`Assigned staff: ${staffId}`);
});
