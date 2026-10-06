import { test, expect } from '@playwright/test';

const listing = {
  id: '00000000-0000-4000-8000-000000000051', purpose: 'RENT', title: 'Synthetic public flat', description: 'A safe public listing description.',
  price: { amount_minor: 200000, currency: 'XAF', pricing_period: 'MONTHLY', negotiable: false },
  terms: { deposit_amount_minor: 100000, advance_months: 1, minimum_lease_months: 12, utilities_included: null, service_charge_amount_minor: null, weekly_amount_minor: null, minimum_nights: null, guest_limit: null, check_in_time: null, check_out_time: null, cleaning_fee_minor: null },
  property: { property_type: 'APARTMENT', bedrooms: 2, bathrooms: 1, size_sqm: null, furnishing: 'FURNISHED' },
  location: { region: 'Littoral', city: 'Douala', neighborhood: 'Akwa' }, market_status: 'AVAILABLE', available_from: '2026-10-01', expires_at: '2026-11-01T00:00:00.000Z',
  media: [{ id: '00000000-0000-4000-8000-000000000052', is_cover: true, widths: [320, 640] }],
};

test('anonymous user filters, opens public detail, and sees no contact/private controls', async ({ page }) => {
  let visible = true;
  await page.route('**/api/session', route => route.fulfill({json:{authenticated:false,participationAllowed:false}}));
  await page.route('**/api/public/listings**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/listings/${listing.id}`)) return route.fulfill({ json: visible ? listing : { message: 'Listing is not available' }, status: visible ? 200 : 404 });
    return route.fulfill({ json: { items: visible ? [listing] : [], filters: Object.fromEntries(url.searchParams), next_cursor: null, has_more: false } });
  });
  await page.route('**/api/public/listings/*/media/*/variants/640', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('synthetic-public-derivative') }));
  await page.goto('/listings');
  await expect(page.getByText('Synthetic public flat')).toBeVisible();
  await page.getByLabel('City').fill('Douala');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByText('Synthetic public flat')).toBeVisible();
  await page.getByRole('link', { name: /Synthetic public flat/ }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic public flat' })).toBeVisible();
  await expect(page.getByText('Akwa')).toBeVisible();
  await expect(page.getByText('Structured neighborhood location. No exact address is shown.')).toBeVisible();
  await expect(page.getByText(/message|phone|email|save|viewing/i)).toHaveCount(0);
  await expect(page.getByRole('link', {name:'Manage your blocks',exact:true})).toHaveCount(0);
  visible = false;
  await page.goto('/listings');
  await expect(page.getByText('No listings match those filters.')).toBeVisible();
});
