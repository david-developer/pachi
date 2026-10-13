import { expect, test, type Page } from '@playwright/test';
import type { ReviewEligibilityResponse, ReviewOwn, ReviewPublished, ReviewPublishedListResponse, ViewingResponse } from '@pachi/contracts';

const ids = { viewing: '00000000-0000-4000-8000-000000000901', interaction: '00000000-0000-4000-8000-000000000902', seeker: '00000000-0000-4000-8000-000000000903', provider: '00000000-0000-4000-8000-000000000904', listing: '00000000-0000-4000-8000-000000000905', eligibility: '00000000-0000-4000-8000-000000000906', review: '00000000-0000-4000-8000-000000000907' };
const opened = '2026-10-13T12:00:00.000Z', closes = '2026-10-27T12:00:00.000Z', privateCanary = 'PRIVATE_REVIEW_BACKEND_SENTINEL';
const seed: ViewingResponse = { id: ids.viewing, interaction_id: ids.interaction, listing_id: ids.listing, seeker_user_id: ids.seeker, provider_account_id: ids.provider, state: 'COMPLETED', proposed_start: '2026-10-12T09:00:00.000Z', proposed_end: '2026-10-12T10:00:00.000Z', scheduled_start: '2026-10-12T09:00:00.000Z', scheduled_end: '2026-10-12T10:00:00.000Z', display_timezone: 'Africa/Douala', response_deadline: opened, version: 5, schedule_version: 2, seeker_confirmed: true, provider_confirmed: true, private_instructions: null, reason: null, created_at: opened, updated_at: opened, actor_side: 'SEEKER', can_accept: false, can_decline: false, can_confirm: false, can_cancel: false };
const emptyPublished = (): ReviewPublishedListResponse => ({ items: [], next_cursor: null, reputation: { count: 0, average: null } });
const published = (id = ids.review, text = 'Revealed synthetic feedback'): ReviewPublished => ({ id, direction: 'SEEKER_TO_PROVIDER', rating: 4, text, criteria: { communication: 5 }, date: '2026-10-13', author_display_name: 'Synthetic participant', author_role: 'SEEKER', event_label: 'VALIDATED_COMPLETED_VIEWING', provider_identity_verified: true });
function hold() { let arrive!: () => void, release!: () => void; return { arrived: new Promise<void>(r => { arrive = r; }), wait: new Promise<void>(r => { release = r; }), notify: () => arrive(), release: () => release() }; }
async function fixture(page: Page, side: 'SEEKER' | 'PROVIDER' = 'SEEKER') {
  const state = { side, eligibility: { id: ids.eligibility, direction: side === 'SEEKER' ? 'SEEKER_TO_PROVIDER' : 'PROVIDER_TO_SEEKER', state: 'OPEN', opens_at: opened, closes_at: closes, policy_version: 'review-v1', can_submit: true, version: 1 } as NonNullable<ReviewEligibilityResponse['eligibility']>,
    eligible: true, own: null as ReviewOwn | null, provider: emptyPublished(), seeker: emptyPublished(), readStatus: 200, publicStatus: 200, nextStatus: 0, abortNext: false, revealOnSubmit: false, effects: 0, reports: 0,
    authenticated: true, participationAllowed: true, sessionUserId: side === 'SEEKER' ? ids.seeker : ids.provider, commands: [] as Attempt[], holdRead: null as null | { arrived: () => void; wait: Promise<void>; snapshot: ReviewEligibilityResponse }, holdCommand: null as null | { arrived: () => void; wait: Promise<void> } };
  type Attempt = { path: string; body: Record<string, unknown>; key: string };
  const receipts = new Map<string, { body: string; response: unknown }>();
  const projection = (): ReviewEligibilityResponse => ({ viewing_id: ids.viewing, interaction_id: ids.interaction, actor_side: state.side, eligibility: state.eligible ? { ...state.eligibility } : null, own_review: state.own ? structuredClone(state.own) : null });
  const makeOwn = (body: Record<string, unknown>): ReviewOwn => ({ id: ids.review, eligibility_id: ids.eligibility, viewing_id: ids.viewing, interaction_id: ids.interaction, direction: state.eligibility.direction, target_type: state.side === 'SEEKER' ? 'PROVIDER_ACCOUNT' : 'USER', target_id: state.side === 'SEEKER' ? ids.provider : ids.seeker, state: state.revealOnSubmit ? 'PUBLISHED' : 'SUBMITTED_HELD', version: 1, rating: body.rating as number, text: body.text as string, criteria: body.criteria as ReviewOwn['criteria'], published_at: state.revealOnSubmit ? opened : null, created_at: opened, updated_at: opened, can_edit: !state.revealOnSubmit, can_withdraw: true });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === '/api/session') return route.fulfill({ json: { authenticated: state.authenticated, participationAllowed: state.participationAllowed, userId: state.sessionUserId, csrfToken: 'synthetic' } });
    if (request.method() === 'GET') {
      if (path === `/api/account/viewings/${ids.viewing}`) return route.fulfill({ json: { ...seed, actor_side: state.side } });
      if (path.endsWith('/attendance')) return route.fulfill({ json: { viewing_id: ids.viewing, schedule_version: 2, version: 5, state: 'COMPLETED', outcome: 'COMPLETED', actor_side: state.side, can_claim_completion: false, can_claim_no_show: false, claims: [], next_cursor: null, case: null, response_window_hours: 48, review_eligibility_created: true } });
      if (path.endsWith('/reschedules')) return route.fulfill({ json: { items: [], current_proposal: null, next_cursor: null, can_propose: false, schedule_history: [] } });
      if (path.endsWith('/reminders')) return route.fulfill({ json: { schedule_version: 2, plan_status: 'NO_FUTURE_WINDOW', planned_at: null, items: [], external_state: 'NOT_ENABLED' } });
      if (path === '/api/account/viewing-notices') return route.fulfill({ json: { items: [], next_cursor: null } });
      if (path === `/api/account/viewings/${ids.viewing}/reviews`) {
        const held = state.holdRead; state.holdRead = null;
        if (held) { held.arrived(); await held.wait; return route.fulfill({ json: held.snapshot }); }
        return route.fulfill({ status: state.readStatus, json: state.readStatus === 200 ? { ...projection(), counterpart_rating: 1, counterpart_text: privateCanary, counterpart_submitted: true } : { message: privateCanary } });
      }
      if (path === `/api/account/providers/${ids.provider}/reviews` || path === `/api/account/seekers/${ids.seeker}/reviews`) {
        expect(url.searchParams.get('interaction_id')).toBe(ids.interaction);
        return route.fulfill({ status: state.publicStatus, json: state.publicStatus === 200 ? path.includes('/providers/') ? state.provider : state.seeker : { message: privateCanary } });
      }
    }
    if (request.method() === 'POST' && (path.includes('/reviews/') || path.includes('/review-eligibilities/'))) {
      expect(request.headers()['x-csrf-token']).toBe('synthetic'); const body = request.postDataJSON() as Record<string, unknown>, key = request.headers()['idempotency-key']!;
      expect(key).toMatch(/^[0-9a-f-]{36}$/); state.commands.push({ path, body, key });
      if (state.nextStatus) { const status = state.nextStatus; state.nextStatus = 0; return route.fulfill({ status, json: { code: 'STALE_VERSION', message: privateCanary } }); }
      const receipt = receipts.get(key);
      if (receipt) expect(JSON.stringify(body)).toBe(receipt.body);
      let result: unknown = receipt?.response;
      if (!receipt) {
        if (path.endsWith('/report')) { expect(Object.keys(body).sort()).toEqual(['details', 'reason']); state.reports++; result = { report: { id: ids.eligibility, review_id: ids.review, state: 'OPEN', review_status: 'PENDING_REVIEW', created_at: opened }, replayed: false }; }
        else {
          state.effects++;
          if (path.endsWith('/submit')) { expect(body.expected_version).toBe(state.eligibility.version); state.own = makeOwn(body); state.eligibility.state = 'CONSUMED'; state.eligibility.can_submit = false; }
          else { expect(body.expected_version).toBe(state.own!.version); state.own = { ...state.own!, version: state.own!.version + 1, ...(path.endsWith('/withdraw') ? { state: 'WITHDRAWN', can_edit: false, can_withdraw: false } : { rating: body.rating as number, text: body.text as string, criteria: body.criteria as ReviewOwn['criteria'] }) }; }
          if (state.own!.state === 'PUBLISHED') { const item = { ...published(), direction: state.own!.direction, rating: state.own!.rating, text: state.own!.text, criteria: state.own!.criteria }; if (state.side === 'SEEKER') state.provider = { items: [item], next_cursor: null, reputation: { count: 1, average: null } }; else state.seeker = { items: [item], next_cursor: null, reputation: { count: 1, average: null } }; }
          if (state.own!.state === 'WITHDRAWN') { if (state.side === 'SEEKER') state.provider = emptyPublished(); else state.seeker = emptyPublished(); }
          result = { review: structuredClone(state.own), replayed: false };
        }
        receipts.set(key, { body: JSON.stringify(body), response: result });
      }
      const held = state.holdCommand; state.holdCommand = null; if (held) { held.arrived(); await held.wait; }
      if (state.abortNext) { state.abortNext = false; return route.abort('failed'); }
      return route.fulfill({ status: 201, json: result });
    }
    throw Error(`Unexpected G3-G1 synthetic API route ${path}`);
  });
  return { state, projection, makeOwn };
}
const panel = (page: Page) => page.getByRole('region', { name: 'Your viewing review', exact: true });
async function ready(page: Page) { await page.goto(`/viewings/${ids.viewing}`); await expect(panel(page).getByRole('button', { name: 'Submit review', exact: true })).toBeEnabled(); }

