import { test, expect } from '@playwright/test';

test('anonymous Contact provider starts sign-in without sending an inquiry', async ({ page }) => {
  const listingId='00000000-0000-4000-8000-000000000061';
  const listing={id:listingId,purpose:'RENT',title:'Synthetic contact flat',description:'Safe contact fixture',price:{amount_minor:200000,currency:'XAF',pricing_period:'MONTHLY',negotiable:false},terms:{deposit_amount_minor:null,advance_months:null,minimum_lease_months:null,utilities_included:null,service_charge_amount_minor:null,weekly_amount_minor:null,minimum_nights:null,guest_limit:null,check_in_time:null,check_out_time:null,cleaning_fee_minor:null},property:{property_type:'APARTMENT',bedrooms:2,bathrooms:1,size_sqm:null,furnishing:'FURNISHED'},location:{region:'Littoral',city:'Douala',neighborhood:'Akwa'},market_status:'AVAILABLE',available_from:'2026-10-01',expires_at:'2026-11-01T00:00:00.000Z',media:[]};
  await page.route('**/api/public/listings/**', route => route.fulfill({json:listing}));
  await page.route('**/api/session', route => route.fulfill({json:{authenticated:false,participationAllowed:false}}));
  let inquiryCalls=0;
  await page.route('**/api/account/listings/*/inquiry', route => { inquiryCalls+=1; return route.fulfill({status:201,json:{}}); });
  await page.route('**/api/auth/login**', route => route.fulfill({status:200,contentType:'text/html',body:'sign-in'}));
  await page.goto(`/listings/${listingId}`);
  await page.getByRole('button',{name:'Contact provider'}).click();
  await expect(page).toHaveURL(new RegExp(`/api/auth/login\\?returnTo=%2Flistings%2F${listingId}`));
  expect(inquiryCalls).toBe(0);
});

test('phone-unverified seeker remains on listing without sending an inquiry', async ({ page }) => {
  const listingId='00000000-0000-4000-8000-000000000061';
  const listing={id:listingId,purpose:'RENT',title:'Synthetic contact flat',description:'Safe contact fixture',price:{amount_minor:200000,currency:'XAF',pricing_period:'MONTHLY',negotiable:false},terms:{deposit_amount_minor:null,advance_months:null,minimum_lease_months:null,utilities_included:null,service_charge_amount_minor:null,weekly_amount_minor:null,minimum_nights:null,guest_limit:null,check_in_time:null,check_out_time:null,cleaning_fee_minor:null},property:{property_type:'APARTMENT',bedrooms:2,bathrooms:1,size_sqm:null,furnishing:'FURNISHED'},location:{region:'Littoral',city:'Douala',neighborhood:'Akwa'},market_status:'AVAILABLE',available_from:'2026-10-01',expires_at:'2026-11-01T00:00:00.000Z',media:[]};
  await page.route('**/api/public/listings/**', route => route.fulfill({json:listing}));
  await page.route('**/api/session', route => route.fulfill({json:{authenticated:true,participationAllowed:false,csrfToken:'synthetic-csrf'}}));
  let inquiryCalls=0;
  await page.route('**/api/account/listings/*/inquiry', route => { inquiryCalls+=1; return route.fulfill({status:201,json:{}}); });
  await page.goto(`/listings/${listingId}`);
  await page.getByRole('button',{name:'Contact provider'}).click();
  await expect(page.getByRole('status')).toHaveText('Verify your phone before contacting a provider.');
  await expect(page).toHaveURL(new RegExp(`/listings/${listingId}$`));
  expect(inquiryCalls).toBe(0);
});

test('eligible seeker opens and reuses inquiry context with messaging capability unavailable', async ({ page }) => {
  const listingId='00000000-0000-4000-8000-000000000061';
  const interaction={interaction_id:'00000000-0000-4000-8000-000000000062',conversation_id:'00000000-0000-4000-8000-000000000063',listing_id:listingId,state:'OPEN',opened_at:new Date().toISOString(),title:'Synthetic contact flat',listing_visible:true};
  const listing={id:listingId,purpose:'RENT',title:'Synthetic contact flat',description:'Safe contact fixture',price:{amount_minor:200000,currency:'XAF',pricing_period:'MONTHLY',negotiable:false},terms:{deposit_amount_minor:null,advance_months:null,minimum_lease_months:null,utilities_included:null,service_charge_amount_minor:null,weekly_amount_minor:null,minimum_nights:null,guest_limit:null,check_in_time:null,check_out_time:null,cleaning_fee_minor:null},property:{property_type:'APARTMENT',bedrooms:2,bathrooms:1,size_sqm:null,furnishing:'FURNISHED'},location:{region:'Littoral',city:'Douala',neighborhood:'Akwa'},market_status:'AVAILABLE',available_from:'2026-10-01',expires_at:'2026-11-01T00:00:00.000Z',media:[]};
  await page.route('**/api/public/listings/**', route => route.fulfill({json:listing}));
  await page.route('**/api/session', route => route.fulfill({json:{authenticated:true,participationAllowed:true,csrfToken:'synthetic-csrf'}}));
  let calls=0;
  await page.route('**/api/account/listings/*/inquiry', route => { calls += 1; return route.fulfill({status:201,json:{...interaction,created:calls===1}}); });
  await page.route('**/api/account/interactions/*', route => route.fulfill({json:interaction}));
  await page.route('**/api/account/conversations/*/messages', route => route.fulfill({json:{items:[],next_cursor:null,can_send:false,actor_side:'SEEKER'}}));
  await page.goto(`/listings/${listingId}`);
  await page.getByRole('button',{name:'Contact provider'}).click();
  await expect(page).toHaveURL(/\/conversations\//);
  await expect(page.getByRole('heading',{name:'Synthetic contact flat'})).toBeVisible();
  await expect(page.getByText('Messaging is not available. You can still view the history.',{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.goto(`/listings/${listingId}`);
  await page.getByRole('button',{name:'Contact provider'}).click();
  await expect(page).toHaveURL(new RegExp(`/conversations/${interaction.interaction_id}$`));
  expect(calls).toBe(2);
  const rendered=await page.locator('body').innerText();
  expect(rendered).not.toMatch(/\+237\d{9}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|PRIVATE_ADDRESS/i);
});
