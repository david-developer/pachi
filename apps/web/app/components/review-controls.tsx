'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ReviewCommandResponse, ReviewCriteria, ReviewDirection, ReviewEligibilityResponse, ReviewPublishedListResponse, ReviewReportReason, ViewingResponse } from '@pachi/contracts';

type Attempt = { path: string; body: Record<string, unknown>; key: string };
const criteriaLabels: Record<string, string> = { listing_accuracy: 'Listing accuracy', communication: 'Communication', reliability: 'Reliability', transparency: 'Transparency', overall_experience: 'Overall experience', appointment_attendance: 'Appointment attendance', respectful_conduct: 'Respectful conduct', overall_interaction: 'Overall interaction' };
const criterionKeys = (direction: ReviewDirection) => direction === 'SEEKER_TO_PROVIDER' ? ['listing_accuracy', 'communication', 'reliability', 'transparency', 'overall_experience'] : ['communication', 'reliability', 'appointment_attendance', 'respectful_conduct', 'overall_interaction'];
const stateLabels = { SUBMITTED_HELD: 'Private until reveal', PUBLISHED: 'Published', UNDER_REVIEW: 'Under moderation review', HIDDEN: 'Hidden', REMOVED: 'Removed', WITHDRAWN: 'Withdrawn' };
const reportReasons: Record<ReviewReportReason, string> = { HARASSMENT: 'Harassment', DISCRIMINATION: 'Discrimination', THREATS: 'Threats', PRIVACY_EXPOSURE: 'Private information exposed', EXTORTION: 'Extortion', IMPERSONATION: 'Impersonation', IRRELEVANT_CONTENT: 'Irrelevant content', OTHER: 'Other safety concern' };
const safeError = (status: number, code?: string) => code === 'ELIGIBILITY_EXPIRED' ? 'The review window has closed. Refresh your eligibility.' :
  status === 401 ? 'Sign in again to access reviews.' : [403, 404].includes(status) ? 'Reviews are unavailable with your current permissions.' :
    status === 409 ? 'The review or its eligibility changed. Refresh before trying again.' : status === 400 ? 'Check the required rating and feedback, then try again.' :
      status === 429 ? 'Too many requests. Wait before trying again.' : 'The review change was not confirmed. Retry the pending change to check its result.';
const deadlineLabel = (value: string) => `${new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC`;
const reviewDate = (value: string) => new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' });
async function code(response: Response) { try { const body = await response.json() as { code?: unknown }; return typeof body.code === 'string' ? body.code : undefined; } catch { return undefined; } }
async function send(attempt: Attempt, csrfToken: string) {
  return fetch(attempt.path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, 'idempotency-key': attempt.key }, body: JSON.stringify(attempt.body), cache: 'no-store', signal: AbortSignal.timeout(10_000) });
}
function CriterionScores({ scores }: { scores: ReviewCriteria }) {
  return <dl>{Object.entries(scores).filter(([key]) => key in criteriaLabels).map(([key, score]) => <div key={key}><dt>{criteriaLabels[key]}</dt><dd>{score} / 5</dd></div>)}</dl>;
}

