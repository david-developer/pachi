import { expect, test } from '@playwright/test';

test('account sign-in preserves its destination and shows safe authentication errors', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: false } }));
  await page.route('**/api/auth/login**', route => route.fulfill({ contentType: 'text/html', body: 'Synthetic sign-in destination' }));
  await page.goto('/account?auth_error=callback');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Authentication could not be completed');
  await page.getByRole('button', { name: 'Continue with Pachi' }).click();
  await expect(page).toHaveURL(/\/api\/auth\/login\?returnTo=\/account$/);
});

test('relocated phone verification and provider onboarding retain CSRF and participation gates', async ({ page }) => {
  const profile = { profile_id: 'synthetic-profile', account_id: 'synthetic-account', provider_types: ['OWNER'], state: 'DRAFT', verification_status: 'NOT_VERIFIED', display_name: 'TEST provider', bio: '', service_area: 'Littoral' };
  let requests = 0;
  let confirmations = 0;
  let onboarding = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, accountState: 'PENDING_PHONE', participationAllowed: false, csrfToken: 'synthetic-csrf' } });
    if (path === '/api/account/provider' && route.request().method() === 'GET') return route.fulfill({ json: { provider: null } });
    expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
    if (path === '/api/account/phone/request') {
      expect(route.request().postDataJSON()).toEqual({ phone: '+237690000001' });
      requests++;
      return route.fulfill({ json: { challengeId: 'synthetic-challenge' } });
    }
    if (path === '/api/account/phone/confirm') {
      expect(route.request().postDataJSON()).toEqual({ phone: '+237690000001', challenge_id: 'synthetic-challenge', code: '123456' });
      confirmations++;
      return route.fulfill({ json: { status: 'ok' } });
    }
    if (path === '/api/account/provider') {
      expect(route.request().postDataJSON()).toEqual({ provider_types: ['OWNER'], display_name: 'TEST provider', bio: '', service_area: 'Littoral' });
      onboarding++;
      return route.fulfill({ status: 201, json: profile });
    }
    throw new Error(`Unexpected synthetic account route: ${path}`);
  });
  await page.goto('/account');
  await expect(page.getByRole('link', { name: 'Your conversations', exact: true })).toHaveAttribute('href', '/conversations');
  await expect(page.getByRole('link', { name: 'Your viewings', exact: true })).toHaveAttribute('href', '/viewings');
  await expect(page.getByRole('button', { name: 'Start provider onboarding' })).toHaveCount(0);
  await page.getByLabel('Cameroon phone number').fill('+237690000001');
  await page.getByRole('button', { name: 'Send verification code' }).click();
  await page.getByLabel('Six-digit code').fill('123456');
  await page.getByRole('button', { name: 'Confirm phone' }).click();
  await expect(page.getByText('Your account is ready for marketplace participation.')).toBeVisible();
  await page.getByLabel('Provider types').selectOption('OWNER');
  await page.getByLabel('Public provider name').fill('TEST provider');
  await page.getByLabel('Service area').fill('Littoral');
  await page.getByRole('button', { name: 'Start provider onboarding' }).click();
  await expect(page.getByRole('link', { name: 'Open provider workspace' })).toHaveAttribute('href', '/provider');
  await expect(page.getByText(/NOT_VERIFIED/)).toBeVisible();
  expect({ requests, confirmations, onboarding }).toEqual({ requests: 1, confirmations: 1, onboarding: 1 });
});

for (const all of [false, true]) test(`account ${all ? 'all-session' : 'current-session'} logout retains CSRF and returns to discovery`, async ({ page }) => {
  let signedOut = false;
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: !signedOut, accountState: 'ACTIVE', participationAllowed: true, csrfToken: 'synthetic-csrf' } }));
  await page.route('**/api/account/provider', route => route.fulfill({ json: { provider: null } }));
  await page.route('**/api/public/listings**', route => route.fulfill({ json: { items: [], next_cursor: null, has_more: false, filters: {} } }));
  await page.route('**/api/auth/logout**', route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
    expect(new URL(route.request().url()).searchParams.get('all')).toBe(all ? 'true' : null);
    signedOut = true;
    return route.fulfill({ json: { status: 'ok' } });
  });
  await page.goto('/account');
  await page.getByRole('button', { name: all ? 'Sign out everywhere' : 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Account', exact: true }).first()).toBeVisible();
  expect(signedOut).toBe(true);
});

test('failed logout remains on account with retry feedback', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, accountState: 'ACTIVE', participationAllowed: true, csrfToken: 'synthetic-csrf' } }));
  await page.route('**/api/account/provider', route => route.fulfill({ json: { provider: null } }));
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 403, json: { error: 'csrf_rejected' } }));
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Sign out could not be confirmed. Please try again.');
  await expect(page).toHaveURL('/account');
});
