import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { marketplaceFixture, privateAddressCanary, testListing, testListings } from './fixtures/marketplace';

const widths = [320, 390, 768, 1440] as const;
const detailPath = `/listings/${testListing.id}`;
const privateErrorCanary = 'TEST_MOBILE_INTERNAL_ERROR_NEVER_PUBLIC';

async function assertPublicPageFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await expect(page.locator('body')).not.toContainText(privateAddressCanary);
  await expect(page.locator('body')).not.toContainText(privateErrorCanary);
}

async function touchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
}

async function capture(page: Page, testInfo: TestInfo, name: string, fullPage = true) {
  // Decode the existing synthetic TEST photographs, including lazy card media.
  // They are intercepted only in this fresh browser context, never published.
  const images = page.locator('img:visible');
  for (let index = 0; index < await images.count(); index++) await images.nth(index).scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => undefined)));
    window.scrollTo(0, 0);
  });
  await assertPublicPageFits(page);
  const directory = process.env.PACHI_MOBILE_EVIDENCE_DIR;
  if (directory) mkdirSync(directory, { recursive: true });
  const path = directory ? join(directory, `${name}.png`) : testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const width of widths) {
  test(`mobile-first discovery renders public homepage, results and detail at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await marketplaceFixture(page);
    for (const [name, route] of [['homepage', '/'], ['results', '/listings'], ['detail', detailPath]] as const) {
      await page.goto(route);
      if (name === 'detail') await expect(page.getByRole('heading', { name: testListing.title, exact: true })).toBeVisible();
      else await expect(page.locator('.listingCard')).toHaveCount(testListings.length);

      if (name === 'homepage' && width <= 390) {
        const header = await page.locator('.marketplaceHeader').boundingBox();
        const visual = await page.locator('.homeHeroVisual').boundingBox();
        const search = await page.locator('.homeSearch').boundingBox();
        const headline = page.getByRole('heading', { name: 'A place for your next chapter.', exact: true });
        await expect(headline).toBeVisible();
        await expect(page.getByText('Discover homes and spaces across Southwest and Littoral.', { exact: true })).toBeVisible();
        const text = await headline.boundingBox();
        expect(header && visual && search && text).toBeTruthy();
        expect(header!.height).toBeGreaterThanOrEqual(60);
        expect(header!.height).toBeLessThanOrEqual(68);
        expect(visual!.y).toBeCloseTo(header!.y + header!.height, 0);
        expect(visual!.x).toBe(0);
        expect(visual!.width).toBe(width);
        expect(visual!.height).toBeGreaterThanOrEqual(340);
        expect(visual!.height).toBeLessThanOrEqual(420);
        expect(text!.y).toBeGreaterThanOrEqual(visual!.y);
        expect(text!.y + text!.height).toBeLessThan(visual!.y + visual!.height);
        const overlap = visual!.y + visual!.height - search!.y;
        expect(overlap).toBeGreaterThanOrEqual(65);
        expect(overlap).toBeLessThanOrEqual(95);
        expect(search!.x).toBeGreaterThanOrEqual(16);
        expect(search!.x + search!.width).toBeLessThanOrEqual(width - 16);
        const photograph = page.locator('.homeHeroPhoto');
        await expect(photograph).toHaveAttribute('src', new RegExp(`/api/public/listings/${testListing.id}/media/`));
        await expect.poll(() => photograph.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        expect(await photograph.evaluate(image => getComputedStyle(image).objectFit)).toBe('cover');
        for (const target of [page.locator('.marketplaceMenu > summary'), page.locator('.accountLink'), page.locator('.homeSearchSubmit'), page.locator('.homeCityField input'), page.locator('.homeSearch [name="property_type"]'), page.locator('.homeSearch [name="max_price"]')]) await touchTarget(target);
        const purposeButtons = page.getByRole('group', { name: 'Property purpose' }).getByRole('button');
        for (let index = 0; index < await purposeButtons.count(); index++) await touchTarget(purposeButtons.nth(index));
        const cities = await page.locator('.homeLocationShortcuts').boundingBox();
        expect(cities).not.toBeNull();
        expect(cities!.y).toBeGreaterThanOrEqual(search!.y + search!.height);
        expect(cities!.y - (search!.y + search!.height)).toBeLessThanOrEqual(100);
      }

      if (name === 'results' && width <= 390) {
        await touchTarget(page.locator('.searchFilters > summary'));
        await touchTarget(page.getByRole('combobox', { name: 'Sort', exact: true }));
        const card = page.locator('.listingCard').first();
        const photo = await card.locator('.listingCardMedia').boundingBox();
        const price = await card.locator('.listingPrice').boundingBox();
        const title = await card.getByRole('heading', { name: testListing.title, exact: true }).boundingBox();
        const location = await card.locator('.listingLocation').boundingBox();
        expect(photo && price && title && location).toBeTruthy();
        expect(photo!.height).toBeGreaterThanOrEqual(170);
        expect(price!.y).toBeGreaterThanOrEqual(photo!.y + photo!.height);
        expect(title!.y).toBeGreaterThanOrEqual(price!.y + price!.height);
        expect(location!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
        await expect(card).toContainText('200,000');
        await expect(card).toContainText('XAF');
        await expect(card).toContainText('per month');
      }

      if (name === 'detail' && width <= 390) {
        const back = page.getByRole('link', { name: '← Back to listings', exact: true });
        const photo = await page.locator('.galleryMainImage').boundingBox();
        const title = await page.locator('.detailHeader').boundingBox();
        const contact = await page.locator('.detailContactCard').boundingBox();
        const description = await page.locator('.detailDescriptionSection').boundingBox();
        const backBounds = await back.boundingBox();
        expect(photo && title && contact && description && backBounds).toBeTruthy();
        expect(photo!.y).toBeGreaterThanOrEqual(backBounds!.y + backBounds!.height);
        expect(title!.y).toBeGreaterThanOrEqual(photo!.y + photo!.height);
        expect(contact!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
        expect(description!.y).toBeGreaterThanOrEqual(contact!.y + contact!.height);
        await expect(page.locator('.detailContactPrice')).toContainText('200,000');
        await expect(page.locator('.detailContactPrice')).toContainText('per month');
        await touchTarget(back);
        await touchTarget(page.getByRole('button', { name: 'Ask about this property', exact: true }));
        await touchTarget(page.getByRole('button', { name: 'Contact provider', exact: true }));
        await expect(page.getByRole('button', { name: 'Contact provider', exact: true })).toBeInViewport();
      }

      await capture(page, testInfo, `${name}-${width}`);
      if (width <= 390 && name !== 'results') await capture(page, testInfo, `${name}-${width}-viewport`, false);
    }
  });
}

test('mobile home purpose, city, type and budget submit real shareable filters; advanced search preserves them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await marketplaceFixture(page);
  const requests: URL[] = [];
  await page.route('**/api/public/listings?**', route => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ json: { items: testListings, filters: {}, next_cursor: null, has_more: false } });
  });
  for (const [label, purpose] of [['Rent', 'RENT'], ['Buy', 'SALE'], ['Short let', 'SHORT_LET']] as const) {
    await page.goto('/');
    await expect(page.locator('.listingCard')).toHaveCount(testListings.length);
    const purposeControl = page.getByRole('group', { name: 'Property purpose' }).getByRole('button', { name: label, exact: true });
    await purposeControl.click();
    await expect(purposeControl).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('textbox', { name: 'Where would you like to live?', exact: true }).fill(' Douala ');
    await page.getByRole('combobox', { name: 'Property type', exact: true }).selectOption('APARTMENT');
    const budget = page.getByLabel('Budget (maximum XAF)', { exact: true });
    await expect(budget).toHaveAttribute('placeholder', 'Any price');
    await budget.fill('300000');
    await page.getByRole('button', { name: 'Find a home', exact: true }).click();
    await expect(page).toHaveURL(/\/listings\?/);
    await expect(page.locator('.listingCard')).toHaveCount(testListings.length);
    const expected = { purpose, city: 'Douala', property_type: 'APARTMENT', max_price: '300000' };
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(expected);
    await expect.poll(() => Object.fromEntries(requests.at(-1)!.searchParams)).toEqual(expected);
    await page.reload();
    await expect(page.locator('[name="max_price"]')).toHaveValue('300000');
    await expect(page.locator('[name="property_type"]')).toHaveValue('APARTMENT');
  }

  await page.goto('/');
  await page.getByRole('textbox', { name: 'Where would you like to live?', exact: true }).fill('Buea');
  await page.getByRole('combobox', { name: 'Property type', exact: true }).selectOption('ROOM');
  await page.getByLabel('Budget (maximum XAF)', { exact: true }).fill('125000');
  await page.getByRole('link', { name: 'Region & more filters', exact: true }).click();
  await expect(page).toHaveURL('/listings?purpose=RENT&city=Buea&property_type=ROOM&max_price=125000');
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ purpose: 'RENT', city: 'Buea', property_type: 'ROOM', max_price: '125000' });
  await page.getByRole('combobox', { name: 'Region', exact: true }).selectOption('Southwest');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page).toHaveURL(/region=Southwest/);
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('Buea');
  await expect.poll(() => Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({ purpose: 'RENT', region: 'Southwest', city: 'Buea', property_type: 'ROOM', max_price: '125000' });
});

test('mobile location shortcuts come from public inventory and navigate real city and region filters', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await marketplaceFixture(page, [testListings[1]!, { ...testListing, location: { region: 'Centre', city: 'TEST outside launch regions', neighborhood: '' } }]);
  await page.goto('/');
  const shortcuts = page.getByRole('navigation', { name: 'Explore Cameroon', exact: true });
  await expect(shortcuts.getByRole('link')).toHaveCount(1);
  const city = shortcuts.getByRole('link', { name: 'Buea', exact: true });
  await touchTarget(city);
  const target = new URL((await city.getAttribute('href'))!, page.url());
  expect(target.pathname).toBe('/listings');
  expect(Object.fromEntries(target.searchParams)).toEqual({ region: 'Southwest', city: 'Buea' });
  await expect(shortcuts).not.toContainText('Douala');
  await expect(shortcuts).not.toContainText('Limbe');
  await expect(shortcuts).not.toContainText('TEST outside launch regions');
  await city.click();
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('Buea');
  await expect(page.getByRole('combobox', { name: 'Region', exact: true })).toHaveValue('Southwest');
});

test('mobile budget blocks invalid amounts and submits a corrected whole XAF amount by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await marketplaceFixture(page);
  let searches = 0;
  await page.route('**/api/public/listings?**', route => {
    searches++;
    return route.fulfill({ json: { items: testListings, filters: {}, next_cursor: null, has_more: false } });
  });
  await page.goto('/');
  await expect(page.locator('.listingCard')).toHaveCount(testListings.length);
  const initialSearches = searches;
  const budget = page.getByLabel('Budget (maximum XAF)', { exact: true });
  await budget.fill('-1');
  expect(await budget.evaluate(input => (input as HTMLInputElement).validity.rangeUnderflow)).toBe(true);
  await page.getByRole('button', { name: 'Find a home', exact: true }).click();
  await expect(page).toHaveURL('/');
  expect(searches).toBe(initialSearches);

  // Native number inputs accept exponent syntax; the shared marketplace filter
  // validator requires an explicit whole XAF string before navigating.
  await budget.fill('1e3');
  await page.getByRole('button', { name: 'Find a home', exact: true }).click();
  await expect(budget).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('main').getByRole('alert')).toContainText('Enter a whole XAF amount, zero or more.');
  await expect(page).toHaveURL('/');
  expect(searches).toBe(initialSearches);
  await budget.fill('00300000');
  await expect(budget).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/listings?purpose=RENT&max_price=300000');
  await expect(page.locator('[name="max_price"]')).toHaveValue('300000');
  await assertPublicPageFits(page);
});

for (const width of [320, 390]) {
  test(`mobile no-photo and empty inventory keep a working branded search at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await marketplaceFixture(page, [{ ...testListing, media: [] }]);
    await page.goto('/');
    await expect(page.locator('.listingCard')).toHaveCount(1);
    await expect(page.locator('.homeHeroPhoto')).toHaveCount(0);
    await expect(page.locator('.homeArchitecture')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Find a home', exact: true })).toBeVisible();
    await capture(page, testInfo, `homepage-no-photo-${width}`);
    await page.getByRole('button', { name: 'Find a home', exact: true }).click();
    await expect(page).toHaveURL('/listings?purpose=RENT');
    await expect(page.getByText('No photo available', { exact: true })).toBeVisible();
    await capture(page, testInfo, `results-no-photo-${width}`);
    await page.locator('.listingCard').click();
    await expect(page.getByText('Photos are not available for this listing.', { exact: true })).toBeVisible();
    await capture(page, testInfo, `detail-no-photo-${width}`);

    await marketplaceFixture(page, []);
    for (const [name, route, message] of [
      ['homepage', '/', 'New places will appear here.'],
      ['results', '/listings', 'No listings match those filters.'],
      ['detail', detailPath, 'This listing is no longer available.'],
    ] as const) {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: message, exact: true })).toBeVisible();
      await expect(page.locator('.listingCard')).toHaveCount(0);
      if (name === 'homepage') {
        await expect(page.locator('.homeHeroPhoto')).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: 'Explore Cameroon', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Find a home', exact: true })).toBeVisible();
      }
      await capture(page, testInfo, `${name}-empty-${width}`);
    }
  });
}

test('mobile media and API failures preserve search, public errors and retry behavior', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await marketplaceFixture(page);
  await page.route('**/api/public/listings/*/media/**', route => route.fulfill({ status: 503, body: '' }));
  await page.goto('/');
  await expect(page.locator('.listingCard')).toHaveCount(testListings.length);
  await expect(page.locator('.homeHeroPhoto')).toHaveCount(0);
  await expect(page.locator('.homeArchitecture')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find a home', exact: true })).toBeVisible();
  await capture(page, testInfo, 'homepage-media-unavailable-390');

  let failed = true;
  await page.route('**/api/public/listings**', route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { message: privateErrorCanary } : { items: [], filters: {}, next_cursor: null, has_more: false } }));
  for (const [name, route] of [['homepage', '/'], ['results', '/listings'], ['detail', detailPath]] as const) {
    await page.goto(route);
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    await expect(page.locator('.listingCard')).toHaveCount(0);
    await capture(page, testInfo, `${name}-error-390`);
  }
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New places will appear here.', exact: true })).toBeVisible();
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Find a home', exact: true }).click();
  await expect(page).toHaveURL('/listings?purpose=RENT');
});
