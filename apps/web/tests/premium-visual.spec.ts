import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { marketplaceFixture, privateAddressCanary, testListing } from './fixtures/marketplace';

const widths = [1440, 768, 390] as const;
const routes = [
  ['homepage', '/'],
  ['results', '/listings'],
  ['detail', `/listings/${testListing.id}`],
] as const;
const internalErrorCanary = 'TEST_INTERNAL_FAILURE_NEVER_PUBLIC';

async function capture(page: Page, testInfo: TestInfo, name: string, fullPage = true) {
  // Decode lazy photographs and local brand assets before reviewing their layout.
  const images = page.locator('img');
  for (let index = 0; index < await images.count(); index++) await images.nth(index).scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => undefined)));
    window.scrollTo(0, 0);
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await expect(page.locator('body')).not.toContainText(privateAddressCanary);
  await expect(page.locator('body')).not.toContainText(internalErrorCanary);
  const directory = process.env.PACHI_VISUAL_EVIDENCE_DIR;
  if (directory) mkdirSync(directory, { recursive: true });
  const path = directory ? join(directory, `${name}.png`) : testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const width of widths) {
  test(`premium TEST discovery composition at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await marketplaceFixture(page);
    for (const [name, route] of routes) {
      await page.goto(route);
      if (name === 'detail') {
        await expect(page.getByRole('heading', { name: testListing.title, exact: true })).toBeVisible();
        const photo = page.locator('.galleryMainImage');
        await expect.poll(() => photo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await expect(page.getByRole('button', { name: 'Show photo 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
      } else {
        await expect(page.locator('.listingCard').first()).toBeVisible();
        await expect.poll(() => page.locator('.listingCard img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      }
      if (name === 'homepage') {
        const purposeButtons = page.getByRole('group', { name: 'Property purpose', exact: true }).getByRole('button');
        const targets = [page.getByRole('link', { name: 'Pachi home', exact: true }), ...await purposeButtons.all()];
        if (width === 1440) targets.push(...await page.getByRole('navigation', { name: 'Property search', exact: true }).getByRole('link').all());
        for (const target of targets) {
          const bounds = await target.boundingBox();
          expect(bounds?.width).toBeGreaterThanOrEqual(44);
          expect(bounds?.height).toBeGreaterThanOrEqual(44);
        }
      }
      await capture(page, testInfo, `${name}-${width}`);
      if (name === 'detail' && width === 390) {
        await expect(page.getByRole('button', { name: 'Contact provider', exact: true })).toBeInViewport();
        await capture(page, testInfo, 'detail-390-viewport', false);
      }
    }
  });

  test(`premium empty inventory remains honest at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await marketplaceFixture(page, []);
    await page.goto('/');
    await expect(page.getByText('New places will appear here.', { exact: true })).toBeVisible();
    await expect(page.locator('.listingCard')).toHaveCount(0);
    await capture(page, testInfo, `homepage-empty-${width}`);
    await page.goto('/listings');
    await expect(page.getByText('No listings match those filters.', { exact: true })).toBeVisible();
    await expect(page.locator('.listingCard')).toHaveCount(0);
    await capture(page, testInfo, `results-empty-${width}`);
  });

  test(`premium missing media retains discovery and contact at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await marketplaceFixture(page, [{ ...testListing, media: [] }]);
    for (const [name, route] of routes) {
      await page.goto(route);
      if (name === 'detail') {
        await expect(page.getByText('Photos are not available for this listing.', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Contact provider', exact: true })).toBeVisible();
      } else {
        await expect(page.locator('.listingCard').first()).toBeVisible();
        await expect(page.getByText('No photo available', { exact: true })).toBeVisible();
      }
      await capture(page, testInfo, `${name}-missing-media-${width}`);
    }
  });

  test(`premium API failure differs from empty inventory at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await marketplaceFixture(page);
    await page.route('**/api/public/listings**', route => route.fulfill({ status: 503, json: { message: internalErrorCanary } }));
    for (const [name, route] of routes) {
      await page.goto(route);
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
      await expect(page.locator('.listingCard')).toHaveCount(0);
      await expect(page.getByText('New places will appear here.', { exact: true })).toHaveCount(0);
      await expect(page.getByText('No listings match those filters.', { exact: true })).toHaveCount(0);
      await capture(page, testInfo, `${name}-error-${width}`);
    }
  });
}

