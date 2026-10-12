'use client';

import { useEffect, useRef, useState } from 'react';
import type { ViewingAttendanceClaimResponse, ViewingAttendanceCommandResponse, ViewingAttendanceResponse, ViewingResponse } from '@pachi/contracts';
import { viewingTimeLabel } from '@/lib/viewing-time';

type Attempt = { path: string; body: Record<string, unknown>; key: string };
const outcomes = { COMPLETED: 'Viewing attended', SEEKER_NO_SHOW: 'Seeker did not attend', PROVIDER_NO_SHOW: 'Provider did not attend' };
const reasons = { DID_NOT_ATTEND: 'The viewing did not take place', OUTCOME_INCORRECT: 'The claimed outcome is incorrect', SAFETY: 'Safety concern', OTHER: 'Other disagreement' };
const safeError = (status: number) => status === 401 ? 'Sign in again to read attendance.' :
  [403, 404].includes(status) ? 'Attendance is unavailable with your current permissions.' :
    status === 409 ? 'This appointment or attendance claim changed. Refresh the viewing before trying again.' :
      status === 400 ? 'Check the attendance claim and required fields, then try again.' :
        'The attendance change was not confirmed. Retry the pending change to check its result.';

export function ViewingAttendanceControls({ viewing, csrfToken, disabled, refreshVersion, onChange, onBusyChange, onDenied, onStale }: {
  viewing: ViewingResponse; csrfToken?: string | undefined; disabled: boolean; refreshVersion: number;
  onChange: (viewing: ViewingResponse) => void; onBusyChange: (busy: boolean) => void;
  onDenied: (status: number) => void; onStale: () => void;
}) {
  const [data, setData] = useState<ViewingAttendanceResponse | null>(null);
  const [busy, setBusy] = useState(true), [sending, setSending] = useState(false);
  const [pending, setPending] = useState<Attempt | null>(null);
  const [error, setError] = useState(''), [feedback, setFeedback] = useState('');
  const [disputeReasons, setDisputeReasons] = useState<Record<string, string>>({});
  const alive = useRef(true), reads = useRef(0), commands = useRef(0);

  async function load(after?: string) {
    const generation = ++reads.current;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/account/viewings/${encodeURIComponent(viewing.id)}/attendance${after ? `?cursor=${encodeURIComponent(after)}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!alive.current || generation !== reads.current) return;
      if (!response.ok) {
        setData(null); setError(response.status >= 500 ? 'Attendance could not be loaded. Refresh to try again.' : safeError(response.status));
        if ([401, 403, 404].includes(response.status)) onDenied(response.status);
        return;
      }
      const result = await response.json() as ViewingAttendanceResponse;
      if (!alive.current || generation !== reads.current) return;
      setData(previous => ({ ...result, claims: after && previous ? [...new Map([...previous.claims, ...result.claims].map(claim => [claim.id, claim])).values()] : result.claims }));
      if (result.version !== viewing.version || result.schedule_version !== viewing.schedule_version) {
        setFeedback('Attendance changed. Refresh the viewing to load the current appointment.'); onStale();
      }
    } catch {
      if (alive.current && generation === reads.current) { setData(null); setError('Attendance could not be loaded. Refresh to try again.'); }
    } finally { if (alive.current && generation === reads.current) setBusy(false); }
  }

  useEffect(() => {
    alive.current = true; setData(null); setPending(null); setSending(false); setFeedback(''); setDisputeReasons({});
    return () => { alive.current = false; reads.current++; commands.current++; onBusyChange(false); };
  }, [viewing.id]);
  useEffect(() => { void load(); }, [viewing.id, viewing.version, refreshVersion]);
  useEffect(() => { onBusyChange(busy || sending || !!pending); }, [busy, sending, pending, onBusyChange]);

  async function command(action?: 'completion' | 'no-show' | 'confirm' | 'dispute', claim?: ViewingAttendanceClaimResponse) {
    if (!csrfToken || sending || (!pending && (disabled || busy))) return;
    let attempt = pending;
    if (!attempt) {
      if (!action) return;
      const body: Record<string, unknown> = { expected_version: viewing.version, expected_schedule_version: viewing.schedule_version };
      let suffix: string = action;
      if (action === 'no-show') body.absent_side = viewing.actor_side === 'SEEKER' ? 'PROVIDER' : 'SEEKER';
      if (action === 'confirm' || action === 'dispute') {
        if (!claim || claim.claimant_side === viewing.actor_side) return;
        body.expected_claim_version = claim.version;
        suffix = `claims/${encodeURIComponent(claim.id)}/${action}`;
        if (action === 'dispute') {
          const reason = disputeReasons[claim.id];
          if (!reason) { setError('Choose a reason for disputing this claim.'); return; }
          body.reason = reason;
        }
      }
      attempt = { path: `/api/account/viewings/${encodeURIComponent(viewing.id)}/attendance/${suffix}`, body, key: crypto.randomUUID() };
    }
    const generation = ++commands.current;
    reads.current++; setBusy(false); setPending(attempt); setSending(true); setError(''); setFeedback('Saving attendance change…');
    try {
      const response = await fetch(attempt.path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, 'idempotency-key': attempt.key }, body: JSON.stringify(attempt.body), cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!alive.current || generation !== commands.current) return;
      if (!response.ok) {
        setError(safeError(response.status)); setFeedback('');
        if (response.status < 500) setPending(null);
        if ([401, 403, 404].includes(response.status)) onDenied(response.status);
        if (response.status === 409) onStale();
        return;
      }
      const result = await response.json() as ViewingAttendanceCommandResponse;
      if (!alive.current || generation !== commands.current) return;
      reads.current++; setData(result.attendance); setPending(null); setDisputeReasons({});
      setFeedback(result.attendance.state === 'DISPUTED' ? 'Dispute saved. The case is pending moderation review.' :
        result.attendance.state === 'AWAITING_VALIDATION' ? 'Attendance claim saved. It is awaiting counterparty validation.' : 'Attendance outcome validated.');
      onChange(result.viewing);
    } catch { if (alive.current && generation === commands.current) { setError(safeError(503)); setFeedback(''); } }
    finally { if (alive.current && generation === commands.current) setSending(false); }
  }

  const actionable = !disabled && !busy && !sending && !pending && !!csrfToken;
  return <section className="viewingPanel" aria-label="Viewing attendance">
    <h2>Attendance and no-show claims</h2>
    <button disabled={busy || sending || !!pending} onClick={() => void load()}>Refresh attendance</button>
    {busy && <p role="status">Loading attendance…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {data && <>
      {data.state === 'NONE' && <p>No attendance claim has been recorded for this schedule.</p>}
      {data.state === 'AWAITING_VALIDATION' && <p><strong>Awaiting validation</strong> · A claim is recorded; the outcome has not been verified.</p>}
      {data.outcome && data.state !== 'DISPUTED' && <p aria-label="Validated attendance outcome"><strong>Validated outcome: {outcomes[data.outcome]}</strong></p>}
      {data.state === 'DISPUTED' && <div aria-label="Attendance dispute status">
        <p><strong>Attendance disputed</strong> · Automatic finalization, review eligibility and no-show effects are on hold.</p>
        <p>{data.case?.review_status === 'PENDING_REVIEW' ? 'Pending moderation review. No decision has been made.' : 'Dispute support status is currently unavailable. Refresh to check again.'}</p>
        {data.case && <p>Case reference: {data.case.id}</p>}
      </div>}
      {!pending && <div>
        {data.can_claim_completion && <button disabled={!actionable} onClick={() => void command('completion')}>Mark viewing attended</button>}
        {data.can_claim_no_show && <button disabled={!actionable} onClick={() => void command('no-show')}>Report {viewing.actor_side === 'SEEKER' ? 'provider' : 'seeker'} no-show</button>}
      </div>}
      <p className="muted">A completion claim is available after the scheduled end; a no-show claim is available 30 minutes after the scheduled start. Submitting a claim does not verify the outcome.</p>
      {!data.claims.length && <p>No attendance claim history yet.</p>}
      {!!data.claims.length && <ul aria-label="Attendance claim history">{data.claims.map(claim => <li key={claim.id}>
        <h3>{outcomes[claim.claimed_outcome]} · {claim.claimant_side === 'SEEKER' ? 'Seeker' : 'Provider'} claim</h3>
        <p>Schedule {claim.schedule_version} · {claim.state === 'PENDING' ? 'Awaiting validation' : claim.state === 'DISPUTED' ? 'Disputed' : 'Validated'}</p>
        <p>Claim recorded: {viewingTimeLabel(claim.claimed_at, viewing.display_timezone)}</p>
        <p>Counterparty notice available in inbox: {viewingTimeLabel(claim.notice_available_at, viewing.display_timezone)}</p>
        {claim.state === 'PENDING' && <p>Counterparty response deadline: {viewingTimeLabel(claim.response_deadline, viewing.display_timezone)}. The 48-hour window starts when the durable inbox notice is available. An uncontested claim may then be validated if no restriction or conflict prevents it.</p>}
        {claim.finalized_at && <p>Outcome validated: {viewingTimeLabel(claim.finalized_at, viewing.display_timezone)}</p>}
        {claim.claimant_side !== viewing.actor_side && claim.can_confirm && <button disabled={!actionable} onClick={() => void command('confirm', claim)}>Confirm {claim.claim_type === 'COMPLETION' ? 'viewing attended' : 'no-show claim'}</button>}
        {claim.claimant_side !== viewing.actor_side && claim.can_dispute && <form onSubmit={event => { event.preventDefault(); void command('dispute', claim); }}>
          <fieldset disabled={!actionable}><legend>Dispute this attendance claim</legend>
            <label htmlFor={`attendance-dispute-reason-${claim.id}`}>Dispute reason</label>
            <select id={`attendance-dispute-reason-${claim.id}`} required value={disputeReasons[claim.id] ?? ''} onChange={event => setDisputeReasons(current => ({ ...current, [claim.id]: event.target.value }))}>
              <option value="">Choose a reason</option>{Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select><button type="submit">Dispute attendance claim</button>
          </fieldset>
        </form>}
      </li>)}</ul>}
      {data.next_cursor && <button disabled={busy || sending || !!pending} onClick={() => void load(data.next_cursor!)}>Load more attendance claims</button>}
    </>}
    {pending && <button disabled={sending} onClick={() => void command()}>{sending ? 'Saving attendance…' : 'Retry pending attendance change'}</button>}
    <p className="muted">No-show claims do not create star ratings. Inbox notice availability and external delivery are separate; external email, SMS and push are inactive.</p>
  </section>;
}
