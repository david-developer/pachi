'use client';
import { useEffect, useState } from 'react';
import type { StaffSessionResponse, AuthorityRiskInternalSource } from '@pachi/contracts';
type VerificationCase = { id: string; state: string; version: number; reason_code: string | null; policy_version: string; valid_until: string | null };
type ListingPhoto = { id: string; listing_id: string; media_asset_id: string; region: string; listing_title: string | null; status: 'NOT_REVIEWED' | 'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED'; version: number; reason_code: string | null; is_cover: boolean; attached_at: string };
type ListingSubmission = { submission_id: string; listing_id: string; revision_id: string; revision_version: number; offering_id: string; offering_version_id: string; submitted_at: string; media_snapshot: Array<{ listing_media_id: string; media_asset_id: string; display_order: number; is_cover: boolean }>; region: string; city: string; neighborhood: string; purpose: string; title: string | null; description: string | null; currency: string; amount_minor: number | string | null; pricing_period: string; available_from: string | null; owner_user_id: string; market_status: string };
type AuthorityCase = { id:string; property_id:string; relationship_id:string|null; principal_id:string|null; subject_scope:string; trigger_kind:string; allegation_kind:string; state:string; version:number; reason_code:string; safe_remediation:string; source_provenance:string; received_at:string|null; source_review_action_id:string|null };
export default function Page() {
  const [session, setSession] = useState<StaffSessionResponse | null>(null),
    [csrf, setCsrf] = useState(''),
    [status, setStatus] = useState('Loading staff session…');
  const [busy, setBusy] = useState(false);
  const [caseId, setCaseId] = useState('');
  const [verificationCase, setVerificationCase] = useState<VerificationCase | null>(null);
  const [verificationStatus, setVerificationStatus] = useState('');
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<'VERIFIED' | 'REJECTED' | 'NEEDS_RESUBMISSION'>('NEEDS_RESUBMISSION');
  const [reason, setReason] = useState('DOCUMENT_UNREADABLE');
  const [assignee, setAssignee] = useState('');
  const [photoQueue, setPhotoQueue] = useState<ListingPhoto[]>([]);
  const [photoReviewStatus, setPhotoReviewStatus] = useState('');
  const [listingQueue, setListingQueue] = useState<ListingSubmission[]>([]);
  const [listingReviewStatus, setListingReviewStatus] = useState('');
  const [openedListingMedia, setOpenedListingMedia] = useState<string[]>([]);
  const [previewedListingMedia, setPreviewedListingMedia] = useState<string[]>([]);
  const [listingCommand, setListingCommand] = useState<'REQUEST_CHANGES' | 'REJECT' | 'APPROVE_AND_PUBLISH'>('REQUEST_CHANGES');
  const [listingReasonCode, setListingReasonCode] = useState('CONTENT_NEEDS_CORRECTION');
  const [listingReasonText, setListingReasonText] = useState('');
  const [providerMessage, setProviderMessage] = useState('');
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);
  const [photoOutcome, setPhotoOutcome] = useState<'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED'>('CHANGES_REQUIRED');
  const [photoReason, setPhotoReason] = useState('');
  const [riskCaseId, setRiskCaseId] = useState('');
  const [riskPropertyId, setRiskPropertyId] = useState('');
  const [riskRelationshipId, setRiskRelationshipId] = useState('');
  const [riskPrincipalId, setRiskPrincipalId] = useState('');
  const [riskScope, setRiskScope] = useState<'PROPERTY'|'RELATIONSHIP'|'PRINCIPAL'>('PROPERTY');
  const [riskTrigger, setRiskTrigger] = useState<'DISPUTE'|'REPRESENTATION'|'FRAUD'>('DISPUTE');
  const [riskProvenance, setRiskProvenance] = useState<'STAFF_OBSERVATION'|'PROVIDER_REPORT'|'THIRD_PARTY_REPORT'>('STAFF_OBSERVATION');
  const [riskReason, setRiskReason] = useState('');
  const [riskEvidenceId, setRiskEvidenceId] = useState('');
  const [riskDecision, setRiskDecision] = useState<'REVIEW_SOURCE'|'CONFIRM'|'RESOLVE'>('REVIEW_SOURCE');
  const [riskCase, setRiskCase] = useState<AuthorityCase|null>(null);
  const [riskSource, setRiskSource] = useState<AuthorityRiskInternalSource|null>(null);
  const [riskStatus, setRiskStatus] = useState('');
  useEffect(() => {
    let alive = true;
    fetch('/api/session', { cache: 'no-store' })
      .then(async (r) => {
        const b = await r.json();
        if (!alive) return;
        setCsrf(b.csrf ?? '');
        if (r.ok) {
          setSession(b.session);
          setCsrf(b.csrf);
          setStatus('Signed in');
        } else
          setStatus(
            b.error === 'CONFIGURATION'
              ? 'Staff sign-in is not configured. Contact the operator.'
              : b.error === 'ACCESS_DENIED'
                ? 'Access denied. An eligible staff grant is required.'
                : 'Signed out or session expired.',
          );
      })
      .catch(() => {
        if (alive) setStatus('Unable to check staff access. Try again.');
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const deadline = Math.min(
      Date.parse(session.idle_expires_at),
      Date.parse(session.absolute_expires_at),
    );
    const timer = setTimeout(
      () => {
        setSession(null);
        setStatus('Session expired. Sign in again.');
      },
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session]);
  async function logout() {
    setBusy(true);
    try {
      const r = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
      });
      if (!r.ok) throw new Error();
      const b = await r.json();
      window.location.assign(b.logout_url);
    } catch {
      setStatus('Sign-out failed. Please retry.');
      setBusy(false);
    }
  }
  async function caseRequest(path: string, payload?: object) {
    const response = await fetch(`/api/verification-cases/${encodeURIComponent(caseId.trim())}${path}`, { method: payload ? 'POST' : 'GET', headers: payload ? { 'content-type': 'application/json', 'x-csrf-token': csrf } : {}, ...(payload ? { body: JSON.stringify(payload) } : {}), cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? result.error ?? 'Case action was denied');
    return result;
  }
  async function openCase() {
    setVerificationStatus('Loading case…'); setReviewed([]); setVerificationCase(null);
    try { setVerificationCase(await caseRequest('') as VerificationCase); setVerificationStatus('Assigned case loaded.'); }
    catch (error) { setVerificationStatus(error instanceof Error ? error.message : 'Case access denied.'); }
  }
  async function readEvidence(kind: 'GOVERNMENT_ID' | 'LIVE_SELFIE') {
    try { const evidence = await caseRequest(`/evidence/${kind}`) as {content:string}; if (!evidence.content.startsWith('PACHI_SYNTHETIC_')) throw new Error('Unexpected evidence format'); setReviewed((current) => [...new Set([...current,kind])]); setVerificationStatus(`${kind.replaceAll('_',' ')} sample reviewed.`); }
    catch (error) { setVerificationStatus(error instanceof Error ? error.message : 'Evidence access denied.'); }
  }
  async function decide() {
    if (!verificationCase) return;
    setVerificationStatus('Recording decision…');
    try { setVerificationCase(await caseRequest('/decision', { expected_version: verificationCase.version, outcome, reason_code: reason }) as VerificationCase); setVerificationStatus('Decision recorded. The provider can refresh status.'); }
    catch (error) { setVerificationStatus(error instanceof Error ? error.message : 'Decision was not recorded.'); }
  }
  async function assign() {
    setVerificationStatus('Assigning case…');
    try { const assigned = await caseRequest('/assign', { staff_user_id: assignee, expected_version: verificationCase?.version ?? 1 }) as VerificationCase; setVerificationCase(assigned); setVerificationStatus('Case assigned to the scoped officer.'); }
    catch (error) { setVerificationStatus(error instanceof Error ? error.message : 'Assignment denied.'); }
  }
  async function loadPhotoQueue() {
    setPhotoReviewStatus('Loading pending photos…');
    setOpenPhotoId(null);
    try {
      const response = await fetch('/api/listing-photos', { cache: 'no-store' });
      const result = await response.json() as { photos?: ListingPhoto[]; message?: string; error?: string };
      if (!response.ok || !Array.isArray(result.photos)) throw new Error(result.message ?? result.error ?? 'Photo queue unavailable');
      setPhotoQueue(result.photos);
      setPhotoReviewStatus(`${result.photos.length} pending photos in your current scope.`);
    } catch (error) { setPhotoReviewStatus(error instanceof Error ? error.message : 'Photo queue unavailable'); }
  }
  async function reviewPhoto(photo: ListingPhoto) {
    setPhotoReviewStatus('Recording photo decision…');
    try {
      const response = await fetch(`/api/listing-photos/${encodeURIComponent(photo.id)}/decision`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ media_asset_id: photo.media_asset_id, expected_version: photo.version, outcome: photoOutcome, reason_code: photoReason.trim().toUpperCase(), idempotency_key: crypto.randomUUID() }) });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? 'Photo decision denied. Refresh the queue.');
      await loadPhotoQueue();
      setPhotoReviewStatus('Photo decision recorded. Provider status and readiness can be refreshed.');
    } catch (error) { setPhotoReviewStatus(error instanceof Error ? error.message : 'Photo decision denied. Refresh the queue.'); }
  }
  async function loadListingQueue() {
    setListingReviewStatus('Loading submitted revisions…');
    try {
      const response = await fetch('/api/listing-revisions', { cache: 'no-store' });
      const result = await response.json() as { submissions?: ListingSubmission[]; message?: string; error?: string };
      if (!response.ok || !Array.isArray(result.submissions)) throw new Error(result.message ?? result.error ?? 'Listing review queue unavailable');
      setListingQueue(result.submissions);
      setListingReviewStatus(`${result.submissions.length} submitted revisions in your current scope.`);
    } catch (issue) { setListingReviewStatus(issue instanceof Error ? issue.message : 'Listing review queue unavailable.'); }
  }
  function reviewMediaKey(submissionId: string, mediaId: string) { return `${submissionId}:${mediaId}`; }
  async function decideListing(item: ListingSubmission) {
    setListingReviewStatus('Recording listing decision…');
    try {
      const response = await fetch(`/api/listing-revisions/${encodeURIComponent(item.listing_id)}/decision`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ submission_id: item.submission_id, revision_id: item.revision_id, expected_version: item.revision_version,
          command: listingCommand, reason_code: listingReasonCode.trim().toUpperCase(), reason_text: listingReasonText.trim(),
          ...(listingCommand === 'REQUEST_CHANGES' || providerMessage.trim() ? { provider_message: providerMessage.trim() } : {}),
          idempotency_key: crypto.randomUUID() }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? 'Listing decision denied. Refresh the queue.');
      await loadListingQueue();
      setListingReviewStatus('Decision recorded for the exact submitted revision.');
    } catch (issue) { setListingReviewStatus(issue instanceof Error ? issue.message : 'Listing decision denied. Refresh the queue.'); }
  }
  async function riskRequest<T=AuthorityCase>(path:string, method:'GET'|'POST', payload?:object):Promise<T> {
    const response=await fetch(`/api/authority-risk-cases${path}`,{method,headers:method==='POST'?{'content-type':'application/json','x-csrf-token':csrf}:{},...(payload?{body:JSON.stringify(payload)}:{}),cache:'no-store'});
    const result=await response.json();
    if (!response.ok) throw new Error(result.message ?? result.error ?? 'Authority case action denied');
    return result as T;
  }
  async function openRiskCase() { setRiskStatus('Loading authority case…'); setRiskSource(null); try { const result=await riskRequest(`/${encodeURIComponent(riskCaseId.trim())}`,'GET'); setRiskCase(result); setRiskStatus('Assigned case loaded.'); } catch(issue) { setRiskStatus(issue instanceof Error?issue.message:'Case unavailable.'); } }
  async function createRiskCase() { setRiskStatus('Recording reported authority allegation…'); setRiskSource(null); try { const supported=riskScope==='RELATIONSHIP' && riskTrigger==='REPRESENTATION' && riskReason.trim().toUpperCase()==='LISTING_RELATIONSHIP_PRINCIPAL_CONFLICT'; const result=await riskRequest('','POST',{id:riskCaseId.trim(),propertyId:riskPropertyId.trim(),relationshipId:riskRelationshipId.trim()||null,principalId:riskPrincipalId.trim()||null,subjectScope:riskScope,triggerKind:riskTrigger,allegationKind:'REPORTED',provenance:riskProvenance,reasonCode:riskReason.trim().toUpperCase(),...(supported?{evidenceRefType:'LISTING',evidenceRefId:riskEvidenceId.trim()}: {})}); setRiskCase(result); setRiskStatus('Reported allegation recorded as a precautionary hold.'); } catch(issue) { setRiskStatus(issue instanceof Error?issue.message:'Case could not be recorded.'); } }
  async function readRiskSource() { if(!riskCase) return; setRiskStatus('Reading assigned internal source…'); try { const source=await riskRequest<AuthorityRiskInternalSource>(`/${encodeURIComponent(riskCase.id)}/internal-source`,'GET'); setRiskSource(source); setRiskStatus('Current structured source loaded.'); } catch(issue) { setRiskSource(null); setRiskStatus(issue instanceof Error?issue.message:'Internal source unavailable.'); } }
  async function decideRiskCase() { if(!riskCase || !riskSource) return; setRiskStatus('Recording authority decision…'); try { const review=riskDecision==='REVIEW_SOURCE'; const result=await riskRequest(`/${encodeURIComponent(riskCase.id)}/decision`,'POST',{expected_version:riskCase.version,outcome:riskDecision,reason_code:review?(riskSource.finding==='PRESENT'?'SOURCE_SUPPORTS_FINDING':'SOURCE_SUPPORTS_DISPROOF'):riskDecision==='RESOLVE'?'TRIGGER_DISPROVED':'FINDING_CONFIRMED',evidence_ref_type:review?'LISTING':'CASE_ACTION',evidence_ref_id:review?riskSource.listing_id:riskCase.source_review_action_id}); setRiskCase(result); if(!review) setRiskSource(null); setRiskStatus(review?'Versioned internal source review recorded. Confirm or resolve only the supported finding.':'Specific case decision recorded and authority risk re-evaluated.'); } catch(issue) { setRiskStatus(issue instanceof Error?issue.message:'Decision denied. Refresh the case and source.'); } }
  async function claimLegacyRiskCase() { if(!riskCaseId.trim()) return; setRiskStatus('Assigning legacy review…'); setRiskSource(null); try { const result=await riskRequest(`/${encodeURIComponent(riskCaseId.trim())}/claim-legacy`,'POST',{expected_version:1}); setRiskCase(result); setRiskStatus('Legacy review assigned under the current scoped grant.'); } catch(issue) { setRiskStatus(issue instanceof Error?issue.message:'Legacy assignment denied.'); } }
  return (
    <main style={{ maxWidth: 720, margin: '3rem auto', padding: '1rem', fontFamily: 'sans-serif' }}>
      <h1>Pachi staff access</h1>
      <p role="status">{status}</p>
      <AuthError />
      {session ? (
        <>
          <h2>{session.display_name}</h2>
          <ul>
            {session.grants.map((g, i) => (
              <li key={i}>
                {g.role} — {g.scope.kind}: {g.scope.id}
                <br />
                {g.scope.permissions.join(', ')}
                <br />
                Grant expires {g.expires_at}
              </li>
            ))}
          </ul>
          <p>
            Session expires {session.absolute_expires_at}. Idle deadline {session.idle_expires_at}.
          </p>
          <p>
            Recent authentication valid until {session.reauthentication_expires_at}. Sensitive
            actions require reauthentication within 15 minutes.
          </p>
          <section aria-labelledby="verification-heading"><h2 id="verification-heading">Provider identity cases</h2><p>Use the case ID from the provider submission. Case access and decisions require a current assigned grant. Real evidence intake remains disabled pending E01.</p><label>Case ID<input value={caseId} onChange={(event) => setCaseId(event.target.value)} /></label><button type="button" onClick={() => { void openCase(); }}>Open assigned case</button>{verificationStatus && <p role="status">{verificationStatus}</p>}{session.grants.some(g => g.scope.permissions.includes('admin:permissions_manage')) && <div><label>Officer user ID<input value={assignee} onChange={(event) => setAssignee(event.target.value)} /></label><button type="button" onClick={() => { void assign(); }}>Assign scoped officer</button></div>}{verificationCase && <div><p>State: {verificationCase.state}. Policy: {verificationCase.policy_version}. Version: {verificationCase.version}. {verificationCase.reason_code ? `Reason: ${verificationCase.reason_code}.` : ''}</p>{verificationCase.state === 'PENDING' && <><button type="button" onClick={() => { void readEvidence('GOVERNMENT_ID'); }}>Review government ID sample</button><button type="button" onClick={() => { void readEvidence('LIVE_SELFIE'); }}>Review live selfie sample</button><p>Reviewed: {reviewed.join(', ') || 'none'}</p><label>Decision<select value={outcome} onChange={(event) => { const next = event.target.value as typeof outcome; setOutcome(next); setReason(next === 'VERIFIED' ? 'EVIDENCE_ACCEPTED' : next === 'REJECTED' ? 'SUBJECT_MISMATCH' : 'DOCUMENT_UNREADABLE'); }}><option>NEEDS_RESUBMISSION</option><option>REJECTED</option><option>VERIFIED</option></select></label><label>Reason<select value={reason} onChange={(event) => setReason(event.target.value)}>{(outcome === 'VERIFIED' ? ['EVIDENCE_ACCEPTED'] : outcome === 'REJECTED' ? ['SUBJECT_MISMATCH','POLICY_NOT_MET'] : ['DOCUMENT_UNREADABLE','EVIDENCE_INCOMPLETE']).map(code => <option key={code}>{code}</option>)}</select></label><button type="button" disabled={reviewed.length !== 2} onClick={() => { void decide(); }}>Record decision</button></>}</div>}</section>
          <section aria-labelledby="listing-review-heading"><h2 id="listing-review-heading">Listing revision moderation</h2><p>Review the exact submitted revision and inspect its approved media when needed. Publication runs current server checks.</p><button type="button" onClick={() => { void loadListingQueue(); }}>Refresh submitted revisions</button>{listingReviewStatus && <p role="status">{listingReviewStatus}</p>}{listingQueue.length > 0 && <><label>Decision<select value={listingCommand} onChange={(event) => setListingCommand(event.target.value as typeof listingCommand)}><option value="REQUEST_CHANGES">Request changes</option><option value="REJECT">Reject</option><option value="APPROVE_AND_PUBLISH">Approve and publish</option></select></label><label>Internal reason code<input value={listingReasonCode} onChange={(event) => setListingReasonCode(event.target.value)} maxLength={64} /></label><label>Internal reason<textarea value={listingReasonText} onChange={(event) => setListingReasonText(event.target.value)} maxLength={2000} rows={3} /></label>{listingCommand !== 'APPROVE_AND_PUBLISH' && <label>Message to provider<textarea value={providerMessage} onChange={(event) => setProviderMessage(event.target.value)} maxLength={1000} rows={3} /></label>}<ul>{listingQueue.map((item) => <li key={item.submission_id}><h3>{item.title || 'Untitled listing'} · {item.region}</h3><p>{item.purpose} · {item.amount_minor ?? 'No amount'} {item.currency} {item.pricing_period.toLowerCase()} · {item.city}, {item.neighborhood} · {item.market_status.replaceAll('_', ' ').toLowerCase()}</p><p>Revision v{item.revision_version} · submitted {new Date(item.submitted_at).toLocaleString()}</p><p>{item.description || 'No description provided.'}</p><p>Availability from {item.available_from || 'not set'}</p><ul>{item.media_snapshot.map((media) => { const key = reviewMediaKey(item.submission_id, media.listing_media_id); const opened = openedListingMedia.includes(key); return <li key={key}><p>{media.is_cover ? 'Cover photo' : `Photo ${media.display_order + 1}`} · {media.media_asset_id}</p>{opened ? <img src={`/api/listing-revisions/${encodeURIComponent(item.submission_id)}/media/${encodeURIComponent(media.listing_media_id)}/variants/640`} alt={`Private submitted photo ${media.display_order + 1}`} width={320} onLoad={() => setPreviewedListingMedia((current) => current.includes(key) ? current : [...current, key])} onError={() => setListingReviewStatus('Private photo preview failed. Reauthenticate and refresh the queue.')} /> : <button type="button" onClick={() => setOpenedListingMedia((current) => [...current, key])}>Open private photo preview</button>}{previewedListingMedia.includes(key) && <span> Previewed</span>}</li>; })}</ul><button type="button" disabled={!/^[A-Z][A-Z0-9_]{2,63}$/.test(listingReasonCode.trim().toUpperCase()) || !listingReasonText.trim() || (listingCommand === 'REQUEST_CHANGES' && providerMessage.trim().length < 10)} onClick={() => { void decideListing(item); }}>Record {listingCommand.replaceAll('_', ' ').toLowerCase()}</button></li>)}</ul></>}</section>
          <section aria-labelledby="photo-review-heading"><h2 id="photo-review-heading">Listing photo review</h2><p>Processed photos still need a separate content decision. Only photos in your current listing scope appear here. Open a photo to access its private preview.</p><button type="button" onClick={() => { void loadPhotoQueue(); }}>Refresh pending photos</button>{photoReviewStatus && <p role="status">{photoReviewStatus}</p>}{photoQueue.length > 0 && <><label>Decision<select value={photoOutcome} onChange={(event) => setPhotoOutcome(event.target.value as typeof photoOutcome)}><option>CHANGES_REQUIRED</option><option>REJECTED</option><option>APPROVED</option></select></label><label>Reason code<input value={photoReason} onChange={(event) => setPhotoReason(event.target.value)} maxLength={64} placeholder="UPPERCASE_REASON_CODE" /></label><ul>{photoQueue.map(photo => <li key={photo.id}><p>{photo.listing_title || 'Untitled listing'} · {photo.region} · {photo.is_cover ? 'Cover photo' : 'Photo'} · attached {new Date(photo.attached_at).toLocaleString()}</p><p>Association {photo.id} · version {photo.version}</p>{openPhotoId === photo.id ? <><img src={`/api/listing-photos/${encodeURIComponent(photo.id)}/variants/320`} alt={`Private review preview for ${photo.listing_title || 'listing'}`} width={160} onError={() => setPhotoReviewStatus('Private preview unavailable. Reauthenticate or refresh the queue.')} /><button type="button" disabled={!/^[A-Z][A-Z0-9_]{2,63}$/.test(photoReason.trim().toUpperCase())} onClick={() => { void reviewPhoto(photo); }}>Record {photoOutcome.replaceAll('_', ' ').toLowerCase()}</button></> : <button type="button" onClick={() => setOpenPhotoId(photo.id)}>Open private preview for {photo.id}</button>}</li>)}</ul></>}</section>
          {session.grants.some(g=>g.scope.permissions.includes('authority:risk_decide')) &&
            <section aria-labelledby="risk-heading">
              <h2 id="risk-heading">Authority risk cases</h2>
              <p>Use only the case and property in your current assignment. A separate evidence grant and recent reauthentication are required to read internal sources. Real documents remain unavailable under E01.</p>
              <label>Case ID<input value={riskCaseId} onChange={event=>setRiskCaseId(event.target.value)} /></label>
              <button type="button" onClick={()=>{void openRiskCase();}}>Open assigned case</button>
              <button type="button" onClick={()=>{void claimLegacyRiskCase();}}>Claim legacy case</button>
              <label>Property ID<input value={riskPropertyId} onChange={event=>setRiskPropertyId(event.target.value)} /></label>
              <label>Relationship ID, if scoped<input value={riskRelationshipId} onChange={event=>setRiskRelationshipId(event.target.value)} /></label>
              <label>Principal ID, if scoped<input value={riskPrincipalId} onChange={event=>setRiskPrincipalId(event.target.value)} /></label>
              <label>Subject scope<select value={riskScope} onChange={event=>setRiskScope(event.target.value as typeof riskScope)}><option>PROPERTY</option><option>RELATIONSHIP</option><option>PRINCIPAL</option></select></label>
              <label>Trigger<select value={riskTrigger} onChange={event=>setRiskTrigger(event.target.value as typeof riskTrigger)}><option>DISPUTE</option><option>REPRESENTATION</option><option>FRAUD</option></select></label>
              <label>Provenance<select value={riskProvenance} onChange={event=>setRiskProvenance(event.target.value as typeof riskProvenance)}><option>STAFF_OBSERVATION</option><option>PROVIDER_REPORT</option><option>THIRD_PARTY_REPORT</option></select></label>
              <label>Reason code<input value={riskReason} onChange={event=>setRiskReason(event.target.value)} maxLength={64} /></label>
              <label>Internal listing ID for a relationship principal mismatch<input value={riskEvidenceId} onChange={event=>setRiskEvidenceId(event.target.value)} /></label>
              <button type="button" onClick={()=>{void createRiskCase();}}>Record reported allegation</button>
              {riskStatus && <p role="status">{riskStatus}</p>}
              {riskCase && <div>
                <p>{riskCase.trigger_kind} · {riskCase.allegation_kind} · {riskCase.state} · version {riskCase.version}. Reason {riskCase.reason_code}. {riskCase.safe_remediation}</p>
                {riskCase.state==='OPEN' && (riskCase.subject_scope==='RELATIONSHIP' && riskCase.trigger_kind==='REPRESENTATION' && riskCase.reason_code==='LISTING_RELATIONSHIP_PRINCIPAL_CONFLICT'
                  ? <>
                    <button type="button" onClick={()=>{void readRiskSource();}}>Read current internal source</button>
                    {riskSource && <p>Listing {riskSource.listing_id}: {riskSource.finding==='PRESENT'?'provider references conflict':'provider references match'}. Listing principal {riskSource.listing_provider_account_id}; relationship principal {riskSource.relationship_provider_account_id}. Source versions {riskSource.listing_version}/{riskSource.relationship_version}.</p>}
                    <label>Decision<select value={riskDecision} onChange={event=>setRiskDecision(event.target.value as typeof riskDecision)}><option>REVIEW_SOURCE</option><option>CONFIRM</option><option>RESOLVE</option></select></label>
                    {riskCase.source_review_action_id && <p>Reviewed source action: {riskCase.source_review_action_id}</p>}
                    <button type="button" disabled={!riskSource || riskSource.case_id!==riskCase.id || (riskDecision!=='REVIEW_SOURCE' && (!riskCase.source_review_action_id || (riskDecision==='CONFIRM' && riskSource.finding!=='PRESENT') || (riskDecision==='RESOLVE' && riskSource.finding!=='ABSENT')))} onClick={()=>{void decideRiskCase();}}>Record case decision</button>
                  </>
                  : <p>This trigger has no approved internal evidence decision path. Its hold remains open.</p>)}
              </div>}
            </section>}

        </>
      ) : null}
      {csrf ? (
        <button
          disabled={busy}
          onClick={() => {
            void logout();
          }}
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      ) : null}
      <form action="/api/auth/login" method="post">
        <button>{session ? 'Reauthenticate with TOTP' : 'Sign in with staff account'}</button>
      </form>
      <p>
        Use your local staff Cognito account and authenticator. Marketplace sign-in and organization
        roles do not grant staff access.
      </p>
    </main>
  );
}
function AuthError() {
  const [error, setError] = useState('');
  useEffect(() => {
    const code = new URL(window.location.href).searchParams.get('auth_error');
    if (code)
      setError(
        code === 'access_denied'
          ? 'Access denied: no eligible staff grant.'
          : code === 'configuration'
            ? 'Staff authentication configuration is incomplete.'
            : 'Authentication could not be verified. Sign in again with password and TOTP; contact the operator if it persists.',
      );
  }, []);
  return error ? <p role="alert">{error}</p> : null;
}
