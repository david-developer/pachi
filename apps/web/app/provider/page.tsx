'use client';

import { useEffect, useRef, useState } from 'react';

type Session = { authenticated: boolean; accountState?: string; participationAllowed?: boolean; csrfToken?: string };
type Property = { id: string; version: number; property_type: string; region: string; city: string; neighborhood: string; relationship_type: string; bedrooms: number | null; bathrooms: number | null; size_sqm: string | null; furnishing: string | null };
type Draft = { id: string; property_id: string; purpose: string; title: string | null; description: string | null; amount_minor: number | null; pricing_period: string; negotiable: boolean; deposit_amount_minor: number | null; advance_months: number | null; minimum_lease_months: number | null; utilities_included: boolean | null; service_charge_amount_minor: number | null; weekly_amount_minor: number | null; minimum_nights: number | null; guest_limit: number | null; check_in_time: string | null; check_out_time: string | null; cleaning_fee_minor: number | null; available_from: string | null; currency: string; publication_status: 'DRAFT' | 'PENDING_REVIEW'; version: number };
type DraftPhoto = { id: string; media_asset_id: string; display_order: number; is_cover: boolean; status: 'UPLOAD_AUTHORIZED' | 'UPLOADED_QUARANTINED' | 'PROCESSING' | 'READY' | 'FAILED' | 'REJECTED' | 'DELETION_PENDING' | 'DELETED'; review_status: 'NOT_REVIEWED' | 'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED'; next_action: 'WAIT_FOR_PROCESSING' | 'WAIT_FOR_REVIEW' | 'NONE' | 'REPLACE_PHOTO' | 'RETRY_OR_REMOVE'; mime_type: string | null; size_bytes: number | null; width: number | null; height: number | null; variants: Array<{ width: number; height: number; bytes: number; mime: string }>; failure_code: string | null; retryable: boolean };
type Readiness = { listing_id: string; publication_status: 'DRAFT' | 'PENDING_REVIEW'; moderation_status: 'NOT_REVIEWED' | 'IN_REVIEW'; revision_id: string; revision_version: number; offering_id: string; offering_version_id: string; can_submit: boolean; checks: Array<{ code: string; field: string; label: string; status: 'READY' | 'BLOCKED'; message: string | null }>; submission: { id: string; submitted_at: string } | null };
type VerificationCase = { id: string; state: string; version: number; reason_code: string | null; valid_until: string | null; next_action: string };

