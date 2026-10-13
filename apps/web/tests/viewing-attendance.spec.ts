import { expect, test, type Page } from '@playwright/test';
import type { ViewingAttendanceClaimResponse, ViewingAttendanceResponse, ViewingResponse } from '@pachi/contracts';

const id = '00000000-0000-4000-8000-000000000801', claimId = '00000000-0000-4000-8000-000000000802', caseId = '00000000-0000-4000-8000-000000000803';
const guide = 'SYNTHETIC_PRIVATE_F3_GUIDANCE: staffed reception';
const now = '2026-10-12T12:00:00.000Z', noticeAt = '2026-10-12T12:01:00.000Z', deadline = '2026-10-14T12:01:00.000Z';
const seed: ViewingResponse = {
  id, interaction_id: '00000000-0000-4000-8000-000000000804', listing_id: '00000000-0000-4000-8000-000000000805',
  provider_account_id: '00000000-0000-4000-8000-000000000806', seeker_user_id: '00000000-0000-4000-8000-000000000807',
  state: 'SCHEDULED', proposed_start: '2026-10-12T09:00:00.000Z', proposed_end: '2026-10-12T10:00:00.000Z',
  scheduled_start: '2026-10-12T09:00:00.000Z', scheduled_end: '2026-10-12T10:00:00.000Z', display_timezone: 'Africa/Douala',
  response_deadline: deadline, version: 4, schedule_version: 2, seeker_confirmed: true, provider_confirmed: true,
  private_instructions: guide, reason: null, created_at: now, updated_at: now, actor_side: 'SEEKER', can_accept: false, can_decline: false, can_confirm: false, can_cancel: true
};
function pendingClaim(side: 'SEEKER' | 'PROVIDER', outcome: ViewingAttendanceClaimResponse['claimed_outcome'] = 'COMPLETED'): ViewingAttendanceClaimResponse {
  return { id: claimId, viewing_id: id, schedule_version: 2, claimant_user_id: side === 'SEEKER' ? seed.seeker_user_id : seed.provider_account_id,
    claimant_side: side, claim_type: outcome === 'COMPLETED' ? 'COMPLETION' : 'NO_SHOW', claimed_outcome: outcome, state: 'PENDING', version: 1,
    claimed_at: now, notice_available_at: noticeAt, response_deadline: deadline, responded_at: null, finalized_at: null, can_confirm: false, can_dispute: false };
}
async function fixture(page: Page, side: 'SEEKER' | 'PROVIDER' = 'SEEKER') {
  const state = { side, viewing: { ...seed }, attendanceState: 'NONE' as ViewingAttendanceResponse['state'], outcome: null as ViewingAttendanceResponse['outcome'],
    claims: [] as ViewingAttendanceClaimResponse[], case: null as ViewingAttendanceResponse['case'], reviewEligible: false,
    canClaimCompletion: true, canClaimNoShow: true, readStatus: 200, nextStatus: 0, abortNext: false, effects: 0,
    commands: [] as { path: string; body: Record<string, unknown>; key: string }[],
    holdCommand: null as null | { arrived: () => void; wait: Promise<void> }, holdRead: null as null | { arrived: () => void; wait: Promise<void> } };
  const receipts = new Map<string, string>();
  const viewing = () => ({ ...state.viewing, actor_side: state.side, can_cancel: state.claims.length === 0 });
  const attendance = (): ViewingAttendanceResponse => ({ viewing_id: id, schedule_version: state.viewing.schedule_version, version: state.viewing.version,
    state: state.attendanceState, outcome: state.outcome, actor_side: state.side, can_claim_completion: state.canClaimCompletion && !['DISPUTED', 'COMPLETED', 'SEEKER_NO_SHOW', 'PROVIDER_NO_SHOW'].includes(state.attendanceState) && !state.claims.some(c => c.claimant_side === state.side),
    can_claim_no_show: state.canClaimNoShow && !['DISPUTED', 'COMPLETED', 'SEEKER_NO_SHOW', 'PROVIDER_NO_SHOW'].includes(state.attendanceState) && !state.claims.some(c => c.claimant_side === state.side),
    claims: state.claims.map(claim => ({ ...claim, can_confirm: claim.claimant_side !== state.side && claim.state === 'PENDING' && state.attendanceState !== 'DISPUTED',
      can_dispute: claim.claimant_side !== state.side && state.attendanceState !== 'DISPUTED' })), next_cursor: null, case: state.case, response_window_hours: 48, review_eligibility_created: state.reviewEligible });
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, csrfToken: 'synthetic', participationAllowed: true } });
    if (request.method() === 'GET') {
      if (state.readStatus !== 200) return route.fulfill({ status: state.readStatus, json: { message: 'PRIVATE_ATTENDANCE_BACKEND_SENTINEL' } });
      if (path.endsWith('/reviews')) return route.fulfill({ json: { viewing_id: id, interaction_id: seed.interaction_id, actor_side: state.side, eligibility: null, own_review: null } });
      if (path === `/api/account/viewings/${id}`) return route.fulfill({ json: viewing() });
      if (path.endsWith('/attendance')) {
        const snapshot = attendance(), hold = state.holdRead; state.holdRead = null;
        if (hold) { hold.arrived(); await hold.wait; }
        return route.fulfill({ json: snapshot });
      }
      if (path.endsWith('/reschedules')) return route.fulfill({ json: { items: [], current_proposal: null, next_cursor: null, can_propose: state.claims.length === 0, schedule_history: [] } });
      if (path.endsWith('/reminders')) return route.fulfill({ json: { schedule_version: 2, plan_status: 'NO_FUTURE_WINDOW', planned_at: now, items: [], external_state: 'NOT_ENABLED' } });
      if (path === '/api/account/viewing-notices') return route.fulfill({ json: { items: [], next_cursor: null } });
    }
    if (request.method() === 'POST' && path.includes('/attendance/')) {
      expect(request.headers()['x-csrf-token']).toBe('synthetic');
      const body = request.postDataJSON() as Record<string, unknown>, key = request.headers()['idempotency-key']!;
      state.commands.push({ path, body, key }); expect(key).toMatch(/^[0-9a-f-]{36}$/);
      if (state.nextStatus) { const status = state.nextStatus; state.nextStatus = 0; return route.fulfill({ status, json: { code: 'STALE_CLAIM_VERSION', message: 'PRIVATE_ATTENDANCE_BACKEND_SENTINEL' } }); }
      const replay = receipts.get(key);
      if (replay) expect(JSON.stringify(body)).toBe(replay);
      else {
        expect(body.expected_version).toBe(state.viewing.version); expect(body.expected_schedule_version).toBe(state.viewing.schedule_version);
        state.effects++;
        if (path.endsWith('/completion') || path.endsWith('/no-show')) {
          const outcome = path.endsWith('/completion') ? 'COMPLETED' : body.absent_side === 'SEEKER' ? 'SEEKER_NO_SHOW' : 'PROVIDER_NO_SHOW';
          const claim = { ...pendingClaim(state.side, outcome), id: state.claims.length ? '00000000-0000-4000-8000-000000000808' : claimId };
          if (path.endsWith('/no-show')) expect(body.absent_side).toBe(state.side === 'SEEKER' ? 'PROVIDER' : 'SEEKER');
          state.claims.push(claim); state.attendanceState = state.claims.length > 1 ? 'DISPUTED' : 'AWAITING_VALIDATION';
        } else {
          const claim = state.claims.find(c => path.includes(c.id))!; expect(body.expected_claim_version).toBe(claim.version);
          expect(claim.claimant_side).not.toBe(state.side); claim.version++; claim.responded_at = now;
          if (path.endsWith('/confirm')) { claim.state = 'CONFIRMED'; claim.finalized_at = now; state.attendanceState = claim.claimed_outcome; state.outcome = claim.claimed_outcome; state.reviewEligible = claim.claimed_outcome === 'COMPLETED'; }
          else { expect(Object.keys(body).sort()).toEqual(['expected_claim_version', 'expected_schedule_version', 'expected_version', 'reason']); state.attendanceState = 'DISPUTED'; }
        }
        if (state.attendanceState === 'DISPUTED') { state.claims.forEach(c => { c.state = 'DISPUTED'; }); state.case = { id: caseId, state: 'OPEN', review_status: 'PENDING_REVIEW', opened_at: now }; state.reviewEligible = false; }
        state.viewing = { ...state.viewing, version: state.viewing.version + 1, state: state.attendanceState === 'AWAITING_VALIDATION' ? 'SCHEDULED' : state.attendanceState as ViewingResponse['state'], private_instructions: state.attendanceState === 'AWAITING_VALIDATION' ? guide : null };
        receipts.set(key, JSON.stringify(body));
      }
      const hold = state.holdCommand; state.holdCommand = null; if (hold) { hold.arrived(); await hold.wait; }
      if (state.abortNext) { state.abortNext = false; return route.abort('failed'); }
      return route.fulfill({ status: 201, json: { viewing: viewing(), attendance: attendance(), claim: attendance().claims.at(-1), replayed: !!replay } });
    }
    throw Error(`Unexpected G3-F3 synthetic API route ${path}`);
  });
  return state;
}
async function ready(page: Page) { await page.goto(`/viewings/${id}`); await expect(page.getByRole('button', { name: 'Mark viewing attended', exact: true })).toBeEnabled(); }
function hold() { let arrive!: () => void, release!: () => void; return { arrived: new Promise<void>(r => { arrive = r; }), wait: new Promise<void>(r => { release = r; }), notify: () => arrive(), release: () => release() }; }

