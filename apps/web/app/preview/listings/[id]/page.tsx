'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { previewListings } from '../../preview-data';
import { PreviewAction, TrustMark } from '../../preview-shell';
import { formatPrice, formatPropertyType } from '../../preview-utils';
import { usePreview } from '../../preview-context';

export default function PreviewListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { locale, t } = usePreview();
  const listing = previewListings.find((item) => item.id === id);

  if (!listing) return <section className="empty-state"><h1>{t('noResults')}</h1><p>{t('noResultsBody')}</p><Link className="button-dark" href="/preview">{t('back')}</Link></section>;

  const period = listing.period === 'monthly' ? t('perMonth') : listing.period === 'nightly' ? t('perNight') : t('totalPrice');
  return <>
    <div className="detail-topline"><Link className="back-link" href="/preview"><span aria-hidden="true">←</span>{t('back')}</Link><span className="fixture-tag">{t('syntheticNote')}</span></div>
    <div className="detail-title-row"><div><p className="eyebrow">{listing.city} · {listing.area} · {listing.purpose === 'RENT' ? t('rent') : listing.purpose === 'SALE' ? t('sale') : t('shortLet')}</p><h1>{listing.title[locale]}</h1><p className="detail-subtitle">{formatPropertyType(listing.propertyType, locale)} · {listing.bedrooms} {t('beds')} · {listing.areaSqm} {t('sqm')}</p></div><div className="detail-price">{formatPrice(listing.price, locale)} XAF<small>{period}</small></div></div>

    <div className="gallery" role="group" aria-label={t('galleryLabel')}>
      {listing.images.slice(0, 3).map((image, index) => <div className={index === 0 ? 'gallery-main' : 'gallery-side'} key={image}><Image src={image} alt={`${listing.title[locale]} · ${t('showMorePhotos')} ${index + 1}`} fill loading="eager" unoptimized sizes="(max-width: 680px) 100vw, 70vw" /></div>)}
    </div>

    <div className="detail-layout">
      <div className="detail-content">
        <section className="detail-section"><h2>{t('aboutHome')}</h2><p>{listing.description[locale]}</p></section>
        <section className="detail-section"><h2>{t('homeFacts')}</h2><div className="fact-grid"><div className="fact-cell"><span>{t('propertyType')}</span><strong>{formatPropertyType(listing.propertyType, locale)}</strong></div><div className="fact-cell"><span>{t('bedrooms')}</span><strong>{listing.bedrooms}</strong></div><div className="fact-cell"><span>{t('baths')}</span><strong>{listing.bathrooms}</strong></div><div className="fact-cell"><span>{t('sqm')}</span><strong>{listing.areaSqm} {t('sqm')}</strong></div><div className="fact-cell"><span>{t('furnished')}</span><strong>{listing.furnished ? t('yes') : t('no')}</strong></div></div></section>
        <section className="detail-section"><h2>{t('terms')}</h2><div className="fact-grid"><div className="fact-cell"><span>{listing.purpose === 'RENT' ? t('rent') : listing.purpose === 'SALE' ? t('sale') : t('shortLet')}</span><strong>{formatPrice(listing.price, locale)} XAF</strong></div>{listing.deposit !== undefined && <div className="fact-cell"><span>{t('deposit')}</span><strong>{formatPrice(listing.deposit, locale)} XAF</strong></div>}{listing.advance !== undefined && <div className="fact-cell"><span>{t('advance')}</span><strong>{listing.advance}</strong></div>}{listing.utilities !== undefined && <div className="fact-cell"><span>{t('utilities')}</span><strong>{listing.utilities ? t('yes') : t('no')}</strong></div>}{listing.negotiable && <div className="fact-cell"><span>{t('sale')}</span><strong>{t('negotiable')}</strong></div>}</div></section>
        <section className="detail-section"><h2>{t('location')}</h2><div className="location-panel"><div><span className="area-badge">{t('areaBadge')}</span><p><strong>{listing.area}, {listing.city}</strong><br />{listing.region} · Cameroon</p><p>{t('privateLocation')}</p></div><div className="location-art" aria-label={`${t('areaBadge')}: ${listing.area}`}><span className="location-pin" aria-hidden="true" /></div></div></section>
      </div>
      <aside className="provider-card" aria-labelledby="provider-card-title"><div className="provider-card-head"><span className="provider-avatar" aria-hidden="true">{listing.provider.slice(0, 1)}</span><div><strong id="provider-card-title">{listing.provider}</strong><p>{t('providerSample')}</p></div></div><div className="trust-stack"><TrustMark verified={listing.providerState === 'VERIFIED'} label={listing.providerState === 'VERIFIED' ? t('verified') : t('notVerified')} /><TrustMark verified={listing.relationship === 'VERIFIED'} label={listing.relationship === 'VERIFIED' ? t('authorityVerified') : t('declared')} /></div><p className="trust-explainer">{t('trustCopy')}</p><PreviewAction /><PreviewAction viewing /></aside>
    </div>
  </>;
}
