'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { PublicListing, PublicListingSearchResponse } from '@pachi/contracts';

type Filters = { purpose: string; region: string; city: string; neighborhood: string; property_type: string; min_price: string; max_price: string; min_bedrooms: string; furnishing: string; sort: 'newest' | 'price_asc' | 'price_desc' };
const initialFilters: Filters = { purpose: '', region: '', city: '', neighborhood: '', property_type: '', min_price: '', max_price: '', min_bedrooms: '', furnishing: '', sort: 'newest' };

export default function PublicListingsPage() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [result, setResult] = useState<PublicListingSearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(next = filters, append = false) {
    setLoading(true); setError('');
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    try {
      const response = await fetch(`/api/public/listings?${params.toString()}`, { cache: 'no-store' });
      const body = await response.json() as PublicListingSearchResponse & { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Listings could not be loaded.');
      setResult((current) => append && current ? { ...body, items: [...current.items, ...body.items] } : body);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Listings could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(initialFilters); }, []);
  function change(key: keyof Filters, value: string) { setFilters((current) => ({ ...current, [key]: value })); }
  function submit(event: FormEvent) { event.preventDefault(); void load({ ...filters, cursor: undefined } as Filters); }

  return <main className="publicShell"><Link href="/conversations">Your conversations</Link><header className="publicHeader"><p className="eyebrow">PACHI / MARKETPLACE</p><h1>Find a place that fits.</h1><p className="publicLead">Browse currently publishable homes, rooms, land and commercial spaces across Cameroon launch regions.</p></header><form className="filterBar" onSubmit={submit}><label>Purpose<select value={filters.purpose} onChange={(event) => change('purpose', event.target.value)}><option value="">All purposes</option><option value="RENT">Rent</option><option value="SALE">Sale</option><option value="SHORT_LET">Short let</option></select></label><label>Region<select value={filters.region} onChange={(event) => change('region', event.target.value)}><option value="">All regions</option><option value="Southwest">Southwest</option><option value="Littoral">Littoral</option></select></label><label>City<input value={filters.city} onChange={(event) => change('city', event.target.value)} placeholder="Douala" /></label><label>Neighborhood<input value={filters.neighborhood} onChange={(event) => change('neighborhood', event.target.value)} placeholder="Akwa" /></label><label>Property type<select value={filters.property_type} onChange={(event) => change('property_type', event.target.value)}><option value="">Any type</option><option value="HOUSE">House</option><option value="APARTMENT">Apartment</option><option value="ROOM">Room</option><option value="LAND">Land</option><option value="COMMERCIAL">Commercial</option></select></label><label>Min price<input inputMode="numeric" value={filters.min_price} onChange={(event) => change('min_price', event.target.value)} placeholder="XAF" /></label><label>Max price<input inputMode="numeric" value={filters.max_price} onChange={(event) => change('max_price', event.target.value)} placeholder="XAF" /></label><label>Bedrooms<input inputMode="numeric" value={filters.min_bedrooms} onChange={(event) => change('min_bedrooms', event.target.value)} placeholder="Any" /></label><label>Furnishing<select value={filters.furnishing} onChange={(event) => change('furnishing', event.target.value)}><option value="">Any furnishing</option><option value="FURNISHED">Furnished</option><option value="UNFURNISHED">Unfurnished</option><option value="PARTLY_FURNISHED">Partly furnished</option></select></label><label>Sort<select value={filters.sort} onChange={(event) => change('sort', event.target.value as Filters['sort'])}><option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select></label><button className="primary filterSubmit" type="submit">Apply filters</button></form>{error && <p className="error">{error}</p>}{loading ? <p className="publicState">Loading available listings…</p> : result?.items.length ? <><p className="resultCount">{result.items.length} currently available listing{result.items.length === 1 ? '' : 's'}</p><section className="listingGrid" aria-label="Public listings">{result.items.map((listing) => <ListingCard key={listing.id} listing={listing} />)}</section>{result.has_more && result.next_cursor && <button className="secondary loadMore" type="button" onClick={() => { void load({ ...filters, cursor: result.next_cursor ?? undefined } as Filters, true); }}>Load more listings</button>}</> : <section className="emptyResults"><h2>No listings match those filters.</h2><p>Try widening the region, purpose or price range.</p></section>}</main>;
}

function ListingCard({ listing }: { listing: PublicListing }) {
  const cover = listing.media.find((media) => media.is_cover) ?? listing.media[0];
  return <Link className="listingCard" href={`/listings/${listing.id}`}><div className="listingCardMedia">{cover ? <img src={`/api/public/listings/${listing.id}/media/${cover.id}/variants/${cover.widths.includes(640) ? 640 : cover.widths[0] ?? 320}`} alt="" /> : <span>No image</span>}</div><div className="listingCardBody"><p className="listingKicker">{listing.purpose} · {listing.property.property_type}</p><h2>{listing.title}</h2><p className="listingPrice">{listing.price.amount_minor.toLocaleString()} {listing.price.currency} <span>/ {listing.price.pricing_period.toLowerCase()}</span></p><p className="listingLocation">{listing.location.city}{listing.location.neighborhood ? ` · ${listing.location.neighborhood}` : ''}</p><p className="listingFacts">{listing.property.bedrooms ?? '—'} bd · {listing.property.bathrooms ?? '—'} ba · {listing.property.furnishing?.toLowerCase().replaceAll('_', ' ') ?? 'specification pending'}</p></div></Link>;
}
