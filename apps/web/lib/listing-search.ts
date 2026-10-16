import type { PublicListingSort } from '@pachi/contracts';

export type ListingSearchFilters = {
  purpose: string;
  region: string;
  city: string;
  neighborhood: string;
  property_type: string;
  min_price: string;
  max_price: string;
  min_bedrooms: string;
  furnishing: string;
  sort: PublicListingSort;
};

export type ListingSearchErrors = Partial<Record<keyof ListingSearchFilters, string>>;

export const emptyListingSearch: ListingSearchFilters = {
  purpose: '', region: '', city: '', neighborhood: '', property_type: '',
  min_price: '', max_price: '', min_bedrooms: '', furnishing: '', sort: 'newest',
};

const filterKeys = Object.keys(emptyListingSearch) as (keyof ListingSearchFilters)[];

export function readListingSearch(params: URLSearchParams): ListingSearchFilters {
  return Object.fromEntries(filterKeys.map((key) => [key, params.get(key) || emptyListingSearch[key]])) as ListingSearchFilters;
}

export function validateListingSearch(input: ListingSearchFilters): { filters: ListingSearchFilters; errors: ListingSearchErrors } {
  const filters = { ...input, city: input.city.trim(), neighborhood: input.neighborhood.trim() };
  const errors: ListingSearchErrors = {};
  const choices = {
    purpose: ['RENT', 'SALE', 'SHORT_LET'], region: ['Southwest', 'Littoral'],
    property_type: ['HOUSE', 'APARTMENT', 'ROOM', 'LAND', 'COMMERCIAL'],
    furnishing: ['FURNISHED', 'UNFURNISHED', 'PARTLY_FURNISHED'], sort: ['newest', 'price_asc', 'price_desc'],
  };
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) {
    if ((filters[key] || key === 'sort') && !choices[key].includes(filters[key])) errors[key] = 'Choose an available option.';
  }
  if (filters.city.length > 120) errors.city = 'Use a city name of 120 characters or fewer.';
  if (filters.neighborhood.length > 160) errors.neighborhood = 'Use a neighborhood name of 160 characters or fewer.';
  for (const key of ['min_price', 'max_price', 'min_bedrooms'] as const) {
    const value = filters[key].trim();
    filters[key] = value;
    if (!value) continue;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      errors[key] = key === 'min_bedrooms' ? 'Enter a whole number of bedrooms, zero or more.' : 'Enter a whole XAF amount, zero or more.';
    } else filters[key] = String(Number(value));
  }
  if (!errors.min_price && !errors.max_price && filters.min_price && filters.max_price && Number(filters.min_price) > Number(filters.max_price)) {
    errors.max_price = 'Maximum price must be at least the minimum price.';
  }
  return { filters, errors };
}

// Cursors are local pagination state, never part of a new shareable search.
export function listingSearchParams(filters: ListingSearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of filterKeys) {
    const value = filters[key];
    if (value && !(key === 'sort' && value === 'newest')) params.set(key, value);
  }
  return params;
}
