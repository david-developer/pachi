'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ViewingCommandResponse, ViewingListResponse, ViewingResponse } from '@pachi/contracts';
import { ViewingAppointmentControls } from './viewing-appointment-controls';
import { DEFAULT_VIEWING_TIMEZONE, viewingTimeLabel, viewingTimeToUtc } from '@/lib/viewing-time';

type Session = { authenticated: boolean; csrfToken?: string };
type Attempt = { path: string; body: Record<string, unknown>; key: string };
const safeError = (status: number, code?: string) => code === 'REQUEST_EXPIRED' ? 'This request has expired. Refresh its current state.' :
  code === 'APPOINTMENT_PAST' ? 'The appointment time has passed. Refresh its current state.' :
    code === 'ACTIVE_VIEWING_EXISTS' ? 'This conversation already has an active appointment. Refresh your viewings.' :
      status === 401 ? 'Sign in again to view your appointments.' :
  [403, 404].includes(status) ? 'This viewing is not available with your current account permissions.' :
    status === 409 ? 'This viewing changed. Refresh its current state before trying again.' :
      status === 400 ? 'Check the time, timezone and required fields, then try again.' :
        status === 429 ? 'Too many requests. Wait before trying again.' :
          'The change was not confirmed. Retry the pending change to check its result.';
const isAuthorityError = (status: number) => [401, 403, 404].includes(status);
const reasonLabels: Record<string, string> = { UNAVAILABLE: 'Unavailable', TIME_UNSUITABLE: 'Time unsuitable', SAFETY: 'Safety concern', PLANS_CHANGED: 'Plans changed', OTHER: 'Other' };
const historyReasonLabels: Record<string, string> = { ...reasonLabels, RESPONSE_DEADLINE_ELAPSED: 'Response deadline elapsed' };
async function responseCode(response: Response): Promise<string | undefined> {
  try { const body = await response.json() as { code?: unknown }; return typeof body.code === 'string' ? body.code : undefined; }
  catch { return undefined; }
}

async function sendAttempt(attempt: Attempt, csrfToken: string) {
  return fetch(attempt.path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, 'idempotency-key': attempt.key },
    body: JSON.stringify(attempt.body), cache: 'no-store', signal: AbortSignal.timeout(10_000)
  });
}

export function ViewingSummary({ viewing }: { viewing: ViewingResponse }) {
  return <>
    <p><strong>{viewing.state}</strong> · {viewing.actor_side === 'PROVIDER' ? 'Incoming request' : 'Your request'}</p>
    <p>{viewingTimeLabel(viewing.scheduled_start ?? viewing.proposed_start, viewing.display_timezone)} – {viewingTimeLabel(viewing.scheduled_end ?? viewing.proposed_end, viewing.display_timezone)}</p>
  </>;
}

