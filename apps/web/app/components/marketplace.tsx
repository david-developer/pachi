'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import type { PublicListing, PublicListingMedia } from '@pachi/contracts';

export function formatPrice(price: PublicListing['price']): string {
  return `${price.amount_minor.toLocaleString('en-CM')} ${price.currency}`;
}

export function pricePeriod(period: string): string {
  return ({ MONTHLY: 'per month', NIGHTLY: 'per night', TOTAL: 'total price' } as Record<string, string>)[period] ?? '';
}

export function purposeLabel(purpose: string): string {
  return ({ RENT: 'For rent', SALE: 'For sale', SHORT_LET: 'Short let' } as Record<string, string>)[purpose] ?? purpose;
}

export function propertyTypeLabel(type: string): string {
  return ({ HOUSE: 'House', APARTMENT: 'Apartment', ROOM: 'Room', LAND: 'Land', COMMERCIAL: 'Commercial space' } as Record<string, string>)[type] ?? type;
}

export function listingMediaUrl(listing: Pick<PublicListing, 'id'>, media: PublicListingMedia, targetWidth = 640): string {
  const widths = [...media.widths].sort((left, right) => left - right);
  const width = widths.find((available) => available >= targetWidth) ?? widths.at(-1);
  return width ? `/api/public/listings/${encodeURIComponent(listing.id)}/media/${encodeURIComponent(media.id)}/variants/${width}` : '';
}

export function HomeMark({ className = '' }: { className?: string }) {
  return <img className={`pachiSymbol ${className}`} src="/brand/pachi-symbol.svg" width="160" height="160" alt="" aria-hidden="true" />;
}

export function PachiWordmark() {
  return <img className="pachiWordmark" src="/brand/pachi-wordmark.svg" width="752" height="208" alt="Pachi" />;
}

export function PropertyFactIcon({ kind }: { kind: 'bed' | 'bath' | 'area' | 'location' }) {
  const path = {
    bed: <><path d="M3 17V7m18 10V7M3 13h18v6M6 13V6h12v7M3 9h18M3 19v2m18-2v2" /></>,
    bath: <><path d="M3 12h18l-2 6H5l-2-6Zm3 6v3m12-3v3M6 12V5a2 2 0 0 1 4 0" /><path d="M9 6h3" /></>,
    area: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    location: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.3" /></>,
  }[kind];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
}

export function HomeHeroMedia({ listing, loading }: { listing: PublicListing | undefined; loading: boolean }) {
  const cover = listing?.media.find(media => media.is_cover && media.widths.length) ?? listing?.media.find(media => media.widths.length);
  const source = listing && cover ? listingMediaUrl(listing, cover, 1280) : '';
  const [failedSource, setFailedSource] = useState('');
  return <div className={`homeHeroVisual${source && source !== failedSource ? ' hasPhoto' : ''}`}>
    {source && source !== failedSource && listing ? <>
      <img className="homeHeroPhoto" src={source} srcSet={cover?.widths.map(width => `${listingMediaUrl(listing, cover, width)} ${width}w`).join(', ')} sizes="(max-width: 599px) 100vw, (max-width: 700px) calc(100vw - 36px), (max-width: 1000px) 50vw, 660px" alt={listing.title} width="1280" height="1100" fetchPriority="high" onError={() => setFailedSource(source)} />
      <Link className="homePhotoCaption" href={`/listings/${encodeURIComponent(listing.id)}`}><span><small>{purposeLabel(listing.purpose)} · {listing.location.city}</small><strong>{listing.title}</strong><span className="homeFeaturedPrice">{listing.price.amount_minor.toLocaleString('en-CM')} <span className="priceCurrency">{listing.price.currency}</span> <small>{pricePeriod(listing.price.pricing_period)}</small></span></span><b aria-hidden="true">↗</b></Link>
    </> : <div className="homeArchitecture" aria-busy={loading}><span className="architectureLines" aria-hidden="true" /><HomeMark /><p>{loading ? 'Finding the possibilities.' : 'Room for your next chapter.'}</p><span>HOMES · LAND · COMMERCIAL SPACES</span></div>}
    <span className="homePhotoEdge" aria-hidden="true">A NEW PERSPECTIVE</span>
  </div>;
}

