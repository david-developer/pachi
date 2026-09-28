import { test, expect } from '@playwright/test';

test('synthetic scoped photo queue shows private preview and sends an exact versioned decision', async ({ page }) => {
  const photo = { id:'00000000-0000-4000-8000-000000000011', listing_id:'00000000-0000-4000-8000-000000000012', media_asset_id:'00000000-0000-4000-8000-000000000013', region:'Littoral', listing_title:'Synthetic flat', status:'NOT_REVIEWED', version:1, reason_code:null, is_cover:true, attached_at:new Date().toISOString() };
  await page.route('**/api/session', route => route.fulfill({ json:{ csrf:'synthetic-csrf',session:{display_name:'Synthetic photo moderator',grants:[{role:'LISTING_MODERATOR',scope:{kind:'region',id:'Littoral',permissions:['listing:moderate']},expires_at:new Date(Date.now()+3600_000).toISOString()}],absolute_expires_at:new Date(Date.now()+3600_000).toISOString(),idle_expires_at:new Date(Date.now()+1800_000).toISOString(),reauthentication_expires_at:new Date(Date.now()+900_000).toISOString()} } }));
  let pending = true;
  await page.route('**/api/listing-photos', route => route.fulfill({ json:{ photos:pending ? [photo] : [] } }));
  await page.route('**/api/listing-photos/*/variants/320', route => route.fulfill({ contentType:'image/png', body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQyPPDihgGUgIADmopQfEhRyEAAAAASUVORK5CYII=', 'base64') }));
  await page.route('**/api/listing-photos/*/decision', route => {
    expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
    expect(route.request().postDataJSON()).toMatchObject({ media_asset_id:photo.media_asset_id,expected_version:1,outcome:'APPROVED',reason_code:'CONTENT_REVIEWED' });
    expect(route.request().postDataJSON().idempotency_key).toMatch(/^[0-9a-f-]{36}$/i);
    pending = false;
    return route.fulfill({ status:201, json:{ ...photo,status:'APPROVED',version:2,reason_code:'CONTENT_REVIEWED' } });
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Refresh pending photos'}).click();
  await expect(page.getByText('Synthetic flat', { exact:false })).toBeVisible();
  await expect(page.getByAltText('Private review preview for Synthetic flat')).toBeVisible();
  await page.getByLabel('Decision').selectOption('APPROVED');
  await page.getByLabel('Reason code').fill('CONTENT_REVIEWED');
  await page.getByRole('button',{name:'Record approved'}).click();
  await expect(page.getByRole('status').filter({hasText:'Photo decision recorded'})).toBeVisible();
  await expect(page.getByText('Synthetic flat', { exact:false })).toHaveCount(0);
});