/** Conversation request entry and participant-scoped inbox share the same server capabilities. */
export function ViewingList({ interactionId, csrfToken }: { interactionId?: string | undefined; csrfToken?: string | undefined }) {
  const [items, setItems] = useState<ViewingResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [canRequest, setCanRequest] = useState(false);
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_VIEWING_TIMEZONE);
  const [pending, setPending] = useState<Attempt | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);

  async function load(after?: string) {
    const current = ++generation.current;
    setBusy(true); setError('');
    const query = new URLSearchParams();
    if (interactionId) query.set('interaction_id', interactionId);
    if (after) query.set('cursor', after);
    try {
      const response = await fetch(`/api/account/viewings${query.size ? `?${query}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!alive.current || current !== generation.current) return;
      if (!response.ok) {
        setCanRequest(false);
        if (isAuthorityError(response.status)) setItems([]);
        setError(isAuthorityError(response.status) ? safeError(response.status) : 'Viewings could not be loaded. Refresh to try again.');
        return;
      }
      const result = await response.json() as ViewingListResponse;
      if (!alive.current || current !== generation.current) return;
      setItems(previous => after ? [...new Map([...previous, ...result.items].map(item => [item.id, item])).values()] : result.items);
      setCursor(result.next_cursor); setCanRequest(result.can_request === true);
    } catch {
      if (alive.current && current === generation.current) { setCanRequest(false); setError('Viewings could not be loaded. Refresh to try again.'); }
    } finally { if (alive.current && current === generation.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true;
    setItems([]); setCanRequest(false); setCursor(null); setPending(null); setSending(false);
    setStart(''); setEnd(''); setFeedback('');
    void load();
    return () => { alive.current = false; generation.current++; };
    // Each mounted interaction has its own request and response generation.
  }, [interactionId]);

  async function requestViewing(event?: FormEvent) {
    event?.preventDefault();
    if (!interactionId || !csrfToken || sending) return;
    let attempt = pending;
    if (!attempt) {
      try {
        const proposedStart = viewingTimeToUtc(start, timezone);
        const proposedEnd = viewingTimeToUtc(end, timezone);
        if (Date.parse(proposedStart) <= Date.now() || Date.parse(proposedEnd) <= Date.parse(proposedStart))
          throw new Error('Choose a future start and an end after the start.');
        attempt = { path: `/api/account/interactions/${encodeURIComponent(interactionId)}/viewings`, key: crypto.randomUUID(), body: { proposed_start: proposedStart, proposed_end: proposedEnd, display_timezone: timezone } };
      } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check the proposed time.'); return; }
    }
    const current = ++generation.current;
    setPending(attempt); setSending(true); setBusy(false); setError(''); setFeedback('Requesting viewing…');
    try {
      const response = await sendAttempt(attempt, csrfToken);
      if (!alive.current || current !== generation.current) return;
      if (!response.ok) {
        const code = await responseCode(response);
        if (!alive.current || current !== generation.current) return;
        setError(safeError(response.status, code)); setFeedback('');
        if (response.status < 500) setPending(null);
        if (isAuthorityError(response.status)) { setItems([]); setCanRequest(false); }
        if (response.status === 409) setCanRequest(false);
        return;
      }
      const result = await response.json() as ViewingCommandResponse;
      if (!alive.current || current !== generation.current) return;
      setItems(previous => [result.viewing, ...previous.filter(item => item.id !== result.viewing.id)]);
      setPending(null); setCanRequest(false); setFeedback('Viewing request saved.');
    } catch { if (alive.current && current === generation.current) { setError(safeError(503)); setFeedback(''); } }
    finally { if (alive.current && current === generation.current) setSending(false); }
  }

  return <section className="viewingPanel" aria-label={interactionId ? 'Conversation viewings' : 'Your viewing requests'}>
    {interactionId && <h2>Property viewing</h2>}
    <button disabled={busy || sending} onClick={() => void load()}>Refresh viewings</button>
    {busy && <p role="status">Loading viewings…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    <ul aria-label="Viewings">{items.map(viewing => <li key={viewing.id}>
      <ViewingSummary viewing={viewing} />
      <Link href={`/viewings/${viewing.id}`}>Open viewing details</Link>
    </li>)}</ul>
    {!busy && !error && !items.length && <p>{interactionId ? 'No viewing requests for this conversation yet.' : 'No viewing requests yet. Request a viewing from a conversation, or check here for incoming requests.'}</p>}
    {cursor && <button disabled={busy || sending} onClick={() => void load(cursor)}>Load more viewings</button>}
    {interactionId && canRequest && csrfToken && !pending && <form onSubmit={event => void requestViewing(event)}>
      <fieldset disabled={busy || sending}>
        <legend>Request a viewing</legend>
        <label>Proposed start<input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} required /></label>
        <label>Proposed end<input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} required /></label>
        <label>Display timezone<input value={timezone} onChange={event => setTimezone(event.target.value)} placeholder={DEFAULT_VIEWING_TIMEZONE} required maxLength={100} /></label>
        <p className="muted">Enter times in this timezone. The request expires after 48 hours or at the proposed start, whichever comes first.</p>
        <button type="submit" disabled={sending}>{sending ? 'Requesting…' : 'Request viewing'}</button>
      </fieldset>
    </form>}
    {pending && <button disabled={sending} onClick={() => void requestViewing()}>{sending ? 'Requesting…' : 'Retry viewing request'}</button>}
    {interactionId && !busy && !error && !canRequest && !pending && <p className="muted">A new viewing request is not available for this conversation. Existing appointments remain in your history.</p>}
    {interactionId && <p><Link href="/viewings">All your viewings</Link></p>}
  </section>;
}

