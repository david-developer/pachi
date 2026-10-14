'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { PublicListingSearchResponse } from '@pachi/contracts';
import { emptyListingSearch, listingSearchParams, readListingSearch, validateListingSearch } from '../../lib/listing-search';
import type { ListingSearchErrors, ListingSearchFilters } from '../../lib/listing-search';
import { ListingCard, ListingSkeletons, MarketplaceFooter, MarketplaceHeader, purposeLabel } from '../components/marketplace';

type SearchError = { message: string; pagination: boolean };

export default function PublicListingsPage() {
  return <div className="marketplacePage"><MarketplaceHeader active="listings" /><main className="marketplaceContainer" id="main-content"><header className="searchIntro"><p className="searchBreadcrumb"><Link href="/">Home</Link><span aria-hidden="true"> / </span>Property search</p><p className="eyebrow">EXPLORE CAMEROON</p><h1>Find your next place.</h1><p>Homes, rooms, land and commercial spaces in Southwest and Littoral.</p></header><Suspense fallback={<section className="searchResults" aria-label="Loading listings"><ListingSkeletons count={6} /></section>}><ListingSearch /></Suspense></main><MarketplaceFooter /></div>;
}

function ListingSearch() {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const [draft, setDraft] = useState<ListingSearchFilters>(emptyListingSearch);
  const [applied, setApplied] = useState<ListingSearchFilters>(emptyListingSearch);
  const [fieldErrors, setFieldErrors] = useState<ListingSearchErrors>({});
  const [result, setResult] = useState<PublicListingSearchResponse | null>(null);
  const [loading, setLoading] = useState<'search' | 'more' | null>('search');
  const [error, setError] = useState<SearchError | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const appliedRef = useRef(emptyListingSearch);
  const form = useRef<HTMLFormElement | null>(null);
  const validationFocus = useRef<string | null>(null);

  useLayoutEffect(() => {
    const key = validationFocus.current;
    validationFocus.current = null;
    if (!key) return;
    const input = form.current?.elements.namedItem(key);
    if (input instanceof HTMLElement) input.focus();
  }, [fieldErrors, filtersOpen]);

  const load = useCallback(async (filters: ListingSearchFilters, cursor?: string) => {
    controller.current?.abort();
    const current = ++requestSequence.current;
    const nextController = new AbortController();
    controller.current = nextController;
    setLoading(cursor ? 'more' : 'search');
    setError(null);
    if (!cursor) setResult(null);
    const params = listingSearchParams(filters);
    if (cursor) params.set('cursor', cursor);
    try {
      const response = await fetch(`/api/public/listings?${params.toString()}`, { cache: 'no-store', signal: nextController.signal });
      if (!response.ok) throw new Error('Listing search is unavailable');
      const body = await response.json() as PublicListingSearchResponse;
      if (!Array.isArray(body.items) || typeof body.has_more !== 'boolean' || !(body.next_cursor === null || typeof body.next_cursor === 'string')) throw new Error('Listing search is unavailable');
      if (nextController.signal.aborted || current !== requestSequence.current) return;
      setResult((previous) => {
        const items = cursor && previous ? [...previous.items, ...body.items] : body.items;
        const seen = new Set<string>();
        return {
          ...body,
          items: items.filter((listing) => { if (seen.has(listing.id)) return false; seen.add(listing.id); return true; }),
          has_more: body.has_more && Boolean(body.next_cursor) && body.next_cursor !== cursor,
        };
      });
    } catch {
      if (nextController.signal.aborted || current !== requestSequence.current) return;
      setError({ pagination: Boolean(cursor), message: cursor ? 'We couldn’t load more listings. Your results are still here.' : 'We couldn’t load listings right now. Please try again.' });
    } finally {
      if (!nextController.signal.aborted && current === requestSequence.current) setLoading(null);
    }
  }, []);

  useEffect(() => {
    const next = validateListingSearch(readListingSearch(new URLSearchParams(query)));
    setDraft(next.filters);
    setApplied(next.filters);
    appliedRef.current = next.filters;
    setFieldErrors(next.errors);
    if (Object.keys(next.errors).length) {
      controller.current?.abort();
      requestSequence.current++;
      setResult(null);
      setLoading(null);
      setError(null);
    } else void load(next.filters);
    return () => { controller.current?.abort(); requestSequence.current++; };
  }, [query, load]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 900px)');
    setFiltersOpen(desktop.matches);
    const update = () => setFiltersOpen(desktop.matches);
    desktop.addEventListener('change', update);
    return () => desktop.removeEventListener('change', update);
  }, []);

  function change(key: keyof ListingSearchFilters, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => ({ ...previous, [key]: undefined }));
  }

  function apply(next: ListingSearchFilters) {
    const validated = validateListingSearch(next);
    validationFocus.current = Object.keys(validated.errors)[0] ?? null;
    setFieldErrors(validated.errors);
    if (Object.keys(validated.errors).length) {
      setFiltersOpen(true);
      return;
    }
    setDraft(validated.filters);
    const nextQuery = listingSearchParams(validated.filters).toString();
    if (window.location.search.slice(1) === nextQuery) {
      appliedRef.current = validated.filters;
      setApplied(validated.filters);
      void load(validated.filters);
    } else {
      controller.current?.abort();
      requestSequence.current++;
      setLoading('search');
      setError(null);
      setResult(null);
      window.history.pushState(null, '', `/listings${nextQuery ? `?${nextQuery}` : ''}`);
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); apply(draft); }

  const changed = Object.keys(emptyListingSearch).some((key) => draft[key as keyof ListingSearchFilters] !== applied[key as keyof ListingSearchFilters]);
  const invalid = Object.values(fieldErrors).some(Boolean);
  const descriptors = (key: keyof ListingSearchFilters) => ({ name: key, form: 'listing-search', 'aria-invalid': Boolean(fieldErrors[key]), 'aria-describedby': fieldErrors[key] ? `search-error-${key}` : undefined });
  const fieldError = (key: keyof ListingSearchFilters) => fieldErrors[key] && <span className="searchFieldError" id={`search-error-${key}`}>{fieldErrors[key]}</span>;
  const appliedChips = [
    applied.purpose && purposeLabel(applied.purpose), applied.region, applied.city, applied.neighborhood,
    applied.property_type && applied.property_type.toLowerCase(),
    applied.min_price && `From ${Number(applied.min_price).toLocaleString('en-CM')} XAF`,
    applied.max_price && `Up to ${Number(applied.max_price).toLocaleString('en-CM')} XAF`,
    applied.min_bedrooms && `${applied.min_bedrooms}+ bedrooms`,
    applied.furnishing && applied.furnishing.toLowerCase().replaceAll('_', ' '),
  ].filter(Boolean);

  return <>
    <form className="searchPrimary" id="listing-search" ref={form} onSubmit={submit} noValidate>
      <label className="searchField">Purpose<select {...descriptors('purpose')} value={draft.purpose} onChange={(event) => change('purpose', event.target.value)}><option value="">Rent, buy or short let</option><option value="RENT">Rent</option><option value="SALE">Buy</option><option value="SHORT_LET">Short let</option></select>{fieldError('purpose')}</label>
      <label className="searchField">Region<select {...descriptors('region')} value={draft.region} onChange={(event) => change('region', event.target.value)}><option value="">All launch regions</option><option value="Southwest">Southwest</option><option value="Littoral">Littoral</option></select>{fieldError('region')}</label>
      <label className="searchField">City<input {...descriptors('city')} autoComplete="off" maxLength={120} value={draft.city} onChange={(event) => change('city', event.target.value)} placeholder="Enter a city, e.g. Douala" />{fieldError('city')}</label>
      <button className="primary searchSubmit" type="submit">Apply filters</button>
    </form>
    <div className="searchWorkspace">
      <aside className="searchSidebar" aria-label="Refine your search"><details className="searchFilters" open={filtersOpen} onToggle={(event) => setFiltersOpen(event.currentTarget.open)}><summary>More filters</summary><div className="searchFilterBody">
        <label className="searchField">Neighborhood<input {...descriptors('neighborhood')} autoComplete="off" maxLength={160} value={draft.neighborhood} onChange={(event) => change('neighborhood', event.target.value)} placeholder="Enter a neighborhood" />{fieldError('neighborhood')}</label>
        <label className="searchField">Property type<select {...descriptors('property_type')} value={draft.property_type} onChange={(event) => change('property_type', event.target.value)}><option value="">Any type</option><option value="HOUSE">House</option><option value="APARTMENT">Apartment</option><option value="ROOM">Room</option><option value="LAND">Land</option><option value="COMMERCIAL">Commercial</option></select>{fieldError('property_type')}</label>
        <fieldset className="searchPriceRange"><legend>Price range (XAF)</legend><label className="searchField">Min price<input {...descriptors('min_price')} type="text" inputMode="numeric" value={draft.min_price} onChange={(event) => change('min_price', event.target.value)} placeholder="No minimum" />{fieldError('min_price')}</label><label className="searchField">Max price<input {...descriptors('max_price')} type="text" inputMode="numeric" value={draft.max_price} onChange={(event) => change('max_price', event.target.value)} placeholder="No maximum" />{fieldError('max_price')}</label></fieldset>
        <label className="searchField">Bedrooms<input {...descriptors('min_bedrooms')} type="text" inputMode="numeric" value={draft.min_bedrooms} onChange={(event) => change('min_bedrooms', event.target.value)} placeholder="Any number" /><span className="searchNumericHelp">Minimum number of bedrooms</span>{fieldError('min_bedrooms')}</label>
        <label className="searchField">Furnishing<select {...descriptors('furnishing')} value={draft.furnishing} onChange={(event) => change('furnishing', event.target.value)}><option value="">Any furnishing</option><option value="FURNISHED">Furnished</option><option value="UNFURNISHED">Unfurnished</option><option value="PARTLY_FURNISHED">Partly furnished</option></select>{fieldError('furnishing')}</label>
        <div className="searchActions"><button className="primary" type="submit" form="listing-search">Update results</button><button className="secondary searchReset" type="button" onClick={() => apply({ ...emptyListingSearch })}>Reset filters</button></div>
      </div></details></aside>
      <section className="searchResults" aria-label="Search results" aria-busy={Boolean(loading)}>
        <div className="searchResultsHeader"><div><h2>Available properties</h2><p className="resultCount" role="status">{loading === 'search' ? 'Searching available listings…' : result ? `${result.items.length} listing${result.items.length === 1 ? '' : 's'} loaded${result.has_more ? ' · More available' : ''}` : 'Results are unavailable'}</p></div><label className="searchField searchSort">Sort<select {...descriptors('sort')} value={draft.sort} onChange={(event) => change('sort', event.target.value)}><option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select>{fieldError('sort')}</label></div>
        {!invalid && appliedChips.length > 0 && <div className="searchAppliedFilters" aria-label="Applied filters">{appliedChips.map((chip, index) => <span className="searchChip" key={`${chip}-${index}`}>{chip}</span>)}</div>}
        {changed && !invalid && <p className="searchDraftHint" role="status">Filters changed. Apply filters to update results.</p>}
        {invalid && <div className="searchFeedback" role="alert"><h3>Check your search filters.</h3><p>Correct the highlighted fields, then apply your filters.</p><button className="secondary" type="button" onClick={() => apply({ ...emptyListingSearch })}>Clear all filters</button></div>}
        {error && !error.pagination && <div className="searchFeedback" role="alert"><h3>Listings are temporarily unavailable.</h3><p>{error.message}</p><button className="primary" type="button" onClick={() => { void load(appliedRef.current); }}>Try again</button></div>}
        {loading === 'search' && <ListingSkeletons count={6} />}
        {loading !== 'search' && result && (result.items.length ? <section className="listingGrid" aria-label="Public listings">{result.items.map((listing) => <ListingCard key={listing.id} listing={listing} />)}</section> : <div className="emptyResults searchFeedback"><p className="eyebrow">ROOM TO EXPLORE</p><h3>No listings match those filters.</h3><p>Try a different city or widen the purpose, property type or price range.</p><button className="primary" type="button" onClick={() => apply({ ...emptyListingSearch })}>Browse all properties</button></div>)}
        {error?.pagination && <div className="searchFeedback" role="alert"><p>{error.message}</p><button className="secondary" type="button" onClick={() => { if (result?.next_cursor) void load(appliedRef.current, result.next_cursor); }}>Try loading more again</button></div>}
        {result?.has_more && result.next_cursor && !error?.pagination && <div className="searchLoadMore"><button className="secondary" type="button" disabled={Boolean(loading)} onClick={() => { if (result.next_cursor) void load(appliedRef.current, result.next_cursor); }}>{loading === 'more' ? 'Loading more listings…' : 'Load more listings'}</button></div>}
      </section>
    </div>
  </>;
}