test('G3-F3 appointment controls and private guidance wait for the initial attendance read', async ({ page }) => {
  const state = await fixture(page), read = hold(); state.holdRead = { arrived: read.notify, wait: read.wait };
  await page.goto(`/viewings/${id}`); await read.arrived;
  await expect(page.getByRole('button', { name: 'Cancel viewing', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Propose replacement time', exact: true })).toBeDisabled();
  await expect(page.getByText(guide, { exact: true })).toHaveCount(0);
  read.release(); await expect(page.getByRole('button', { name: 'Mark viewing attended', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cancel viewing', exact: true })).toBeEnabled(); await expect(page.getByText(guide, { exact: true })).toBeVisible();
});

for (const side of ['SEEKER', 'PROVIDER'] as const) test(`G3-F3 ${side} completion is a pending claim with an inbox-based 48-hour deadline and no self-confirmation`, async ({ page }) => {
  const state = await fixture(page, side); await ready(page); await page.getByRole('button', { name: 'Mark viewing attended', exact: true }).click();
  await expect(page.getByText('Attendance claim saved. It is awaiting counterparty validation.', { exact: true })).toBeVisible();
  const claims = page.getByRole('list', { name: 'Attendance claim history' }); await expect(claims).toContainText('Awaiting validation'); await expect(claims).toContainText('48-hour window starts when the durable inbox notice is available');
  await expect(claims).toContainText('14 Oct 2026'); await expect(page.getByLabel('Validated attendance outcome')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm viewing attended', exact: true })).toHaveCount(0);
  expect(state.viewing.state).toBe('SCHEDULED'); expect(state.reviewEligible).toBe(false); expect(state.commands[0]!.body).toEqual({ expected_version: 4, expected_schedule_version: 2 });
});

for (const side of ['SEEKER', 'PROVIDER'] as const) test(`G3-F3 ${side} explicitly reports the counterparty no-show as unverified`, async ({ page }) => {
  const state = await fixture(page, side); await ready(page); await page.getByRole('button', { name: `Report ${side === 'SEEKER' ? 'provider' : 'seeker'} no-show`, exact: true }).click();
  await expect(page.getByRole('list', { name: 'Attendance claim history' })).toContainText(side === 'SEEKER' ? 'Provider did not attend' : 'Seeker did not attend');
  await expect(page.getByLabel('Validated attendance outcome')).toHaveCount(0); expect(state.reviewEligible).toBe(false); expect(state.viewing.state).toBe('SCHEDULED');
  expect(state.commands[0]!.body).toEqual({ expected_version: 4, expected_schedule_version: 2, absent_side: side === 'SEEKER' ? 'PROVIDER' : 'SEEKER' });
});

test('G3-F3 counterparty confirms the exact claim and sees a validated completion without private guidance', async ({ page }) => {
  const state = await fixture(page, 'PROVIDER'); state.claims = [pendingClaim('SEEKER')]; state.attendanceState = 'AWAITING_VALIDATION';
  await page.goto(`/viewings/${id}`); const confirm = page.getByRole('button', { name: 'Confirm viewing attended', exact: true }); await expect(confirm).toBeEnabled(); await confirm.click();
  await expect(page.getByLabel('Validated attendance outcome')).toContainText('Viewing attended'); await expect(page.getByText('Attendance outcome validated.', { exact: true })).toBeVisible();
  await expect(page.getByText(guide, { exact: true })).toHaveCount(0); expect(state.commands[0]!.body).toEqual({ expected_version: 4, expected_schedule_version: 2, expected_claim_version: 1 }); expect(state.reviewEligible).toBe(true);
});

test('G3-F3 confirmation of no-show validates absence without creating a rating or review eligibility', async ({ page }) => {
  const state = await fixture(page, 'SEEKER'); state.claims = [pendingClaim('PROVIDER', 'SEEKER_NO_SHOW')]; state.attendanceState = 'AWAITING_VALIDATION';
  await page.goto(`/viewings/${id}`); await page.getByRole('button', { name: 'Confirm no-show claim', exact: true }).click();
  await expect(page.getByLabel('Validated attendance outcome')).toContainText('Seeker did not attend'); expect(state.reviewEligible).toBe(false);
  await expect(page.getByRole('button', { name: /review|rating|star/i })).toHaveCount(0);
});

test('G3-F3 a dispute preserves a safe pending moderation case and freezes the claim', async ({ page }) => {
  const state = await fixture(page, 'PROVIDER'); state.claims = [pendingClaim('SEEKER')]; state.attendanceState = 'AWAITING_VALIDATION';
  await page.goto(`/viewings/${id}`); await page.getByLabel('Dispute reason', { exact: true }).selectOption('OUTCOME_INCORRECT'); await page.getByRole('button', { name: 'Dispute attendance claim', exact: true }).click();
  await expect(page.getByLabel('Attendance dispute status')).toContainText('Pending moderation review. No decision has been made.'); await expect(page.getByLabel('Attendance dispute status')).toContainText(caseId);
  await expect(page.getByRole('list', { name: 'Attendance claim history' })).toContainText('Disputed'); await expect(page.getByLabel('Validated attendance outcome')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Confirm viewing attended|Mark viewing attended|Report .* no-show|resolve|override/i })).toHaveCount(0); expect(state.reviewEligible).toBe(false);
});

test('G3-F3 competing completion and no-show claims preserve both histories as disputed', async ({ page }) => {
  const state = await fixture(page, 'PROVIDER'); state.claims = [pendingClaim('SEEKER')]; state.attendanceState = 'AWAITING_VALIDATION';
  await ready(page); await page.getByRole('button', { name: 'Report seeker no-show', exact: true }).click();
  const claims = page.getByRole('list', { name: 'Attendance claim history' }); await expect(claims.locator('li')).toHaveCount(2); await expect(claims).toContainText('Viewing attended'); await expect(claims).toContainText('Seeker did not attend');
  await expect(page.getByLabel('Attendance dispute status')).toBeVisible(); expect(state.effects).toBe(1); expect(state.reviewEligible).toBe(false);
});

test('G3-F3 ambiguous persisted attendance retry retains the exact body and key while hiding guidance and other commands', async ({ page }) => {
  const state = await fixture(page); await ready(page); state.abortNext = true; await page.getByRole('button', { name: 'Mark viewing attended', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry pending attendance change', exact: true }); await expect(retry).toBeVisible();
  await expect(page.getByText(guide, { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Cancel viewing', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Propose replacement time', exact: true })).toBeDisabled();
  await retry.click(); await expect(page.getByRole('list', { name: 'Attendance claim history' }).locator('li')).toHaveCount(1);
  expect(state.commands[1]).toEqual(state.commands[0]); expect(state.effects).toBe(1);
});

test('G3-F3 a stale claim response suppresses guidance and commands until a full viewing refresh', async ({ page }) => {
  const state = await fixture(page, 'PROVIDER'); state.claims = [pendingClaim('SEEKER')]; state.attendanceState = 'AWAITING_VALIDATION';
  await page.goto(`/viewings/${id}`); const confirm = page.getByRole('button', { name: 'Confirm viewing attended', exact: true }); await expect(confirm).toBeEnabled(); state.nextStatus = 409; await confirm.click();
  await expect(page.getByRole('alert').filter({ hasText: 'This appointment or attendance claim changed.' })).toBeVisible(); await expect(confirm).toBeDisabled(); await expect(page.getByText(guide, { exact: true })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('PRIVATE_ATTENDANCE_BACKEND_SENTINEL'); await page.getByRole('button', { name: 'Refresh viewing', exact: true }).click(); await expect(confirm).toBeEnabled();
});

test('G3-F3 a delayed old attendance read cannot restore a pending claim after confirmation', async ({ page }) => {
  const state = await fixture(page, 'PROVIDER'); state.claims = [pendingClaim('SEEKER')]; state.attendanceState = 'AWAITING_VALIDATION';
  await page.goto(`/viewings/${id}`); const confirm = page.getByRole('button', { name: 'Confirm viewing attended', exact: true }); await expect(confirm).toBeEnabled();
  // Commit the command but hold its response, then fetch a stale attendance snapshot.
  const command = hold(); state.holdCommand = { arrived: command.notify, wait: command.wait }; await confirm.click(); await command.arrived;
  const read = hold(); await page.route(`**/api/account/viewings/${id}/attendance`, async route => { read.notify(); await read.wait; await route.fulfill({ json: { viewing_id: id, schedule_version: 2, version: 4, state: 'AWAITING_VALIDATION', outcome: null, actor_side: 'PROVIDER', can_claim_completion: true, can_claim_no_show: true, claims: [pendingClaim('SEEKER')], next_cursor: null, case: null, response_window_hours: 48, review_eligibility_created: false } }); }, { times: 1 });
  await page.getByRole('button', { name: 'Refresh viewing', exact: true }).click(); await read.arrived; command.release(); await expect(page.getByLabel('Validated attendance outcome')).toContainText('Viewing attended'); read.release();
  await expect(page.getByLabel('Validated attendance outcome')).toContainText('Viewing attended'); await expect(confirm).toHaveCount(0); await expect(page.getByText(guide, { exact: true })).toHaveCount(0);
});

test('G3-F3 attendance scope revocation clears appointment history and private instructions without backend details', async ({ page }) => {
  const state = await fixture(page); await ready(page); await expect(page.getByText(guide, { exact: true })).toBeVisible(); state.readStatus = 404; await page.getByRole('button', { name: 'Refresh attendance', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'current account permissions' })).toBeVisible(); await expect(page.getByLabel('Viewing attendance')).toHaveCount(0); await expect(page.getByText(guide, { exact: true })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('PRIVATE_ATTENDANCE_BACKEND_SENTINEL');
});

test('G3-F3 a newly finalized attendance read suppresses an older appointment and its guidance until refresh', async ({ page }) => {
  const state = await fixture(page); await ready(page); await expect(page.getByText(guide, { exact: true })).toBeVisible();
  state.claims = [{ ...pendingClaim('SEEKER'), state: 'FINALIZED', finalized_at: deadline, version: 2 }]; state.attendanceState = 'COMPLETED'; state.outcome = 'COMPLETED'; state.reviewEligible = true;
  state.viewing = { ...state.viewing, version: 5, state: 'COMPLETED', private_instructions: null };
  await page.getByRole('button', { name: 'Refresh attendance', exact: true }).click();
  await expect(page.getByLabel('Validated attendance outcome')).toContainText('Viewing attended'); await expect(page.getByText('Attendance changed. Refresh the viewing to load the current appointment.', { exact: true })).toBeVisible();
  await expect(page.getByText(guide, { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Cancel viewing', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh viewing', exact: true }).click(); await expect(page.getByText('COMPLETED', { exact: true })).toBeVisible();
});

test('G3-F3 server attendance capabilities govern premature and restricted controls; transient errors remain neutral', async ({ page }) => {
  const state = await fixture(page); state.canClaimCompletion = false; state.canClaimNoShow = false;
  await page.goto(`/viewings/${id}`); await expect(page.getByText('No attendance claim has been recorded for this schedule.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mark viewing attended|Report .* no-show/ })).toHaveCount(0); expect(state.commands).toHaveLength(0);
  state.readStatus = 503; await page.getByRole('button', { name: 'Refresh attendance', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'Attendance could not be loaded.' })).toBeVisible(); await expect(page.locator('main')).not.toContainText('PRIVATE_ATTENDANCE_BACKEND_SENTINEL');
});

test('G3-F3 attendance notice previews render safe event labels and never private evidence or instructions', async ({ page }) => {
  await fixture(page); await page.route('**/api/account/viewing-notices', route => route.fulfill({ json: { items: [{ id: claimId, viewing_id: id, recipient_side: 'PROVIDER', event_type: 'viewing_attendance_disputed', schedule_version: 2, event_at: now, available_at: noticeAt, inbox_state: 'AVAILABLE', external_state: 'NOT_ENABLED', read_at: now, private_instructions: guide, evidence: 'PRIVATE_CASE_EVIDENCE_SENTINEL', claimed_outcome: 'PROVIDER_NO_SHOW' }], next_cursor: null } }));
  await page.goto('/viewings/notices'); await expect(page.getByRole('list', { name: 'Appointment notices' })).toContainText('Attendance dispute update'); await expect(page.locator('main')).not.toContainText(guide); await expect(page.locator('main')).not.toContainText('PRIVATE_CASE_EVIDENCE_SENTINEL'); await expect(page.locator('main')).not.toContainText('PROVIDER_NO_SHOW');
});

test('G3-F3 actual attendance BFF routes deny anonymous reads and writes with private no-store responses', async ({ request }) => {
  for (const path of [`/api/account/viewings/${id}/attendance`, `/api/account/viewings/${id}/attendance/case`]) { const response = await request.get(path); expect(response.status()).toBe(401); expect(response.headers()['cache-control']).toBe('private, no-store'); expect(await response.json()).toEqual({ error: 'authentication_required' }); }
  for (const path of [`/api/account/viewings/${id}/attendance/completion`, `/api/account/viewings/${id}/attendance/no-show`, ...['confirm', 'dispute'].map(action => `/api/account/viewings/${id}/attendance/claims/${claimId}/${action}`)]) { const response = await request.post(path, { data: {} }); expect(response.status()).toBe(401); expect(response.headers()['cache-control']).toBe('private, no-store'); }
  for (const path of [`/api/account/viewings/${id}/attendance/finalize`, `/api/account/viewings/${id}/attendance/claims/${claimId}/resolve`]) { const response = await request.post(path, { data: {} }); expect(response.status()).toBe(404); expect(response.headers()['cache-control']).toBe('private, no-store'); }
});


test('G3-F3 historical dispute retains the current appointment controls and keeps further requests unavailable after cancellation', async ({ page }) => {
  const state = await fixture(page, 'SEEKER');
  state.claims = [{ ...pendingClaim('PROVIDER'), state: 'CONFIRMED', version: 2, finalized_at: now, responded_at: now }];
  state.attendanceState = 'COMPLETED'; state.outcome = 'COMPLETED'; state.reviewEligible = true;
  state.viewing = { ...state.viewing, state: 'COMPLETED', private_instructions: null, version: 5 };
  const currentId = '00000000-0000-4000-8000-000000000809', currentGuide = 'SYNTHETIC_CURRENT_APPOINTMENT_GUIDANCE';
  let current: ViewingResponse = { ...seed, id: currentId, state: 'SCHEDULED', actor_side: 'SEEKER', version: 3, schedule_version: 1,
    proposed_start: '2031-01-12T13:00:00.000Z', proposed_end: '2031-01-12T14:00:00.000Z',
    scheduled_start: '2031-01-12T13:00:00.000Z', scheduled_end: '2031-01-12T14:00:00.000Z', private_instructions: currentGuide };
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === '/api/account/viewings') return route.fulfill({ json: { items: [{ ...state.viewing, actor_side: 'SEEKER' }, current], next_cursor: null, can_request: url.searchParams.has('interaction_id') ? false : null } });
    if (path === `/api/account/interactions/${seed.interaction_id}`) return route.fulfill({ json: { interaction_id: seed.interaction_id, listing_id: seed.listing_id, conversation_id: seed.interaction_id, state: 'OPEN', title: 'Synthetic historical dispute', listing_visible: true, opened_at: now } });
    if (path.endsWith('/contact-safety')) return route.fulfill({ json: { can_contact: true, can_block: true, own_block: null } });
    if (path.endsWith('/messages')) return route.fulfill({ json: { items: [], next_cursor: null, can_send: true, actor_side: 'SEEKER' } });
    if (path.startsWith(`/api/account/viewings/${currentId}`)) {
      if (request.method() === 'POST') {
        expect(path).toBe(`/api/account/viewings/${currentId}/cancel`);
        expect(request.postDataJSON()).toEqual({ expected_version: current.version, expected_schedule_version: 1, reason: 'PLANS_CHANGED' });
        expect(request.headers()['x-csrf-token']).toBe('synthetic');
        current = { ...current, state: 'CANCELLED_BY_SEEKER', private_instructions: null, reason: 'PLANS_CHANGED', version: current.version + 1, can_cancel: false };
        return route.fulfill({ status: 201, json: { viewing: current, replayed: false } });
      }
      if (path.endsWith('/reviews')) return route.fulfill({ json: { viewing_id: currentId, interaction_id: seed.interaction_id, actor_side: 'SEEKER', eligibility: null, own_review: null } });
      if (path.endsWith('/attendance')) return route.fulfill({ json: { viewing_id: currentId, schedule_version: 1, version: current.version, state: 'NONE', outcome: null, actor_side: 'SEEKER', can_claim_completion: false, can_claim_no_show: false, claims: [], next_cursor: null, case: null, response_window_hours: 48, review_eligibility_created: false } });
      if (path.endsWith('/reschedules')) return route.fulfill({ json: { items: [], current_proposal: null, next_cursor: null, can_propose: current.state === 'SCHEDULED', schedule_history: [] } });
      if (path.endsWith('/reminders')) return route.fulfill({ json: { schedule_version: 1, plan_status: 'NO_FUTURE_WINDOW', planned_at: now, items: [], external_state: 'NOT_ENABLED' } });
      return route.fulfill({ json: current });
    }
    return route.fallback();
  });
  await page.goto(`/viewings/${id}`);
  await page.getByLabel('Dispute reason', { exact: true }).selectOption('OUTCOME_INCORRECT');
  await page.getByRole('button', { name: 'Dispute attendance claim', exact: true }).click();
  await expect(page.getByLabel('Attendance dispute status')).toContainText('Pending moderation review. No decision has been made.');
  expect(current.state).toBe('SCHEDULED'); expect(current.version).toBe(3); expect(state.reviewEligible).toBe(false);
  await page.goto(`/viewings/${currentId}`);
  await expect(page.getByText(currentGuide, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Propose replacement time', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Cancellation reason', exact: true }).selectOption('PLANS_CHANGED');
  await page.getByRole('button', { name: 'Cancel viewing', exact: true }).click();
  await expect(page.getByText('CANCELLED_BY_SEEKER', { exact: true })).toBeVisible();
  await page.goto(`/conversations/${seed.interaction_id}`);
  await expect(page.getByRole('list', { name: 'Viewings', exact: true })).toContainText('DISPUTED');
  await expect(page.getByRole('list', { name: 'Viewings', exact: true })).toContainText('CANCELLED_BY_SEEKER');
  await expect(page.getByRole('button', { name: 'Request viewing', exact: true })).toHaveCount(0);
  await expect(page.getByText('A new viewing request is not available for this conversation. Existing appointments remain in your history.', { exact: true })).toBeVisible();
});
