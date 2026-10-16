import { expect, test, type Page } from '@playwright/test';
import { marketplaceFixture, privateAddressCanary, testListing } from './fixtures/marketplace';

const detailPath = `/listings/${testListing.id}`;
const detailEndpoint = `/api/public/listings/${testListing.id}`;
const failureText = 'Contact could not be confirmed. Try again.';

async function eligibleFixture(page: Page) {
  await marketplaceFixture(page);
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, participationAllowed: true, csrfToken: 'synthetic-marketplace-csrf' } }));
  await page.route('**/api/account/listings/*/contact-safety', route => route.fulfill({ status: 503, json: {} }));
}

function barrier() {
  let release!: () => void;
  let arrived!: () => void;
  return { pending: new Promise<void>(resolve => { release = resolve; }), started: new Promise<void>(resolve => { arrived = resolve; }), release: () => release(), arrive: () => arrived() };
}

test('listing photos support thumbnail selection, arrow keys and Home/End', async ({ page }) => {
  await marketplaceFixture(page);
  await page.goto(detailPath);
  const gallery = page.getByRole('region', { name: 'Listing photos', exact: true });
  await expect(gallery.getByText('Photo 1 of 3', { exact: true })).toBeVisible();
  await expect.poll(() => gallery.locator('.galleryMainImage').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await gallery.getByRole('button', { name: 'Show photo 3', exact: true }).click();
  await expect(gallery.getByRole('button', { name: 'Show photo 3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(gallery.locator('.galleryMainImage')).toHaveAttribute('src', new RegExp(`${testListing.media[2]!.id}/variants/1280$`));
  await gallery.locator('.galleryStage').focus();
  await page.keyboard.press('Home');
  await expect(gallery.getByText('Photo 1 of 3', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(gallery.getByText('Photo 2 of 3', { exact: true })).toBeVisible();
  await page.keyboard.press('End');
  await expect(gallery.getByText('Photo 3 of 3', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(gallery.getByText('Photo 2 of 3', { exact: true })).toBeVisible();
  await gallery.getByRole('button', { name: 'Show photo 1', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(gallery.getByRole('button', { name: 'Show photo 2', exact: true })).toBeFocused();
  await expect(page.getByText(privateAddressCanary)).toHaveCount(0);
  await expect(page.locator('.detailDescription')).toHaveCSS('white-space', 'pre-wrap');
});

test('a broken listing derivative gives useful feedback and another real photo still opens', async ({ page }) => {
  await marketplaceFixture(page);
  await page.route(`**${detailEndpoint}/media/${testListing.media[1]!.id}/variants/*`, route => route.fulfill({ status: 404, contentType: 'text/plain', body: '' }));
  await page.goto(detailPath);
  const gallery = page.getByRole('region', { name: 'Listing photos', exact: true });
  await gallery.getByRole('button', { name: 'Next photo', exact: true }).click();
  await expect(gallery.getByText('This photo couldn’t be loaded.', { exact: true })).toBeVisible();
  await expect(gallery.locator('.galleryMainImage')).toHaveCount(0);
  await gallery.getByRole('button', { name: 'Next photo', exact: true }).click();
  await expect(gallery.locator('.galleryMainImage')).toHaveAttribute('src', new RegExp(`${testListing.media[2]!.id}/variants/1280$`));
  await expect.poll(() => gallery.locator('.galleryMainImage').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(gallery.getByText('This photo couldn’t be loaded.', { exact: true })).toHaveCount(0);
});

test('a single broken photograph does not offer absent gallery navigation', async ({ page }) => {
  await marketplaceFixture(page, [{ ...testListing, media: [testListing.media[0]!] }]);
  await page.route(`**${detailEndpoint}/media/*/variants/*`, route => route.fulfill({ status: 404, contentType: 'text/plain', body: '' }));
  await page.goto(detailPath);
  const gallery = page.getByRole('region', { name: 'Listing photos', exact: true });
  await expect(gallery.getByText('This photo couldn’t be loaded.', { exact: true })).toBeVisible();
  await expect(gallery.getByRole('button')).toHaveCount(0);
  await expect(gallery.getByText('Select another photo to keep exploring.')).toHaveCount(0);
});

test('unavailable listings and API outages stay distinct, and an outage can be retried', async ({ page }) => {
  await marketplaceFixture(page);
  let status = 404;
  let reads = 0;
  await page.route(`**${detailEndpoint}`, route => {
    reads++;
    return route.fulfill({ status, json: status === 200 ? testListing : { message: privateAddressCanary } });
  });
  await page.goto(detailPath);
  await expect(page.getByRole('heading', { name: 'This listing is no longer available.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  status = 503;
  await page.goto(detailPath);
  await expect(page.getByRole('heading', { name: 'We couldn’t load this listing.', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This listing is no longer available.', exact: true })).toHaveCount(0);
  await expect(page.getByText(privateAddressCanary)).toHaveCount(0);
  status = 200;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: testListing.title, exact: true })).toBeVisible();
  expect(reads).toBe(3);
});

test('a failed session read keeps contact safe without inquiry or sign-in navigation', async ({ page }) => {
  await marketplaceFixture(page);
  let inquiries = 0;
  let signIns = 0;
  await page.route('**/api/session', route => route.fulfill({ status: 503, json: { authenticated: false, message: privateAddressCanary } }));
  await page.route('**/api/account/listings/*/inquiry', route => { inquiries++; return route.fulfill({ status: 403, json: {} }); });
  await page.route('**/api/auth/login**', route => { signIns++; return route.fulfill({ contentType: 'text/html', body: 'Synthetic sign-in' }); });
  await page.goto(detailPath);
  await page.getByRole('button', { name: 'Contact provider', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: failureText })).toHaveText(failureText);
  await expect(page.getByRole('button', { name: 'Contact provider', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
  expect(inquiries).toBe(0);
  expect(signIns).toBe(0);
  await expect(page.getByText(privateAddressCanary)).toHaveCount(0);
});

test('rapid contact clicks send one inquiry until its result is confirmed', async ({ page }) => {
  await eligibleFixture(page);
  const hold = barrier();
  let inquiries = 0;
  await page.route('**/api/account/listings/*/inquiry', async route => {
    inquiries++;
    hold.arrive();
    await hold.pending;
    return route.fulfill({ status: 403, json: {} });
  });
  await page.goto(detailPath);
  await page.getByRole('button', { name: 'Contact provider', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await hold.started;
  try {
    const busyButton = page.getByRole('button', { name: 'Opening contact…', exact: true });
    await expect(busyButton).toBeDisabled();
    await busyButton.dispatchEvent('click');
    expect(inquiries).toBe(1);
  } finally { hold.release(); }
  await expect(page.getByText('Contact is not available for this listing.', { exact: true })).toBeVisible();
  expect(inquiries).toBe(1);
});

test('retrying an ambiguous inquiry retains the exact CSRF and idempotency context', async ({ page }) => {
  await eligibleFixture(page);
  const keys: string[] = [];
  await page.route('**/api/account/listings/*/inquiry', route => {
    const headers = route.request().headers();
    expect(headers['x-csrf-token']).toBe('synthetic-marketplace-csrf');
    expect(headers['idempotency-key']).toMatch(/^[\da-f-]{36}$/i);
    keys.push(headers['idempotency-key']!);
    return keys.length === 1 ? route.abort('failed') : route.fulfill({ status: 503, json: { message: privateAddressCanary } });
  });
  await page.goto(detailPath);
  await page.getByRole('button', { name: 'Contact provider', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: failureText })).toHaveText(failureText);
  await page.getByRole('button', { name: 'Contact provider', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: failureText })).toHaveText(failureText);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
  await expect(page.getByText(privateAddressCanary)).toHaveCount(0);
});

test('mobile contact gives visible phone eligibility feedback beside the sticky action', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await marketplaceFixture(page);
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, participationAllowed: false, csrfToken: 'synthetic-marketplace-csrf' } }));
  await page.route('**/api/account/listings/*/contact-safety', route => route.fulfill({ status: 503, json: {} }));
  let inquiries = 0;
  await page.route('**/api/account/listings/*/inquiry', route => { inquiries++; return route.fulfill({ status: 403, json: {} }); });
  await page.goto(detailPath);
  await expect(page.getByRole('region', { name: 'Listing photos', exact: true })).toBeInViewport();
  const contact = page.getByRole('button', { name: 'Contact provider', exact: true });
  await expect(contact).toHaveCount(1);
  await expect(contact).toBeInViewport();
  await contact.click();
  const feedback = page.getByRole('status').filter({ hasText: 'Verify your phone before contacting a provider.' });
  await expect(feedback).toHaveCount(1);
  await expect(feedback).toHaveText('Verify your phone before contacting a provider.');
  await expect(page.getByText('Verify your phone before contacting a provider.', { exact: true })).toHaveCount(1);
  await expect(feedback).toBeInViewport();
  const account = page.getByRole('link', { name: 'Go to your account', exact: true });
  await expect(account).toHaveCount(1);
  await expect(account).toHaveAttribute('href', '/account');
  await expect(account).toBeInViewport();
  await expect(contact).toBeInViewport();
  expect(inquiries).toBe(0);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(horizontalOverflow).toBe(false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#desktop-contact-feedback')).toBeVisible();
  await expect(page.locator('#mobile-contact-feedback')).toHaveCount(0);
  await expect(page.getByText('Verify your phone before contacting a provider.', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Go to your account', exact: true })).toHaveCount(1);
});
