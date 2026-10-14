import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyListingSearch, listingSearchParams, readListingSearch, validateListingSearch } from './listing-search.js';

void test('XAF and bedroom filters require safe nonnegative integers and an ordered range', () => {
  for (const value of ['-1', '1.5', '1e3', 'NaN', 'Infinity', '9,000', '9007199254740992']) {
    assert.ok(validateListingSearch({ ...emptyListingSearch, min_price: value }).errors.min_price);
    assert.ok(validateListingSearch({ ...emptyListingSearch, min_bedrooms: value }).errors.min_bedrooms);
  }
  assert.ok(validateListingSearch({ ...emptyListingSearch, min_price: '300000', max_price: '200000' }).errors.max_price);
  const valid = validateListingSearch({ ...emptyListingSearch, min_price: ' 000200000 ', max_price: '9007199254740991', min_bedrooms: '0' });
  assert.deepEqual(valid.errors, {});
  assert.equal(valid.filters.min_price, '200000');
  assert.equal(valid.filters.max_price, '9007199254740991');
  assert.equal(valid.filters.min_bedrooms, '0');
});

void test('a shared search retains only supported filters, without cursor or unknown query state', () => {
  const params = new URLSearchParams('purpose=SHORT_LET&region=Littoral&city=%20Douala%20&neighborhood=Akwa&property_type=APARTMENT&min_price=100000&max_price=400000&min_bedrooms=2&furnishing=FURNISHED&sort=price_asc&cursor=old&limit=99&private_address=hidden');
  const validated = validateListingSearch(readListingSearch(params));
  assert.deepEqual(validated.errors, {});
  const shared = listingSearchParams(validated.filters);
  assert.equal(shared.get('city'), 'Douala');
  assert.equal(shared.get('purpose'), 'SHORT_LET');
  assert.equal(shared.get('min_bedrooms'), '2');
  assert.equal(shared.get('sort'), 'price_asc');
  for (const unsupported of ['cursor', 'limit', 'private_address']) assert.equal(shared.has(unsupported), false);
  assert.deepEqual(readListingSearch(shared), validated.filters);
  assert.equal(listingSearchParams(emptyListingSearch).toString(), '');
});

void test('unsupported locations and filter options are rejected without fabricating alternatives', () => {
  for (const key of ['purpose', 'region', 'property_type', 'furnishing', 'sort'] as const) {
    const parsed = readListingSearch(new URLSearchParams(`${key}=unsupported`));
    assert.ok(validateListingSearch(parsed).errors[key]);
  }
  assert.ok(validateListingSearch({ ...emptyListingSearch, city: 'a'.repeat(121) }).errors.city);
  assert.ok(validateListingSearch({ ...emptyListingSearch, neighborhood: 'a'.repeat(161) }).errors.neighborhood);
  assert.equal(validateListingSearch({ ...emptyListingSearch, city: '  ' }).filters.city, '');
});
