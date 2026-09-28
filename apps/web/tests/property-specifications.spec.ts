import { expect, test } from '@playwright/test';

test('property specifications preserve failed input, save, reload, and refresh readiness', async ({ page }) => {
  let property = { id: 'synthetic-property', version: 1, property_type: 'HOUSE', region: 'Littoral', city: 'Sample city', neighborhood: 'Sample area', relationship_type: 'OWNER', bedrooms: null as number | null, bathrooms: null, size_sqm: null, furnishing: null };
  let failNextSave = true;
  let successfulSaves = 0;
  const draft = { id: 'synthetic-draft', property_id: property.id, title: 'Synthetic Guest House', purpose: 'RENT', description: 'Sample draft', amount_minor: 1000, pricing_period: 'MONTHLY', currency: 'XAF', publication_status: 'DRAFT', moderation_status: 'NOT_REVIEWED', version: 1, utilities_included: null };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, participationAllowed: true, accountState: 'ACTIVE', csrfToken: 'synthetic-csrf' } });
    if (path === '/api/account/provider/verification') return route.fulfill({ json: { case: null, synthetic_intake_available: false } });
    if (path === '/api/account/properties' && route.request().method() === 'GET') return route.fulfill({ json: { properties: [property] } });
    if (path === `/api/account/properties/${property.id}/specifications` && route.request().method() === 'PATCH') {
      expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
      const body = route.request().postDataJSON() as { expected_version: number; bedrooms: number; bathrooms: null; size_sqm: null; furnishing: null };
      expect(body).toEqual({ expected_version: property.version, bedrooms: 2, bathrooms: null, size_sqm: null, furnishing: null });
      if (failNextSave) { failNextSave = false; return route.fulfill({ status: 409, json: { message: 'Synthetic save failure' } }); }
      property = { ...property, version: property.version + 1, bedrooms: body.bedrooms };
      successfulSaves += 1;
      return route.fulfill({ json: property });
    }
    if (path === '/api/account/listing-drafts') return route.fulfill({ json: { drafts: [draft] } });
    if (path === `/api/account/listing-drafts/${draft.id}`) return route.fulfill({ json: draft });
    if (path === `/api/account/listing-drafts/${draft.id}/media`) return route.fulfill({ json: { media: [] } });
    if (path === `/api/account/listing-drafts/${draft.id}/readiness`) return route.fulfill({ json: { publication_status: 'DRAFT', moderation_status: 'NOT_REVIEWED', can_submit: false, checks: [
      { code: 'PROPERTY_SPECIFICATION_REQUIRED', label: 'Property specifications', status: property.bedrooms === null ? 'BLOCKED' : 'READY', message: property.bedrooms === null ? 'Add a physical specification.' : null },
      { code: 'PROVIDER_NOT_ACTIVE', label: 'Provider profile', status: 'BLOCKED', message: 'Provider not active.' },
      { code: 'PROVIDER_IDENTITY_VERIFICATION_UNAVAILABLE', label: 'Provider identity verification', status: 'BLOCKED', message: 'Verification unavailable.' },
      { code: 'PROPERTY_RISK_HOLD_EVALUATION_UNAVAILABLE', label: 'Authority risk-hold evaluation', status: 'BLOCKED', message: 'Risk hold unavailable.' },
    ] } });
    throw new Error(`Unexpected synthetic API route: ${path}`);
  });

  await page.goto('/provider');
  await page.getByRole('button', { name: /Synthetic Guest House/ }).click();
  const checks = page.locator('.readinessList li');
  await expect(checks.filter({ hasText: 'Property specifications' })).toHaveClass(/readinessBlocked/);
  await page.getByRole('button', { name: 'Edit specifications' }).click();
  const editor = page.getByRole('form', { name: 'Edit property specifications' });
  await editor.getByLabel('Bedrooms').fill('2');
  await editor.getByRole('button', { name: 'Save specifications' }).click();
  await expect(editor.getByRole('alert')).toContainText('Your entries are still here');
  await expect(editor.getByLabel('Bedrooms')).toHaveValue('2');
  await editor.getByRole('button', { name: 'Save specifications' }).click();
  await expect(page.getByText('Property specifications saved.')).toBeVisible();
  await expect(checks.filter({ hasText: 'Property specifications' })).toHaveClass(/readinessReady/);
  expect(successfulSaves).toBe(1);

  await page.reload();
  await page.getByRole('button', { name: 'Edit specifications' }).click();
  await expect(page.getByRole('form', { name: 'Edit property specifications' }).getByLabel('Bedrooms')).toHaveValue('2');
  await page.getByRole('button', { name: /Synthetic Guest House/ }).click();
  await expect(checks.filter({ hasText: 'Property specifications' })).toHaveClass(/readinessReady/);
  for (const label of ['Provider profile', 'Provider identity verification', 'Authority risk-hold evaluation']) await expect(checks.filter({ hasText: label })).toHaveClass(/readinessBlocked/);
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
});
