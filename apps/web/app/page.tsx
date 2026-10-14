'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { PublicListing, PublicListingPurpose, PublicListingSearchResponse } from '@pachi/contracts';
import { HomeMark, ListingCard, ListingSkeletons, MarketplaceFooter, MarketplaceHeader } from './components/marketplace';

export default function MarketplaceHomePage() {
  const router = useRouter();
  const [purpose, setPurpose] = useState<PublicListingPurpose>('RENT');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
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
    const query = new URLSearchParams({ purpose });
    if (region) query.set('region', region);
    if (city.trim()) query.set('city', city.trim());
    router.push(`/listings?${query.toString()}`);
  }

  return <div className="marketplace-root"><MarketplaceHeader active="home" /><main id="main-content"><section className="homeHero"><div className="marketplaceContainer"><div className="homeHeroHeading"><div><p className="homeEyebrow"><span /> YOUR NEXT PLACE, IN CAMEROON</p><h1>Good places.<br />New beginnings.</h1></div><p className="homeHeroLead">Find a home, a space for your business, or somewhere to stay. Start your search in Southwest and Littoral.</p></div><form className="homeSearch" onSubmit={search}><div className="homePurpose" role="group" aria-label="Property purpose">{([{ value: 'RENT', label: 'Rent' }, { value: 'SALE', label: 'Buy' }, { value: 'SHORT_LET', label: 'Short let' }] as const).map((option) => <button key={option.value} type="button" aria-pressed={purpose === option.value} className={purpose === option.value ? 'isActive' : ''} onClick={() => setPurpose(option.value)}>{option.label}</button>)}</div><div className="homeSearchFields"><label><span>Region</span><select name="region" value={region} onChange={(event) => setRegion(event.target.value)}><option value="">Southwest &amp; Littoral</option><option value="Southwest">Southwest</option><option value="Littoral">Littoral</option></select></label><label className="homeCityField"><span>City or municipality</span><input name="city" value={city} maxLength={120} onChange={(event) => setCity(event.target.value)} placeholder="Where would you like to look?" autoComplete="address-level2" /></label><button className="primary homeSearchSubmit" type="submit"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.8" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>Search properties</button></div></form><p className="homeSearchHint">Looking for something specific? <Link href="/listings">Explore all properties <span aria-hidden="true">→</span></Link></p></div></section><section className="homeListings marketplaceContainer" aria-labelledby="home-listings-title"><div className="sectionHeading"><div><p className="sectionEyebrow">THE MARKETPLACE</p><h2 id="home-listings-title">Explore the latest listings</h2><p>Available properties, with the details that matter.</p></div><Link className="textLink" href="/listings">View all properties <span aria-hidden="true">→</span></Link></div>{loading ? <ListingSkeletons /> : error ? <div className="marketplaceFeedback" role="alert"><HomeMark /><h3>We couldn’t load the latest listings.</h3><p>Please try again in a moment. You can still start a property search above.</p><button className="secondary" type="button" onClick={() => setRetry((current) => current + 1)}>Try again</button></div> : listings.length ? <div className="listingGrid" aria-label="Latest public listings">{listings.map((listing) => <ListingCard key={listing.id} listing={listing} />)}</div> : <div className="marketplaceFeedback"><HomeMark /><h3>New places will appear here.</h3><p>There are no available listings to show right now. Check back soon, or explore the marketplace.</p><Link className="secondary" href="/listings">Browse properties</Link></div>}</section><section className="homeExplore marketplaceContainer" aria-labelledby="home-explore-title"><div className="sectionHeading"><div><p className="sectionEyebrow">FIND YOUR FIT</p><h2 id="home-explore-title">A place for every next step</h2></div></div><div className="homePurposeGrid"><Link href="/listings?purpose=RENT"><span className="purposeNumber">01</span><div><h3>A place to call home</h3><p>Explore homes and spaces for rent.</p></div><span className="purposeArrow" aria-hidden="true">↗</span></Link><Link href="/listings?purpose=SALE"><span className="purposeNumber">02</span><div><h3>Make your next move</h3><p>Find property and land for sale.</p></div><span className="purposeArrow" aria-hidden="true">↗</span></Link><Link href="/listings?purpose=SHORT_LET"><span className="purposeNumber">03</span><div><h3>Stay a little while</h3><p>Discover places for a shorter stay.</p></div><span className="purposeArrow" aria-hidden="true">↗</span></Link></div></section><section className="homeProvider marketplaceContainer"><div className="homeProviderInner"><div><p className="sectionEyebrow">FOR PROPERTY PROVIDERS</p><h2>Help someone find their next place.</h2><p>Set up your provider profile and manage your property listings with Pachi.</p></div><Link className="providerCta" href="/account#provider-profile">Get started <span aria-hidden="true">→</span></Link></div></section></main><MarketplaceFooter /></div>;
}
