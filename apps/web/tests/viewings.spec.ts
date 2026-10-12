import { expect, test, type Page } from '@playwright/test';
import type { ViewingResponse } from '@pachi/contracts';

const ids = {
  interaction: '00000000-0000-4000-8000-000000000401',
  listing: '00000000-0000-4000-8000-000000000402',
  conversation: '00000000-0000-4000-8000-000000000403',
  viewing: '00000000-0000-4000-8000-000000000404',
  seeker: '00000000-0000-4000-8000-000000000405',
  provider: '00000000-0000-4000-8000-000000000406'
};
const privateGuidance = 'PRIVATE_MEETING_SENTINEL: meet inside the staffed reception.';
const proposed = { proposed_start: '2031-01-12T13:00:00.000Z', proposed_end: '2031-01-12T14:00:00.000Z' };
const seed: ViewingResponse = {
  id: ids.viewing, interaction_id: ids.interaction, listing_id: ids.listing,
  provider_account_id: ids.provider, seeker_user_id: ids.seeker, state: 'REQUESTED',
  ...proposed, scheduled_start: null, scheduled_end: null, display_timezone: 'Africa/Douala',
  response_deadline: '2031-01-11T13:00:00.000Z', version: 1, schedule_version: 1,
  seeker_confirmed: false, provider_confirmed: false, private_instructions: null, reason: null,
  created_at: '2031-01-09T13:00:00.000Z', updated_at: '2031-01-09T13:00:00.000Z',
  actor_side: 'SEEKER', can_accept: false, can_decline: false, can_confirm: false, can_cancel: true
};

async function fixture(page: Page, initial: ViewingResponse | null = null) {
  const state = {
    side: 'SEEKER' as 'SEEKER' | 'PROVIDER', viewing: initial,
    readStatus: 200, requestAllowed: true, commands: [] as { command: string; body: Record<string, unknown>; key: string | undefined }[]
  };
  function projection(): ViewingResponse | null {
    if (!state.viewing) return null;
    const viewing = state.viewing;
    return { ...viewing, actor_side: state.side,
      private_instructions: viewing.state === 'SCHEDULED' ? viewing.private_instructions : null,
      can_accept: state.side === 'PROVIDER' && viewing.state === 'REQUESTED',
      can_decline: state.side === 'PROVIDER' && viewing.state === 'REQUESTED',
      can_confirm: viewing.state === 'ACCEPTED' && !(state.side === 'SEEKER' ? viewing.seeker_confirmed : viewing.provider_confirmed),
      can_cancel: ['REQUESTED', 'ACCEPTED', 'SCHEDULED'].includes(viewing.state)
    };
  }
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, userId: state.side === 'SEEKER' ? ids.seeker : ids.provider, csrfToken: 'synthetic', participationAllowed: true } });
    if (path === `/api/account/interactions/${ids.interaction}`) return route.fulfill({ json: { interaction_id: ids.interaction, listing_id: ids.listing, conversation_id: ids.conversation, state: 'OPEN', title: 'Synthetic viewing flat', listing_visible: true, opened_at: seed.created_at } });
    if (path.endsWith('/contact-safety')) return route.fulfill({ json: { can_contact: true, can_block: true, own_block: null } });
    if (path.endsWith('/messages')) return route.fulfill({ json: { items: [], next_cursor: null, can_send: true, actor_side: state.side } });
    if (path === '/api/account/viewings') {
      if (state.readStatus !== 200) return route.fulfill({ status: state.readStatus, json: { message: 'PRIVATE_BACKEND_ERROR' } });
      const row = projection();
      return route.fulfill({ json: { items: row ? [row] : [], next_cursor: null, can_request: url.searchParams.has('interaction_id') ? state.requestAllowed && state.side === 'SEEKER' && (!row || !['REQUESTED', 'ACCEPTED', 'SCHEDULED'].includes(row.state)) : null } });
    }
    if(request.method()==='GET'&&(path.endsWith('/reschedules')||path.endsWith('/reminders')||path==='/api/account/viewing-notices')) {
      if(state.readStatus!==200)return route.fulfill({status:state.readStatus,json:{message:'PRIVATE_BACKEND_ERROR'}});
      if(path.endsWith('/reschedules'))return route.fulfill({json:{items:[],current_proposal:null,next_cursor:null,can_propose:false,schedule_history:[]}});
      if(path.endsWith('/reminders'))return route.fulfill({json:{schedule_version:state.viewing?.schedule_version??1,plan_status:'NOT_PREPARED',planned_at:null,items:[],external_state:'NOT_ENABLED'}});
      return route.fulfill({json:{items:[],next_cursor:null}});
    }
    if (path === `/api/account/viewings/${ids.viewing}` && request.method() === 'GET') {
      if (state.readStatus !== 200) return route.fulfill({ status: state.readStatus, json: { message: 'PRIVATE_BACKEND_ERROR' } });
      return route.fulfill({ json: projection() });
    }
    if (request.method() === 'POST' && (path.endsWith('/viewings') || path.startsWith(`/api/account/viewings/${ids.viewing}/`))) {
      const command = path.endsWith('/viewings') ? 'create' : path.split('/').at(-1)!;
      const body = request.postDataJSON() as Record<string, unknown>;
      state.commands.push({ command, body, key: request.headers()['idempotency-key'] });
      if (command === 'create') state.viewing = { ...seed, proposed_start: body.proposed_start as string, proposed_end: body.proposed_end as string, display_timezone: body.display_timezone as string };
      else {
        const row = state.viewing!;
        expect(body.expected_version).toBe(row.version);
        expect(body.expected_schedule_version).toBe(row.schedule_version);
        if (command === 'accept') {
          expect(body.scheduled_start).toBe(row.proposed_start);
          expect(body.scheduled_end).toBe(row.proposed_end);
          state.viewing = { ...row, state: 'ACCEPTED', scheduled_start: row.proposed_start, scheduled_end: row.proposed_end, private_instructions: body.private_instructions as string, version: row.version + 1 };
        } else if (command === 'confirm') {
          const confirmed = { ...row, seeker_confirmed: row.seeker_confirmed || state.side === 'SEEKER', provider_confirmed: row.provider_confirmed || state.side === 'PROVIDER', version: row.version + 1 };
          state.viewing = { ...confirmed, state: confirmed.seeker_confirmed && confirmed.provider_confirmed ? 'SCHEDULED' : 'ACCEPTED' };
        } else state.viewing = { ...row, state: command === 'cancel' ? (state.side === 'SEEKER' ? 'CANCELLED_BY_SEEKER' : 'CANCELLED_BY_PROVIDER') : 'DECLINED', reason: body.reason as string, version: row.version + 1 };
      }
      return route.fulfill({ status: 201, json: { viewing: projection(), replayed: false } });
    }
    throw new Error(`Unexpected synthetic API route: ${path}`);
  });
  return state;
}