export default function ProviderWorkspace() {
  const [session, setSession] = useState<Session | null>(null); const [properties, setProperties] = useState<Property[]>([]); const [drafts, setDrafts] = useState<Draft[]>([]); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]); const [photoError, setPhotoError] = useState(''); const [photoProgress, setPhotoProgress] = useState<number | null>(null); const [photoBusy, setPhotoBusy] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null); const [submissionBusy, setSubmissionBusy] = useState(false); const [publicationStatus, setPublicationStatus] = useState<'DRAFT' | 'PENDING_REVIEW'>('DRAFT');
  const [property, setProperty] = useState({ property_type: 'APARTMENT', region: 'Littoral', city: 'Douala', neighborhood: '', relationship_type: 'OWNER' });
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [specifications, setSpecifications] = useState({ bedrooms: '', bathrooms: '', size_sqm: '', furnishing: '' });
  const [specificationError, setSpecificationError] = useState('');
  const [specificationBusy, setSpecificationBusy] = useState(false);
  const [draft, setDraft] = useState({ property_id: '', purpose: 'RENT', title: '', description: '', amount_minor: '', pricing_period: 'MONTHLY', negotiable: false, deposit_amount_minor: '', advance_months: '', minimum_lease_months: '', utilities_included: '', service_charge_amount_minor: '', weekly_amount_minor: '', minimum_nights: '', guest_limit: '', check_in_time: '', check_out_time: '', cleaning_fee_minor: '', available_from: '' });
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [csrf, setCsrf] = useState('');
  const [verificationCase, setVerificationCase] = useState<VerificationCase | null>(null);
  const [syntheticIntakeAvailable, setSyntheticIntakeAvailable] = useState(false);
  const [verificationCapacity, setVerificationCapacity] = useState('OWNER');
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState('');
  const [photoRefreshing, setPhotoRefreshing] = useState(false);
  const [photoRefreshMessage, setPhotoRefreshMessage] = useState('');
  const photoScope = useRef({ draftId: null as string | null, generation: 0, request: 0, poll: 0 });
  const readinessRequest = useRef(0);
  function photoScopeCurrent(id: string, generation: number) { return photoScope.current.draftId === id && photoScope.current.generation === generation; }
  function selectPhotoDraft(id: string | null) {
    const previous = photoScope.current;
    photoScope.current = { draftId: id, generation: previous.generation + 1, request: previous.request + 1, poll: previous.poll + 1 };
    setPhotoRefreshing(false); setPhotoRefreshMessage(''); setPhotoError('');
  }
  useEffect(() => () => { photoScope.current.generation += 1; photoScope.current.poll += 1; }, []);

  async function load() {
    const sessionResponse = await fetch('/api/session', { cache: 'no-store' });
    if (!sessionResponse.ok) throw new Error('Your sign-in session could not be checked. Sign in again.');
    const s = await sessionResponse.json() as Session;
    setSession(s); setCsrf(s.csrfToken ?? '');
    if (s.authenticated && s.participationAllowed) {
      const verificationResponse = await fetch('/api/account/provider/verification', { cache: 'no-store' });
      if (verificationResponse.ok) { const status = await verificationResponse.json() as { case: VerificationCase | null; synthetic_intake_available: boolean }; setVerificationCase(status.case); setSyntheticIntakeAvailable(status.synthetic_intake_available); }
      const [propertiesResponse, draftsResponse] = await Promise.all([fetch('/api/account/properties'), fetch('/api/account/listing-drafts')]);
      if (propertiesResponse.status === 401 || draftsResponse.status === 401) throw new Error('Your sign-in session has expired. Sign in again before loading provider data.');
      if (!propertiesResponse.ok || !draftsResponse.ok) throw new Error('Provider data could not be loaded. Refresh and try again.');
      const p = await propertiesResponse.json() as { properties: Property[] };
      const d = await draftsResponse.json() as { drafts: Draft[] };
      setProperties(p.properties ?? []); setDrafts(d.drafts ?? []);
    }
  }
  useEffect(() => { void load().catch((loadError: unknown) => { setError(loadError instanceof Error ? loadError.message : 'The provider workspace could not be loaded.'); }); }, []);

  async function submitSyntheticVerification() {
    setVerificationBusy(true); setVerificationMessage('');
    try {
      const response = await fetch('/api/account/provider/verification', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ capacity: verificationCapacity, government_id: 'PACHI_SYNTHETIC_GOVERNMENT_ID_V1', live_selfie: 'PACHI_SYNTHETIC_LIVE_SELFIE_V1', idempotency_key: crypto.randomUUID() }) });
      if (!response.ok) { const result = await response.json() as { message?: string }; throw new Error(response.status === 503 ? 'Evidence intake is unavailable until the privacy and retention gate is approved.' : result.message ?? 'Verification submission failed.'); }
      setVerificationCase(await response.json() as VerificationCase);
      setVerificationMessage('Sample case submitted for staff review. No identity has been approved yet.');
    } catch (issue) { setVerificationMessage(issue instanceof Error ? issue.message : 'Verification submission failed.'); }
    finally { setVerificationBusy(false); }
  }

  async function createProperty(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); setMessage(''); try { const response = await fetch('/api/account/properties', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(property) }); if (!response.ok) throw new Error(); setMessage('Property draft saved.'); await load(); } catch { setError('Property could not be saved. Check the required fields.'); } finally { setBusy(false); } }
  function editSpecifications(saved: Property) {
    setEditingPropertyId(saved.id);
    setSpecifications({ bedrooms: saved.bedrooms?.toString() ?? '', bathrooms: saved.bathrooms?.toString() ?? '', size_sqm: saved.size_sqm ?? '', furnishing: saved.furnishing ?? '' });
    setSpecificationError('');
  }
  async function saveSpecifications(event: React.FormEvent) {
    event.preventDefault();
    const current = properties.find((item) => item.id === editingPropertyId);
    if (!current) { setSpecificationError('This property is no longer available. Refresh the page.'); return; }
    const integer = (value: string) => value.trim() === '' ? null : Number(value);
    const bedrooms = integer(specifications.bedrooms);
    const bathrooms = integer(specifications.bathrooms);
    const size = specifications.size_sqm.trim() === '' ? null : Number(specifications.size_sqm);
    if ([bedrooms, bathrooms].some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)) || (size !== null && (!Number.isFinite(size) || size <= 0))) { setSpecificationError('Bedrooms and bathrooms must be nonnegative whole numbers; size must be positive. Your entries are still here.'); return; }
    setSpecificationBusy(true); setSpecificationError(''); setMessage('');
    try {
      const response = await fetch(`/api/account/properties/${current.id}/specifications`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ expected_version: current.version, bedrooms, bathrooms, size_sqm: size, furnishing: specifications.furnishing || null }) });
      if (!response.ok) throw new Error(response.status === 409 ? 'Property details were invalid, changed elsewhere, or can no longer be edited. Your entries are still here; refresh only after copying them.' : 'Property specifications could not be saved. Your entries are still here; try again.');
      const saved = await response.json() as Property;
      setProperties((previous) => previous.map((item) => item.id === saved.id ? saved : item));
      setMessage('Property specifications saved.');
      if (editingDraftId && drafts.some((item) => item.id === editingDraftId && item.property_id === saved.id)) await loadReadiness(editingDraftId).catch(() => setSpecificationError('Specifications were saved, but readiness could not be refreshed. Use Refresh checklist.'));
    } catch (issue) { setSpecificationError(issue instanceof Error ? issue.message : 'Property specifications could not be saved. Your entries are still here.'); }
    finally { setSpecificationBusy(false); }
  }
  async function loadPhotos(listingId: string): Promise<DraftPhoto[] | null> {
    if (photoScope.current.draftId !== listingId) return null;
    const generation = photoScope.current.generation;
    const request = ++photoScope.current.request;
    const current = () => photoScopeCurrent(listingId, generation) && photoScope.current.request === request;
    try {
      const response = await fetch(`/api/account/listing-drafts/${listingId}/media`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (response.status === 401) throw new Error('Your sign-in session has expired. Sign in again to refresh photos.');
      if (!response.ok) throw new Error('Photo status could not be refreshed. Try again.');
      const result = await response.json() as { media: DraftPhoto[] };
      if (!Array.isArray(result.media)) throw new Error('Photo status could not be refreshed. Try again.');
      if (!current()) return null;
      setPhotos(result.media);
      return result.media;
    } catch (error) { if (!current()) return null; throw error; }
  }
  async function refreshPhotos(listingId: string) {
    const generation = photoScope.current.generation;
    photoScope.current.poll += 1; // Manual refresh supersedes the upload poll.
    setPhotoRefreshing(true); setPhotoRefreshMessage(''); setPhotoError('');
    try {
      const records = await loadPhotos(listingId);
      if (!records || !photoScopeCurrent(listingId, generation)) return;
      setPhotoRefreshMessage('Photo status refreshed.');
      if (records.some((photo) => ['UPLOAD_AUTHORIZED', 'UPLOADED_QUARANTINED', 'PROCESSING'].includes(photo.status))) void waitForPhotoProcessing(listingId);
    } catch (error) {
      if (photoScopeCurrent(listingId, generation)) setPhotoError(error instanceof Error ? error.message : 'Photo status could not be refreshed. Try again.');
    } finally { if (photoScopeCurrent(listingId, generation)) setPhotoRefreshing(false); }
  }
  async function loadReadiness(listingId: string) { const generation = photoScope.current.generation; const request = ++readinessRequest.current; const response = await fetch(`/api/account/listing-drafts/${listingId}/readiness`, { cache: 'no-store' }); const result = await response.json() as Readiness; if (!response.ok) throw new Error(); if (photoScopeCurrent(listingId, generation) && request === readinessRequest.current) setReadiness(result); return result; }
  async function requestAuthorityRiskEvaluation() { if (!editingDraftId) return; setSubmissionBusy(true); setError(''); try { const response = await fetch(`/api/account/listing-drafts/${editingDraftId}/authority-risk/evaluate`, { method: 'POST', headers: { 'x-csrf-token': csrf } }); const result = await response.json() as { next_action?: string; message?: string }; if (!response.ok) throw new Error(result.message ?? 'Authority risk evaluation could not be completed.'); await loadReadiness(editingDraftId); setMessage(result.next_action ?? 'Authority risk status refreshed.'); } catch (issue) { setError(issue instanceof Error ? issue.message : 'Authority risk status could not be refreshed.'); } finally { setSubmissionBusy(false); } }
  async function submitDraft() { if (!editingDraftId || !readiness?.can_submit) return; setSubmissionBusy(true); setError(''); try { const response = await fetch(`/api/account/listing-drafts/${editingDraftId}/submissions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ revision_id: readiness.revision_id, offering_version_id: readiness.offering_version_id }) }); const result = await response.json() as { readiness?: Readiness }; if (result.readiness) { setReadiness(result.readiness); setPublicationStatus(result.readiness.publication_status); } if (!response.ok) throw new Error('Submission was not accepted. Review the checklist and refresh readiness.'); setMessage('Submitted for review. This is not approval or publication.'); await load(); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Submission could not be completed.'); } finally { setSubmissionBusy(false); } }
  function uploadFile(listingId: string, file: File, onProgress: (percent: number) => void): Promise<void> { return new Promise((resolve, reject) => { const request = new XMLHttpRequest(); request.open('POST', `/api/account/listing-drafts/${listingId}/media`); request.setRequestHeader('x-csrf-token', csrf); request.setRequestHeader('content-type', file.type); request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); }; request.onload = () => request.status === 202 ? resolve() : reject(new Error(request.status === 413 ? 'Photo exceeds the 15 MiB limit.' : 'Photo upload failed. Choose a JPEG, PNG, or WebP image and retry.')); request.onerror = () => reject(new Error('Connection interrupted. The photo was not confirmed; check its status before retrying.')); request.send(file); }); }
  async function waitForPhotoProcessing(listingId: string) {
    if (photoScope.current.draftId !== listingId) return;
    const generation = photoScope.current.generation;
    const poll = ++photoScope.current.poll;
    const current = () => photoScopeCurrent(listingId, generation) && photoScope.current.poll === poll;
    try {
      for (let attempt = 0; attempt < 35; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (!current()) return;
        const records = await loadPhotos(listingId);
        if (!current() || !records || records.every((photo) => ['READY', 'FAILED', 'REJECTED', 'DELETED'].includes(photo.status))) return;
      }
    } catch { if (current()) setPhotoError('Photo status could not be refreshed. Retry refresh.'); }
  }
  async function uploadPhotos(event: React.ChangeEvent<HTMLInputElement>) { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (!editingDraftId || files.length === 0) return; if (photos.length + files.length > 20) { setPhotoError('A draft can contain at most 20 photos.'); return; } if (files.some((file) => file.size > 15 * 1024 * 1024)) { setPhotoError('Each photo must be 15 MiB or smaller.'); return; } if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setPhotoError('Choose JPEG, PNG, or WebP photos.'); return; } setPhotoBusy(true); setPhotoError(''); try { for (const [index, file] of files.entries()) { await uploadFile(editingDraftId, file, (percent) => setPhotoProgress(Math.round(((index + percent / 100) / files.length) * 100))); } await loadPhotos(editingDraftId); setPhotoProgress(null); void waitForPhotoProcessing(editingDraftId); } catch (uploadError) { setPhotoError(uploadError instanceof Error ? uploadError.message : 'Photo upload failed.'); await loadPhotos(editingDraftId).catch(() => undefined); } finally { setPhotoProgress(null); setPhotoBusy(false); } }
  async function reorderPhotos(next: DraftPhoto[], requestedCoverId?: string) { if (!editingDraftId) return; setPhotoBusy(true); setPhotoError(''); try { const readyCover = next.find((photo) => photo.media_asset_id === requestedCoverId && photo.status === 'READY') ?? next.find((photo) => photo.is_cover && photo.status === 'READY') ?? next.find((photo) => photo.status === 'READY'); if (!readyCover) throw new Error('A processed photo is required to choose a cover.'); const response = await fetch(`/api/account/listing-drafts/${editingDraftId}/media/order`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ media_asset_ids: next.map((photo) => photo.media_asset_id), cover_media_asset_id: readyCover.media_asset_id }) }); const result = await response.json() as { media?: DraftPhoto[] }; if (!response.ok) throw new Error('Photo order could not be saved. Refresh the draft and try again.'); setPhotos(result.media ?? []); } catch (orderError) { setPhotoError(orderError instanceof Error ? orderError.message : 'Photo order could not be saved.'); } finally { setPhotoBusy(false); } }
  async function removePhoto(photo: DraftPhoto) { if (!editingDraftId) return; setPhotoBusy(true); setPhotoError(''); try { const response = await fetch(`/api/account/listing-drafts/${editingDraftId}/media/${photo.media_asset_id}`, { method: 'DELETE', headers: { 'x-csrf-token': csrf } }); const result = await response.json() as { media?: DraftPhoto[] }; if (!response.ok) throw new Error('Photo could not be removed. Refresh and try again.'); setPhotos(result.media ?? []); } catch (removeError) { setPhotoError(removeError instanceof Error ? removeError.message : 'Photo could not be removed.'); } finally { setPhotoBusy(false); } }
  async function retryPhoto(photo: DraftPhoto) { if (!editingDraftId) return; setPhotoBusy(true); setPhotoError(''); try { const response = await fetch(`/api/account/listing-drafts/${editingDraftId}/media/${photo.media_asset_id}/retry`, { method: 'POST', headers: { 'x-csrf-token': csrf } }); if (!response.ok) throw new Error('This photo cannot be retried.'); await loadPhotos(editingDraftId); void waitForPhotoProcessing(editingDraftId); } catch (retryError) { setPhotoError(retryError instanceof Error ? retryError.message : 'Photo retry failed.'); } finally { setPhotoBusy(false); } }
  async function openDraft(id: string) { selectPhotoDraft(id); const generation = photoScope.current.generation; setReadiness(null); setError(''); setPhotos([]); setPhotoError(''); try { const response = await fetch(`/api/account/listing-drafts/${id}`, { cache: 'no-store' }); if (!response.ok) throw new Error(); const saved = await response.json() as Draft; if (!photoScopeCurrent(id, generation)) return; setEditingDraftId(saved.id); setPublicationStatus(saved.publication_status); setDraft({
    property_id: saved.property_id,
    purpose: saved.purpose,
    title: saved.title ?? '',
    description: saved.description ?? '',
    amount_minor: saved.amount_minor?.toString() ?? '',
    pricing_period: saved.pricing_period,
    negotiable: saved.negotiable,
    deposit_amount_minor: saved.deposit_amount_minor?.toString() ?? '',
    advance_months: saved.advance_months?.toString() ?? '',
    minimum_lease_months: saved.minimum_lease_months?.toString() ?? '',
    utilities_included: saved.utilities_included === null ? '' : String(saved.utilities_included),
    service_charge_amount_minor: saved.service_charge_amount_minor?.toString() ?? '',
    weekly_amount_minor: saved.weekly_amount_minor?.toString() ?? '',
    minimum_nights: saved.minimum_nights?.toString() ?? '',
    guest_limit: saved.guest_limit?.toString() ?? '',
    check_in_time: saved.check_in_time?.slice(0, 5) ?? '',
    check_out_time: saved.check_out_time?.slice(0, 5) ?? '',
    cleaning_fee_minor: saved.cleaning_fee_minor?.toString() ?? '',
    available_from: saved.available_from ?? '',
  }); await Promise.all([loadPhotos(saved.id), loadReadiness(saved.id)]);
  } catch { if (photoScopeCurrent(id, generation)) setError('That private draft could not be reopened.'); } }
  async function saveDraft(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); setMessage(''); const numeric = (value: string) => value === '' ? undefined : Number(value); const updatedNumeric = (value: string) => value === '' ? null : numeric(value); const maybeTime = (value: string) => editingDraftId && !value ? null : value || undefined; const payload = { ...draft, amount_minor: editingDraftId ? updatedNumeric(draft.amount_minor) : numeric(draft.amount_minor), deposit_amount_minor: editingDraftId ? updatedNumeric(draft.deposit_amount_minor) : numeric(draft.deposit_amount_minor), advance_months: editingDraftId ? updatedNumeric(draft.advance_months) : numeric(draft.advance_months), minimum_lease_months: editingDraftId ? updatedNumeric(draft.minimum_lease_months) : numeric(draft.minimum_lease_months), utilities_included: draft.utilities_included === '' ? editingDraftId ? null : undefined : draft.utilities_included === 'true', service_charge_amount_minor: editingDraftId ? updatedNumeric(draft.service_charge_amount_minor) : numeric(draft.service_charge_amount_minor), weekly_amount_minor: editingDraftId ? updatedNumeric(draft.weekly_amount_minor) : numeric(draft.weekly_amount_minor), minimum_nights: editingDraftId ? updatedNumeric(draft.minimum_nights) : numeric(draft.minimum_nights), guest_limit: editingDraftId ? updatedNumeric(draft.guest_limit) : numeric(draft.guest_limit), check_in_time: maybeTime(draft.check_in_time), check_out_time: maybeTime(draft.check_out_time), cleaning_fee_minor: editingDraftId ? updatedNumeric(draft.cleaning_fee_minor) : numeric(draft.cleaning_fee_minor), available_from: editingDraftId && !draft.available_from ? null : draft.available_from || undefined }; try { const response = await fetch(editingDraftId ? `/api/account/listing-drafts/${editingDraftId}` : '/api/account/listing-drafts', { method: editingDraftId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error(); const saved = await response.json() as Draft; setEditingDraftId(saved.id); setMessage('Private listing draft saved.'); await load(); await openDraft(saved.id); } catch { setError('Listing draft could not be saved. Check the offering terms and property.'); } finally { setBusy(false); } }
  function startNewDraft() { selectPhotoDraft(null); setEditingDraftId(null); setPublicationStatus('DRAFT'); setReadiness(null); setPhotos([]); setDraft({ property_id: '', purpose: 'RENT', title: '', description: '', amount_minor: '', pricing_period: 'MONTHLY', negotiable: false, deposit_amount_minor: '', advance_months: '', minimum_lease_months: '', utilities_included: '', service_charge_amount_minor: '', weekly_amount_minor: '', minimum_nights: '', guest_limit: '', check_in_time: '', check_out_time: '', cleaning_fee_minor: '', available_from: '' }); }

  if (!session) return <main className="shell"><section className="panel"><h1>Provider workspace</h1><p className="muted">Loading account state.</p></section></main>;
  if (!session.authenticated) return <main className="shell"><section className="panel"><h1>Provider workspace</h1><p className="muted">Sign in before opening provider tools.</p><a className="primary" href="/api/auth/login?returnTo=/provider">Continue with Pachi</a></section></main>;
  if (!session.participationAllowed) return <main className="shell"><section className="panel"><h1>Provider workspace</h1><p className="muted">Phone ownership is required before provider drafts are available.</p><a className="secondary" href="/">Return to account</a></section></main>;
    return <main className="workspace"><nav><a href="/provider" className="active">Overview</a><a href="#properties">Properties</a><a href="#drafts">Listing drafts</a><a href="/provider/listings">Availability and freshness</a><a href="/">Return to account</a></nav><header><p className="eyebrow">PACHI / PROVIDER WORKSPACE</p><h1>Prepare your inventory</h1><p className="muted">Private drafts are saved to your provider account. Nothing here publishes a listing.</p></header>{message && <p className="successMessage">{message}</p>}{error && <p className="error" role="alert">{error}</p>}<section className="tool" aria-labelledby="provider-verification-title"><h2 id="provider-verification-title">Provider identity verification</h2><p>Provider identity is reviewed separately from property authority. A verified decision does not approve photos or publish a listing.</p><p>{verificationCase ? `Case reference: ${verificationCase.id}` : 'No case reference yet.'}</p><p role="status">{verificationCase ? `Status: ${verificationCase.state}. ${verificationCase.reason_code ? `Reason: ${verificationCase.reason_code}. ` : ''}${verificationCase.valid_until ? `Valid until ${new Date(verificationCase.valid_until).toLocaleDateString()}. ` : ''}Next action: ${verificationCase.next_action.replaceAll('_', ' ').toLowerCase()}.` : 'Status: not started. Next action: submit identity evidence when intake is available.'}</p><p>Real identity documents cannot be collected until the approved privacy notice, document list and retention schedule are recorded. Do not send real documents in this development workspace. A synthetic sample decision does not activate a real provider profile or qualify a listing outside isolated tests.</p>{syntheticIntakeAvailable && (!verificationCase || ['SUBMIT_CORRECTION', 'SUBMIT_NEW_CASE', 'RENEW'].includes(verificationCase.next_action)) && <div><label>Declared provider capacity<select value={verificationCapacity} onChange={(event) => setVerificationCapacity(event.target.value)}><option>OWNER</option><option>INDEPENDENT_AGENT</option><option>PROPERTY_MANAGER</option></select></label><button className="secondary" type="button" disabled={verificationBusy} onClick={() => { void submitSyntheticVerification(); }}>{verificationBusy ? 'Submitting…' : 'Submit synthetic sample case'}</button></div>}{verificationMessage && <p role="status">{verificationMessage}</p>}<button className="linkButton" type="button" onClick={() => { void fetch('/api/account/provider/verification', { cache: 'no-store' }).then(async response => { if (response.ok) setVerificationCase((await response.json() as {case: VerificationCase | null}).case); }); }}>Refresh verification status</button></section><section id="properties" className="workspaceGrid"><div className="tool"><h2>New property</h2><form onSubmit={(event) => { void createProperty(event); }}>
<label>Property type<select value={property.property_type} onChange={(e) => setProperty({ ...property, property_type: e.target.value })}><option>APARTMENT</option><option>HOUSE</option><option>ROOM</option><option>LAND</option><option>COMMERCIAL</option></select></label>
<label>Region<select value={property.region} onChange={(e) => setProperty({ ...property, region: e.target.value })}><option>Littoral</option><option>Southwest</option></select></label>
<label>City<input value={property.city} onChange={(e) => setProperty({ ...property, city: e.target.value })} required /></label>
<label>Neighborhood<input value={property.neighborhood} onChange={(e) => setProperty({ ...property, neighborhood: e.target.value })} required /></label>
<button className="primary" disabled={busy}>Save property</button>
</form></div><div className="tool"><h2>Your properties</h2>
{properties.length ? <ul>{properties.map((item) => <li key={item.id}><strong>{item.property_type}</strong><span>{item.city} · {item.neighborhood}</span>{drafts.some((draftItem) => draftItem.property_id === item.id) && <span>Drafts: {drafts.filter((draftItem) => draftItem.property_id === item.id).map((draftItem) => draftItem.title || 'Untitled draft').join(', ')}</span>}<button className="linkButton" type="button" onClick={() => editSpecifications(item)}>Edit specifications</button></li>)}</ul> : <p className="muted">No properties saved yet.</p>}
{editingPropertyId && <form aria-label="Edit property specifications" onSubmit={(event) => { void saveSpecifications(event); }}>
  <h3>Property specifications</h3>
  <p className="muted">Enter only physical details you know. The current checklist needs at least one of bedrooms, bathrooms, size or furnishing.</p>
  {specificationError && <p className="error" role="alert">{specificationError}</p>}
  <fieldset disabled={specificationBusy}>
    <label>Bedrooms<input type="number" min="0" step="1" value={specifications.bedrooms} onChange={(event) => setSpecifications({ ...specifications, bedrooms: event.target.value })} /></label>
    <label>Bathrooms<input type="number" min="0" step="1" value={specifications.bathrooms} onChange={(event) => setSpecifications({ ...specifications, bathrooms: event.target.value })} /></label>
    <label>Size in square metres<input type="number" min="0" step="any" value={specifications.size_sqm} onChange={(event) => setSpecifications({ ...specifications, size_sqm: event.target.value })} /></label>
    <label>Furnishing<select value={specifications.furnishing} onChange={(event) => setSpecifications({ ...specifications, furnishing: event.target.value })}><option value="">Not specified</option><option value="FURNISHED">Furnished</option><option value="UNFURNISHED">Unfurnished</option><option value="PARTLY_FURNISHED">Partly furnished</option></select></label>
    <button className="primary" type="submit">{specificationBusy ? 'Saving…' : 'Save specifications'}</button>
    <button className="secondary" type="button" onClick={() => { setEditingPropertyId(null); setSpecificationError(''); }}>Cancel</button>
  </fieldset>
</form>}</div></section><section id="drafts" className="workspaceGrid"><div className="tool">
    <h2>{editingDraftId ? (publicationStatus === 'PENDING_REVIEW' ? 'Listing under review' : 'Edit private listing draft') : 'New private listing draft'}</h2>
    {editingDraftId && <button className="linkButton" type="button" onClick={startNewDraft}>Create another draft</button>}
    <form onSubmit={(event) => { void saveDraft(event); }}>
      <fieldset disabled={publicationStatus === 'PENDING_REVIEW'}>
      <label>Property<select value={draft.property_id} disabled={Boolean(editingDraftId)} onChange={(event) => setDraft({ ...draft, property_id: event.target.value })} required><option value="">Choose a property</option>{properties.map((item) => <option key={item.id} value={item.id}>{item.city} · {item.neighborhood}</option>)}</select></label>
      <label>Transaction<select value={draft.purpose} disabled={Boolean(editingDraftId)} onChange={(event) => { const purpose = event.target.value; setDraft({ ...draft, purpose, pricing_period: purpose === 'RENT' ? 'MONTHLY' : purpose === 'SALE' ? 'TOTAL' : 'NIGHTLY', deposit_amount_minor: '', advance_months: '', minimum_lease_months: '', utilities_included: '', service_charge_amount_minor: '', weekly_amount_minor: '', minimum_nights: '', guest_limit: '', check_in_time: '', check_out_time: '', cleaning_fee_minor: '' }); }}><option>RENT</option><option>SALE</option><option>SHORT_LET</option></select></label>
      <label>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={4} /></label>
      <label>Amount in XAF<input inputMode="numeric" value={draft.amount_minor} onChange={(event) => setDraft({ ...draft, amount_minor: event.target.value })} /></label>
      <label>Pricing period<select value={draft.pricing_period} disabled><option>MONTHLY</option><option>TOTAL</option><option>NIGHTLY</option></select></label>
      <label><input type="checkbox" checked={draft.negotiable} onChange={(event) => setDraft({ ...draft, negotiable: event.target.checked })} /> Negotiable</label>
      {draft.purpose === 'RENT' && <><label>Deposit in XAF<input inputMode="numeric" value={draft.deposit_amount_minor} onChange={(event) => setDraft({ ...draft, deposit_amount_minor: event.target.value })} /></label><label>Advance months<input inputMode="numeric" value={draft.advance_months} onChange={(event) => setDraft({ ...draft, advance_months: event.target.value })} /></label><label>Minimum lease months<input inputMode="numeric" value={draft.minimum_lease_months} onChange={(event) => setDraft({ ...draft, minimum_lease_months: event.target.value })} /></label><label>Utilities included<select value={draft.utilities_included} onChange={(event) => setDraft({ ...draft, utilities_included: event.target.value })}><option value="">Not specified</option><option value="true">Yes</option><option value="false">No</option></select></label><label>Service charge in XAF<input inputMode="numeric" value={draft.service_charge_amount_minor} onChange={(event) => setDraft({ ...draft, service_charge_amount_minor: event.target.value })} /></label></>}
      {draft.purpose === 'SHORT_LET' && <><label>Weekly rate in XAF<input inputMode="numeric" value={draft.weekly_amount_minor} onChange={(event) => setDraft({ ...draft, weekly_amount_minor: event.target.value })} /></label><label>Minimum nights<input inputMode="numeric" value={draft.minimum_nights} onChange={(event) => setDraft({ ...draft, minimum_nights: event.target.value })} /></label><label>Guest limit<input inputMode="numeric" value={draft.guest_limit} onChange={(event) => setDraft({ ...draft, guest_limit: event.target.value })} /></label><label>Check-in<input type="time" value={draft.check_in_time} onChange={(event) => setDraft({ ...draft, check_in_time: event.target.value })} /></label><label>Check-out<input type="time" value={draft.check_out_time} onChange={(event) => setDraft({ ...draft, check_out_time: event.target.value })} /></label><label>Cleaning fee in XAF<input inputMode="numeric" value={draft.cleaning_fee_minor} onChange={(event) => setDraft({ ...draft, cleaning_fee_minor: event.target.value })} /></label></>}
      <label>Available from<input type="date" value={draft.available_from} onChange={(event) => setDraft({ ...draft, available_from: event.target.value })} /></label>
      <button className="primary" disabled={busy}>{editingDraftId ? 'Save draft changes' : 'Save private draft'}</button>
      </fieldset>
    </form>
    {editingDraftId && <section className="readinessPanel" aria-labelledby="readiness-title"><div className="photoManagerHead"><div><h3 id="readiness-title">Listing readiness</h3><p>{readiness?.publication_status === 'PENDING_REVIEW' ? `Submitted for review · ${readiness.moderation_status}` : 'Backend-checked submission requirements'}</p></div><button className="linkButton" type="button" disabled={submissionBusy} onClick={() => { void loadReadiness(editingDraftId).catch(() => setError('Readiness could not be refreshed.')); }}>Refresh checklist</button></div>{readiness ? <><ul className="readinessList">{readiness.checks.map((check) => <li key={check.code} className={check.status === 'READY' ? 'readinessReady' : 'readinessBlocked'}><strong>{check.label}</strong><span>{check.message ?? 'Ready'}</span></li>)}</ul>{readiness.publication_status === 'DRAFT' ? <><button type="button" disabled={submissionBusy} onClick={() => { void requestAuthorityRiskEvaluation(); }}>Request authority risk evaluation</button><button className="primary" type="button" disabled={!readiness.can_submit || submissionBusy} onClick={() => { void submitDraft(); }}>{submissionBusy ? 'Submitting...' : 'Submit for review'}</button></> : <p className="muted">This exact revision is in review. Editing and photo changes are unavailable until the review outcome allows correction.</p>}</> : <p className="muted">Loading listing readiness.</p>}</section>}
    {editingDraftId && publicationStatus === 'DRAFT' && <section className="photoManager"
      aria-labelledby="draft-photos-title">
      <div className="photoManagerHead">
        <div><h3 id="draft-photos-title">Draft photos</h3><p>{photos.length}/20 photos · JPEG, PNG or WebP · 15 MiB max each</p></div>
        <button className="linkButton" type="button" disabled={photoBusy || photoRefreshing} onClick={() => { void refreshPhotos(editingDraftId); }}>{photoRefreshing ? 'Refreshing…' : 'Refresh status'}</button>
      </div>
      <label className="photoUploadLabel">Add photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={photoBusy || photos.length >= 20} onChange={(event) => { void uploadPhotos(event); }} /></label>
      {photoProgress !== null && <div className="uploadProgress" role="status">
        <span>Uploading photos: {photoProgress}%</span>
        <progress max="100" value={photoProgress} />
      </div>}
      <p role="status" aria-live="polite">{photoRefreshing ? 'Refreshing photo status…' : photoRefreshMessage}</p>
      {photoError && <p className="error" role="alert">{photoError}</p>}
      {photos.length > 0 ? <ol className="photoList">
        {photos.map((photo, index) => <li className="photoRow" key={photo.media_asset_id}>
          <div className="photoThumb">
            {photo.status === 'READY' ? <img src={`/api/account/listing-drafts/${editingDraftId}/media/${photo.media_asset_id}/variants/320`} alt={`Draft photo ${index + 1}`} /> : <span aria-hidden="true">{photo.status === 'PROCESSING' || photo.status === 'UPLOADED_QUARANTINED' ? '…' : '!'}</span>}
          </div>
          <div className="photoInfo">
            <strong>Photo {index + 1}{photo.is_cover ? ' · Cover' : ''}</strong>
            <span>{photoStatusLabel(photo.status)}{photo.width && photo.height ? ` · ${photo.width} × ${photo.height}` : ''}{photo.size_bytes ? ` · ${(photo.size_bytes / (1024 * 1024)).toFixed(1)} MiB` : ''}</span>
            <span>Content review: {photo.review_status.replaceAll('_', ' ').toLowerCase()}. Next action: {photo.next_action === 'NONE' ? 'no photo action needed' : photo.next_action.replaceAll('_', ' ').toLowerCase()}.</span>
            {photo.failure_code && <span className="photoFailure">{photoFailureLabel(photo.failure_code)}</span>}
          </div>
          <div className="photoControls">
            <button type="button" title="Move photo up" aria-label={`Move photo ${index + 1} up`} disabled={photoBusy || index === 0} onClick={() => { const next = [...photos]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; void reorderPhotos(next); }}>↑</button>
            <button type="button" title="Move photo down" aria-label={`Move photo ${index + 1} down`} disabled={photoBusy || index === photos.length - 1} onClick={() => { const next = [...photos]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; void reorderPhotos(next); }}>↓</button>
            {photo.status === 'READY' && !photo.is_cover && <button type="button" className="coverControl" disabled={photoBusy} onClick={() => { void reorderPhotos(photos.map((item) => ({ ...item, is_cover: item.media_asset_id === photo.media_asset_id })), photo.media_asset_id); }}>Set cover</button>}
            {photo.status === 'FAILED' && photo.retryable && <button type="button" className="coverControl" disabled={photoBusy} onClick={() => { void retryPhoto(photo); }}>Retry</button>}
            <button type="button" className="removePhoto" disabled={photoBusy} onClick={() => { void removePhoto(photo); }}>Remove</button>
          </div>
        </li>)}</ol> : <p className="photoEmpty">No photos added to this private draft yet.</p>}
      <p className="photoPrivacy">Photos stay private to this draft. Processing does not approve or publish a listing.</p>
    </section>}
  </div>
  <div className="tool"><h2>Saved drafts</h2>{drafts.length ? <ul>{drafts.map((item) => <li key={item.id}><button className="draftItem" type="button" onClick={() => { void openDraft(item.id); }}><strong>{item.title || 'Untitled draft'}</strong><span>{item.purpose} · {item.amount_minor ?? 'No amount yet'} {item.currency} · {item.publication_status} · v{item.version}</span></button></li>)}</ul> : <p className="muted">No private drafts saved yet.</p>}</div>
</section></main>;
}

function photoStatusLabel(status: DraftPhoto['status']): string { return status === 'UPLOAD_AUTHORIZED' ? 'Upload authorized' : status === 'UPLOADED_QUARANTINED' ? 'Waiting for safety scan' : status === 'PROCESSING' ? 'Processing photo' : status === 'READY' ? 'Ready · private draft' : status === 'FAILED' ? 'Processing failed' : status === 'REJECTED' ? 'Photo rejected' : status === 'DELETION_PENDING' ? 'Removing photo' : 'Removed'; }
function photoFailureLabel(code: string): string { return code === 'SCAN_UNAVAILABLE' ? 'Safety scanner unavailable. Retry when it is online.' : code === 'IMAGE_TOO_LARGE' ? 'Image dimensions exceed 40 megapixels.' : code === 'INFECTED_FILE' ? 'Photo failed the safety scan.' : code === 'SOURCE_MISSING' ? 'Original upload is no longer available.' : code === 'CHECKSUM_MISMATCH' ? 'Stored photo failed its integrity check.' : 'Photo could not be processed.'; }
