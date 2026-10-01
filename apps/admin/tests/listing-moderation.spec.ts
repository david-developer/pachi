import { test, expect } from '@playwright/test';

test('synthetic scoped listing queue can approve without redundant photo previews', async ({ page }) => {
  const submission = {
    submission_id: '00000000-0000-4000-8000-000000000021',
    listing_id: '00000000-0000-4000-8000-000000000022',
    revision_id: '00000000-0000-4000-8000-000000000023',
    revision_version: 1,
    offering_id: '00000000-0000-4000-8000-000000000024',
    offering_version_id: '00000000-0000-4000-8000-000000000025',
    submitted_at: new Date().toISOString(),
    media_snapshot: [{ listing_media_id: '00000000-0000-4000-8000-000000000026', media_asset_id: '00000000-0000-4000-8000-000000000027', display_order: 0, is_cover: true }],
    region: 'Littoral', city: 'Douala', neighborhood: 'Akwa', purpose: 'RENT', title: 'Synthetic pending flat', description: 'A complete synthetic listing', currency: 'XAF', amount_minor: 200000, pricing_period: 'MONTHLY', available_from: '2026-10-01', owner_user_id: '00000000-0000-4000-8000-000000000028', market_status: 'AVAILABLE',
  };
  await page.route('**/api/session', route => route.fulfill({ json: { csrf: 'synthetic-csrf', session: { display_name: 'Synthetic listing moderator', grants: [{ role: 'LISTING_MODERATOR', scope: { kind: 'region', id: 'Littoral', permissions: ['listing:moderate'] }, expires_at: new Date(Date.now() + 3600000).toISOString() }], absolute_expires_at: new Date(Date.now() + 3600000).toISOString(), idle_expires_at: new Date(Date.now() + 1800000).toISOString(), reauthentication_expires_at: new Date(Date.now() + 900000).toISOString() } } }));
  let pending = true;
  await page.route('**/api/listing-revisions', route => route.fulfill({ json: { submissions: pending ? [submission] : [] } }));
  const previews: string[] = [];
  await page.route('**/api/listing-revisions/*/media/*/variants/640', route => { previews.push(route.request().url()); return route.fulfill({ contentType: 'image/png', body: Buffer.from('synthetic-preview') }); });
  await page.route('**/api/listing-revisions/*/decision', route => {
    expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
    expect(route.request().postDataJSON()).toMatchObject({ submission_id: submission.submission_id, revision_id: submission.revision_id, expected_version: 1, command: 'APPROVE_AND_PUBLISH', reason_code: 'CONTENT_REVIEWED', reason_text: 'Synthetic exact revision approved.' });
    expect(route.request().postDataJSON().idempotency_key).toMatch(/^[0-9a-f-]{36}$/i);
    pending = false;
    return route.fulfill({ status: 201, json: { action_id: '00000000-0000-4000-8000-000000000029', listing_id: submission.listing_id, submission_id: submission.submission_id, revision_id: submission.revision_id, command: 'APPROVE_AND_PUBLISH', publication_status: 'PUBLISHED', moderation_status: 'APPROVED', idempotent: false } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Refresh submitted revisions' }).click();
  await expect(page.getByText('Synthetic pending flat', { exact: false })).toBeVisible();
  await page.getByLabel('Decision').selectOption('APPROVE_AND_PUBLISH');
  await page.getByLabel('Internal reason', { exact: true }).fill('Synthetic exact revision approved.');
  await page.getByRole('button', { name: 'Record approve and publish' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Decision recorded for the exact submitted revision.' })).toBeVisible();
  expect(previews).toHaveLength(0);
});