async function requestForm(page: Page) {
  await page.goto(`/conversations/${ids.interaction}`);
  await page.getByLabel('Proposed start', { exact: true }).fill('2031-01-12T14:00');
  await page.getByLabel('Proposed end', { exact: true }).fill('2031-01-12T15:00');
}

test('seeker requests from conversation; provider accepts incoming request; two confirmations schedule and reveal private guidance', async ({ page }) => {
  const state = await fixture(page);
  await requestForm(page);
  await expect(page.getByLabel('Display timezone')).toHaveValue('Africa/Douala');
  await page.getByRole('button', { name: 'Request viewing', exact: true }).click();
  await expect(page.getByText('Viewing request saved.', { exact: true })).toBeVisible();
  expect(state.commands[0]!.body).toEqual({ ...proposed, display_timezone: 'Africa/Douala' });
  expect(state.commands[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
  state.side = 'PROVIDER';
  await page.goto('/viewings');
  await expect(page.getByText('Incoming request', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Open viewing details', exact: true }).click();
  await page.getByLabel('Safe meeting guidance').fill(privateGuidance);
  await page.getByRole('button', { name: 'Accept viewing', exact: true }).click();
  await expect(page.getByText(/Both parties must confirm/)).toBeVisible();
  await expect(page.getByText(privateGuidance, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm appointment time' }).click();
  await expect(page.getByText('Seeker confirmation: Waiting · Provider confirmation: Confirmed', { exact: true })).toBeVisible();
  await expect(page.getByText(privateGuidance, { exact: true })).toHaveCount(0);
  state.side = 'SEEKER';
  await page.goto(`/viewings/${ids.viewing}`);
  await page.getByRole('button', { name: 'Confirm appointment time' }).click();
  await expect(page.getByText('SCHEDULED', { exact: true })).toBeVisible();
  await expect(page.getByText(privateGuidance, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm appointment time' })).toHaveCount(0);
  expect(state.commands.map(command => command.command)).toEqual(['create', 'accept', 'confirm', 'confirm']);
});

test('provider declines with reason; a terminal request allows a currently eligible seeker to request later', async ({ page }) => {
  const state = await fixture(page, { ...seed }); state.side = 'PROVIDER';
  await page.goto(`/viewings/${ids.viewing}`);
  await page.getByLabel('Decline reason').selectOption('TIME_UNSUITABLE');
  await page.getByRole('button', { name: 'Decline viewing', exact: true }).click();
  await expect(page.getByText('DECLINED', { exact: true })).toBeVisible();
  await expect(page.getByText('Reason: Time unsuitable', { exact: true })).toBeVisible();
  state.side = 'SEEKER';
  await requestForm(page);
  await expect(page.getByRole('button', { name: 'Request viewing', exact: true })).toBeEnabled();
});

test('authorized scheduled cancellation records reason and immediately removes private instructions', async ({ page }) => {
  await fixture(page, { ...seed, state: 'SCHEDULED', scheduled_start: seed.proposed_start, scheduled_end: seed.proposed_end, seeker_confirmed: true, provider_confirmed: true, private_instructions: privateGuidance });
  await page.goto(`/viewings/${ids.viewing}`);
  await expect(page.getByText(privateGuidance, { exact: true })).toBeVisible();
  await page.getByLabel('Cancellation reason').selectOption('PLANS_CHANGED');
  await page.getByRole('button', { name: 'Cancel viewing', exact: true }).click();
  await expect(page.getByText('CANCELLED_BY_SEEKER', { exact: true })).toBeVisible();
  await expect(page.getByText(privateGuidance, { exact: true })).toHaveCount(0);
  await expect(page.getByText('Reason: Plans changed', { exact: true })).toBeVisible();
});

test('stale schedule response blocks commands until refresh and preserves safe feedback', async ({ page }) => {
  const state = await fixture(page, { ...seed, state: 'ACCEPTED', scheduled_start: seed.proposed_start, scheduled_end: seed.proposed_end });
  await page.goto(`/viewings/${ids.viewing}`);
  await expect(page.getByRole('button', { name: 'Confirm appointment time' })).toBeEnabled();
  state.viewing = { ...state.viewing!, version: 7, schedule_version: 3 };
  let rejected = false;
  await page.route(`**/api/account/viewings/${ids.viewing}/confirm`, route => {
    if (rejected) return route.fallback();
    rejected = true;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.expected_version).toBe(1); expect(body.expected_schedule_version).toBe(1);
    return route.fulfill({ status: 409, json: { message: 'PRIVATE_BACKEND_ERROR' } });
  });
  await page.getByRole('button', { name: 'Confirm appointment time' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'This viewing changed.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm appointment time' })).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('PRIVATE_BACKEND_ERROR');
  await page.getByRole('button', { name: 'Refresh viewing', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm appointment time' }).click();
  await expect(page.getByText('Viewing change saved.', { exact: true })).toBeVisible();
  expect(state.commands[0]!.body).toEqual({ expected_version: 7, expected_schedule_version: 3 });
});

test('past, reversed, invalid-zone and DST-gap proposals remain local validation errors', async ({ page }) => {
  const state = await fixture(page);
  await requestForm(page);
  for (const [start, end, zone, error] of [
    ['2000-01-12T14:00', '2000-01-12T15:00', 'Africa/Douala', 'Choose a future start'],
    ['2031-01-12T15:00', '2031-01-12T14:00', 'Africa/Douala', 'Choose a future start'],
    ['2031-01-12T14:00', '2031-01-12T15:00', 'Invalid/Zone', 'Enter a valid IANA timezone'],
    ['2031-03-30T02:30', '2031-03-30T04:30', 'Europe/Paris', 'This local time is skipped or repeated']
  ]) {
    await page.getByLabel('Proposed start', { exact: true }).fill(start!);
    await page.getByLabel('Proposed end', { exact: true }).fill(end!);
    await page.getByLabel('Display timezone').fill(zone!);
    await page.getByRole('button', { name: 'Request viewing', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: error! })).toBeVisible();
  }
  expect(state.commands).toHaveLength(0);
});

test('ambiguous persisted request retry preserves body and idempotency key without duplicate visible appointments', async ({ page }) => {
  await fixture(page);
  const attempts: { body: unknown; key: string | undefined }[] = [];
  await page.route(`**/api/account/interactions/${ids.interaction}/viewings`, route => {
    attempts.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] });
    return attempts.length === 1 ? route.abort('failed') : route.fulfill({ status: 201, json: { viewing: seed, replayed: true } });
  });
  await requestForm(page);
  await page.getByRole('button', { name: 'Request viewing', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The change was not confirmed.' })).toBeVisible();
  await expect(page.getByLabel('Proposed start', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry viewing request', exact: true }).click();
  await expect(page.getByText('Viewing request saved.', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
  await expect(page.getByRole('list', { name: 'Viewings', exact: true }).locator('li')).toHaveCount(1);
});

test('ambiguous committed cancellation hides guidance immediately and retries the exact original version and key', async ({ page }) => {
  await fixture(page, { ...seed, state: 'SCHEDULED', private_instructions: privateGuidance, scheduled_start: seed.proposed_start, scheduled_end: seed.proposed_end });
  const attempts: { body: unknown; key: string | undefined }[] = [];
  await page.route(`**/api/account/viewings/${ids.viewing}/cancel`, route => {
    attempts.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] });
    return attempts.length === 1 ? route.abort('failed') : route.fulfill({ status: 201, json: { viewing: { ...seed, state: 'CANCELLED_BY_SEEKER', version: 2, reason: 'SAFETY', can_cancel: false }, replayed: true } });
  });
  await page.goto(`/viewings/${ids.viewing}`);
  await expect(page.getByText(privateGuidance, { exact: true })).toBeVisible();
  await page.getByLabel('Cancellation reason').selectOption('SAFETY');
  await page.getByRole('button', { name: 'Cancel viewing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry pending change', exact: true })).toBeVisible();
  await expect(page.getByText(privateGuidance, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Cancellation reason')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry pending change', exact: true }).click();
  await expect(page.getByText('CANCELLED_BY_SEEKER', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0]!.body).toEqual({ expected_version: 1, expected_schedule_version: 1, reason: 'SAFETY' });
});

test('revoked assignment response clears a previously visible scheduled appointment and private guidance', async ({ page }) => {
  const state = await fixture(page, { ...seed, state: 'SCHEDULED', private_instructions: privateGuidance, scheduled_start: seed.proposed_start, scheduled_end: seed.proposed_end }); state.side = 'PROVIDER';
  await page.goto(`/viewings/${ids.viewing}`);
  await expect(page.getByText(privateGuidance, { exact: true })).toBeVisible();
  state.readStatus = 404;
  await page.getByRole('button', { name: 'Refresh viewing', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'current account permissions' })).toBeVisible();
  await expect(page.getByText(privateGuidance, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel viewing', exact: true })).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('PRIVATE_BACKEND_ERROR');
});

test('private guidance never renders in accepted or cancelled payloads even if a malformed projection includes it', async ({ page }) => {
  await fixture(page);
  let state: ViewingResponse['state'] = 'ACCEPTED';
  await page.route(`**/api/account/viewings/${ids.viewing}`, route => route.fulfill({ json: {
    ...seed, state, private_instructions: privateGuidance, can_confirm: false, can_cancel: false
  } }));
  for (const status of ['ACCEPTED', 'CANCELLED_BY_PROVIDER'] as const) {
    state = status;
    await page.goto(`/viewings/${ids.viewing}`);
    await expect(page.getByText(status, { exact: true })).toBeVisible();
    await expect(page.getByText(privateGuidance, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Private meeting instructions' })).toHaveCount(0);
  }
});

test('empty, unavailable and denied inbox states give accessible feedback without raw backend details', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/viewings');
  await expect(page.getByText(/No viewing requests yet\./)).toBeVisible();
  for (const status of [503, 401, 403]) {
    state.readStatus = status;
    await page.getByRole('button', { name: 'Refresh viewings', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: status === 503 ? 'could not be loaded' : status === 401 ? 'Sign in again' : 'current account permissions' })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain('PRIVATE_BACKEND_ERROR');
  }
});

test('server capability denial removes request controls and expired history remains readable', async ({ page }) => {
  const state = await fixture(page, { ...seed, state: 'EXPIRED' }); state.requestAllowed = false;
  await page.goto(`/conversations/${ids.interaction}`);
  await expect(page.getByText('EXPIRED', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Proposed start', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/A new viewing request is not available/)).toBeVisible();
  expect(state.commands).toHaveLength(0);
});

test('viewing BFF anonymous reads and commands fail closed with private no-store responses', async ({ request }) => {
  for (const [method, path] of [
    ['GET', '/api/account/viewings'], ['GET', `/api/account/viewings/${ids.viewing}`],
    ['POST', `/api/account/interactions/${ids.interaction}/viewings`],
    ...['accept', 'decline', 'confirm', 'cancel'].map(command => ['POST', `/api/account/viewings/${ids.viewing}/${command}`])
  ]) {
    const response = await request.fetch(path!, { method: method!, data: {} });
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'authentication_required' });
  }
  const unsupported = await request.post(`/api/account/viewings/${ids.viewing}/reschedule`, { data: {} });
  expect(unsupported.status()).toBe(404); expect(unsupported.headers()['cache-control']).toBe('private, no-store');
});
