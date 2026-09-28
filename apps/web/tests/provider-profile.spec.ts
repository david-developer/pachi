import { expect, test } from '@playwright/test';

test('existing provider can edit and reload profile without claiming readiness', async ({ page }) => {
  let provider = {
    profile_id: 'synthetic-profile', account_id: 'synthetic-account', provider_types: ['OWNER'],
    state: 'DRAFT', verification_status: 'NOT_VERIFIED', display_name: 'Sample provider',
    bio: null as string | null, service_area: 'Littoral' as string | null,
  };
  let saves = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, accountState: 'ACTIVE', participationAllowed: true, csrfToken: 'synthetic-csrf' } });
    if (path === '/api/account/provider') {
      if (route.request().method() === 'POST') {
        expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
        const body = route.request().postDataJSON() as { provider_types: string[]; display_name: string; bio: string; service_area: string };
        expect(body.provider_types).toEqual(['OWNER']);
        provider = { ...provider, display_name: body.display_name, bio: body.bio, service_area: body.service_area };
        saves += 1;
        return route.fulfill({ status: 201, json: provider });
      }
      return route.fulfill({ json: provider });
    }
    throw new Error(`Unexpected synthetic API route: ${path}`);
  });

  await page.goto('/');
  await expect(page.getByText('Sample provider', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Edit provider profile' }).click();
  await expect(page.getByLabel('Public provider name')).toHaveValue('Sample provider');
  await expect(page.getByLabel('Service area')).toHaveValue('Littoral');
  await page.getByLabel('Public provider name').fill('Updated sample provider');
  await page.getByLabel('Provider bio').fill('Synthetic profile description');
  await page.getByRole('button', { name: 'Save provider profile' }).click();
  await expect(page.getByText('Updated sample provider', { exact: false })).toBeVisible();
  expect(saves).toBe(1);
  expect(provider.state).toBe('DRAFT');
  expect(provider.verification_status).toBe('NOT_VERIFIED');

  await page.reload();
  await page.getByRole('button', { name: 'Edit provider profile' }).click();
  await expect(page.getByLabel('Public provider name')).toHaveValue('Updated sample provider');
  await expect(page.getByLabel('Provider bio')).toHaveValue('Synthetic profile description');
});

test('pending capacity is locked and restricted profiles cannot open the edit form', async ({ page }) => {
  let state = 'PENDING_VERIFICATION';
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, accountState: 'ACTIVE', participationAllowed: true, csrfToken: 'synthetic-csrf' } });
    if (path === '/api/account/provider') return route.fulfill({ json: { profile_id: 'synthetic-profile', account_id: 'synthetic-account', provider_types: ['OWNER'], state, verification_status: 'PENDING', display_name: 'Sample provider', bio: null, service_area: null } });
    throw new Error(`Unexpected synthetic API route: ${path}`);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit provider profile' }).click();
  await expect(page.getByLabel('Provider types')).toBeDisabled();
  state = 'RESTRICTED';
  await page.reload();
  await expect(page.getByText('Profile state: RESTRICTED', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit provider profile' })).toHaveCount(0);
});
