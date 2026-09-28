import { test, expect } from '@playwright/test';
test('unconfigured admin renders safe guidance without credentials or identifiers', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('not configured');
  await expect(page.getByRole('button', { name: 'Sign in with staff account' })).toBeVisible();
});
test('staff summary, denial and logout controls use session API; fixtures do not prove Cognito', async ({
  page,
}) => {
  await page.route('**/api/session', (r) =>
    r.fulfill({
      status: 200,
      json: {
        csrf: 'synthetic-csrf',
        session: {
          display_name: 'Synthetic analyst',
          grants: [
            {
              role: 'ANALYST',
              scope: { kind: 'platform', id: 'pachi', permissions: ['analytics:aggregate'] },
              expires_at: '2026-09-27T00:00:00Z',
            },
          ],
          absolute_expires_at: new Date(Date.now() + 8 * 3600_000).toISOString(),
          idle_expires_at: new Date(Date.now() + 1800_000).toISOString(),
          reauthentication_expires_at: '2026-09-26T12:15:00Z',
        },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Synthetic analyst' })).toBeVisible();
  await expect(
    page.getByText('Sensitive actions require reauthentication', { exact: false }),
  ).toBeVisible();
  await page.route('**/api/auth/logout', async (r) => {
    expect(r.request().method()).toBe('POST');
    expect(r.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
    await r.fulfill({ status: 503, json: { error: 'unavailable' } });
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Sign-out failed');
  await page.route('**/api/session', (r) =>
    r.fulfill({ status: 403, json: { error: 'ACCESS_DENIED' } }),
  );
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Access denied');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
});
