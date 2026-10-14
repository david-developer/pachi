import { expect, test } from '@playwright/test';
import { marketplaceFixture, testListing, testListings } from './fixtures/marketplace';

test('all supported filters roundtrip through the URL and reset to a fresh search', async ({ page }) => {
  await marketplaceFixture(page);
  const requests: URL[] = [];
  await page.route('**/api/public/listings?**', route => {
    const url = new URL(route.request().url());
    requests.push(url);
    return route.fulfill({ json: { items: [testListing], filters: {}, next_cursor: null, has_more: false } });
  });
  const filters = {
    purpose: 'RENT', region: 'Littoral', city: 'Douala', neighborhood: 'Akwa', property_type: 'APARTMENT',
    min_price: '100000', max_price: '400000', min_bedrooms: '2', furnishing: 'PARTLY_FURNISHED', sort: 'price_asc',
  };
  await page.goto(`/listings?${new URLSearchParams(filters).toString()}`);
  await expect(page.getByRole('heading', { name: testListing.title })).toBeVisible();
  for (const [name, value] of Object.entries(filters)) await expect(page.locator(`[name="${name}"]`)).toHaveValue(value);
  expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual(filters);
  const more = page.locator('details.searchFilters');
  if (!(await more.evaluate((element: HTMLDetailsElement) => element.open))) await more.locator('summary').click();
  await page.getByRole('combobox', { name: 'Purpose', exact: true }).selectOption('SHORT_LET');
  await page.getByRole('combobox', { name: 'Region', exact: true }).selectOption('Southwest');
  await page.getByLabel('City', { exact: true }).fill(' Buea ');
  await page.getByLabel('Neighborhood', { exact: true }).fill(' Molyko ');
  await page.getByRole('combobox', { name: 'Property type', exact: true }).selectOption('ROOM');
  await page.getByLabel('Min price', { exact: true }).fill('00050000');
  await page.getByLabel('Max price', { exact: true }).fill('150000');
  await page.locator('[name="min_bedrooms"]').fill('1');
  await page.getByRole('combobox', { name: 'Furnishing', exact: true }).selectOption('FURNISHED');
  await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('price_desc');
  const expected = { purpose: 'SHORT_LET', region: 'Southwest', city: 'Buea', neighborhood: 'Molyko', property_type: 'ROOM', min_price: '50000', max_price: '150000', min_bedrooms: '1', furnishing: 'FURNISHED', sort: 'price_desc' };
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(`/listings?${new URLSearchParams(expected).toString()}`);
  await expect(page.getByRole('heading', { name: testListing.title })).toBeVisible();
  expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual(expected);
  await page.reload();
  await expect(page.getByRole('heading', { name: testListing.title })).toBeVisible();
  for (const [name, value] of Object.entries(expected)) await expect(page.locator(`[name="${name}"]`)).toHaveValue(value);
  if (!(await more.evaluate((element: HTMLDetailsElement) => element.open))) await more.locator('summary').click();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page).toHaveURL('/listings');
  await expect(page.getByRole('heading', { name: testListing.title })).toBeVisible();
  expect([...requests.at(-1)!.searchParams]).toEqual([]);
  for (const name of Object.keys(filters)) await expect(page.locator(`[name="${name}"]`)).toHaveValue(name === 'sort' ? 'newest' : '');
});