export function ViewingDetail({ viewingId }: { viewingId: string }) {
  const [viewing, setViewing] = useState<ViewingResponse | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const [stale, setStale] = useState(false);
  const [appointmentBusy,setAppointmentBusy]=useState(false);
  const [appointmentRefresh,setAppointmentRefresh]=useState(0);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [instructions, setInstructions] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<Attempt | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);

  async function load() {
    const current = ++generation.current;
    setBusy(true); setError('');
    try {
      const [response, sessionResponse] = await Promise.all([
        fetch(`/api/account/viewings/${encodeURIComponent(viewingId)}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) }),
        fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
      ]);
      if (!alive.current || current !== generation.current) return;
      if (!response.ok || !sessionResponse.ok) {
        setViewing(null); setSession(null); setError(safeError(response.ok ? sessionResponse.status : response.status)); return;
      }
      const [result, actor] = await Promise.all([response.json() as Promise<ViewingResponse>, sessionResponse.json() as Promise<Session>]);
      if (!alive.current || current !== generation.current) return;
      if (!actor.authenticated) { setViewing(null); setSession(null); setError(safeError(401)); return; }
      setViewing(result); setSession(actor); setStale(false);setAppointmentRefresh(value=>value+1);
    } catch { if (alive.current && current === generation.current) { setViewing(null); setError('Viewing details could not be loaded. Refresh to try again.'); } }
    finally { if (alive.current && current === generation.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true;
    setViewing(null); setSession(null); setPending(null); setInstructions(''); setReason(''); setStale(false); setFeedback(''); setSending(false);
    void load();
    return () => { alive.current = false; generation.current++; };
  }, [viewingId]);

  async function command(action?: 'accept' | 'decline' | 'confirm' | 'cancel') {
    if (!viewing || !session?.csrfToken || sending) return;
    let attempt = pending;
    if (!attempt) {
      if (!action || stale) return;
      if ((action === 'decline' || action === 'cancel') && !reason.trim()) { setError('Enter a reason for this change.'); return; }
      if (action === 'accept' && !instructions.trim()) { setError('Enter safe meeting guidance.'); return; }
      attempt = { path: `/api/account/viewings/${encodeURIComponent(viewing.id)}/${action}`, key: crypto.randomUUID(), body: {
        expected_version: viewing.version, expected_schedule_version: viewing.schedule_version,
        ...(action === 'accept' ? { scheduled_start: viewing.proposed_start, scheduled_end: viewing.proposed_end, private_instructions: instructions } : {}),
        ...((action === 'decline' || action === 'cancel') ? { reason } : {})
      } };
    }
    const current = ++generation.current;
    setPending(attempt); setSending(true); setBusy(false); setError(''); setFeedback('Saving viewing change…');
    try {
      const response = await sendAttempt(attempt, session.csrfToken);
      if (!alive.current || current !== generation.current) return;
      if (!response.ok) {
        const code = await responseCode(response);
        if (!alive.current || current !== generation.current) return;
        setError(safeError(response.status, code)); setFeedback('');
        if (response.status < 500) setPending(null);
        if (isAuthorityError(response.status)) { setViewing(null); setSession(null); setInstructions(''); setReason(''); }
        if (response.status === 409) setStale(true);
        return;
      }
      const result = await response.json() as ViewingCommandResponse;
      if (!alive.current || current !== generation.current) return;
      setViewing(result.viewing); setPending(null); setInstructions(''); setReason(''); setFeedback('Viewing change saved.');
    } catch { if (alive.current && current === generation.current) { setError(safeError(503)); setFeedback(''); } }
    finally { if (alive.current && current === generation.current) setSending(false); }
  }
  const actionable = !busy && !sending && !stale && !pending && !appointmentBusy && !!session?.csrfToken;
  return <section className="viewingPanel" aria-label="Viewing details">
    <button disabled={busy || sending} onClick={() => void load()}>Refresh viewing</button>
    {busy && <p role="status">Loading viewing details…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {viewing && <>
      {viewing.state==='SCHEDULED'&&<h2>Confirmed appointment</h2>}
      <div role="group" aria-label={viewing.state==='SCHEDULED'?'Confirmed appointment time':'Viewing time'}><ViewingSummary viewing={viewing} /></div>
      {viewing.state === 'REQUESTED' && <p>Response deadline: {viewingTimeLabel(viewing.response_deadline, viewing.display_timezone)}</p>}
      {viewing.state === 'ACCEPTED' && <p>Acceptance reserves this proposed time. Both parties must confirm it before the appointment is scheduled.</p>}
      {['ACCEPTED', 'SCHEDULED'].includes(viewing.state) && <p>Seeker confirmation: {viewing.seeker_confirmed ? 'Confirmed' : 'Waiting'} · Provider confirmation: {viewing.provider_confirmed ? 'Confirmed' : 'Waiting'}</p>}
      {viewing.state === 'SCHEDULED' && !stale && !busy && !pending && !sending && !appointmentBusy && viewing.private_instructions && <div className="viewingInstructions"><h2>Private meeting instructions</h2><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{viewing.private_instructions}</p></div>}
      {viewing.reason && <p>Reason: {historyReasonLabels[viewing.reason] ?? 'Other'}</p>}
      {viewing.can_accept && !pending && !stale && <form onSubmit={event => { event.preventDefault(); void command('accept'); }}>
        <fieldset disabled={!actionable}><legend>Accept proposed time</legend>
          <label>Safe meeting guidance<textarea value={instructions} onChange={event => setInstructions(event.target.value)} required maxLength={2000} /></label>
          <p className="muted">Choose a safe meeting place. These private instructions are shown to authorized participants only after both parties confirm.</p>
          <button type="submit">Accept viewing</button>
        </fieldset>
      </form>}
      {viewing.can_confirm && !pending && !stale && <div><p>Confirm that you agree to the appointment time shown above.</p><button disabled={!actionable} onClick={() => void command('confirm')}>Confirm appointment time</button></div>}
      {(viewing.can_decline || viewing.can_cancel) && !pending && !stale && <form onSubmit={event => { event.preventDefault(); void command(viewing.can_decline ? 'decline' : 'cancel'); }}>
        <fieldset disabled={!actionable}><legend>{viewing.can_decline ? 'Decline this request' : 'Cancel this appointment'}</legend>
          <label>{viewing.can_decline ? 'Decline reason' : 'Cancellation reason'}<select value={reason} onChange={event => setReason(event.target.value)} required>
            <option value="">Choose a reason</option>{Object.entries(reasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {viewing.can_decline && <button type="submit">Decline viewing</button>}
          {viewing.can_cancel && <button type={viewing.can_decline ? 'button' : 'submit'} onClick={viewing.can_decline ? () => void command('cancel') : undefined}>Cancel viewing</button>}
        </fieldset>
      </form>}
      {pending && <button disabled={sending} onClick={() => void command()}>{sending ? 'Saving…' : 'Retry pending change'}</button>}
      <ViewingAppointmentControls viewing={viewing} csrfToken={session?.csrfToken} disabled={busy||sending||stale||!!pending} refreshVersion={appointmentRefresh}
        onBusyChange={setAppointmentBusy}
        onChange={current=>{generation.current++;setViewing(current);setBusy(false);setStale(false);}}
        onDenied={status=>{generation.current++;setViewing(null);setSession(null);setInstructions('');setReason('');setBusy(false);setError(safeError(status));}}
        onStale={()=>{generation.current++;setBusy(false);setStale(true);}}
      />
    </>}
  </section>;
}
