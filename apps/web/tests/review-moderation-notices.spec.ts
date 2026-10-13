import { expect, test } from '@playwright/test';
test('G3-H1 affected-user notice presents a safe reason and durable appeal deadline without confidential evidence', async ({ page }) => {
  const notice = { id: '00000000-0000-4000-8000-000000000821', viewing_id: '00000000-0000-4000-8000-000000000822', recipient_side: 'SEEKER',
    event_type: 'review_moderation_changed', schedule_version: 1, event_at: '2026-10-13T12:00:00.000Z', available_at: '2026-10-13T12:00:00.000Z',
    inbox_state: 'AVAILABLE', external_state: 'NOT_ENABLED', read_at: null, moderation_reason_code: 'PRIVACY_PROTECTION', moderation_command: 'HIDE', appeal_deadline: '2026-11-12T12:00:00.000Z',
    reporter_user_id: 'CONFIDENTIAL_REPORTER_CANARY', details: 'CONFIDENTIAL_EVIDENCE_CANARY', review_text: 'HELD_TEXT_CANARY', rating: 1, private_instructions: 'CONFIDENTIAL_MEETING_CANARY' };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, csrfToken: 'synthetic', participationAllowed: true } });
    if (path === '/api/account/viewing-notices') return route.fulfill({ json: { items: [notice], next_cursor: null } });
    if (path.endsWith('/read')) { expect(route.request().headers()['x-csrf-token']).toBe('synthetic'); return route.fulfill({ status: 201, json: { ...notice, read_at: '2026-10-13T12:05:00.000Z' } }); }
    throw Error('Unexpected synthetic moderation notice path');
  });
  await page.goto('/viewings/notices'); await expect(page.getByText('Review moderation outcome', { exact: true })).toBeVisible();
  await expect(page.getByText(/Avoid publishing private addresses/)).toBeVisible(); await expect(page.getByText(/within 30 days of this notice becoming available/)).toBeVisible();
  for (const value of ['CONFIDENTIAL_REPORTER_CANARY', 'CONFIDENTIAL_EVIDENCE_CANARY', 'HELD_TEXT_CANARY', 'CONFIDENTIAL_MEETING_CANARY']) await expect(page.locator('main')).not.toContainText(value);
  await page.getByRole('button', { name: 'Mark notice read' }).click(); await expect(page.getByText(/Read by you/)).toBeVisible();
});