for (const side of ['SEEKER', 'PROVIDER'] as const) test(`G3-G1 ${side} submits the correct principal direction with an overall rating and canonical optional criteria`, async ({ page }) => {
  const { state } = await fixture(page, side); await ready(page);
  await expect(panel(page)).toContainText('27 Oct 2026'); await expect(panel(page)).toContainText('12:00 UTC'); await expect(panel(page)).toContainText('14-day window'); await expect(panel(page)).not.toContainText(privateCanary);
  await panel(page).getByRole('combobox', { name: 'Overall rating', exact: true }).selectOption('4'); await panel(page).getByLabel('Optional review feedback').fill('Safe synthetic viewing experience');
  await panel(page).getByText('Optional structured criteria', { exact: true }).click(); await panel(page).getByRole('combobox', { name: side === 'SEEKER' ? 'Listing accuracy' : 'Appointment attendance', exact: true }).selectOption('5');
  await panel(page).getByRole('button', { name: 'Submit review', exact: true }).click();
  await expect(panel(page).getByLabel('Your saved review')).toContainText('Private until reveal'); await expect(panel(page)).toContainText('Your review is saved privately until reveal.');
  expect(state.commands[0]!.body).toEqual({ expected_version: 1, rating: 4, text: 'Safe synthetic viewing experience', criteria: side === 'SEEKER' ? { listing_accuracy: 5 } : { appointment_attendance: 5 } }); expect(state.own!.direction).toBe(side === 'SEEKER' ? 'SEEKER_TO_PROVIDER' : 'PROVIDER_TO_SEEKER');
  await expect(page.getByRole('region', { name: 'Provider reputation', exact: true })).toContainText('0 published reviews'); await expect(page.getByRole('region', { name: 'Seeker reputation', exact: true })).toContainText('0 published reviews');
});

