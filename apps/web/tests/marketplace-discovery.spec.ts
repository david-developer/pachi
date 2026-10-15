import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Route } from '@playwright/test';
import { marketplaceFixture, privateAddressCanary, testListing, testListings } from './fixtures/marketplace';

test('anonymous homepage shows API inventory and searches with supported location and purpose', async ({ page }) => {
  await marketplaceFixture(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Good places/ })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(testListing.title.replace('·', '\\u00b7')) }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('combobox', { name: 'Region', exact: true }).selectOption('Littoral');
  await page.getByLabel('City or municipality').fill('Douala');
  await page.getByRole('button', { name: 'Search properties' }).click();
  await expect(page).toHaveURL(/\/listings\?purpose=SALE&region=Littoral&city=Douala/);
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('Douala');
  await expect(page.getByRole('combobox', { name: 'Purpose', exact: true })).toHaveValue('SALE');
});

test('pagination uses applied filters while edits stay unsent and new searches reset the cursor', async ({ page }) => {
  await marketplaceFixture(page);
  const requests: URL[] = [];
  await page.route('**/api/public/listings?**', route => {
    const url = new URL(route.request().url());
    requests.push(url);
    const append = url.searchParams.has('cursor');
    return route.fulfill({ json: { items: append ? [testListings[1]] : [testListing], filters: {}, next_cursor: append ? null : 'synthetic-cursor', has_more: !append } });
  });
  await page.goto('/listings?city=Douala&purpose=RENT');
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('Douala');
  await expect(page.getByRole('button', { name: 'Load more listings' })).toBeVisible();
  await page.getByLabel('City', { exact: true }).fill('Buea');
  await page.getByRole('button', { name: 'Load more listings' }).click();
  await expect(page.getByRole('heading', { name: testListings[1]!.title })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get('city')).toBe('Douala');
  expect(requests.at(-1)?.searchParams.get('cursor')).toBe('synthetic-cursor');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/city=Buea/);
  await expect(page.getByRole('heading', { name: testListings[1]!.title })).toHaveCount(0);
  expect(requests.at(-1)?.searchParams.has('cursor')).toBe(false);
  await page.goBack();
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('Douala');
  await page.goForward();
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('Buea');
});

test('a superseded delayed search cannot replace the newest results', async ({ page }) => {
  await marketplaceFixture(page);
  let release!: () => void;
  let arrived!: () => void;
  let completed!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { arrived = resolve; });
  const settled = new Promise<void>(resolve => { completed = resolve; });
  await page.route('**/api/public/listings?**', async (route: Route) => {
    const city = new URL(route.request().url()).searchParams.get('city');
    if (city === 'Douala') {
      arrived();
      await pending;
      try { await route.fulfill({ json: { items: [testListing], has_more: false, next_cursor: null, filters: {} } }); }
      finally { completed(); }
      return;
    }
    return route.fulfill({ json: { items: [testListings[1]], has_more: false, next_cursor: null, filters: {} } });
  });
  await page.goto('/listings');
  await expect(page.getByRole('heading', { name: testListings[1]!.title })).toBeVisible();
  await page.getByLabel('City', { exact: true }).fill('Douala');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await started;
  await page.getByLabel('City', { exact: true }).fill('Buea');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByRole('heading', { name: testListings[1]!.title })).toBeVisible();
  release();
  await settled;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByRole('heading', { name: testListing.title })).toHaveCount(0);
  await expect(page).toHaveURL(/city=Buea/);
});

for (const width of [1440, 768, 390]) test(`rendered discovery pages fit ${width}px and retain public privacy`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  await marketplaceFixture(page);
  const evidence = process.env.PACHI_VISUAL_EVIDENCE_DIR;
  if (evidence) mkdirSync(evidence, { recursive: true });
  for (const [name, route] of [['homepage', '/'], ['results', '/listings'], ['detail', `/listings/${testListing.id}`]] as const) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: name === 'homepage' ? width <= 599 ? /A place for your next chapter/ : /Good places/ : name === 'detail' ? testListing.title : /Find/ }).first()).toBeVisible();
    if (name !== 'detail') await expect(page.locator('.listingCard').first()).toBeVisible();
    // Bring lazy images into view before capturing full-page evidence.
    const images = page.locator('img');
    for (let index = 0; index < await images.count(); index++) await images.nth(index).scrollIntoViewIfNeeded();
    await page.evaluate(async () => { await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => undefined))); window.scrollTo(0, 0); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await expect(page.getByText(privateAddressCanary)).toHaveCount(0);
    const file = `${name}-${width}.png`;
    const path = evidence ? join(evidence, file) : testInfo.outputPath(file);
    await page.screenshot({ path, fullPage: !(name === 'detail' && width === 390) });
    await testInfo.attach(file, { path, contentType: 'image/png' });
  }
});

test('homepage and results distinguish empty inventory from failure and allow retry', async ({ page }) => {
  await marketplaceFixture(page, []);
  await page.goto('/');
  await expect(page.getByText('New places will appear here.')).toBeVisible();
  let failed = true;
  await page.route('**/api/public/listings?**', route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { message: 'SYNTHETIC_INTERNAL_ERROR_DO_NOT_RENDER' } : { items: [], filters: {}, next_cursor: null, has_more: false } }));
  await page.reload();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await expect(page.getByText('New places will appear here.')).toHaveCount(0);
  await expect(page.getByText('SYNTHETIC_INTERNAL_ERROR_DO_NOT_RENDER')).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('New places will appear here.')).toBeVisible();
  await page.goto('/listings');
  await expect(page.getByText('No listings match those filters.')).toBeVisible();
  failed = true;
  await page.reload();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await expect(page.getByText('No listings match those filters.')).toHaveCount(0);
  await expect(page.getByText('SYNTHETIC_INTERNAL_ERROR_DO_NOT_RENDER')).toHaveCount(0);
});

test('missing photographs retain listing navigation and a useful detail gallery state', async ({ page }) => {
  await marketplaceFixture(page, [{ ...testListing, media: [] }]);
  await page.goto('/listings');
  await expect(page.getByText('No photo available')).toBeVisible();
  await page.locator('.listingCard').click();
  await expect(page.getByRole('heading', { name: testListing.title })).toBeVisible();
  await expect(page.getByText('Photos are not available for this listing.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Contact provider', exact: true })).toBeVisible();
  await expect(page.getByText(privateAddressCanary)).toHaveCount(0);
});

test('mobile navigation opens by keyboard, follows discovery links and closes with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await marketplaceFixture(page);
  await page.goto('/');
  const menu = page.locator('.marketplaceMenu > summary');
  await menu.focus();
  await page.keyboard.press('Enter');
  const navigation = page.getByRole('navigation', { name: 'Mobile navigation', exact: true });
  await expect(navigation).toBeVisible();
  await navigation.getByRole('link', { name: 'Buy', exact: true }).click();
  await expect(page).toHaveURL('/listings?purpose=SALE');
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(navigation).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(navigation).not.toBeVisible();
  await expect(menu).toBeFocused();
});
