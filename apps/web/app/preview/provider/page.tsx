'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { previewListings, imageForListing } from '../preview-data';
import { TrustMark } from '../preview-shell';
import { formatPrice, formatPropertyType } from '../preview-utils';
import { usePreview } from '../preview-context';

export default function PreviewProviderPage() {
  const { locale, t } = usePreview();
  const [selectedId, setSelectedId] = useState('bonamoussadi-light');
  const [title, setTitle] = useState('A bright home near the Bonamoussadi market');
  const [description, setDescription] = useState('A generous living room opens onto a shaded balcony, close to daily services.');
  const [price, setPrice] = useState('350000');
  const [notice, setNotice] = useState(false);
  const selected = previewListings.find((listing) => listing.id === selectedId) ?? previewListings[0]!;

  function selectDraft(id: string) {
    setSelectedId(id);
    const draft = previewListings.find((listing) => listing.id === id);
    if (!draft) return;
    setTitle(draft.title.en);
    setDescription(draft.description.en);
    setPrice(String(draft.price));
    setNotice(false);
  }

  return <>
    <div className="workspace-title-row"><div><p className="eyebrow">{t('sampleProvider')}</p><h1>{t('homeOverview')}</h1><p>{t('reviewOnly')}</p></div><Link className="button-outline" href="/preview">{t('returnBrowse')} <span aria-hidden="true">↗</span></Link></div>
    <div className="workspace-overview" aria-label={t('homeOverview')}><div className="overview-stat"><span>{t('propertyLabel')}</span><strong>3</strong></div><div className="overview-stat"><span>{t('draftLabel')}</span><strong>3</strong></div><div className="overview-stat"><span>{t('verifiedProfile')}</span><strong>{t('notVerified')}</strong></div></div>
    <div className="provider-status-line"><TrustMark verified={false} label={t('profileDraft')} /><TrustMark verified={false} label={t('notVerified')} /><TrustMark verified={selected.relationship === 'VERIFIED'} label={selected.relationship === 'VERIFIED' ? t('authorityVerified') : t('declared')} /></div>
    <div className="workspace-grid">
      <section className="workspace-panel" aria-labelledby="inventory-title"><div className="fixture-heading"><div><p className="eyebrow">{t('statusSample')}</p><h2 id="inventory-title">{t('propertyLabel')} / {t('draftLabel')}</h2></div><span className="fixture-tag">{t('synthetic')}</span></div>
        {previewListings.slice(0, 3).map((listing) => <article className="sample-record" key={listing.id}><div className="sample-thumb"><Image src={imageForListing(listing)} alt={`${formatPropertyType(listing.propertyType, locale)}, ${listing.area}`} fill unoptimized sizes="100px" /></div><div><button className="record-name" type="button" onClick={() => selectDraft(listing.id)}>{listing.title[locale]}</button><p>{listing.area}, {listing.city} · {formatPrice(listing.price, locale)} XAF</p><span className="record-status">{t('draftStatus')}</span></div></article>)}
        <p className="mobile-note">{t('editingNote')}</p>
      </section>
      <section className="workspace-panel" aria-labelledby="edit-title"><div className="fixture-heading"><div><p className="eyebrow">{t('editExample')}</p><h2 id="edit-title">{selected.title[locale]}</h2></div><span className="record-status">{t('draftStatus')}</span></div>
        <form className="workspace-editor" onSubmit={(event) => { event.preventDefault(); setNotice(true); }}>
          <label>{t('titleLabel')}<input value={title} onChange={(event) => { setTitle(event.target.value); setNotice(false); }} /></label>
          <label>{t('description')}<textarea rows={4} value={description} onChange={(event) => { setDescription(event.target.value); setNotice(false); }} /></label>
          <label>{t('amount')}<input inputMode="numeric" type="number" min="0" value={price} onChange={(event) => { setPrice(event.target.value); setNotice(false); }} /></label>
          {selected.purpose === 'RENT' && <div className="fact-grid"><div className="fact-cell"><span>{t('deposit')}</span><strong>{formatPrice(selected.deposit ?? 0, locale)} XAF</strong></div><div className="fact-cell"><span>{t('advance')}</span><strong>{selected.advance} {locale === 'fr' ? 'mois' : 'months'}</strong></div></div>}
          <button className="button-dark" type="submit">{t('savePreview')} <span aria-hidden="true">↗</span></button>
        </form>
        {notice && <p className="preview-feedback" role="status">{t('saveNotice')}</p>}
        <p className="filter-note">{t('editingNote')}</p>
      </section>
    </div>
  </>;
}
