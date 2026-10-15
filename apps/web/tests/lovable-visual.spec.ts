import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { PublicListing } from '@pachi/contracts';
import { marketplaceFixture, privateAddressCanary, testListing, testListings } from './fixtures/marketplace';

const widths = [1440, 768, 390] as const;
const detailPath = `/listings/${testListing.id}`;
const routes = [['homepage', '/'], ['results', '/listings'], ['detail', detailPath]] as const;
const internalErrorCanary = 'TEST_INTERNAL_DETAIL_NEVER_PUBLIC';
const longListing: PublicListing = {
  ...testListing,
  title: 'TEST · A bright apartment with a separate kitchen, generous living space and room for a longer description of the property in Akwa',
  description: [
    'Synthetic TEST inventory for long-content browser review. This is an invented property, not a live listing or a claim about a real home.',
    'The supplied description has several paragraphs so the reading column, line length and spacing can be reviewed. A separate kitchen and two bedrooms are fixture data. No parking, internet, gated entrance or other amenities have been invented for this test.',
    'Discuss the supplied terms through the authorized Pachi conversation flow. This paragraph deliberately continues the description to exercise a realistic reading rhythm on small screens without exposing private addresses, security instructions or direct contact details.',
    'TEST · Fin de description. Des caractères accentués restent lisibles : à, é, è, ê, ô, ç. This is a typography fixture and does not establish French localization.',
  ].join('\n\n'),
  price: { ...testListing.price, amount_minor: 129000000 },
  terms: { ...testListing.terms, deposit_amount_minor: 258000000, advance_months: 24, minimum_lease_months: 36, service_charge_amount_minor: 1234567 },
};

async function capture(page: Page, testInfo: TestInfo, name: string, options: { section?: Locator; fullPage?: boolean } = {}) {
  const images = page.locator('img');
  for (let index = 0; index < await images.count(); index++) await images.nth(index).scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => undefined)));
  });
  if (options.section) await options.section.evaluate(element => element.scrollIntoView({ block: 'start' }));
  else await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await expect(page.locator('body')).not.toContainText(privateAddressCanary);
  await expect(page.locator('body')).not.toContainText(internalErrorCanary);
  const directory = process.env.PACHI_LOVABLE_EVIDENCE_DIR;
  if (directory) mkdirSync(directory, { recursive: true });
  const file = `${name}.png`;
  const path = directory ? join(directory, file) : testInfo.outputPath(file);
  await page.screenshot({ path, fullPage: options.fullPage ?? true, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function assertPhotographs(page: Page, count: number, width: number) {
  const main = page.locator('.galleryMainImage');
  const supporting = page.locator('.gallerySupportingPhoto img');
  await expect(main).toHaveCount(count ? 1 : 0);
  await expect(supporting).toHaveCount(width >= 700 ? Math.max(0, count - 1) : 0);
  const sources = await page.locator('.galleryMainImage, .gallerySupportingPhoto img').evaluateAll(images => images.map(image => image.getAttribute('src')));
  expect(new Set(sources).size).toBe(sources.length);
  const mediaIds = sources.map(source => source?.split('/')[6]);
  expect(new Set(mediaIds).size).toBe(mediaIds.length);
  for (const id of mediaIds) expect(testListing.media.slice(0, count).map(media => media.id)).toContain(id);
  for (const source of sources) expect(source).toContain(`/api/public/listings/${testListing.id}/media/`);
  if (count) await expect.poll(() => main.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  if (width === 1440 && count === 3) {
    const mainBounds = await main.boundingBox();
    const first = await supporting.nth(0).boundingBox();
    const second = await supporting.nth(1).boundingBox();
    expect(mainBounds && first && second).toBeTruthy();
    expect(mainBounds!.width).toBeGreaterThan(first!.width * 1.4);
    expect(first!.x).toBeGreaterThan(mainBounds!.x + mainBounds!.width - 1);
    expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
  }
}

for (const width of widths) {
  test(`Lovable reference composition uses real TEST contract data at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await marketplaceFixture(page);
    for (const [name, route] of routes) {
      await page.goto(route);
      if (name === 'detail') {
        await expect(page.getByRole('heading', { name: testListing.title, exact: true })).toBeVisible();
        await assertPhotographs(page, 3, width);
        await expect(page.getByRole('button', { name: 'Contact provider', exact: true })).toHaveCount(1);
      } else {
        await expect(page.locator('.listingCard')).toHaveCount(testListings.length);
      }
      await capture(page, testInfo, `${name}-${width}`);
      if (name === 'detail') {
        await capture(page, testInfo, `detail-${width}-viewport`, { fullPage: false });
        await capture(page, testInfo, `detail-contact-${width}`, { section: page.locator('.detailContactCard'), fullPage: false });
        await capture(page, testInfo, `detail-reading-${width}`, { section: page.locator('.detailDescriptionSection'), fullPage: false });
        if (width === 390) await expect(page.getByRole('button', { name: 'Contact provider', exact: true })).toBeInViewport();
      }
    }
  });

  test(`Lovable composition supports long titles, paragraphs and XAF terms at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await marketplaceFixture(page, [longListing, testListings[1]!, testListings[2]!]);
    for (const [name, route] of routes) {
      await page.goto(route);
      if (name === 'detail') {
        await expect(page.getByRole('heading', { name: longListing.title, exact: true })).toBeVisible();
        await expect(page.locator('.detailDescription')).toHaveText(longListing.description);
        await expect(page.locator('.detailTerms')).toContainText('258,000,000 XAF');
      } else await expect(page.locator('.listingCard').first()).toContainText(longListing.title);
      await capture(page, testInfo, `${name}-long-content-${width}`);
    }
  });

  test(`Lovable empty and unavailable states remain distinct from API errors at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await marketplaceFixture(page, []);
    for (const [name, route] of routes) {
      await page.goto(route);
      await expect(page.locator('.listingCard')).toHaveCount(0);
      if (name === 'homepage') await expect(page.getByText('New places will appear here.', { exact: true })).toBeVisible();
      if (name === 'results') await expect(page.getByText('No listings match those filters.', { exact: true })).toBeVisible();
      if (name === 'detail') await expect(page.getByRole('heading', { name: 'This listing is no longer available.', exact: true })).toBeVisible();
      await capture(page, testInfo, `${name}-empty-${width}`);
    }
    await page.route('**/api/public/listings**', route => route.fulfill({ status: 503, json: { message: internalErrorCanary } }));
    for (const [name, route] of routes) {
      await page.goto(route);
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
      await expect(page.locator('.listingCard')).toHaveCount(0);
      await capture(page, testInfo, `${name}-error-${width}`);
    }
  });
}

for (const width of [1440, 390]) for (const count of [0, 1, 2, 3]) {
  test(`Lovable ${count}-photo detail uses only supplied media at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await marketplaceFixture(page, [{ ...testListing, media: testListing.media.slice(0, count) }]);
    await page.goto(detailPath);
    await expect(page.getByRole('heading', { name: testListing.title, exact: true })).toBeVisible();
    await assertPhotographs(page, count, width);
    if (count === 0) {
      await expect(page.getByText('Photos are not available for this listing.', { exact: true })).toBeVisible();
      await expect(page.locator('.galleryOpen')).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: 'Contact provider', exact: true })).toBeVisible();
    await capture(page, testInfo, `detail-${count}-photos-${width}`);
  });
}