export function MarketplaceHeader({ active }: { active?: 'home' | 'listings'; compact?: boolean }) {
  const menu = useRef<HTMLDetailsElement>(null);
  function closeMenu() { if (menu.current) menu.current.open = false; }
  const navigation = <><Link href="/listings?purpose=RENT" onClick={closeMenu}>Rent</Link><Link href="/listings?purpose=SALE" onClick={closeMenu}>Buy</Link><Link href="/listings?purpose=SHORT_LET" onClick={closeMenu}>Short let</Link></>;

  return <><a className="skipLink" href="#main-content">Skip to content</a><header className="marketplaceHeader"><div className="marketplaceContainer marketplaceHeaderInner"><Link className="marketplaceBrand" href="/" aria-label="Pachi home" aria-current={active === 'home' ? 'page' : undefined}><PachiWordmark /></Link><nav className="marketplaceDesktopNav" aria-label="Property search">{navigation}</nav><div className="marketplaceHeaderActions"><Link className="accountLink" href="/account">Account</Link><Link className="providerLink" href="/account#provider-profile">List a property <span aria-hidden="true">↗</span></Link></div><details ref={menu} className="marketplaceMenu" onKeyDown={(event) => { if (event.key === 'Escape') { closeMenu(); menu.current?.querySelector('summary')?.focus(); } }}><summary>Menu <span className="menuLines" aria-hidden="true"><i /><i /></span></summary><nav aria-label="Mobile navigation">{navigation}<Link href="/account" onClick={closeMenu}>Your account</Link><Link href="/account#provider-profile" onClick={closeMenu}>List a property</Link><Link href="/conversations" onClick={closeMenu}>Conversations</Link></nav></details></div></header></>;
}

export function MarketplaceFooter() {
  return <footer className="marketplaceFooter"><div className="marketplaceContainer marketplaceFooterInner"><div><Link className="footerBrand" href="/"><PachiWordmark /></Link><p>A place to find your place in Cameroon.</p></div><nav aria-label="Footer navigation"><Link href="/listings">Browse properties</Link><Link href="/account#provider-profile">For providers</Link><Link href="/account">Your account</Link></nav><p className="footerRegion">Southwest &amp; Littoral<br /><span>Prices in XAF</span></p></div></footer>;
}

export function ListingCard({ listing }: { listing: PublicListing }) {
  const cover = listing.media.find((media) => media.is_cover && media.widths.length > 0) ?? listing.media.find((media) => media.widths.length > 0);
  const source = cover ? listingMediaUrl(listing, cover) : '';
  const [failedSource, setFailedSource] = useState('');
  const facts = [
    ...(listing.property.bedrooms !== null ? [{ kind: 'bed' as const, label: `${listing.property.bedrooms} bed${listing.property.bedrooms === 1 ? '' : 's'}` }] : []),
    ...(listing.property.bathrooms !== null ? [{ kind: 'bath' as const, label: `${listing.property.bathrooms} bath${listing.property.bathrooms === 1 ? '' : 's'}` }] : []),
    ...(listing.property.size_sqm ? [{ kind: 'area' as const, label: `${listing.property.size_sqm} m²` }] : []),
  ];

  return <Link className="listingCard" href={`/listings/${encodeURIComponent(listing.id)}`}><div className="listingCardMedia">{source && source !== failedSource ? <img src={source} alt={listing.title} width="640" height="480" loading="lazy" decoding="async" onError={() => setFailedSource(source)} /> : <div className="listingNoPhoto"><span className="noPhotoFrame" aria-hidden="true"><HomeMark /></span><span>No photo available</span><small>Explore the property details</small></div>}<span className="listingPurpose">{purposeLabel(listing.purpose)}</span></div><div className="listingCardBody"><div className="listingPriceRow"><p className="listingPrice">{listing.price.amount_minor.toLocaleString('en-CM')}{' '}<span className="priceCurrency">{listing.price.currency}</span></p><span className="listingPricePeriod">{pricePeriod(listing.price.pricing_period)}</span></div><h2>{listing.title}</h2><p className="listingLocation"><PropertyFactIcon kind="location" /><span>{listing.location.neighborhood ? `${listing.location.neighborhood}, ` : ''}{listing.location.city} · {propertyTypeLabel(listing.property.property_type)}</span></p>{facts.length > 0 && <p className="listingFacts">{facts.map(fact => <span key={fact.kind}><PropertyFactIcon kind={fact.kind} />{fact.label}</span>)}</p>}</div></Link>;
}

export function ListingSkeletons({ count = 6 }: { count?: number }) {
  return <><p className="srOnly" role="status">Loading available listings…</p><div className="listingGrid skeletonGrid" aria-hidden="true">{Array.from({ length: count }, (_, index) => <div className="listingCard listingSkeleton" key={index}><div className="listingCardMedia skeleton" /><div className="listingCardBody"><div className="skeleton skeletonPrice" /><div className="skeleton skeletonTitle" /><div className="skeleton skeletonLine" /><div className="skeleton skeletonFacts" /></div></div>)}</div></>;
}
