'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { PublicListing, PublicListingPurpose, PublicListingSearchResponse } from '@pachi/contracts';
import { HomeHeroMedia, HomeMark, ListingCard, ListingSkeletons, MarketplaceFooter, MarketplaceHeader, PropertyFactIcon } from './components/marketplace';
import { emptyListingSearch, listingSearchParams, validateListingSearch } from '../lib/listing-search';
import './lovable-home.css';

export default function MarketplaceHomePage() {
  const router = useRouter();
  const [purpose, setPurpose] = useState<PublicListingPurpose>('RENT');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [budget, setBudget] = useState('');
  const [budgetError, setBudgetError] = useState('');
  const [listings, setListings] = useState<PublicListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestOrder = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const request = ++requestOrder.current;
    setLoading(true); setError(false);
    void fetch('/api/public/listings?sort=newest&limit=6', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) }).then(async (response) => {
      if (!response.ok) throw new Error('Listings unavailable');
      const result = await response.json() as PublicListingSearchResponse;
      if (!Array.isArray(result.items)) throw new Error('Listings unavailable');
      if (request === requestOrder.current && !controller.signal.aborted) setListings(result.items);
    }).catch(() => {
      if (request === requestOrder.current && !controller.signal.aborted) setError(true);
    }).finally(() => {
      if (request === requestOrder.current && !controller.signal.aborted) setLoading(false);
    });
    return () => { controller.abort(); };
  }, [retry]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validateListingSearch(homeFilters);
    if (checked.errors.max_price) { setBudgetError(checked.errors.max_price); return; }
    setBudgetError('');
    router.push(`/listings?${listingSearchParams(checked.filters).toString()}`);
  }

  const homeFilters = { ...emptyListingSearch, purpose, region, city, property_type: propertyType, max_price: budget };
  const advancedSearch = `/listings?${listingSearchParams(homeFilters).toString()}`;
  const heroListing = listings.find(listing => listing.media.some(media => media.widths.length > 0));
  // Public inventory supplies approved coarse locations; this is not a city taxonomy.
  const locations = loading || error ? [] : Array.from(new Map(listings
    .filter(listing => ['Southwest', 'Littoral'].includes(listing.location.region) && listing.location.city.trim())
    .map(listing => [`${listing.location.region}:${listing.location.city}`, listing.location] as const)).values()).slice(0, 6);

  return <div className="marketplace-root premiumHomePage lovableHomePage">
    <MarketplaceHeader active="home" />
    <main id="main-content">
      <section className="homeHero">
        <div className="marketplaceContainer homeHeroGrid">
          <div className="homeHeroCopy">
            <p className="homeEyebrow">YOUR NEXT PLACE, IN CAMEROON</p>
            <h1><span className="homeDesktopOnly">Good places.<br /><span>New beginnings.</span></span><span className="homeMobileOnly">A place for your next chapter.</span></h1>
            <p className="homeHeroLead"><span className="homeDesktopOnly">Find a home, a space for your next idea, or a place to stay in Southwest and Littoral.</span><span className="homeMobileOnly">Discover homes and spaces across Southwest and Littoral.</span></p>
            <p className="homeHeroRegion">Property in Cameroon <span aria-hidden="true">·</span> Prices in XAF</p>
          </div>
          <HomeHeroMedia listing={error ? undefined : heroListing} loading={loading} />
          <form className="homeSearch" id="home-search" onSubmit={search}>
            <div className="homePurpose" role="group" aria-label="Property purpose">
              {([{ value: 'RENT', label: 'Rent' }, { value: 'SALE', label: 'Buy' }, { value: 'SHORT_LET', label: 'Short let' }] as const).map(option => <button key={option.value} type="button" aria-pressed={purpose === option.value} className={purpose === option.value ? 'isActive' : ''} onClick={() => setPurpose(option.value)}>{option.label}</button>)}
            </div>
            <div className="homeSearchFields">
              <label className="homeRegionField"><span>Region</span><select name="region" value={region} onChange={event => setRegion(event.target.value)}><option value="">Southwest &amp; Littoral</option><option value="Southwest">Southwest</option><option value="Littoral">Littoral</option></select></label>
              <label className="homeCityField"><span><span className="homeDesktopOnly">City or municipality</span><span className="homeMobileOnly">Where would you like to live?</span></span><span className="homeLocationInput"><PropertyFactIcon kind="location" /><input name="city" value={city} maxLength={120} onChange={event => setCity(event.target.value)} placeholder="Search city or municipality" autoComplete="address-level2" /></span></label>
              <div className="homeSecondaryFilters homeMobileOnly">
                <label><span>Property type</span><select name="property_type" value={propertyType} onChange={event => setPropertyType(event.target.value)}><option value="">Any type</option><option value="HOUSE">House</option><option value="APARTMENT">Apartment</option><option value="ROOM">Room</option><option value="LAND">Land</option><option value="COMMERCIAL">Commercial space</option></select></label>
                <label><span>Budget <small>(max. XAF)</small></span><input name="max_price" aria-label="Budget (maximum XAF)" type="number" inputMode="numeric" min="0" step="1" max="9007199254740991" value={budget} onChange={event => { setBudget(event.target.value); setBudgetError(''); }} placeholder="Any price" aria-invalid={!!budgetError} aria-describedby={budgetError ? 'home-budget-error' : undefined} /></label>
              </div>
              {budgetError && <p className="homeBudgetError" id="home-budget-error" role="alert">{budgetError}</p>}
              <button className="primary homeSearchSubmit" type="submit"><svg className="homeDesktopOnly" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.8" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg><span className="homeDesktopOnly">Search properties</span><span className="homeMobileOnly">Find a home</span><span aria-hidden="true">→</span></button>
            </div>
          </form>
          <p className="homeSearchHint"><span className="homeDesktopOnly">Explore at your own pace.</span> <Link className="homeDesktopOnly" href="/listings">Explore all properties <span aria-hidden="true">↗</span></Link><Link className="homeMobileOnly" href={advancedSearch}>Region &amp; more filters <span aria-hidden="true">↗</span></Link></p>
        </div>
      </section>
      {locations.length > 0 && <nav className="homeLocationShortcuts marketplaceContainer homeMobileOnly" aria-label="Explore Cameroon"><p className="sectionEyebrow">EXPLORE CAMEROON</p><div>{locations.map(location => <Link key={`${location.region}:${location.city}`} href={`/listings?${new URLSearchParams({ region: location.region, city: location.city }).toString()}`}><PropertyFactIcon kind="location" />{location.city}</Link>)}</div></nav>}
      <section className="homeListings marketplaceContainer" aria-labelledby="home-listings-title">
        <div className="sectionHeading"><div><p className="sectionEyebrow">ON THE MARKET</p><h2 id="home-listings-title"><span className="homeDesktopOnly">Find a place that fits.</span><span className="homeMobileOnly">Somewhere you’ll love coming home to.</span></h2><p>Explore the latest available properties.</p></div><Link className="textLink" href="/listings">View all properties <span aria-hidden="true">↗</span></Link></div>
        {loading ? <ListingSkeletons /> : error ? <div className="marketplaceFeedback" role="alert"><HomeMark /><h3>We couldn’t load the latest listings.</h3><p>Please try again in a moment. You can still start a property search above.</p><button className="secondary" type="button" onClick={() => setRetry(current => current + 1)}>Try again</button></div> : listings.length ? <div className="listingGrid" aria-label="Latest public listings">{listings.map(listing => <ListingCard key={listing.id} listing={listing} />)}</div> : <div className="marketplaceFeedback"><HomeMark /><h3>New places will appear here.</h3><p>There are no available listings to show right now. Check back soon, or explore the marketplace.</p><Link className="secondary" href="/listings">Browse properties</Link></div>}
      </section>
      <section className="homeProvider marketplaceContainer"><div className="homeProviderInner"><div><p className="sectionEyebrow">FOR PROPERTY PROVIDERS</p><h2>Have a place to offer?</h2><p>Create your provider profile and manage your listings in one place.</p></div><Link className="providerCta" href="/account#provider-profile">Get started <span aria-hidden="true">↗</span></Link></div></section>
    </main>
    <MarketplaceFooter />
  </div>;
}
