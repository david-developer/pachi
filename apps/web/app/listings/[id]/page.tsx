'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicListing } from '@pachi/contracts';
import { BlockControls } from '../../components/block-controls';
import { MarketplaceFooter, MarketplaceHeader, formatPrice, pricePeriod, propertyTypeLabel, purposeLabel } from '../../components/marketplace';
import { PublishedReviews } from '../../components/review-controls';
import { ListingGallery } from './listing-gallery';
import './detail-premium.css';

type DetailState = 'loading' | 'ready' | 'missing' | 'error';
type ContactSession = { authenticated?: boolean; participationAllowed?: boolean; csrfToken?: string };
type Fact = { label: string; value: string | number };
const contactFailure = 'Contact could not be confirmed. Try again.';
const notSpecified = 'Not specified';

function dateLabel(value: string | null | undefined) {
  if (!value) return 'Contact provider for timing';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Contact provider for timing' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function offeringFacts(listing: PublicListing): Fact[] {
  const terms = listing.terms ?? {};
  const amount = (value: number | null | undefined) => value == null ? notSpecified : formatPrice({ ...listing.price, amount_minor: value });
  if (listing.purpose === 'RENT') return [
    { label: 'Deposit', value: amount(terms.deposit_amount_minor) },
    { label: 'Advance rent', value: terms.advance_months == null ? notSpecified : `${terms.advance_months} ${terms.advance_months === 1 ? 'month' : 'months'}` },
    { label: 'Minimum lease', value: terms.minimum_lease_months == null ? notSpecified : `${terms.minimum_lease_months} ${terms.minimum_lease_months === 1 ? 'month' : 'months'}` },
    { label: 'Utilities included', value: terms.utilities_included == null ? notSpecified : terms.utilities_included ? 'Yes' : 'No' },
    { label: 'Service charge', value: amount(terms.service_charge_amount_minor) },
  ];
  if (listing.purpose === 'SHORT_LET') return [
    ...(terms.weekly_amount_minor == null ? [] : [{ label: 'Weekly rate', value: amount(terms.weekly_amount_minor) }]),
    { label: 'Minimum stay', value: terms.minimum_nights == null ? notSpecified : `${terms.minimum_nights} ${terms.minimum_nights === 1 ? 'night' : 'nights'}` },
    { label: 'Guest limit', value: terms.guest_limit ?? notSpecified },
    { label: 'Check-in time', value: terms.check_in_time?.slice(0, 5) ?? notSpecified },
    { label: 'Check-out time', value: terms.check_out_time?.slice(0, 5) ?? notSpecified },
    { label: 'Cleaning fee', value: amount(terms.cleaning_fee_minor) },
  ];
  if (listing.purpose === 'SALE') return [{ label: 'Price negotiable', value: typeof listing.price.negotiable === 'boolean' ? listing.price.negotiable ? 'Yes' : 'No' : notSpecified }];
  return [];
}

