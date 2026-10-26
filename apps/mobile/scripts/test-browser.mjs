import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstListingId, privateAddressCanary, startPreview } from './preview-fixtures.mjs';

// Reuse the repository's installed Playwright. No production mobile dependency
// and no browser-context request interception is needed for the core journeys.
const mobileDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireWeb = createRequire(resolve(mobileDirectory, '../web/package.json'));
const { chromium, expect } = requireWeb('@playwright/test');
const evidenceDirectory = resolve(process.env.PACHI_MOBILE_EVIDENCE_DIR ?? resolve(mobileDirectory, '../../.local-dev/g3i2-native-browser'));
await mkdir(evidenceDirectory, { recursive: true });
const port = Number(process.env.PACHI_MOBILE_PREVIEW_PORT ?? 8085);
const preview = await startPreview({ port, fixturePort: null, directory: process.env.PACHI_MOBILE_EXPORT_DIRECTORY });
const base = `http://localhost:${preview.port}`;
let browser;
try { browser = await chromium.launch({ headless: true }); }
catch (error) { await preview.close(); throw error; }
const receipts = [];
const fixtureTitle = 'TEST · Bright apartment in Akwa';
const byCard = page => page.getByRole('link', { name: new RegExp(fixtureTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
const cardLinks = page => page.getByRole('link', { name: /TEST ·/ });
const findHome = page => page.getByRole('button', { name: 'Find a home', exact: true });
const city = page => page.getByLabel('City or municipality', { exact: true });
const resultsHeading = page => page.getByRole('heading', { name: 'Find your next place.', exact: true });
const frenchToggle = page => page.getByRole('button', { name: 'Switch to French', exact: true });
const englishToggle = page => page.getByRole('button', { name: 'Passer en anglais', exact: true });
async function choose(page, label, option) {
  await page.getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole('radio', { name: option, exact: true }).click();
}
async function filters(page) { await page.getByRole('button', { name: /^Filters(?:\b|$)/ }).click(); }
async function capture(page, filename) {
  // Let the native-stack commit its resting frame before freezing screenshots.
  // This is visual capture settling; functional assertions do not depend on it.
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)));
    await Promise.all(document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)));
    // Expo native-stack transitions can move an otherwise "visible" heading.
    // Wait for control geometry to settle before evaluating the composition.
    await new Promise(resolveStable => {
      const deadline = performance.now() + 2000;
      let previous = '', stableFrames = 0;
      const sample = () => {
        const signature = [...document.querySelectorAll('[role="button"], [role="heading"]')].map(element => {
          const rect = element.getBoundingClientRect();
          return `${rect.x.toFixed(1)},${rect.y.toFixed(1)},${rect.width.toFixed(1)},${rect.height.toFixed(1)}`;
        }).join(';');
        stableFrames = signature === previous ? stableFrames + 1 : 0;
        previous = signature;
        if (stableFrames >= 5 || performance.now() >= deadline) resolveStable();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  });
  await page.screenshot({ path: resolve(evidenceDirectory, `${filename}.png`), fullPage: true, animations: 'disabled' });
  // React Native ScrollView can scroll within the viewport rather than expand
  // the document. Retain a second lower view instead of calling that one frame
  // a full-page mobile capture.
  const scrolled = await page.evaluate(() => {
    const container = [...document.querySelectorAll('*')].find(element => {
      const style = getComputedStyle(element);
      return ['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 100;
    });
    if (!container) return false;
    container.scrollTop = container.scrollHeight;
    return true;
  });
  if (scrolled) {
    await page.screenshot({ path: resolve(evidenceDirectory, `${filename}-lower.png`), fullPage: true });
    await page.evaluate(() => { for (const element of document.querySelectorAll('*')) if (element.scrollTop) element.scrollTop = 0; });
  }
}

async function check(name, width, scenario, action) {
  preview.setScenario(scenario);
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: 'reduce', locale: 'en-GB' });
  const page = await context.newPage();
  const errors = [];
  const consoleErrors = [];
  const responseFailures = [];
  const accountRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) responseFailures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  page.on('request', request => {
    if (/\/(?:account|auth|session|inquir)/.test(new URL(request.url()).pathname)) accountRequests.push(request.url());
  });
  try {
    await action(page, context);
    assert.deepEqual(errors, [], 'No unhandled browser/hydration error');
    assert.deepEqual(consoleErrors.filter(message => !/^Failed to load resource:/.test(message)), [], 'No application console errors');
    if (scenario === 'normal' && !name.startsWith('unavailable detail')) assert.deepEqual(responseFailures, [], 'Normal navigation has no failing HTTP resources');
    assert.deepEqual(accountRequests, [], 'Public discovery must not call account/auth/mutation endpoints');
    await expect(page.getByText(privateAddressCanary, { exact: false })).toHaveCount(0);
    await expect(page.getByText('SYNTHETIC_INTERNAL_ERROR_DO_NOT_RENDER', { exact: false })).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'No horizontal overflow');
    receipts.push({ name, width, scenario, status: 'PASS', browser: 'Chromium / Expo web', context: 'fresh', request_interception: false, browser_errors: errors, application_console_errors: consoleErrors.filter(message => !/^Failed to load resource:/.test(message)) });
    process.stdout.write(`PASS ${width}px ${name}\n`);
  } catch (error) {
    const file = `${name.replace(/[^a-z0-9]+/gi, '-')}-${width}-failure.png`;
    await page.screenshot({ path: resolve(evidenceDirectory, file), fullPage: true }).catch(() => undefined);
    receipts.push({ name, width, scenario, status: 'FAIL', error: String(error), browser_errors: errors, console_errors: consoleErrors, http_failures: responseFailures, screenshot: file });
    process.stderr.write(`FAIL ${width}px ${name}: ${error}\n`);
  } finally {
    await context.close();
  }
}

