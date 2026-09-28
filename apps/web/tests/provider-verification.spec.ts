import { expect, test } from '@playwright/test';

test('provider sees synthetic case status and next action without listing publication', async ({ page }) => {
  let submitted = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({json:{authenticated:true,participationAllowed:true,accountState:'ACTIVE',csrfToken:'synthetic-csrf'}});
    if (path === '/api/account/properties') return route.fulfill({json:{properties:[]}});
    if (path === '/api/account/listing-drafts') return route.fulfill({json:{drafts:[]}});
    if (path === '/api/account/provider/verification') {
      if (route.request().method() === 'POST') {
        expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
        const body = route.request().postDataJSON();
        expect(body.government_id).toBe('PACHI_SYNTHETIC_GOVERNMENT_ID_V1');
        submitted = true;
        return route.fulfill({status:201,json:{id:'synthetic-case',state:'PENDING',next_action:'WAIT_FOR_REVIEW',reason_code:null,valid_until:null,version:1}});
      }
      return route.fulfill({json:{case:submitted?{id:'synthetic-case',state:'PENDING',next_action:'WAIT_FOR_REVIEW',reason_code:null,valid_until:null,version:1}:null,synthetic_intake_available:true}});
    }
    throw new Error(`Unexpected intercepted path: ${path}`);
  });
  await page.goto('/provider');
  await expect(page.getByText('Status: not started', {exact:false})).toBeVisible();
  await expect(page.getByText('Real identity documents cannot be collected', {exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Submit synthetic sample case'}).click();
  await expect(page.getByText('Status: PENDING.',{exact:false})).toBeVisible();
  await expect(page.getByText('Next action: wait for review.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Submit synthetic sample case'})).toHaveCount(0);
});