test('Lovable gallery dialog navigates actual media, contains focus and restores each opener', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await marketplaceFixture(page);
  await page.goto(detailPath);
  await expect(page.getByRole('heading', { name: testListing.title, exact: true })).toBeVisible();
  const open = page.getByRole('button', { name: 'View all 3 photos', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Full property photo gallery', exact: true });
  await expect(dialog).toBeVisible();
  const firstSource = await dialog.locator('.galleryDialogStage img').getAttribute('src');
  await dialog.getByRole('button', { name: 'Next gallery photo', exact: true }).click();
  await expect(dialog.locator('.galleryDialogStage img')).not.toHaveAttribute('src', firstSource!);
  const focusable = dialog.getByRole('button');
  await focusable.last().focus();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await focusable.first().focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await capture(page, testInfo, 'detail-gallery-dialog-1440', { fullPage: false });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(open).toBeFocused();
  const supporting = page.locator('.gallerySupportingPhoto').first();
  await supporting.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close photo gallery', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(supporting).toBeFocused();
});

test('Lovable mobile inline inquiry and sticky action retain the phone gate', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await marketplaceFixture(page);
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, participationAllowed: false, csrfToken: 'synthetic-lovable-test-csrf' } }));
  await page.route('**/api/account/listings/*/contact-safety', route => route.fulfill({ status: 503, json: {} }));
  let inquiries = 0;
  await page.route('**/api/account/listings/*/inquiry', route => { inquiries++; return route.fulfill({ status: 403, json: {} }); });
  await page.goto(detailPath);
  await expect(page.getByRole('heading', { name: testListing.title, exact: true })).toBeVisible();
  const inline = page.getByRole('button', { name: 'Ask about this property', exact: true });
  await expect(inline).toBeVisible();
  await inline.click();
  const feedback = page.getByText('Verify your phone before contacting a provider.', { exact: true });
  await expect(feedback).toHaveCount(1);
  await expect(feedback).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Contact provider', exact: true })).toBeInViewport();
  await expect(page.getByRole('link', { name: 'Go to your account', exact: true })).toBeInViewport();
  expect(inquiries).toBe(0);
  await capture(page, testInfo, 'detail-mobile-phone-gate-390', { section: page.locator('.detailContactCard'), fullPage: false });
});

