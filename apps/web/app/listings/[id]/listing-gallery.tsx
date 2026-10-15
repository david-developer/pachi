'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import type { PublicListing } from '@pachi/contracts';
import { listingMediaUrl } from '../../components/marketplace';

function PhotoPlaceholder({ unavailable = false, alternatives = false }: { unavailable?: boolean; alternatives?: boolean }) {
  return <div className="galleryPlaceholder"><svg aria-hidden="true" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="10" y="12" width="44" height="38" rx="4" /><circle cx="23" cy="25" r="4" /><path d="m12 44 13-12 9 8 9-10 11 12" /></svg><p>{unavailable ? 'This photo couldn’t be loaded.' : 'Photos are not available for this listing.'}</p>{unavailable && alternatives && <span>Select another photo to keep exploring.</span>}</div>;
}

export function ListingGallery({ listing }: { listing: PublicListing }) {
  const media = listing.media.filter(item => listingMediaUrl(listing, item));
  const [selected, setSelected] = useState(() => Math.max(0, media.findIndex(item => item.is_cover)));
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(new Set());
  const thumbnailButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = media[selected];

  function choose(index: number) {
    const next = (index + media.length) % media.length;
    setSelected(next);
    const thumbnail = thumbnailButtons.current[next];
    const strip = thumbnail?.parentElement;
    if (thumbnail && strip) {
      const itemBounds = thumbnail.getBoundingClientRect();
      const stripBounds = strip.getBoundingClientRect();
      const distance = itemBounds.left < stripBounds.left ? itemBounds.left - stripBounds.left : itemBounds.right > stripBounds.right ? itemBounds.right - stripBounds.right : 0;
      if (distance) strip.scrollBy({ left: distance, behavior: 'instant' });
    }
  }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (media.length < 2) return;
    const focusedThumbnail = (event.target as HTMLElement).closest<HTMLElement>('.galleryThumbnail');
    const index = focusedThumbnail ? Number(focusedThumbnail.dataset.photoIndex) : selected;
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? media.length - 1 : null;
    if (next == null) return;
    event.preventDefault();
    choose(next);
    if (focusedThumbnail) thumbnailButtons.current[(next + media.length) % media.length]?.focus({ preventScroll: true });
  }

  return <section className="detailGallery" aria-label="Listing photos" onKeyDown={keyboard}>
    <div className="galleryStage" role="group" tabIndex={media.length > 1 ? 0 : undefined} aria-label={current ? `Photo ${selected + 1} of ${media.length}. ${media.length > 1 ? 'Use left and right arrow keys to explore photos.' : ''}` : undefined}>
      {!current ? <PhotoPlaceholder /> : failed.has(current.id) ? <PhotoPlaceholder unavailable alternatives={media.length > 1} /> : <img className="galleryMainImage" key={current.id} src={listingMediaUrl(listing, current, 1280)} srcSet={current.widths.map(width => `${listingMediaUrl(listing, current, width)} ${width}w`).join(', ')} sizes="(max-width: 700px) calc(100vw - 40px), (max-width: 900px) calc(100vw - 48px), (max-width: 1100px) calc(100vw - 408px), (max-width: 1400px) calc(100vw - 456px), 944px" alt={`${listing.title} — property photo ${selected + 1}`} width={1280} height={800} loading="eager" fetchPriority="high" decoding="async" onError={() => setFailed(previous => new Set(previous).add(current.id))} />}
      {current && <div className="galleryControls"><span className="galleryCounter" aria-live="polite">Photo {selected + 1} of {media.length}</span>{media.length > 1 && <div className="galleryNav"><button type="button" aria-label="Previous photo" onClick={() => choose(selected - 1)}><span aria-hidden="true">←</span></button><button type="button" aria-label="Next photo" onClick={() => choose(selected + 1)}><span aria-hidden="true">→</span></button></div>}</div>}
    </div>
    {media.length > 1 && <div className="galleryThumbnails" aria-label="Choose a property photo">{media.map((item, index) => <button className={`galleryThumbnail${index === selected ? ' isSelected' : ''}`} key={item.id} ref={element => { thumbnailButtons.current[index] = element; }} data-photo-index={index} type="button" aria-label={`Show photo ${index + 1}`} aria-pressed={index === selected} onClick={() => choose(index)}>{failedThumbnails.has(item.id) ? <span className="galleryThumbnailMissing">Photo {index + 1}</span> : <img src={listingMediaUrl(listing, item, 320)} alt="" width={160} height={100} loading="lazy" decoding="async" onError={() => setFailedThumbnails(previous => new Set(previous).add(item.id))} />}</button>)}</div>}
  </section>;
}
