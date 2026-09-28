import { expect, test, type Page, type Route } from '@playwright/test';

// Exercise the actual provider page in a fresh browser context. All API traffic
// is intercepted: these UI regressions never use credentials or mutate records.
async function workspace(page: Page) {
  const drafts = ['a', 'b'].map((id) => ({ id, property_id: 'property', title: `Draft ${id.toUpperCase()}`, purpose: 'RENT', description: 'Saved description', amount_minor: 1000, pricing_period: 'MONTHLY', currency: 'XAF', publication_status: 'DRAFT', version: 1, utilities_included: null }));
  let status = 'PROCESSING';
  let nextResponse: ((route: Route, body: unknown) => Promise<void>) | undefined;
  let reads = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, participationAllowed: true, accountState: 'ACTIVE', csrfToken: 'synthetic' } });
    if (path === '/api/account/properties') return route.fulfill({ json: { properties: [{ id: 'property', city: 'Synthetic city', neighborhood: 'Synthetic area' }] } });
    if (path === '/api/account/listing-drafts') return route.fulfill({ json: { drafts } });
    if (path.endsWith('/readiness')) return route.fulfill({ json: { publication_status: 'DRAFT', checks: [], can_submit: false } });
    if (path.includes('/variants/')) return route.fulfill({ status: 204 });
    const id = path.split('/')[4];
    if (path.endsWith('/media')) {
      if (route.request().method() === 'POST') return route.fulfill({ status: 202, json: { status: 'UPLOADED_QUARANTINED' } });
      reads += 1;
      const body = { media: [{ id: `photo-${id}`, media_asset_id: `photo-${id}`, status: id === 'b' ? 'READY' : status, display_order: 0, is_cover: false, variants: [], width: null, height: null, size_bytes: null, failure_code: null, retryable: false }] };
      const respond = nextResponse;
      nextResponse = undefined;
      return respond ? respond(route, body) : route.fulfill({ json: body });
    }
    const draft = drafts.find((item) => item.id === id);
    if (draft) return route.fulfill({ json: draft });
    throw new Error(`Unexpected synthetic API route: ${path}`);
  });
  await page.goto('/provider');
  await page.getByRole('button', { name: /Draft A/ }).click();
  await expect(page.getByText('Processing photo', { exact: true })).toBeVisible();
  return {
    ready: () => { status = 'READY'; },
    reads: () => reads,
    fail: (code: number) => { nextResponse = async (route) => { await route.fulfill({ status: code, json: { error: 'synthetic_failure' } }); }; },
    disconnect: () => { nextResponse = async (route) => { await route.abort('failed'); }; },
    hold: () => {
      let release!: () => void;
      let started!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      const arrived = new Promise<void>((resolve) => { started = resolve; });
      nextResponse = async (route, body) => { started(); await pending; await route.fulfill({ json: body }); };
      return { arrived, release };
    }
  };
}

test('manual refresh shows progress, applies READY and preserves unsaved form input', async ({ page }) => {
  const api = await workspace(page);
  await page.getByLabel('Title', { exact: true }).fill('Unsaved title');
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Unsaved description');
  await page.getByLabel('Amount in XAF', { exact: true }).fill('9876');
  api.ready();
  const pending = api.hold();
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await pending.arrived;
  await expect(page.getByRole('button', { name: 'Refreshing…', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Refreshing photo status' })).toBeVisible();
  pending.release();
  await expect(page.getByText('Ready · private draft', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Photo status refreshed.' })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Unsaved title');
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Unsaved description');
  await expect(page.getByLabel('Amount in XAF', { exact: true })).toHaveValue('9876');
  expect(api.reads()).toBe(2);
});

test('refresh failures keep photos and input, and a retry clears the error', async ({ page }) => {
  const api = await workspace(page);
  await page.getByLabel('Title', { exact: true }).fill('Unsaved title');
  for (const status of [401, 500]) {
    api.fail(status);
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await expect(page.locator('.photoManager').getByRole('alert')).toContainText(status === 401 ? 'session has expired' : 'could not be refreshed');
    await expect(page.getByText('Processing photo', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled();
  }
  api.disconnect();
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.locator('.photoManager').getByRole('alert')).toBeVisible();
  api.ready();
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByText('Ready · private draft', { exact: true })).toBeVisible();
  await expect(page.locator('.photoManager').getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Unsaved title');
});

test('a delayed refresh cannot replace the next draft photos', async ({ page }) => {
  const api = await workspace(page);
  const pending = api.hold();
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await pending.arrived;
  await page.getByRole('button', { name: /Draft B/ }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Draft B');
  await expect(page.getByText('Ready · private draft', { exact: true })).toBeVisible();
  pending.release();
  // Allow the earlier response to complete before asserting its absence.
  await page.waitForTimeout(150);
  await expect(page.getByText('Processing photo', { exact: true })).toHaveCount(0);
  await expect(page.locator('.photoThumb img')).toHaveAttribute('src', /\/b\/media\/photo-b\//);
  await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled();
});

test('manual refresh supersedes a stale upload poll and resumes polling while processing', async ({ page }) => {
  const api = await workspace(page);
  await page.getByLabel('Add photos').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('synthetic upload intercepted before server') });
  await expect.poll(api.reads).toBe(2);
  const oldPoll = api.hold();
  await oldPoll.arrived;
  await page.getByLabel('Title', { exact: true }).fill('Still editing');
  // Manual response is still PROCESSING. It should restart one scoped poll.
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByText('Photo status refreshed.', { exact: true })).toBeVisible();
  api.ready();
  await expect(page.getByText('Ready · private draft', { exact: true })).toBeVisible();
  oldPoll.release();
  await page.waitForTimeout(150);
  await expect(page.getByText('Processing photo', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Still editing');
  const completedReads = api.reads();
  await page.waitForTimeout(1100);
  expect(api.reads()).toBe(completedReads);
});