// Pinned public SVG from4813fd8, kept test-only so an arrival/proposal comparison
// does not depend on ignored local files or alter the product's public assets.
const arrivalWordmark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 234 64" role="img" aria-label="PACHI"><title>PACHI — architectural wordmark proposal</title><g fill="#142D30"><path fill-rule="evenodd" d="M5 8h22c14 0 22 7 22 19S41 46 27 46H16v12H5V8Zm11 10v18h10c8 0 12-3 12-9s-4-9-12-9H16Z"/><path fill-rule="evenodd" d="M57 58 77 8h12l21 50H98l-5-13H73l-5 13H57Zm20-23h12l-6-16-6 16Z"/><path d="M151 18c-4-6-10-11-19-11-15 0-26 11-26 26s11 26 26 26c9 0 15-4 20-11l-9-6c-3 4-6 6-11 6-9 0-15-6-15-15s6-15 15-15c5 0 8 2 11 6l8-6ZM162 8h11v19h22V8h11v50h-11V38h-22v20h-11V8ZM219 8h11v50h-11V8Z"/></g><path d="M78 58V45l6-7 7 7v13h-5V47h-3v11Z" fill="#BE7651"/></svg>';

test('Lovable owner concept, arrival wordmark and derived proposal compare at real sizes', async ({ page }, testInfo) => {
  await marketplaceFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const sources = [
    { id: 'owner', label: 'Supplied owner concept', svg: readFileSync(join(process.cwd(), '../../docs/design/assets/pachi-wordmark-concept.svg'), 'utf8') },
    { id: 'arrival', label: 'Arrival runtime ·4813fd8', svg: arrivalWordmark },
    { id: 'proposal', label: 'Derived proposal ·approval pending', svg: readFileSync(join(process.cwd(), 'public/brand/pachi-wordmark.svg'), 'utf8') },
  ];
  await page.route('**/__test__/logo-comparison/*', route => {
    const [id, treatment] = new URL(route.request().url()).pathname.split('/').at(-1)!.split('-');
    const source = sources.find(item => item.id === id);
    if (!source) return route.fulfill({ status: 404, body: '' });
    const svg = treatment === 'dark' ? source.svg.replaceAll('#142D30', '#FFFFFF') : treatment === 'mono' ? source.svg.replaceAll('#BE7651', '#142D30') : source.svg;
    return route.fulfill({ contentType: 'image/svg+xml', body: svg });
  });
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  const boards = ['light', 'dark', 'mono'].map(treatment => `<section class="surface ${treatment}"><h2>${treatment} ·native geometry / test-only colour treatment</h2><div class="columns">${sources.map(source => `<div><h3>${source.label}</h3>${[148, 117, 24, 32, 48].map(width => `<div class="sample"><span>${width}px wide</span><img src="${origin}/__test__/logo-comparison/${source.id}-${treatment}" width="${width}" alt="${source.label},${width}px"></div>`).join('')}</div>`).join('')}</div></section>`).join('');
  await page.setContent(`<html lang="en"><head><title>TEST PACHI owner logo comparison</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#f6f8f6;color:#142d30;font:15px/1.5 system-ui}h1{margin:0 0 8px}h2{font-size:18px}h3{font-size:16px}.surface{padding:24px;background:#fff;border:1px solid #d8e2dd;margin-top:20px}.dark{background:#142d30;color:#fff}.columns{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.sample{display:flex;align-items:center;gap:24px;min-height:56px}.sample span{width:95px;font-size:13px}img{display:block;height:auto;max-width:100%}</style></head><body><h1>TEST ·PACHI logo comparison</h1><p>Owner concept, pinned arrival runtime and directly derived proposal. No logo selection is approved. All concept/arrival routes exist only inside this intercepted test.</p>${boards}</body></html>`);
  const images = page.locator('img');
  for (let index = 0; index < await images.count(); index++) await expect.poll(() => images.nth(index).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await capture(page, testInfo, 'logo-owner-arrival-proposal');
  await page.setViewportSize({ width: 1440, height: 300 });
  await page.setContent(`<html lang="en"><head><title>TEST PACHI header logo comparison</title><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#fff;color:#142d30;font:14px/1.4 system-ui}h1{font-size:20px;margin:0 0 6px}p{font-size:13px;margin:0 0 18px}.columns{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}h2{font-size:15px;margin:0 0 10px}.sample{display:flex;gap:20px;align-items:center;min-height:54px}.sample span{width:90px;font-size:13px}img{display:block;height:auto}</style></head><body><h1>TEST · PACHI header-size logo comparison · owner selection pending</h1><p>Supplied owner concept and derived proposal are unapproved. Native SVG geometry at actual desktop148px / mobile117px widths; test-only comparison.</p><div class="columns">${sources.map(source => `<section><h2>${source.label}</h2>${[148, 117].map(width => `<div class="sample"><span>${width}px wide</span><img src="${origin}/__test__/logo-comparison/${source.id}-light" width="${width}" alt="${source.label},${width}px"></div>`).join('')}</section>`).join('')}</div></body></html>`);
  const compactImages = page.locator('img');
  for (let index = 0; index < await compactImages.count(); index++) await expect.poll(() => compactImages.nth(index).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await capture(page, testInfo, 'logo-comparison-header');
});