/** This endpoint returns only the current actor's eligibility and private authorship. */
export function ViewingReviewControls({ viewing, csrfToken, disabled, refreshVersion }: { viewing: ViewingResponse; csrfToken?: string | undefined; disabled: boolean; refreshVersion: number }) {
  const [data, setData] = useState<ReviewEligibilityResponse | null>(null), [busy, setBusy] = useState(true), [sending, setSending] = useState(false);
  const [pending, setPending] = useState<Attempt | null>(null), [error, setError] = useState(''), [feedback, setFeedback] = useState(''), [stale, setStale] = useState(false);
  const [rating, setRating] = useState(''), [text, setText] = useState(''), [criteria, setCriteria] = useState<Record<string, string>>({}), [publishedVersion, setPublishedVersion] = useState(0);
  const alive = useRef(true), reads = useRef(0), commands = useRef(0), dirty = useRef(false);

  async function load() {
    const generation = ++reads.current;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/account/viewings/${encodeURIComponent(viewing.id)}/reviews`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!alive.current || generation !== reads.current) return;
      if (!response.ok) { setData(null); setError(response.status >= 500 ? 'Review eligibility could not be loaded. Check eligibility to try again.' : safeError(response.status)); if ([401, 403, 404].includes(response.status)) { setRating(''); setText(''); setCriteria({}); dirty.current = false; } return; }
      const result = await response.json() as ReviewEligibilityResponse;
      if (!alive.current || generation !== reads.current) return;
      setData(result); setStale(false);
      if (!dirty.current) { setRating(result.own_review ? String(result.own_review.rating) : ''); setText(result.own_review?.text ?? ''); setCriteria(Object.fromEntries(Object.entries(result.own_review?.criteria ?? {}).map(([key, score]) => [key, String(score)]))); }
      setPublishedVersion(value => value + 1);
    } catch { if (alive.current && generation === reads.current) { setData(null); setError('Review eligibility could not be loaded. Check eligibility to try again.'); } }
    finally { if (alive.current && generation === reads.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true; dirty.current = false; setData(null); setRating(''); setText(''); setCriteria({}); setPending(null); setSending(false); setFeedback(''); setStale(false);
    return () => { alive.current = false; reads.current++; commands.current++; };
  }, [viewing.id]);
  useEffect(() => { void load(); }, [viewing.id, viewing.version, refreshVersion]);

  async function command(action?: 'submit' | 'edit' | 'withdraw', event?: FormEvent) {
    event?.preventDefault();
    if (!csrfToken || sending || (!pending && (disabled || busy || stale))) return;
    let attempt = pending;
    if (!attempt) {
      const eligibility = data?.eligibility, own = data?.own_review;
      if (!action || !eligibility || (action === 'submit' ? !eligibility.can_submit : !own || (action === 'edit' ? !own.can_edit : !own.can_withdraw))) return;
      if (action !== 'withdraw' && (!/^[1-5]$/.test(rating) || Array.from(text).length > 2000)) { setError('Choose an overall rating from 1 to 5 and use at most 2,000 Unicode characters.'); return; }
      const body: Record<string, unknown> = { expected_version: action === 'submit' ? eligibility.version : own!.version };
      if (action !== 'withdraw') { body.rating = Number(rating); body.text = text; body.criteria = Object.fromEntries(Object.entries(criteria).filter(([key, score]) => criterionKeys(eligibility.direction).includes(key) && score !== '').map(([key, score]) => [key, Number(score)])); }
      attempt = { path: action === 'submit' ? `/api/account/review-eligibilities/${encodeURIComponent(eligibility.id)}/submit` : `/api/account/reviews/${encodeURIComponent(own!.id)}/${action}`, body, key: crypto.randomUUID() };
    }
    const generation = ++commands.current;
    reads.current++; setBusy(false); setPending(attempt); setSending(true); setError(''); setFeedback('Saving review change…');
    try {
      const response = await send(attempt, csrfToken);
      if (!alive.current || generation !== commands.current) return;
      if (!response.ok) {
        const reason = await code(response); if (!alive.current || generation !== commands.current) return;
        setError(safeError(response.status, reason)); setFeedback('');
        if (response.status < 500) setPending(null);
        if (response.status === 409) setStale(true);
        if ([401, 403, 404].includes(response.status)) { setData(null); setRating(''); setText(''); setCriteria({}); dirty.current = false; }
        return;
      }
      const result = await response.json() as ReviewCommandResponse;
      if (!alive.current || generation !== commands.current) return;
      reads.current++; setBusy(false); setData(previous => previous ? { ...previous, eligibility: previous.eligibility ? { ...previous.eligibility, state: 'CONSUMED', can_submit: false } : null, own_review: result.review } : null);
      setRating(String(result.review.rating)); setText(result.review.text ?? ''); setCriteria(Object.fromEntries(Object.entries(result.review.criteria).map(([key, score]) => [key, String(score)]))); dirty.current = false;
      setPending(null); setPublishedVersion(value => value + 1);
      setFeedback(result.review.state === 'WITHDRAWN' ? 'Your review was withdrawn. This eligibility cannot be used again.' : result.review.state === 'PUBLISHED' ? 'Your review is published. Rating and feedback are locked.' : 'Your review is saved privately until reveal.');
    } catch { if (alive.current && generation === commands.current) { setError(safeError(503)); setFeedback(''); } }
    finally { if (alive.current && generation === commands.current) setSending(false); }
  }
  const eligibility = data?.eligibility, own = data?.own_review, actionable = !disabled && !busy && !sending && !pending && !stale && !!csrfToken;
  return <section className="viewingPanel" aria-label="Your viewing review">
    <h2>Reviews after a completed viewing</h2>
    <button disabled={busy || sending || !!pending} onClick={() => void load()}>Check eligibility</button>
    {busy && <p role="status">Loading review eligibility…</p>}{error && <p role="alert" className="error">{error}</p>}{feedback && <p role="status">{feedback}</p>}
    {data && !eligibility && <p>No review eligibility is available for this appointment. Only the first validated completed viewing in this Interaction creates review slots.</p>}
    {eligibility && <>
      <p>Review deadline: <time dateTime={eligibility.closes_at}>{deadlineLabel(eligibility.closes_at)}</time></p>
      <p>Reviews describe this marketplace viewing experience. They do not confirm a rental, purchase, ownership or legal transaction.</p>
      <p>Reviews stay private until both valid reviews can be revealed or the {eligibility.policy_version === 'bilateral-review-v1' ? '14-day' : eligibility.policy_version === 'bilateral-review-v2' ? '7-day' : 'stored'} window closes. Safety checks may delay reveal. You can edit your held review until reveal; the other participant&apos;s submission status stays private.</p>
      {eligibility.state === 'HELD' && <p role="status">Review eligibility is on hold while attendance or safety concerns are evaluated. A later appointment cannot replace this slot.</p>}
      {eligibility.state === 'EXPIRED' && <p>The review window has closed. This unused eligibility has expired.</p>}
      {eligibility.state === 'REVOKED' && <p>This review eligibility is no longer valid.</p>}
      {eligibility.state === 'OPEN' && !eligibility.can_submit && !own && <p>Submission is unavailable with your current eligibility or permissions.</p>}
      {eligibility.state === 'CONSUMED' && !own && <p>This principal&apos;s review slot has been used. Private authorship is available only to its author.</p>}
      {own && <article aria-label="Your saved review"><h3>Your saved review · {stateLabels[own.state]}</h3><p>Overall rating: {own.rating} / 5</p>{own.text && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{own.text}</p>}<CriterionScores scores={own.criteria}/>
        {own.state === 'PUBLISHED' && <p>{eligibility.state === 'REVOKED' ? 'This previously published review is excluded from reputation by the attendance resolution. Its original rating and feedback remain locked.' : 'Published rating and feedback are locked.'} You can still withdraw your review.</p>}
        {own.state === 'WITHDRAWN' && <p>This slot remains consumed; withdrawal does not permit a replacement review.</p>}
      </article>}
      {(eligibility.can_submit || own?.can_edit) && !pending && <form onSubmit={event => void command(own ? 'edit' : 'submit', event)}><fieldset disabled={!actionable}>
        <legend>{own ? 'Edit your held review' : `Review the ${eligibility.direction === 'SEEKER_TO_PROVIDER' ? 'provider' : 'seeker'}`}</legend>
        <label>Overall rating<select required value={rating} onChange={event => { dirty.current = true; setRating(event.target.value); }}><option value="">Choose 1–5</option>{[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score} / 5</option>)}</select></label>
        <label>Optional review feedback<textarea value={text} onChange={event => { dirty.current = true; setText(event.target.value); }} aria-describedby="review-text-limit" /></label>
        <p id="review-text-limit">{Array.from(text).length.toLocaleString()} / 2,000 Unicode characters. Avoid private addresses, contact details, legal identity and protected or irrelevant personal characteristics.</p>
        <details><summary>Optional structured criteria</summary>{criterionKeys(eligibility.direction).map(key => <label key={key}>{criteriaLabels[key]}<select value={criteria[key] ?? ''} onChange={event => { dirty.current = true; setCriteria(previous => ({ ...previous, [key]: event.target.value })); }}><option value="">Not rated</option>{[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score} / 5</option>)}</select></label>)}</details>
        <button type="submit">{own ? 'Save held review changes' : 'Submit review'}</button>
      </fieldset></form>}
      {own?.can_withdraw && !pending && <button disabled={!actionable} onClick={() => void command('withdraw')}>Withdraw your review</button>}
      {pending && <button disabled={sending} onClick={() => void command()}>{sending ? 'Saving review…' : 'Retry pending review change'}</button>}
      <PublishedReviews endpoint={`/api/account/providers/${encodeURIComponent(viewing.provider_account_id)}/reviews?interaction_id=${encodeURIComponent(viewing.interaction_id)}`} title="Provider reputation" refreshVersion={publishedVersion} />
      <PublishedReviews endpoint={`/api/account/seekers/${encodeURIComponent(viewing.seeker_user_id)}/reviews?interaction_id=${encodeURIComponent(viewing.interaction_id)}`} title="Seeker reputation" refreshVersion={publishedVersion} />
    </>}
  </section>;
}

/** Published projections are fetched afresh; failed reads remove stale public content. */
export function PublishedReviews({ endpoint, title, refreshVersion = 0 }: { endpoint: string; title: string; refreshVersion?: number }) {
  const [data, setData] = useState<ReviewPublishedListResponse | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [reportId, setReportId] = useState<string | null>(null), [reason, setReason] = useState<ReviewReportReason | ''>(''), [details, setDetails] = useState('');
  const [csrf, setCsrf] = useState(''), [sending, setSending] = useState(false), [pending, setPending] = useState<Attempt | null>(null), [reportError, setReportError] = useState(''), [feedback, setFeedback] = useState('');
  const alive = useRef(true), reads = useRef(0), reports = useRef(0);
  async function load(after?: string) {
    const generation = ++reads.current; setBusy(true); setError('');
    const url = new URL(endpoint, window.location.origin); if (after) url.searchParams.set('cursor', after);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!alive.current || generation !== reads.current) return;
      if (!response.ok) { setData(null); setError('Published reputation is unavailable. Refresh to check again.'); return; }
      const result = await response.json() as ReviewPublishedListResponse;
      if (!alive.current || generation !== reads.current) return;
      if (!Array.isArray(result.items) || typeof result.reputation?.count !== 'number') throw Error();
      setData(previous => ({ ...result, items: after && previous ? [...new Map([...previous.items, ...result.items].map(item => [item.id, item])).values()] : result.items }));
    } catch { if (alive.current && generation === reads.current) { setData(null); setError('Published reputation is unavailable. Refresh to check again.'); } }
    finally { if (alive.current && generation === reads.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true; setData(null); setReportId(null); setPending(null); setSending(false); setReason(''); setDetails(''); setFeedback(''); setReportError(''); setCsrf('');
    return () => { alive.current = false; reads.current++; reports.current++; };
  }, [endpoint]);
  useEffect(() => { void load(); }, [endpoint, refreshVersion]);
  async function openReport(id: string) {
    const generation = ++reports.current; setSending(true); setReportError(''); setFeedback('');
    try {
      const response = await fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      const session = await response.json() as { authenticated?: boolean; participationAllowed?: boolean; csrfToken?: string };
      if (!alive.current || generation !== reports.current) return;
      if (!response.ok || !session.authenticated || !session.csrfToken) { setReportError('Sign in to report a published review.'); return; }
      if (!session.participationAllowed) { setReportError('Verify your phone before submitting a report.'); return; }
      setCsrf(session.csrfToken); setReportId(id); setReason(''); setDetails('');
    } catch { if (alive.current && generation === reports.current) setReportError('Reporting could not be opened. Try again.'); }
    finally { if (alive.current && generation === reports.current) setSending(false); }
  }
  async function report(event?: FormEvent) {
    event?.preventDefault(); if (!reportId || !csrf || sending) return;
    let attempt = pending;
    if (!attempt) {
      if (!reason || Array.from(details).length > 2000) { setReportError('Choose a safety reason and use at most 2,000 Unicode characters.'); return; }
      attempt = { path: `/api/account/reviews/${encodeURIComponent(reportId)}/report`, body: { reason, details }, key: crypto.randomUUID() };
    }
    const generation = ++reports.current; setPending(attempt); setSending(true); setReportError('');
    try {
      const response = await send(attempt, csrf);
      if (!alive.current || generation !== reports.current) return;
      if (!response.ok) { setReportError(response.status >= 500 ? 'The report was not confirmed. Retry to check its result.' : safeError(response.status)); if (response.status < 500) setPending(null); return; }
      setPending(null); setReportId(null); setReason(''); setDetails(''); setFeedback('Report recorded privately for moderation review. A report alone does not hide a review.');
    } catch { if (alive.current && generation === reports.current) setReportError('The report was not confirmed. Retry to check its result.'); }
    finally { if (alive.current && generation === reports.current) setSending(false); }
  }
  return <section className="viewingPanel" aria-label={title}><h3>{title}</h3>
    <button disabled={busy} onClick={() => void load()}>Refresh {title.toLowerCase()}</button>
    {busy && <p role="status">Loading published reputation…</p>}{error && <p role="alert" className="error">{error}</p>}
    {data && <><p>{data.reputation.count} published {data.reputation.count === 1 ? 'review' : 'reviews'}</p>{data.reputation.count >= 3 && data.reputation.average !== null ? <p aria-label="Average review rating">Average rating: {data.reputation.average.toFixed(2)} / 5</p> : <p>A numerical average is available after 3 eligible published reviews.</p>}
      {endpoint.startsWith('/api/public/') && <p>Public written feedback awaits moderation controls.</p>}
      <ul aria-label={`${title} published reviews`}>{data.items.map(item => <li key={item.id}><article><p><strong>{item.author_display_name}</strong> · {item.author_role} · {reviewDate(item.date)}</p><p>Validated completed viewing · {item.rating} / 5</p>{item.provider_identity_verified && <p>Provider identity verified</p>}{item.text && !endpoint.startsWith('/api/public/') && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</p>}<CriterionScores scores={item.criteria}/><button disabled={sending || !!pending} onClick={() => void openReport(item.id)}>Report this review</button></article></li>)}</ul>
      {data.next_cursor && <button disabled={busy} onClick={() => void load(data.next_cursor!)}>Load more published reviews</button>}
    </>}
    {feedback && <p role="status">{feedback}</p>}{reportError && <p role="alert" className="error">{reportError}</p>}
    {reportId && !pending && <form onSubmit={event => void report(event)}><fieldset disabled={sending}><legend>Report a published review</legend><label>Review report reason<select required value={reason} onChange={event => setReason(event.target.value as ReviewReportReason)}><option value="">Choose a reason</option>{Object.entries(reportReasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Optional report details<textarea value={details} onChange={event => setDetails(event.target.value)}/></label><p>{Array.from(details).length.toLocaleString()} / 2,000 Unicode characters. Your report is private.</p><button type="submit">Submit review report</button><button type="button" onClick={() => setReportId(null)}>Cancel report</button></fieldset></form>}
    {pending && <button disabled={sending} onClick={() => void report()}>{sending ? 'Sending report…' : 'Retry pending review report'}</button>}
  </section>;
}