try {
  for (const width of [390, 768, 1440]) {
    await check('connected home results details and browser history', width, 'normal', async page => {
      await page.goto(base);
      await expect(findHome(page)).toBeVisible();
      await expect(page.getByText(/synthetic TEST/i).first()).toBeVisible();
      await expect(byCard(page)).toBeVisible();
      await capture(page, `homepage-${width}`);
      await byCard(page).click();
      await expect(page).toHaveURL(new RegExp(`/listings/${firstListingId}`));
      await expect(page.getByRole('heading', { name: fixtureTitle, exact: true })).toBeVisible();
      await page.goBack();
      await expect(findHome(page)).toBeVisible();
      await city(page).fill('Douala');
      await findHome(page).click();
      await expect(resultsHeading(page)).toBeVisible();
      await expect(page).toHaveURL(/city=Douala/);
      await expect(byCard(page)).toBeVisible();
      await capture(page, `results-${width}`);
      const searchURL = page.url();
      await byCard(page).click();
      await expect(page.getByRole('heading', { name: fixtureTitle, exact: true })).toBeVisible();
      await capture(page, `detail-${width}`);
      await page.goBack();
      await expect(page).toHaveURL(searchURL);
      await expect(byCard(page)).toBeVisible();
      await page.goForward();
      await expect(page.getByRole('heading', { name: fixtureTitle, exact: true })).toBeVisible();
      const back = page.getByRole('button', { name: /Back to results|Back to search|Back/, exact: false }).first();
      await back.click();
      await expect(resultsHeading(page)).toBeVisible();
      await expect(page).toHaveURL(/city=Douala/);
    });
    await check('pagination keeps applied search state', width, 'normal', async page => {
      await page.goto(`${base}/listings`);
      await expect(cardLinks(page)).toHaveCount(2);
      await page.getByRole('button', { name: 'Load more listings', exact: true }).click();
      await expect(cardLinks(page)).toHaveCount(4);
      await page.getByRole('button', { name: 'Load more listings', exact: true }).click();
      await expect(cardLinks(page)).toHaveCount(6);
      await expect(page.getByRole('button', { name: 'Load more listings', exact: true })).toHaveCount(0);
      const ids = await cardLinks(page).allTextContents();
      assert.equal(new Set(ids).size, 6, 'Pagination never duplicates cards');
    });
    await check('structured filters and sorting use public contract values', width, 'normal', async page => {
      await page.goto(`${base}/listings`);
      await expect(cardLinks(page)).toHaveCount(2);
      await choose(page, 'Sort by', 'Price: low to high');
      await expect(cardLinks(page).first()).toHaveAccessibleName(/Furnished short stay/);
      await expect(page).toHaveURL(/sort=price_asc/);
      await filters(page);
      await choose(page, 'Purpose', 'Rent');
      await choose(page, 'Region', 'Southwest');
      await choose(page, 'Property type', 'Apartment');
      await city(page).fill('Buea');
      await page.getByLabel('Neighborhood or area', { exact: true }).fill('Bokwango');
      await page.getByLabel('Minimum price (XAF)', { exact: true }).fill('100000');
      await page.getByLabel('Maximum price (XAF)', { exact: true }).fill('150000');
      await page.getByLabel('Minimum bedrooms', { exact: true }).fill('2');
      await page.getByLabel('Minimum bathrooms', { exact: true }).fill('1');
      await choose(page, 'Furnishing', 'Unfurnished');
      await page.getByLabel('Available from', { exact: true }).fill('2026-10-20');
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
      await expect(cardLinks(page)).toHaveCount(1);
      await expect(cardLinks(page).first()).toHaveAccessibleName(/Calm apartment in Buea/);
      const current = new URL(page.url());
      for (const [key, value] of Object.entries({ city: 'Buea', neighborhood: 'Bokwango', purpose: 'RENT', region: 'Southwest', property_type: 'APARTMENT', min_price: '100000', max_price: '150000', min_bedrooms: '2', min_bathrooms: '1', furnishing: 'UNFURNISHED', available_from: '2026-10-20', sort: 'price_asc' })) assert.equal(current.searchParams.get(key), value, `Applied ${key} persists in navigation`);
      await cardLinks(page).first().click();
      await expect(page.getByRole('heading', { name: 'TEST · Calm apartment in Buea', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page).toHaveURL(current.toString());
      await expect(cardLinks(page)).toHaveCount(1);
      await capture(page, `results-filtered-${width}`);
    });
    await check('localized French navigation and controls', width, 'normal', async page => {
      await page.goto(base);
      await expect(findHome(page)).toBeVisible();
      await frenchToggle(page).click();
      await expect(page.getByRole('button', { name: 'Find a home', exact: true })).toHaveCount(0);
      await expect(englishToggle(page)).toBeVisible();
      await expect(cardLinks(page).first()).toBeVisible();
      await capture(page, `homepage-fr-${width}`);
      await cardLinks(page).first().click();
      await expect(page.getByRole('heading', { name: fixtureTitle, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Caractéristiques du bien', exact: true })).toBeVisible();
      await expect(englishToggle(page)).toBeVisible();
      await capture(page, `detail-fr-${width}`);
      await page.getByRole('button', { name: 'Retour', exact: true }).click();
      await englishToggle(page).click();
      await expect(frenchToggle(page)).toBeVisible();
    });
  }
  for (const width of [320, 390, 768, 899, 900, 1440]) {
    for (const locale of ['en', 'fr']) {
      await check(`pricing card preserves localized rent sale and short-let terms (${locale})`, width, 'normal', async page => {
        const examples = [
          { id: firstListingId, purpose: 'rent', amount: 200000, period: ['per month', 'par mois'], negotiable: false },
          { id: '00000000-0000-4000-8000-000000000171', purpose: 'sale', amount: 65000000, period: ['total price', 'prix total'], negotiable: true },
          { id: '00000000-0000-4000-8000-000000000161', purpose: 'short-let', amount: 35000, period: ['per night', 'par nuit'], negotiable: false },
        ];
        for (const example of examples) {
          await page.goto(`${base}/listings/${example.id}`);
          if (locale === 'fr') await frenchToggle(page).click();
          const card = page.getByTestId('listing-price-card');
          await expect(card).toHaveCount(1);
          await expect(card.getByText(locale === 'fr' ? 'Prix demandé' : 'Asking price', { exact: true })).toBeVisible();
          const amount = card.getByTestId('listing-price-amount');
          const formatted = new Intl.NumberFormat(locale === 'fr' ? 'fr-CM' : 'en-CM', { maximumFractionDigits: 0 }).format(example.amount);
          await expect(amount).toHaveText(`${formatted} XAF`);
          const period = card.getByText(example.period[locale === 'fr' ? 1 : 0], { exact: true });
          await expect(period).toBeVisible();
          await expect(card.getByText(locale === 'fr' ? 'Prix négociable' : 'Price negotiable', { exact: true })).toHaveCount(example.negotiable ? 1 : 0);
          await expect(card.getByText(locale === 'fr' ? 'Disponible' : 'Available', { exact: true })).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await card.scrollIntoViewIfNeeded();
          const presentation = await card.evaluate(element => {
            const amountElement = element.querySelector('[data-testid="listing-price-amount"]');
            const currency = element.querySelector('[data-testid="listing-price-currency"]');
            const cardBox = element.getBoundingClientRect();
            const amountStyle = getComputedStyle(amountElement), currencyStyle = getComputedStyle(currency);
            const range = document.createRange(); range.selectNodeContents(amountElement);
            return {
              background: getComputedStyle(element).backgroundColor,
              amountSize: parseFloat(amountStyle.fontSize), currencySize: parseFloat(currencyStyle.fontSize),
              currencyText: currency.textContent, currencyColor: currencyStyle.color,
              unclipped: amountElement.scrollWidth <= amountElement.clientWidth + 1 && [...range.getClientRects()].every(rect => rect.left >= cardBox.left && rect.right <= cardBox.right),
              withinViewport: cardBox.left >= 0 && cardBox.right <= innerWidth,
            };
          });
          assert.equal(presentation.background, 'rgb(255, 255, 255)', 'Reference pricing card has a light surface');
          assert.ok(presentation.currencySize < presentation.amountSize / 2, 'Currency is secondary to the amount');
          assert.equal(presentation.currencyText.trim(), 'XAF');
          assert.equal(presentation.currencyColor, 'rgb(14, 59, 46)', 'Currency remains readable on the light surface');
          assert.ok(presentation.unclipped && presentation.withinViewport, 'Complete localized amount fits without clipping or horizontal overflow');
          const periodSize = await period.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
          assert.ok(periodSize < presentation.amountSize, 'Billing period is visually secondary');
          const cardBox = await card.boundingBox();
          const headingBox = await page.getByRole('heading', { name: locale === 'fr' ? 'Découvrez ce bien' : 'A closer look', exact: true }).boundingBox();
          assert.ok(cardBox && headingBox);
          assert.ok(width >= 900 ? cardBox.x > headingBox.x + 100 : Math.abs(cardBox.x - headingBox.x) < 2, 'Pricing retains the mobile column and wide sidebar placement');
          await card.screenshot({ path: resolve(evidenceDirectory, `pricing-${example.purpose}-${width}-${locale}.png`), animations: 'disabled' });
          await page.screenshot({ path: resolve(evidenceDirectory, `detail-pricing-${example.purpose}-${width}-${locale}.png`), animations: 'disabled' });
        }
      });
    }
  }
  await check('search network failure recovers without leaking server error', 390, 'fail-once', async page => {
    await page.goto(`${base}/listings`);
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    await expect(cardLinks(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(cardLinks(page)).toHaveCount(2);
  });
  await check('pagination failure preserves cards and retries the same cursor once', 390, 'page-fail-once', async page => {
    await page.goto(`${base}/listings?purpose=RENT`);
    await expect(cardLinks(page)).toHaveCount(2);
    const before = preview.requests.length;
    await page.getByRole('button', { name: 'Load more listings', exact: true }).evaluate(button => { button.click(); button.click(); });
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    await expect(cardLinks(page)).toHaveCount(2);
    assert.equal(preview.requests.slice(before).filter(request => new URLSearchParams(request.query).has('cursor')).length, 1, 'Duplicate taps send one page request');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(cardLinks(page)).toHaveCount(3);
    const pageReads = preview.requests.slice(before).filter(request => new URLSearchParams(request.query).has('cursor'));
    assert.equal(pageReads.length, 2);
    assert.ok(pageReads.every(request => new URLSearchParams(request.query).get('cursor') === 'test-offset-2' && new URLSearchParams(request.query).get('purpose') === 'RENT'));
  });
  await check('invalid direct query renders correction without a failing request', 390, 'normal', async page => {
    const before = preview.requests.length;
    await page.goto(`${base}/listings?max_price=1.5`);
    await expect(page.getByRole('heading', { name: 'Check your filters', exact: true })).toBeVisible();
    await expect(cardLinks(page)).toHaveCount(0);
    assert.equal(preview.requests.slice(before).filter(request => request.path === '/v1/public/listings').length, 0, 'Invalid query is rejected before sending public discovery');
    await capture(page, 'results-invalid-query-390');
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page).not.toHaveURL(/max_price=/);
    await expect(cardLinks(page)).toHaveCount(2);
  });
  await check('sort and chip actions safely retain invalid filter correction', 390, 'normal', async page => {
    const before = preview.requests.length;
    await page.goto(`${base}/listings?city=Douala&max_price=1.5`);
    await expect(page.getByRole('heading', { name: 'Check your filters', exact: true })).toBeVisible();
    await choose(page, 'Sort by', 'Price: high to low');
    await expect(page.getByRole('heading', { name: 'Make room for your needs.', exact: true })).toBeVisible();
    await expect(page.getByLabel('Maximum price (XAF)', { exact: true })).toHaveValue('1.5');
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(page.getByText('Enter a whole, non-negative number.', { exact: true }).last()).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    // Modal dismissal commits asynchronously; await removal before using page controls.
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove filter: Douala', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Make room for your needs.', exact: true })).toBeVisible();
    await expect(page.getByLabel('Maximum price (XAF)', { exact: true })).toHaveValue('1.5');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0);
    assert.equal(preview.requests.slice(before).filter(request => request.path === '/v1/public/listings').length, 0, 'Invalid sort/chip actions do not issue discovery');
    await expect(page.getByRole('heading', { name: 'Check your filters', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page).toHaveURL(`${base}/listings`);
    await expect(cardLinks(page)).toHaveCount(2);
  });
  await check('narrow 320px screens retain connected touch navigation', 320, 'normal', async page => {
    await page.goto(base);
    await expect(findHome(page)).toBeVisible();
    await capture(page, 'homepage-320');
    await city(page).fill('Douala');
    await findHome(page).click();
    await expect(byCard(page)).toBeVisible();
    await capture(page, 'results-320');
    await byCard(page).click();
    await expect(page.getByRole('heading', { name: fixtureTitle, exact: true })).toBeVisible();
    await capture(page, 'detail-320');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page).toHaveURL(/city=Douala/);
  });
  await check('a superseded slow search cannot overwrite a newer search', 390, 'slow-douala', async page => {
    await page.goto(`${base}/listings`);
    await expect(cardLinks(page)).toHaveCount(2);
    await filters(page);
    await city(page).fill('Douala');
    const oldRequest = page.waitForRequest(request => request.url().includes('/public/listings?') && new URL(request.url()).searchParams.get('city') === 'Douala');
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await oldRequest;
    await filters(page);
    await city(page).fill('Buea');
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(cardLinks(page)).toHaveCount(2);
    await expect(cardLinks(page).first()).toHaveAccessibleName(/Furnished short stay/);
    // Wait for the fixture's controlled older response, then assert final state.
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/city=Buea/);
    await expect(byCard(page)).toHaveCount(0);
    await expect(cardLinks(page).last()).toHaveAccessibleName(/Calm apartment in Buea/);
  });
  await check('detail network failure can be retried', 390, 'detail-fail-once', async page => {
    await page.goto(`${base}/listings/${firstListingId}`);
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('heading', { name: fixtureTitle, exact: true })).toBeVisible();
  });
  await check('sale detail renders total XAF terms without rental or booking fields', 390, 'normal', async page => {
    await page.goto(`${base}/listings/00000000-0000-4000-8000-000000000171`);
    await expect(page.getByRole('heading', { name: 'TEST · Family home for sale', exact: true })).toBeVisible();
    await expect(page.getByText('65,000,000 XAF', { exact: true })).toBeVisible();
    await expect(page.getByText('total price', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Offering details', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rental terms', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Stay details', exact: true })).toHaveCount(0);
  });
  await check('short let detail renders nightly price and commercial terms', 390, 'normal', async page => {
    await page.goto(`${base}/listings/00000000-0000-4000-8000-000000000161`);
    await expect(page.getByRole('heading', { name: 'TEST · Furnished short stay in Molyko', exact: true })).toBeVisible();
    await expect(page.getByText('35,000 XAF', { exact: true })).toBeVisible();
    await expect(page.getByText('per night', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stay details', exact: true })).toBeVisible();
    await expect(page.getByText('2 nights', { exact: true })).toBeVisible();
    await expect(page.getByText('14:00', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rental terms', exact: true })).toHaveCount(0);
  });
  await check('reputation failure leaves detail available and never fabricates an aggregate', 390, 'reviews-unavailable', async page => {
    await page.goto(`${base}/listings/${firstListingId}`);
    await expect(page.getByRole('heading', { name: fixtureTitle, exact: true })).toBeVisible();
    await expect(page.getByText('Published reputation is temporarily unavailable.', { exact: true })).toBeVisible();
    await expect(page.getByText('0 eligible published reviews', { exact: true })).toHaveCount(0);
    preview.setScenario('normal');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('0 eligible published reviews', { exact: true })).toBeVisible();
    await expect(page.getByText('An average appears after 3 eligible published reviews.', { exact: true })).toBeVisible();
  });
  await check('gallery supports distinct photographs and full-screen navigation', 390, 'normal', async page => {
    await page.goto(`${base}/listings/${firstListingId}`);
    await expect(page.getByText('Photo 1 of 3', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next photo', exact: true }).click();
    await expect(page.getByText('Photo 2 of 3', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Select photo 3', exact: true }).click();
    await expect(page.getByText('Photo 3 of 3', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open full-screen photo gallery', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close photo gallery', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Previous photo', exact: true }).click();
    await expect(dialog.getByText('Photo 2 of 3', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close photo gallery', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close photo gallery', exact: true })).toHaveCount(0);
    await expect(page.getByText('Photo 2 of 3', { exact: true })).toBeVisible();
  });
  await check('empty inventory remains distinct from network failure', 390, 'empty', async page => {
    await page.goto(`${base}/listings`);
    await expect(page.getByText(/No (?:listings|places|homes)|no (?:listings|places|homes)/).first()).toBeVisible();
    await expect(cardLinks(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
    await page.screenshot({ path: resolve(evidenceDirectory, 'results-empty-390.png'), fullPage: true });
  });
  await check('unavailable detail is not presented as a connection failure', 390, 'normal', async page => {
    await page.goto(`${base}/listings/00000000-0000-4000-8000-000000000999`);
    await expect(page.getByText(/no longer available|not available|unavailable/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  });
  await check('failed derivative retains useful gallery feedback', 390, 'broken-images', async page => {
    await page.goto(`${base}/listings/${firstListingId}`);
    await expect(page.getByRole('heading', { name: fixtureTitle, exact: true })).toBeVisible();
    await expect(page.getByText(/photo.*(?:load|unavailable)|(?:load|unavailable).*photo/i).first()).toBeVisible();
    await page.screenshot({ path: resolve(evidenceDirectory, 'detail-image-failure-390.png'), fullPage: true });
  });
  await check('no photo listing has a deliberate empty gallery', 390, 'missing-photos', async page => {
    await page.goto(`${base}/listings/${firstListingId}`);
    await expect(page.getByRole('heading', { name: fixtureTitle, exact: true })).toBeVisible();
    await expect(page.getByText(/No photo|Photos.*not available/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Next photo/i })).toHaveCount(0);
  });
  await check('keyboard controls are labelled and touch targets meet 44px', 390, 'normal', async page => {
    await page.goto(base);
    await expect(findHome(page)).toBeVisible();
    await city(page).focus();
    await expect(city(page)).toBeFocused();
    const box = await findHome(page).boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44, 'Primary action meets 44px touch target');
    const unlabeled = await page.getByRole('button').evaluateAll(elements => elements.filter(element => !element.getAttribute('aria-label') && !element.textContent?.trim()).length);
    assert.equal(unlabeled, 0, 'No unlabeled buttons');
    await page.keyboard.press('Tab');
    const focusVisible = await page.evaluate(() => document.activeElement && document.activeElement !== document.body);
    assert.ok(focusVisible, 'Keyboard focus remains in labelled controls');
    await byCard(page).focus();
    await expect(byCard(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: fixtureTitle, exact: true })).toBeVisible();
  });
} finally {
  await browser.close();
  await preview.close();
  const receipt = { provenance: 'isolated synthetic TEST inventory; Expo web exported React Native screens', native_device_acceptance: 'NOT RUN', database: 'not connected', browser_request_interception: false, checks: receipts, passed: receipts.filter(item => item.status === 'PASS').length, failed: receipts.filter(item => item.status === 'FAIL').length };
  await writeFile(resolve(evidenceDirectory, 'browser-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
}
if (receipts.some(item => item.status === 'FAIL')) process.exitCode = 1;
