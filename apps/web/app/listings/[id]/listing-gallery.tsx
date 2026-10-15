'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PublicListing } from '@pachi/contracts';
import { listingMediaUrl } from '../../components/marketplace';

function PhotoPlaceholder({ unavailable = false, alternatives = false }: { unavailable?: boolean; alternatives?: boolean }) {
  return <div className="galleryPlaceholder"><svg aria-hidden="true" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="10" y="12" width="44" height="38" rx="4" /><circle cx="23" cy="25" r="4" /><path d="m12 44 13-12 9 8 9-10 11 12" /></svg><p>{unavailable ? 'This photo couldn’t be loaded.' : 'Photos are not available for this listing.'}</p>{unavailable && alternatives && <span>Select another photo to keep exploring.</span>}</div>;
}

export function ListingGallery({ listing }: { listing: PublicListing }) {
  const media = [...new Map(listing.media.filter(item => listingMediaUrl(listing, item)).map(item => [item.id, item])).values()];
  const [selected, setSelected] = useState(() => Math.max(0, media.findIndex(item => item.is_cover)));
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(new Set());
  const [mosaic, setMosaic] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [dialogSelected, setDialogSelected] = useState(0);
  const thumbnailButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const dialogThumbnails = useRef<(HTMLButtonElement | null)[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const current = media[selected];
  const dialogCurrent = media[dialogSelected];
  const supporting = media.map((item, index) => ({ item, index })).filter(({ index }) => index !== selected).slice(0, 2);
  const canOpen = media.some(item => !failed.has(item.id));

  useEffect(() => {
    const viewport = window.matchMedia('(min-width: 701px)');
    const update = () => setMosaic(viewport.matches);
    update();
    viewport.addEventListener('change', update);
    return () => viewport.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!galleryOpen) return;
    const element = dialog.current;
    if (!element) return;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    closeButton.current?.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      if (element.open) element.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
  }, [galleryOpen]);

  function openGallery(index = selected) {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialogSelected(index);
    setGalleryOpen(true);
  }

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
    // These buttons open a stable photo in the dialog; selection must not
    // unmount their focused tile before Enter or Space can activate it.
    if ((event.target as HTMLElement).closest('.gallerySupportingPhoto, .galleryOpen')) return;
    if (media.length < 2) return;
    const focusedThumbnail = (event.target as HTMLElement).closest<HTMLElement>('[data-photo-index]');
    const index = focusedThumbnail ? Number(focusedThumbnail.dataset.photoIndex) : galleryOpen ? dialogSelected : selected;
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? media.length - 1 : null;
    if (next == null) return;
    event.preventDefault();
    if (galleryOpen) setDialogSelected((next + media.length) % media.length);
    else choose(next);
    if (focusedThumbnail) (galleryOpen ? dialogThumbnails : thumbnailButtons).current[(next + media.length) % media.length]?.focus({ preventScroll: true });
  }

  function containDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter(element => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <section className="detailGallery" aria-label="Listing photos" onKeyDown={keyboard}>
    <div className={`galleryMosaic${mosaic && supporting.length ? ' hasSupportingPhotos' : ''}${supporting.length === 1 ? ' hasTwoPhotos' : ''}${!current ? ' hasNoPhotos' : ''}`}>
    <div className="galleryStage" role="group" tabIndex={media.length > 1 ? 0 : undefined} aria-label={current ? `Photo ${selected + 1} of ${media.length}. ${media.length > 1 ? 'Use left and right arrow keys to explore photos.' : ''}` : undefined}>
      {!current ? <PhotoPlaceholder /> : failed.has(current.id) ? <PhotoPlaceholder unavailable alternatives={media.length > 1} /> : <img className="galleryMainImage" key={current.id} src={listingMediaUrl(listing, current, 1280)} srcSet={current.widths.map(width => `${listingMediaUrl(listing, current, width)} ${width}w`).join(', ')} sizes="(max-width: 700px) calc(100vw - 40px), (max-width: 1400px) 65vw, 880px" alt={`${listing.title} — property photo ${selected + 1}`} width={1280} height={800} loading="eager" fetchPriority="high" decoding="async" onError={() => setFailed(previous => new Set(previous).add(current.id))} />}
      {current && <div className="galleryControls"><span className="galleryCounter" aria-live="polite">Photo {selected + 1} of {media.length}</span>{media.length > 1 && <div className="galleryNav"><button type="button" aria-label="Previous photo" onClick={() => choose(selected - 1)}><span aria-hidden="true">←</span></button><button type="button" aria-label="Next photo" onClick={() => choose(selected + 1)}><span aria-hidden="true">→</span></button></div>}</div>}
    </div>
    {mosaic && supporting.length > 0 && <div className="gallerySupportingPhotos">{supporting.map(({ item, index }) => <button className="gallerySupportingPhoto" key={item.id} type="button" aria-label={`Open photo ${index + 1} in full gallery`} onClick={() => openGallery(index)}>{failedThumbnails.has(item.id) ? <span className="gallerySupportingMissing">Photo {index + 1} is unavailable</span> : <img src={listingMediaUrl(listing, item, 640)} alt={`${listing.title} — supporting property photo ${index + 1}`} width={640} height={400} loading="eager" decoding="async" onError={() => setFailedThumbnails(previous => new Set(previous).add(item.id))} />}</button>)}</div>}
    {canOpen && <button className="galleryOpen" type="button" onClick={() => openGallery()}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="12" y="3" width="5" height="5" rx="1" /><rect x="3" y="12" width="5" height="5" rx="1" /><rect x="12" y="12" width="5" height="5" rx="1" /></svg>View {media.length === 1 ? 'photo' : `all ${media.length} photos`}</button>}
    </div>
    {media.length > 1 && <div className="galleryThumbnails" aria-label="Choose a property photo">{media.map((item, index) => <button className={`galleryThumbnail${index === selected ? ' isSelected' : ''}`} key={item.id} ref={element => { thumbnailButtons.current[index] = element; }} data-photo-index={index} type="button" aria-label={`Show photo ${index + 1}`} aria-pressed={index === selected} onClick={() => choose(index)}>{failedThumbnails.has(item.id) ? <span className="galleryThumbnailMissing">Photo {index + 1}</span> : <img src={listingMediaUrl(listing, item, 320)} alt="" width={160} height={100} loading="lazy" decoding="async" onError={() => setFailedThumbnails(previous => new Set(previous).add(item.id))} />}</button>)}</div>}
    <dialog ref={dialog} className="galleryDialog" aria-label="Full property photo gallery" onKeyDown={containDialogFocus} onClose={() => setGalleryOpen(false)}>
      {galleryOpen && <div className="galleryDialogContent"><header><div><p>Property photos</p><h2>{listing.title}</h2></div><button ref={closeButton} className="galleryDialogClose" type="button" aria-label="Close photo gallery" onClick={() => dialog.current?.close()}>Close <span aria-hidden="true">×</span></button></header><div className="galleryDialogStage" role="group" aria-label={`Image ${dialogSelected + 1} of ${media.length}`} tabIndex={0}>{dialogCurrent && !failed.has(dialogCurrent.id) ? <img src={listingMediaUrl(listing, dialogCurrent, 1920)} alt={`${listing.title} — full property photo ${dialogSelected + 1}`} width={1920} height={1200} onError={() => setFailed(previous => new Set(previous).add(dialogCurrent.id))} /> : <PhotoPlaceholder unavailable alternatives={media.length > 1} />}</div><div className="galleryDialogNavigation"><p aria-live="polite">{dialogSelected + 1} / {media.length}</p>{media.length > 1 && <div className="galleryNav"><button type="button" aria-label="Previous gallery photo" onClick={() => setDialogSelected((dialogSelected - 1 + media.length) % media.length)}>←</button><button type="button" aria-label="Next gallery photo" onClick={() => setDialogSelected((dialogSelected + 1) % media.length)}>→</button></div>}</div>{media.length > 1 && <div className="galleryDialogThumbnails" aria-label="Choose a gallery photo">{media.map((item, index) => <button ref={element => { dialogThumbnails.current[index] = element; }} className="galleryDialogThumbnail" key={item.id} data-photo-index={index} type="button" aria-label={`Select gallery photo ${index + 1}`} aria-pressed={dialogSelected === index} onClick={() => setDialogSelected(index)}>{failedThumbnails.has(item.id) ? <span>Photo {index + 1}</span> : <img src={listingMediaUrl(listing, item, 320)} alt="" width={160} height={100} />}</button>)}</div>}</div>}
    </dialog>
  </section>;
}
