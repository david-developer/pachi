'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { previewListings, imageForListing, type PreviewListing } from './preview-data';
import { ListingCard } from './preview-shell';
import { usePreview } from './preview-context';

type Purpose = 'all' | PreviewListing['purpose'];

export default function PreviewDiscoveryPage() {
  const { locale, t } = usePreview();
  const [location, setLocation] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('all');
  const [homeType, setHomeType] = useState('all');
  const [bedrooms, setBedrooms] = useState('all');
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const [furnished, setFurnished] = useState(false);
  const [sort, setSort] = useState('recommended');
  const [loading, setLoading] = useState(false);

  const results = useMemo(() => {
    const searchText = location.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const filtered = previewListings.filter((listing) => {
      const place = `${listing.area} ${listing.city} ${listing.region} ${listing.title.en} ${listing.title.fr}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return (!searchText || place.includes(searchText))
        && (purpose === 'all' || listing.purpose === purpose)
        && (homeType === 'all' || listing.propertyType === homeType)
        && (bedrooms === 'all' || listing.bedrooms >= Number(bedrooms))
        && (!minimum || listing.price >= Number(minimum))
        && (!maximum || listing.price <= Number(maximum))
        && (!furnished || listing.furnished);
    });
    return filtered.sort((a, b) => sort === 'price' ? a.price - b.price : sort === 'newest' ? Number(b.status === 'recent') - Number(a.status === 'recent') : 0);
  }, [location, purpose, homeType, bedrooms, minimum, maximum, furnished, sort]);

  function refreshResults(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    window.setTimeout(() => setLoading(false), 420);
  }

  function clearFilters() {
    setLocation(''); setPurpose('all'); setHomeType('all'); setBedrooms('all'); setMinimum(''); setMaximum(''); setFurnished(false); setSort('recommended'); setLoading(false);
  }

  return <>
    <section className="preview-hero" aria-labelledby="search-title">
      <div><p className="eyebrow">DOUALA · BUEA · XAF</p><h1 id="search-title">{t('homeSearchTitle')}</h1><p>{t('searchSub')}</p></div>
      <div className="hero-photo"><Image src={imageForListing(previewListings[0] as PreviewListing, 1)} alt={t('firstPhoto')} fill loading="eager" unoptimized sizes="(max-width: 680px) 90vw, 330px" /><span className="hero-caption">{t('shownAs')} Douala</span></div>
    </section>

    <form className="search-panel" onSubmit={refreshResults} aria-label={t('search')}>
      <div className="search-grid">
        <label className="location-field">{t('city')}<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder={t('searchHint')} /></label>
        <label>{t('purpose')}<select aria-label={t('purposeLabel')} value={purpose} onChange={(event) => setPurpose(event.target.value as Purpose)}><option value="all">{t('any')}</option><option value="RENT">{t('rent')}</option><option value="SALE">{t('sale')}</option><option value="SHORT_LET">{t('shortLet')}</option></select></label>
        <label>{t('propertyType')}<select aria-label={t('typeLabel')} value={homeType} onChange={(event) => setHomeType(event.target.value)}><option value="all">{t('anyType')}</option><option value="Apartment">{t('apartment')}</option><option value="House">{t('house')}</option><option value="Studio">{t('studio')}</option></select></label>
        <button className="button-dark" type="submit">{t('search')} <span aria-hidden="true">↗</span></button>
      </div>
    </form>

    <div className="filter-layout">
      <aside className="filter-rail" aria-labelledby="filter-title">
        <div className="filter-heading"><h2 id="filter-title">{t('filterPanel')}</h2><button type="button" onClick={clearFilters}>{t('clear')}</button></div>
        <div className="filter-fields">
          <label>{t('bedrooms')}<select aria-label={t('bedroomsLabel')} value={bedrooms} onChange={(event) => setBedrooms(event.target.value)}><option value="all">{t('any')}</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option><option value="4">4+</option></select></label>
          <div className="price-filter"><span className="filter-label">{t('maxPrice')}</span><div className="price-pair"><label><span>{t('minPrice')}</span><input aria-label={t('minPrice')} inputMode="numeric" min="0" type="number" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label><label><span>{t('maxPrice')}</span><input aria-label={t('priceLabel')} inputMode="numeric" min="0" type="number" value={maximum} onChange={(event) => setMaximum(event.target.value)} /></label></div></div>
          <label className="check-row"><input type="checkbox" checked={furnished} onChange={(event) => setFurnished(event.target.checked)} />{t('furnished')}</label>
        </div>
        <p className="filter-note">{t('privateLocation')}</p>
      </aside>

      <section aria-labelledby="results-title" aria-live="polite">
        <div className="results-heading"><div><p className="eyebrow">{t('popularAreas')}</p><h2 id="results-title">{results.length} {t('results')}</h2></div>
          <label className="sort-control">{t('sort')}<select aria-label={t('sortLabel')} value={sort} onChange={(event) => setSort(event.target.value)}><option value="recommended">{t('recommended')}</option><option value="price">{t('priceLow')}</option><option value="newest">{t('newest')}</option></select></label>
        </div>
        {loading ? <div className="loading-state" role="status"><strong>{t('loading')}</strong><span className="loading-dots" aria-hidden="true"><i /><i /><i /></span></div> : results.length ? <div className="listing-grid">{results.map((listing) => <ListingCard key={listing.id} listing={listing} />)}</div> : <div className="empty-state"><span className="empty-mark" aria-hidden="true">?</span><h3>{t('noResults')}</h3><p>{t('noResultsBody')}</p><button className="button-outline" type="button" onClick={clearFilters}>{t('reset')}</button></div>}
      </section>
    </div>
  </>;
}