function Facts({ facts, className = '' }: { facts: Fact[]; className?: string }) {
  return <dl className={`detailFacts ${className}`}>{facts.filter(fact => fact.value !== notSpecified).map(fact => <div className="factItem" key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
}

function Price({ price }: { price: PublicListing['price'] }) {
  const formatted = formatPrice(price);
  return <>{formatted.slice(0, -(price.currency.length + 1))} <span className="priceCurrency">{price.currency}</span></>;
}

function PropertyMetrics({ listing }: { listing: PublicListing }) {
  return <ul className="detailKeyFacts" aria-label="Key property specifications">
    {listing.property.bedrooms != null && <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 18v-6h18v6M3 16h18M5 12V6h14v6M7 12V9h4v3m2 0V9h4v3M3 18v2m18-2v2" /></svg><span>{listing.property.bedrooms} {listing.property.bedrooms === 1 ? 'bedroom' : 'bedrooms'}</span></li>}
    {listing.property.bathrooms != null && <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 11h18v3a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-3Zm3 0V5a2 2 0 0 1 4 0M7 19l-1 2m11-2 1 2" /></svg><span>{listing.property.bathrooms} {listing.property.bathrooms === 1 ? 'bathroom' : 'bathrooms'}</span></li>}
    {listing.property.size_sqm != null && <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></svg><span>{listing.property.size_sqm} m²</span></li>}
  </ul>;
}

const marketLabels: Record<string, string> = { AVAILABLE: 'Available', PARTIALLY_BOOKED: 'Partially booked', TEMPORARILY_UNAVAILABLE: 'Temporarily unavailable', UNDER_OFFER: 'Under offer', RESERVED: 'Reserved', RENTED: 'Rented', SOLD: 'Sold', UNAVAILABLE: 'Unavailable' };

export default function PublicListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [listing, setListing] = useState<PublicListing | null>(null);
  const [state, setState] = useState<DetailState>('loading');
  const [retryVersion, setRetryVersion] = useState(0);
  const [contactState, setContactState] = useState('');
  const [needsPhone, setNeedsPhone] = useState(false);
  const [contactAllowed, setContactAllowed] = useState(true);
  const [contactBusy, setContactBusy] = useState(false);
  const [mobileContact, setMobileContact] = useState(false);
  const epoch = useRef(0);
  const contactLock = useRef(false);
  const allowed = useRef(true);
  const inquiryKey = useRef<string | null>(null);
  const contactAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const update = () => setMobileContact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const invalidateContact = useCallback(() => {
    epoch.current++;
    contactAbort.current?.abort();
    contactAbort.current = null;
    contactLock.current = false;
    setContactBusy(false);
    setContactState('');
    setNeedsPhone(false);
  }, []);
  const capability = useCallback((canContact: boolean) => {
    allowed.current = canContact;
    setContactAllowed(canContact);
    if (!canContact) invalidateContact();
  }, [invalidateContact]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    invalidateContact();
    const current = epoch.current;
    inquiryKey.current = null;
    allowed.current = true;
    setContactAllowed(true);
    setListing(null);
    setState('loading');
    void (async () => {
      try {
        const { id } = await params;
        if (!active || current !== epoch.current) return;
        const response = await fetch(`/api/public/listings/${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!active || current !== epoch.current) return;
        if (!response.ok) { setState([404, 410].includes(response.status) ? 'missing' : 'error'); return; }
        const value = await response.json() as PublicListing;
        if (!active || current !== epoch.current) return;
        if (value.id !== id || !value.price || !value.property || !value.location || !Array.isArray(value.media)) throw Error();
        setListing(value);
        setState('ready');
      } catch { if (active && current === epoch.current) setState('error'); }
    })();
    return () => {
      active = false;
      epoch.current++;
      controller.abort();
      contactAbort.current?.abort();
      contactAbort.current = null;
      contactLock.current = false;
    };
  }, [params, retryVersion, invalidateContact]);

  async function contact() {
    if (!listing || !allowed.current || contactLock.current) return;
    const id = listing.id;
    const current = epoch.current;
    const controller = new AbortController();
    contactAbort.current = controller;
    contactLock.current = true;
    setContactBusy(true);
    setContactState('');
    setNeedsPhone(false);
    let navigating = false;
    const isCurrent = () => current === epoch.current && !controller.signal.aborted && allowed.current;
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
      const sessionResponse = await fetch('/api/session', { cache: 'no-store', signal });
      if (!isCurrent()) return;
      if (!sessionResponse.ok) throw Error();
      const session = await sessionResponse.json() as ContactSession;
      if (!isCurrent()) return;
      if (session.authenticated === false) {
        window.location.assign(`/api/auth/login?returnTo=${encodeURIComponent(`/listings/${id}`)}`);
        navigating = true;
        return;
      }
      if (session.authenticated !== true) throw Error();
      if (session.participationAllowed === false) {
        setContactState('Verify your phone before contacting a provider.');
        setNeedsPhone(true);
        return;
      }
      if (session.participationAllowed !== true) throw Error();
      if (typeof session.csrfToken !== 'string' || !session.csrfToken) throw Error();
      const response = await fetch(`/api/account/listings/${encodeURIComponent(id)}/inquiry`, {
        method: 'POST', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        headers: { 'x-csrf-token': session.csrfToken, 'idempotency-key': inquiryKey.current ?? (inquiryKey.current = crypto.randomUUID()) },
      });
      if (!isCurrent()) return;
      if (!response.ok) { setContactState(response.status >= 500 ? contactFailure : 'Contact is not available for this listing.'); return; }
      const body = await response.json() as { interaction_id?: unknown };
      if (!isCurrent()) return;
      if (typeof body.interaction_id !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.interaction_id)) throw Error();
      window.location.assign(`/conversations/${encodeURIComponent(body.interaction_id)}`);
      navigating = true;
    } catch { if (isCurrent()) setContactState(contactFailure); }
    finally {
      if (current === epoch.current && !navigating) {
        contactLock.current = false;
        contactAbort.current = null;
        setContactBusy(false);
      }
    }
  }

  const contactButton = (className: string, feedbackId: string, label = 'Contact provider') => <button className={`primary detailContact ${className}`} type="button" disabled={!contactAllowed || contactBusy} aria-busy={contactBusy} aria-describedby={contactState ? feedbackId : undefined} onClick={() => void contact()}>{contactBusy ? label === 'Contact provider' ? 'Opening contact…' : 'Opening inquiry…' : label}<span aria-hidden="true">↗</span></button>;
  const terms = listing ? offeringFacts(listing) : [];
  const unspecifiedTerms = terms.filter(fact => fact.value === notSpecified).map(fact => fact.label.toLowerCase());

  return <div className="marketplacePage premiumDetailPage lovableDetailPage"><MarketplaceHeader active="listings" /><main id="main-content" className="publicShell detailShell">
    <nav aria-label="Breadcrumb"><Link className="backLink" href="/listings">← Back to listings</Link></nav>
    {state === 'loading' && <section className="detailLoading" aria-busy="true"><p className="publicState" role="status">Loading listing…</p><div className="detailLoadingPhoto" aria-hidden="true" /></section>}
    {state === 'missing' && <section className="emptyResults"><p className="sectionEyebrow">Listing unavailable</p><h1>This listing is no longer available.</h1><p>It may have expired or changed status. Browse current listings to find another match.</p><Link className="primary" href="/listings">Browse current listings</Link></section>}
    {state === 'error' && <section className="emptyResults"><p className="sectionEyebrow">Connection interrupted</p><h1>We couldn’t load this listing.</h1><p>Listing details are temporarily unavailable. Try again to check this property.</p><button className="primary" type="button" onClick={() => setRetryVersion(value => value + 1)}>Try again</button></section>}
    {state === 'ready' && listing && <article className="detailPage">
      <ListingGallery key={listing.id} listing={listing} />
      <div className="detailLayout">
        <header className="detailHeader">
          <div className="detailEyebrow"><span>{purposeLabel(listing.purpose)}</span><span>{propertyTypeLabel(listing.property.property_type)}</span></div>
          <div className="detailTitleRow"><h1>{listing.title}</h1></div>
          <p className="listingLocation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.3" /></svg>{[listing.location.neighborhood, listing.location.city, listing.location.region].filter(Boolean).join(' · ')}</p>
          <PropertyMetrics listing={listing} />
        </header>
        <aside className="detailContactCard" aria-label="Contact this property's provider">
          <div className="detailContactPriceGroup"><p className="detailContactPrice"><Price price={listing.price} /><span>{pricePeriod(listing.price.pricing_period)}</span></p>{listing.price.negotiable === true && <p className="detailNegotiable">Price negotiable</p>}{listing.market_status && <p className={`detailMarketStatus${listing.market_status === 'AVAILABLE' ? ' isAvailable' : ''}`}><span aria-hidden="true" />{marketLabels[listing.market_status] ?? 'Contact provider to confirm'}</p>}</div>
          <div className="detailContactAction"><p className="detailProviderLabel">Property provider</p><h2>Ask about this property</h2><p className="detailContactHelp">Confirm the terms and availability with the provider.</p>{contactButton(mobileContact ? 'detailInlineContact' : 'detailDesktopContact', mobileContact ? 'mobile-contact-feedback' : 'desktop-contact-feedback', mobileContact ? 'Ask about this property' : 'Contact provider')}{contactState && !mobileContact && <div className="detailDesktopFeedback"><p id="desktop-contact-feedback" className="error" role="status">{contactState}</p>{needsPhone && <Link className="detailAccountLink" href="/account">Go to your account</Link>}</div>}<p className="detailContactPrivacy">Your inquiry starts a conversation in Pachi. Sign-in and account eligibility are required.</p></div>
          <div className="detailSafety"><BlockControls source="listings" id={listing.id} onCapability={capability} onStart={() => { allowed.current = false; setContactAllowed(false); invalidateContact(); }} onChange={() => invalidateContact()} /></div>
        </aside>
        <div className="detailBody">
          <section className="detailSection detailDescriptionSection"><h2>About this listing</h2><p className="detailDescription">{listing.description}</p></section>
          <section className="detailSection detailPropertySection"><h2>Property details</h2><Facts className="detailPropertyFacts" facts={[
            { label: 'Property type', value: propertyTypeLabel(listing.property.property_type) },
            { label: 'Furnishing', value: listing.property.furnishing ? listing.property.furnishing.toLowerCase().replaceAll('_', ' ').replace(/^./, character => character.toUpperCase()) : notSpecified },
          ]} /></section>
          <section className="detailSection detailOfferingSection"><h2>{listing.purpose === 'RENT' ? 'Rental terms' : listing.purpose === 'SHORT_LET' ? 'Stay details' : 'Offering details'}</h2>{terms.some(fact => fact.value !== notSpecified) && <Facts className="detailTerms" facts={terms} />}{unspecifiedTerms.length > 0 && <p className="detailNote">Confirm {unspecifiedTerms.join(', ')} with the provider.</p>}{listing.purpose === 'SHORT_LET' && <p className="detailNote">Availability is informational. Contact the provider to discuss your stay.</p>}
            <div className="detailAvailability"><h3>Availability</h3><Facts facts={[
              ...(listing.market_status ? [{ label: 'Status', value: marketLabels[listing.market_status] ?? 'Contact provider to confirm' }] : []),
              { label: 'Available from', value: dateLabel(listing.available_from) },
            ]} /></div>
          </section>
          <section className="detailSection detailLocation"><h2>The neighborhood</h2><div className="detailLocationContent"><span className="detailLocationIcon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.3" /></svg></span><div>{listing.location.neighborhood && <p className="detailNeighborhood">{listing.location.neighborhood}</p>}<p>{listing.location.city} · {listing.location.region}</p><small>Structured neighborhood location. No exact address is shown.</small></div></div></section>
          <PublishedReviews endpoint={`/api/public/listings/${encodeURIComponent(listing.id)}/reviews`} title="Provider reputation" />
        </div>
      </div>
      {mobileContact && <div className="detailMobileContact"><div><strong><Price price={listing.price} /></strong><span>{pricePeriod(listing.price.pricing_period)}</span></div>{contactButton('detailMobileContactButton', 'mobile-contact-feedback')}{contactState && <div className="detailMobileFeedback"><p id="mobile-contact-feedback" className="error" role="status">{contactState}</p>{needsPhone && <Link className="detailAccountLink" href="/account">Go to your account</Link>}</div>}</div>}
    </article>}
  </main><MarketplaceFooter /></div>;
}