test('G3-G1 an overall rating is required even when a criterion is rated', async ({ page }) => {
  const { state } = await fixture(page); await ready(page); await panel(page).getByText('Optional structured criteria', { exact: true }).click(); await panel(page).getByRole('combobox', { name: 'Communication', exact: true }).selectOption('5'); await panel(page).getByRole('button', { name: 'Submit review', exact: true }).click(); expect(state.commands).toHaveLength(0); await expect(panel(page).getByRole('combobox', { name: 'Overall rating', exact: true })).toHaveValue('');
});

test('G3-G1 feedback counts Unicode characters and rejects more than 2000 without losing the draft', async ({ page }) => {
  const { state } = await fixture(page); await ready(page); const text = '😀'.repeat(2001); await panel(page).getByRole('combobox', { name: 'Overall rating', exact: true }).selectOption('5'); await panel(page).getByLabel('Optional review feedback').fill(text); await panel(page).getByRole('button', { name: 'Submit review', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('at most 2,000 Unicode characters'); expect(state.commands).toHaveLength(0); await expect(panel(page).getByLabel('Optional review feedback')).toHaveValue(text);
  await panel(page).getByLabel('Optional review feedback').fill('😀'.repeat(2000)); await panel(page).getByRole('button', { name: 'Submit review', exact: true }).click(); await expect(panel(page).getByLabel('Your saved review')).toBeVisible(); expect(Array.from(state.own!.text!).length).toBe(2000);
});

test('G3-G1 author edits a held review and withdraws it without a replacement slot', async ({ page }) => {
  const { state, makeOwn } = await fixture(page); state.own = makeOwn({ rating: 2, text: 'Original held feedback', criteria: {} }); state.eligibility.state = 'CONSUMED'; state.eligibility.can_submit = false;
  await page.goto(`/viewings/${ids.viewing}`); await expect(panel(page).getByRole('button', { name: 'Save held review changes' })).toBeEnabled(); await panel(page).getByRole('combobox', { name: 'Overall rating', exact: true }).selectOption('4'); await panel(page).getByLabel('Optional review feedback').fill('Edited held feedback'); await panel(page).getByRole('button', { name: 'Save held review changes' }).click();
  await expect(panel(page).getByLabel('Your saved review')).toContainText('Edited held feedback'); expect(state.commands[0]!.body.expected_version).toBe(1);
  await panel(page).getByRole('button', { name: 'Withdraw your review' }).click(); await expect(panel(page).getByLabel('Your saved review')).toContainText('Withdrawn'); await expect(panel(page).getByRole('button', { name: 'Submit review', exact: true })).toHaveCount(0); await expect(panel(page).getByRole('button', { name: 'Save held review changes' })).toHaveCount(0); expect(state.commands[1]!.body).toEqual({ expected_version: 2 });
});

test('G3-G1 legitimate reveal locks content, makes authorized context readable and withdrawal removes its count', async ({ page }) => {
  const { state } = await fixture(page); state.revealOnSubmit = true; await ready(page); await panel(page).getByRole('combobox', { name: 'Overall rating', exact: true }).selectOption('3'); await panel(page).getByLabel('Optional review feedback').fill('Revealed author feedback'); await panel(page).getByRole('button', { name: 'Submit review', exact: true }).click();
  await expect(panel(page).getByLabel('Your saved review')).toContainText('Published'); await expect(panel(page).getByRole('button', { name: 'Save held review changes' })).toHaveCount(0); await expect(page.getByRole('region', { name: 'Provider reputation', exact: true })).toContainText('Revealed author feedback');
  await panel(page).getByRole('button', { name: 'Withdraw your review' }).click(); await expect(page.getByRole('region', { name: 'Provider reputation', exact: true })).toContainText('0 published reviews'); expect(state.effects).toBe(2);
});

for (const status of ['HELD', 'EXPIRED', 'REVOKED', 'UNAVAILABLE', 'CONSUMED'] as const) test(`G3-G1 ${status} eligibility shows a safe state without submission or another author's private contents`, async ({ page }) => {
  const { state } = await fixture(page, 'PROVIDER'); state.eligibility.can_submit = false; if (status === 'UNAVAILABLE') state.eligible = false; else state.eligibility.state = status;
  await page.goto(`/viewings/${ids.viewing}`); await expect(panel(page).getByRole('button', { name: 'Check eligibility' })).toBeEnabled(); await expect(panel(page).getByRole('button', { name: 'Submit review', exact: true })).toHaveCount(0); await expect(panel(page).getByLabel('Your saved review')).toHaveCount(0); await expect(panel(page)).not.toContainText(privateCanary);
  await expect(panel(page)).toContainText(status === 'HELD' ? 'on hold while attendance or safety concerns' : status === 'EXPIRED' ? 'unused eligibility has expired' : status === 'REVOKED' ? 'eligibility is no longer valid' : status === 'CONSUMED' ? 'Private authorship is available only to its author' : 'No review eligibility is available');
});

test('G3-G1 held and published feedback renders as text with no scripts, legal identity or private context', async ({ page }) => {
  const { state, makeOwn } = await fixture(page); const text = '<img src=x onerror="window.reviewExecuted=true"><script>window.reviewExecuted=true</script> & 😀'; state.own = makeOwn({ rating: 4, text, criteria: {} }); state.eligibility.state = 'CONSUMED'; state.eligibility.can_submit = false; state.provider = { items: [published(ids.review, text)], next_cursor: null, reputation: { count: 1, average: null } };
  await page.goto(`/viewings/${ids.viewing}`); await expect(panel(page).getByLabel('Your saved review').getByText(text, { exact: true })).toBeVisible(); await expect(page.getByRole('region', { name: 'Provider reputation', exact: true }).getByText(text, { exact: true })).toBeVisible(); await expect(panel(page).locator('img,script')).toHaveCount(0); expect(await page.evaluate(() => (window as unknown as { reviewExecuted?: boolean }).reviewExecuted)).toBeUndefined(); await expect(page.locator('main')).not.toContainText(privateCanary);
});

for (const status of [401, 403, 404, 400, 409]) test(`G3-G1 mutation ${status} uses neutral feedback and disables stale or denied content`, async ({ page }) => {
  const { state } = await fixture(page); await ready(page); state.nextStatus = status; await panel(page).getByRole('combobox', { name: 'Overall rating', exact: true }).selectOption('4'); await panel(page).getByRole('button', { name: 'Submit review', exact: true }).click(); await expect(panel(page).getByRole('alert')).toBeVisible(); await expect(page.locator('main')).not.toContainText(privateCanary); await expect(panel(page).getByRole('button', { name: 'Retry pending review change' })).toHaveCount(0);
  if (status === 409) { await expect(panel(page).getByRole('button', { name: 'Submit review', exact: true })).toBeDisabled(); await panel(page).getByRole('button', { name: 'Check eligibility' }).click(); await expect(panel(page).getByRole('button', { name: 'Submit review', exact: true })).toBeEnabled(); }
  if ([401, 403, 404].includes(status)) await expect(panel(page).getByRole('combobox', { name: 'Overall rating', exact: true })).toHaveCount(0);
});

test('G3-G1 ambiguous persisted submission retries the exact version, body and key once', async ({ page }) => {
  const { state } = await fixture(page); await ready(page); state.abortNext = true; await panel(page).getByRole('combobox', { name: 'Overall rating', exact: true }).selectOption('4'); await panel(page).getByLabel('Optional review feedback').fill('Exact retry feedback'); await panel(page).getByRole('button', { name: 'Submit review', exact: true }).click(); await expect(panel(page).getByRole('button', { name: 'Retry pending review change' })).toBeVisible(); await expect(panel(page).getByRole('button', { name: 'Submit review', exact: true })).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Retry pending review change' }).click(); await expect(panel(page).getByLabel('Your saved review')).toContainText('Exact retry feedback'); expect(state.commands[1]).toEqual(state.commands[0]); expect(state.effects).toBe(1);
});

test('G3-G1 transient submission failure keeps a retry with the exact original content', async ({ page }) => {
  const { state } = await fixture(page); await ready(page); state.nextStatus = 503; await panel(page).getByRole('combobox', { name: 'Overall rating', exact: true }).selectOption('2'); await panel(page).getByLabel('Optional review feedback').fill('Preserved transient request'); await panel(page).getByRole('button', { name: 'Submit review', exact: true }).click(); await expect(panel(page).getByRole('button', { name: 'Retry pending review change' })).toBeVisible(); await expect(page.locator('main')).not.toContainText(privateCanary); expect(state.effects).toBe(0); await panel(page).getByRole('button', { name: 'Retry pending review change' }).click(); await expect(panel(page).getByLabel('Your saved review')).toContainText('Preserved transient request'); expect(state.commands[1]).toEqual(state.commands[0]); expect(state.effects).toBe(1);
});

test('G3-G1 a delayed eligibility read cannot restore an unused slot after a newer saved submission', async ({ page }) => {
  const { state, projection } = await fixture(page); await ready(page); const old = projection(); const command = hold(); state.holdCommand = { arrived: command.notify, wait: command.wait }; await panel(page).getByRole('combobox', { name: 'Overall rating', exact: true }).selectOption('4'); await panel(page).getByRole('button', { name: 'Submit review', exact: true }).click(); await command.arrived;
  const read = hold(); state.holdRead = { arrived: read.notify, wait: read.wait, snapshot: old }; await page.getByRole('button', { name: 'Refresh viewing', exact: true }).click(); await read.arrived; command.release(); await expect(panel(page).getByLabel('Your saved review')).toBeVisible(); const settled = page.waitForResponse(response => response.url().endsWith(`/viewings/${ids.viewing}/reviews`)); read.release(); await settled; await expect(panel(page).getByRole('button', { name: 'Submit review', exact: true })).toHaveCount(0); await expect(panel(page).getByLabel('Your saved review')).toBeVisible();
});

test('G3-G1 ordinary eligibility refresh preserves unsaved rating, feedback and criteria', async ({ page }) => {
  await fixture(page); await ready(page); await panel(page).getByRole('combobox', { name: 'Overall rating', exact: true }).selectOption('2'); await panel(page).getByLabel('Optional review feedback').fill('Unsaved review feedback'); await panel(page).getByText('Optional structured criteria', { exact: true }).click(); await panel(page).getByRole('combobox', { name: 'Communication', exact: true }).selectOption('3'); await panel(page).getByRole('button', { name: 'Check eligibility' }).click(); await expect(panel(page).getByRole('button', { name: 'Submit review', exact: true })).toBeEnabled(); await expect(panel(page).getByRole('combobox', { name: 'Overall rating', exact: true })).toHaveValue('2'); await expect(panel(page).getByLabel('Optional review feedback')).toHaveValue('Unsaved review feedback'); await expect(panel(page).getByRole('combobox', { name: 'Communication', exact: true })).toHaveValue('3');
});

test('G3-G1 a changed acting account cannot inherit held authorship or a delayed previous-account response', async ({ page }) => {
  const { state, makeOwn, projection } = await fixture(page, 'PROVIDER'); state.own = makeOwn({ rating: 2, text: 'PREVIOUS_AUTHOR_PRIVATE_REVIEW', criteria: {} }); state.eligibility.state = 'CONSUMED'; state.eligibility.can_submit = false;
  await page.goto(`/viewings/${ids.viewing}`); await expect(panel(page).getByRole('button', { name: 'Save held review changes' })).toBeEnabled(); await panel(page).getByLabel('Optional review feedback').fill('PREVIOUS_AUTHOR_UNSAVED_DRAFT'); const read = hold(); state.holdRead = { arrived: read.notify, wait: read.wait, snapshot: projection() }; await panel(page).getByRole('button', { name: 'Check eligibility' }).click(); await read.arrived;
  state.sessionUserId = '00000000-0000-4000-8000-000000000908'; state.own = null; await page.getByRole('button', { name: 'Refresh viewing', exact: true }).click(); await expect(panel(page)).toContainText('Private authorship is available only to its author'); const settled = page.waitForResponse(response => response.url().endsWith(`/viewings/${ids.viewing}/reviews`)); read.release(); await settled; await expect(panel(page).getByLabel('Your saved review')).toHaveCount(0); await expect(panel(page).getByLabel('Optional review feedback')).toHaveCount(0); await expect(panel(page)).not.toContainText('PREVIOUS_AUTHOR_PRIVATE_REVIEW'); await expect(panel(page)).not.toContainText('PREVIOUS_AUTHOR_UNSAVED_DRAFT');
});

test('G3-G1 a failed fresh public read clears stale revealed contents and counts', async ({ page }) => {
  const { state } = await fixture(page); state.provider = { items: [published()], next_cursor: null, reputation: { count: 3, average: 4 } }; await ready(page); const provider = page.getByRole('region', { name: 'Provider reputation', exact: true }); await expect(provider).toContainText('Revealed synthetic feedback'); await expect(provider.getByLabel('Average review rating')).toContainText('4.00 / 5'); state.publicStatus = 403; await provider.getByRole('button', { name: 'Refresh provider reputation' }).click(); await expect(provider.getByRole('alert')).toBeVisible(); await expect(provider).not.toContainText('Revealed synthetic feedback'); await expect(provider.getByLabel('Average review rating')).toHaveCount(0); await expect(page.locator('main')).not.toContainText(privateCanary);
});

test('G3-G1 published review reporting is private, bounded and does not hide the review', async ({ page }) => {
  const { state } = await fixture(page, 'PROVIDER'); state.seeker = { items: [{ ...published(), direction: 'PROVIDER_TO_SEEKER' }], next_cursor: null, reputation: { count: 1, average: null } }; await ready(page); const seeker = page.getByRole('region', { name: 'Seeker reputation', exact: true }); await seeker.getByRole('button', { name: 'Report this review' }).click(); await seeker.getByLabel('Review report reason').selectOption('PRIVACY_EXPOSURE'); await seeker.getByLabel('Optional report details').fill('Safe private report context'); await seeker.getByRole('button', { name: 'Submit review report' }).click(); await expect(seeker).toContainText('Report recorded privately'); await expect(seeker).toContainText('Revealed synthetic feedback'); await expect(seeker).toContainText('1 published review'); expect(state.reports).toBe(1); expect(state.commands[0]!.body).toEqual({ reason: 'PRIVACY_EXPOSURE', details: 'Safe private report context' });
});

test('G3-G1 report retry preserves the exact private payload without duplicate intake', async ({ page }) => {
  const { state } = await fixture(page); state.provider = { items: [published()], next_cursor: null, reputation: { count: 1, average: null } }; await ready(page); const provider = page.getByRole('region', { name: 'Provider reputation', exact: true }); await provider.getByRole('button', { name: 'Report this review' }).click(); await provider.getByLabel('Review report reason').selectOption('HARASSMENT'); state.abortNext = true; await provider.getByRole('button', { name: 'Submit review report' }).click(); await expect(provider.getByRole('button', { name: 'Retry pending review report' })).toBeVisible(); await provider.getByRole('button', { name: 'Retry pending review report' }).click(); await expect(provider).toContainText('Report recorded privately'); expect(state.commands[1]).toEqual(state.commands[0]); expect(state.reports).toBe(1);
});

test('G3-G1 public provider presentation shows eligible counts and ratings while withholding written feedback', async ({ page }) => {
  const item = published(); let count = 2, available = true;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { authenticated: false, participationAllowed: false } });
    if (path.endsWith('/reviews')) return route.fulfill({ status: available ? 200 : 404, json: available ? { items: count ? [item] : [], next_cursor: null, reputation: { count, average: count >= 3 ? 4 : null } } : { message: privateCanary } });
    return route.fulfill({ json: { id: ids.listing, purpose: 'RENT', title: 'Review fixture listing', description: 'Safe listing', price: { amount_minor: 200000, currency: 'XAF', pricing_period: 'MONTHLY' }, property: { property_type: 'APARTMENT' }, location: { city: 'Douala', region: 'Littoral' }, media: [] } });
  });
  await page.goto(`/listings/${ids.listing}`); const reputation = page.getByRole('region', { name: 'Provider reputation', exact: true }); await expect(reputation).toContainText('2 published reviews'); await expect(reputation.getByLabel('Average review rating')).toHaveCount(0); await expect(reputation).toContainText('Validated completed viewing'); await expect(reputation).toContainText('Oct 2026'); await expect(reputation).not.toContainText('Revealed synthetic feedback'); await expect(reputation).toContainText('Public written feedback awaits moderation controls.');
  await reputation.getByRole('button', { name: 'Report this review' }).click(); await expect(reputation).toContainText('Sign in to report'); count = 3; await reputation.getByRole('button', { name: 'Refresh provider reputation' }).click(); await expect(reputation.getByLabel('Average review rating')).toContainText('4.00 / 5'); count = 0; await reputation.getByRole('button', { name: 'Refresh provider reputation' }).click(); await expect(reputation).toContainText('0 published reviews'); await expect(reputation.getByLabel('Average review rating')).toHaveCount(0); available = false; await reputation.getByRole('button', { name: 'Refresh provider reputation' }).click(); await expect(reputation.getByRole('alert')).toBeVisible(); await expect(reputation).not.toContainText('0 published reviews'); await expect(page.locator('main')).not.toContainText(privateCanary);
});