test('invalid numeric filters and reversed price ranges never send a search request', async ({ page }) => {
  await marketplaceFixture(page);
  let searches = 0;
  await page.route('**/api/public/listings?**', route => {
    searches++;
    return route.fulfill({ json: { items: [testListing], filters: {}, next_cursor: null, has_more: false } });
  });
  await page.goto('/listings?city=Douala');
  await expect(page.getByRole('heading', { name: testListing.title })).toBeVisible();
  const baseline = searches;
  const more = page.locator('details.searchFilters');
  if (!(await more.evaluate((element: HTMLDetailsElement) => element.open))) await more.locator('summary').click();
  const minimum = page.locator('[name="min_price"]');
  const maximum = page.locator('[name="max_price"]');
  for (const value of ['-1', '1.5', '1e3', '9,000', '9007199254740992']) {
    await minimum.fill(value);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(minimum).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Check your search filters.');
    expect(searches).toBe(baseline);
    await expect(page).toHaveURL('/listings?city=Douala');
    await expect(page.getByRole('heading', { name: testListing.title })).toBeVisible();
  }
  await minimum.fill('300000');
  await maximum.fill('200000');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(maximum).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Maximum price must be at least the minimum price.')).toBeVisible();
  expect(searches).toBe(baseline);
  await minimum.fill('');
  await maximum.fill('');
  const bedrooms = page.locator('[name="min_bedrooms"]');
  await bedrooms.fill('2.5');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(bedrooms).toHaveAttribute('aria-invalid', 'true');
  expect(searches).toBe(baseline);
  await bedrooms.fill('0');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL('/listings?city=Douala&min_bedrooms=0');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: testListing.title })).toBeVisible();
  expect(searches).toBe(baseline + 1);
});

test('mobile secondary filters expand by keyboard and apply through their own controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await marketplaceFixture(page);
  const requests: URL[] = [];
  await page.route('**/api/public/listings?**', route => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: { items: [testListing], filters: {}, next_cursor: null, has_more: false } });
  });
  await page.goto('/listings');
  await expect(page.getByRole('heading', { name: testListing.title })).toBeVisible();
  const details = page.locator('details.searchFilters');
  const toggle = details.locator('summary');
  await expect(details).not.toHaveAttribute('open');
  await expect(page.getByLabel('Neighborhood', { exact: true })).not.toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Neighborhood', { exact: true })).toBeVisible();
  await page.getByLabel('Neighborhood', { exact: true }).fill('Akwa');
  await page.getByRole('combobox', { name: 'Property type', exact: true }).selectOption('APARTMENT');
  await page.getByLabel('Max price', { exact: true }).fill('300000');
  await page.getByRole('button', { name: 'Update results', exact: true }).click();
  await expect(page).toHaveURL('/listings?neighborhood=Akwa&property_type=APARTMENT&max_price=300000');
  await expect(page.getByRole('heading', { name: testListing.title })).toBeVisible();
  expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({ neighborhood: 'Akwa', property_type: 'APARTMENT', max_price: '300000' });
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(details).not.toHaveAttribute('open');
  await expect(page.getByLabel('Neighborhood', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply filters' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test('pagination failure retains items and retries the same cursor without duplicate cards', async ({ page }) => {
  await marketplaceFixture(page);
  let failed = true;
  const requests: URL[] = [];
  await page.route('**/api/public/listings?**', route => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (!url.searchParams.has('cursor')) return route.fulfill({ json: { items: [testListing], filters: {}, next_cursor: 'test-page-two', has_more: true } });
    if (failed) return route.fulfill({ status: 503, json: { message: 'TEST_PRIVATE_DIAGNOSTIC_DO_NOT_RENDER' } });
    return route.fulfill({ json: { items: [testListing, testListings[1]], filters: {}, next_cursor: null, has_more: false } });
  });
  await page.goto('/listings?city=Douala');
  await expect(page.getByRole('heading', { name: testListing.title })).toBeVisible();
  await page.getByRole('button', { name: 'Load more listings', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Your results are still here.');
  await expect(page.getByRole('heading', { name: testListing.title })).toBeVisible();
  await expect(page.locator('.listingCard')).toHaveCount(1);
  await expect(page.getByText('TEST_PRIVATE_DIAGNOSTIC_DO_NOT_RENDER')).toHaveCount(0);
  expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({ city: 'Douala', cursor: 'test-page-two' });
  failed = false;
  await page.getByRole('button', { name: 'Try loading more again', exact: true }).click();
  await expect(page.getByRole('heading', { name: testListings[1]!.title })).toBeVisible();
  await expect(page.getByRole('heading', { name: testListing.title })).toHaveCount(1);
  await expect(page.locator('.listingCard')).toHaveCount(2);
  await expect(page.locator('.searchResults').getByRole('status')).toContainText('2 listings loaded');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load more listings', exact: true })).toHaveCount(0);
  expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({ city: 'Douala', cursor: 'test-page-two' });
});
