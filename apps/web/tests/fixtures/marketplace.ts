import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { PublicListing } from '@pachi/contracts';

// Generated TEST photograph. This directory is not served by Next.js and is
// intercepted only in fresh automated browser contexts, never real inventory.
export const testPhotograph = readFileSync(join(process.cwd(), 'tests/fixtures/synthetic-apartment.jpg'));
const testBedroomPhotograph = readFileSync(join(process.cwd(), 'tests/fixtures/synthetic-bedroom.jpg'));
const testKitchenPhotograph = readFileSync(join(process.cwd(), 'tests/fixtures/synthetic-kitchen.jpg'));
const testMediaPhotographs: Record<string, Buffer> = {
  '00000000-0000-4000-8000-000000000152': testPhotograph,
  '00000000-0000-4000-8000-000000000153': testBedroomPhotograph,
  '00000000-0000-4000-8000-000000000154': testKitchenPhotograph,
  '00000000-0000-4000-8000-000000000162': testBedroomPhotograph,
  '00000000-0000-4000-8000-000000000163': testKitchenPhotograph,
  '00000000-0000-4000-8000-000000000164': testPhotograph,
};
export const privateAddressCanary = 'TEST_ONLY_PRIVATE_EXACT_ADDRESS';
export const testListing: PublicListing = {
  id: '00000000-0000-4000-8000-000000000151', purpose: 'RENT', title: 'TEST · Bright apartment in Akwa',
  description: 'Synthetic TEST inventory for browser and visual review.\nA light-filled living area, two bedrooms and a separate kitchen.',
  price: { amount_minor: 200000, currency: 'XAF', pricing_period: 'MONTHLY', negotiable: false },
  terms: { deposit_amount_minor: 200000, advance_months: 3, minimum_lease_months: 12, utilities_included: false, service_charge_amount_minor: 10000, weekly_amount_minor: null, minimum_nights: null, guest_limit: null, check_in_time: null, check_out_time: null, cleaning_fee_minor: null },
  property: { property_type: 'APARTMENT', bedrooms: 2, bathrooms: 2, size_sqm: '95', furnishing: 'PARTLY_FURNISHED' },
  location: { region: 'Littoral', city: 'Douala', neighborhood: 'Akwa' }, market_status: 'AVAILABLE', available_from: '2026-10-20', expires_at: '2026-11-20T00:00:00Z',
  media: [0, 1, 2].map(index => ({ id: `00000000-0000-4000-8000-00000000015${index + 2}`, is_cover: index === 0, widths: [320, 640, 1280] })),
};
export const testListings: PublicListing[] = [
  testListing,
  { ...testListing, id: '00000000-0000-4000-8000-000000000161', title: 'TEST · Furnished short stay', purpose: 'SHORT_LET', price: { ...testListing.price, amount_minor: 35000, pricing_period: 'NIGHTLY' }, property: { ...testListing.property, bedrooms: 1, furnishing: 'FURNISHED' }, location: { region: 'Southwest', city: 'Buea', neighborhood: 'Molyko' }, media: testListing.media.map((media, index) => ({ ...media, id: `00000000-0000-4000-8000-00000000016${index + 2}` })) },
  { ...testListing, id: '00000000-0000-4000-8000-000000000171', title: 'TEST · Family home for sale', purpose: 'SALE', price: { ...testListing.price, amount_minor: 65000000, pricing_period: 'TOTAL', negotiable: true }, property: { ...testListing.property, property_type: 'HOUSE', bedrooms: 4, bathrooms: 3 }, media: [] },
];

export async function marketplaceFixture(page: Page, items = testListings) {
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: false, participationAllowed: false } }));
  await page.route('**/api/public/listings**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/media/')) {
      const photograph = testMediaPhotographs[url.pathname.split('/')[6] ?? ''];
      return photograph ? route.fulfill({ contentType: 'image/jpeg', body: photograph }) : route.fulfill({ status: 404, body: '' });
    }
    if (url.pathname.endsWith('/reviews')) return route.fulfill({ json: { items: [], next_cursor: null, reputation: { count: 0, average: null } } });
    const id = url.pathname.split('/')[4];
    if (id) {
      const listing = items.find(item => item.id === id);
      return route.fulfill({ status: listing ? 200 : 404, json: listing ? { ...listing, location: { ...listing.location, private_address: privateAddressCanary } } : {} });
    }
    return route.fulfill({ json: { items, filters: Object.fromEntries(url.searchParams), next_cursor: null, has_more: false } });
  });
}