test('premium discovery retains its essential actions at 320px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await marketplaceFixture(page);
  for (const [name, route] of routes) {
    await page.goto(route);
    if (name === 'detail') {
      await expect(page.getByRole('heading', { name: testListing.title, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Contact provider', exact: true })).toBeInViewport();
    } else {
      await expect(page.locator('.listingCard').first()).toBeVisible();
    }
    await capture(page, testInfo, `${name}-320`);
  }
});

test('premium actions support longer labels and a 200 percent equivalent viewport', async ({ page }, testInfo) => {
  await marketplaceFixture(page);
  for (const width of [390, 720]) {
    // 720 CSS px models a 1440px desktop viewport reflowed at 200% browser zoom.
    // Longer English labels exercise expansion only; no localization is claimed.
    await page.setViewportSize({ width, height: width === 720 ? 450 : 844 });
    for (const [name, route] of routes) {
      await page.goto(route);
      if (name === 'detail') await expect(page.getByRole('heading', { name: testListing.title, exact: true })).toBeVisible();
      else await expect(page.locator('.listingCard').first()).toBeVisible();
      const action = page.getByRole('button', { name: name === 'homepage' ? 'Search properties' : name === 'results' ? 'Apply filters' : 'Contact provider', exact: true });
      await expect(action).toBeVisible();
      const expandedLabel = name === 'homepage' ? 'Search available homes' : name === 'results' ? 'Apply all filters' : 'Contact this provider';
      await action.evaluate((button, label) => { button.textContent = label; }, expandedLabel);
      const expandedAction = page.getByRole('button', { name: expandedLabel, exact: true });
      const bounds = await expandedAction.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      await expandedAction.focus();
      await expect(expandedAction).toBeFocused();
      await capture(page, testInfo, `${name}-${width === 720 ? 'zoom-equivalent-720' : 'expanded-label-390'}`);
      if (name === 'detail' && width === 390) await expect(expandedAction).toBeInViewport();
    }
  }
});

test('premium vector marks remain inspectable at small and large sizes', async ({ page }, testInfo) => {
  await marketplaceFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  const sizes = [24, 32, 48, 144, 300];
  const surfaces = [
    { tone: 'light', mark: 'pachi-mark-light.svg', wordmark: 'pachi-wordmark.svg' },
    { tone: 'dark', mark: 'pachi-mark.svg', wordmark: 'pachi-wordmark-reversed.svg' },
  ];
  const boards = surfaces.map(({ tone, mark, wordmark }) => `<section class="surface ${tone}"><h2>${tone} surface</h2><div class="samples">${sizes.map(size => `<div class="sample"><span class="label">${size}px</span><img src="${origin}/brand/${mark}" width="${size}" height="${size}" alt="PACHI architectural A at ${size}px"><img src="${origin}/brand/${wordmark}" width="${size}" alt="PACHI wordmark at ${size}px"></div>`).join('')}<div class="sample"><span class="label">favicon · 16px / 32px</span><img src="${origin}/icon.svg" width="16" height="16" alt="PACHI favicon at 16px"><img src="${origin}/icon.svg" width="32" height="32" alt="PACHI favicon at 32px"></div></div></section>`).join('');
  await page.setContent(`<html lang="en"><head><title>TEST PACHI vector review</title><style>
    *{box-sizing:border-box}body{margin:0;padding:32px;background:#f6f8f6;color:#142d30;font:16px system-ui}h1{margin-top:0}h2{font-size:18px}.surface{padding:24px;margin-top:20px;border:1px solid #d8e2dd;background:white}.surface.dark{background:#142d30;color:white}.samples{display:flex;gap:32px;align-items:start;flex-wrap:wrap}.sample{display:flex;flex-direction:column;gap:12px;align-items:start}.label{font-size:13px}img{object-fit:contain;max-width:100%}
  </style></head><body><h1>TEST · PACHI vector review</h1><p>Proposed brand assets; owner visual approval pending. Widths shown in CSS pixels. Actual light and reversed SVG variants are rendered without image filters.</p>${boards}<section class="surface"><h2>Monochrome wordmark</h2><img src="${origin}/brand/pachi-wordmark-monochrome.svg" width="300" alt="Monochrome PACHI wordmark at 300px"></section></body></html>`);
  const images = page.locator('img');
  for (let index = 0; index < await images.count(); index++) {
    await expect.poll(() => images.nth(index).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await capture(page, testInfo, 'brand-scale-light-dark');
});
