'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { StaffSessionResponse, ReviewModerationQueueItem, ReviewModerationDetailResponse,
  ReviewModerationCommandResponse, ReviewModerationCommand, ReviewModerationReason } from '@pachi/contracts';

type Attempt = { path: string; body: Record<string, unknown>; caseId: string };
const commands: ReviewModerationCommand[] = ['BEGIN_INVESTIGATION', 'HOLD', 'HIDE', 'REMOVE', 'RESTORE', 'RESOLVE', 'CLOSE'];
const reasons: ReviewModerationReason[] = ['INVESTIGATION', 'REVIEW_POLICY_VIOLATION', 'PRIVACY_PROTECTION', 'THREAT_PROTECTION', 'NO_VIOLATION', 'ELIGIBILITY_RESTORED', 'CASE_COMPLETED'];
const label = (text: string) => text.replaceAll('_', ' ').toLowerCase();
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
async function safeError(response: Response): Promise<string> {
  const result = await response.json().catch(() => ({})) as { code?: string };
  if (result.code === 'STEP_UP_REQUIRED') return 'Sign in again with MFA before opening evidence or recording a decision.';
  if (response.status === 401) return 'Your staff session expired. Sign in again.';
  if ([403, 404].includes(response.status)) return 'This case is unavailable with your current assignment and permissions.';
  if (response.status === 409) return 'The case or review changed. Refresh the queue and open the case again.';
  if (response.status === 400) return 'Check the selected action, reason and staff user ID.';
  return 'The request was not confirmed. Retry the pending command or refresh to check its result.';
}
export default function ReviewCasesPage() {
  const [session, setSession] = useState<StaffSessionResponse | null>(null), [csrf, setCsrf] = useState('');
  const [items, setItems] = useState<ReviewModerationQueueItem[]>([]), [detail, setDetail] = useState<ReviewModerationDetailResponse | null>(null);
  const [selected, setSelected] = useState(''), [status, setStatus] = useState(''), [severity, setSeverity] = useState(''), [assigned, setAssigned] = useState('all');
  const [loading, setLoading] = useState(true), [opening, setOpening] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [feedback, setFeedback] = useState(''), [assignee, setAssignee] = useState('');
  const [command, setCommand] = useState<ReviewModerationCommand>('BEGIN_INVESTIGATION'), [reason, setReason] = useState<ReviewModerationReason>('INVESTIGATION');
  const [reasonText, setReasonText] = useState(''), [reversal, setReversal] = useState(''), [pending, setPending] = useState<Attempt | null>(null);
  const alive = useRef(true), queueGeneration = useRef(0), detailGeneration = useRef(0), commandGeneration = useRef(0);
  const permitted = (id: string, permission: string) => session?.grants.some(g => g.role === 'TRUST_SAFETY_MODERATOR' &&
    g.scope.kind === 'case' && g.scope.id === id && g.scope.permissions.includes(permission));
  async function load() {
    const generation = ++queueGeneration.current; detailGeneration.current++; setDetail(null); setSelected(''); setLoading(true); setOpening(false); setError('');
    try {
      const query = new URLSearchParams({ purpose: 'REVIEW_MODERATION', assigned, ...(status ? { status } : {}), ...(severity ? { severity } : {}) });
      const [actor, response] = await Promise.all([fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(10_000) }),
        fetch(`/api/review-cases?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })]);
      if (!alive.current || generation !== queueGeneration.current) return;
      const failed = !actor.ok ? actor : !response.ok ? response : null;
      if (failed) { setItems([]); setCsrf(''); setSession(null); const message = await safeError(failed); if (alive.current && generation === queueGeneration.current) setError(message); return; }
      const [identity, queue] = await Promise.all([actor.json(), response.json()]) as [{ session: StaffSessionResponse; csrf: string }, { items: ReviewModerationQueueItem[] }];
      if (!alive.current || generation !== queueGeneration.current) return;
      setSession(identity.session); setCsrf(identity.csrf); setItems(queue.items);
    } catch { if (alive.current && generation === queueGeneration.current) { setItems([]); setError('The case queue could not be loaded. Refresh to try again.'); } }
    finally { if (alive.current && generation === queueGeneration.current) setLoading(false); }
  }
  async function open(id: string) {
    const generation = ++detailGeneration.current; setSelected(id); setDetail(null); setOpening(true); setError(''); setFeedback(''); setReasonText(''); setReversal('');
    try {
      const response = await fetch(`/api/review-cases/${id}?purpose=REVIEW_MODERATION`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) { const message = await safeError(response); if (alive.current && generation === detailGeneration.current) setError(message); return; }
      const data = await response.json() as ReviewModerationDetailResponse;
      if (!alive.current || generation !== detailGeneration.current) return;
      setDetail(data); setCommand(data.case.next_action === 'BEGIN_INVESTIGATION' ? 'BEGIN_INVESTIGATION' : data.case.state === 'RESOLVED' ? 'CLOSE' : 'HOLD');
    } catch { if (alive.current && generation === detailGeneration.current) setError('Case evidence could not be loaded. Open the case again.'); }
    finally { if (alive.current && generation === detailGeneration.current) setOpening(false); }
  }
  async function send(attempt: Attempt) {
    if (!csrf || saving) return;
    const generation = ++commandGeneration.current; detailGeneration.current++; queueGeneration.current++; setLoading(false); setOpening(false); setSaving(true); setPending(attempt); setDetail(null); setError(''); setFeedback('Saving case action…');
    try {
      const response = await fetch(attempt.path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify(attempt.body), cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!alive.current || generation !== commandGeneration.current) return;
      if (!response.ok) { const message = await safeError(response); if (!alive.current || generation !== commandGeneration.current) return;
        setError(message); setFeedback(''); if (response.status < 500) setPending(null); if ([401, 403, 404].includes(response.status)) setItems([]); return; }
      const result = await response.json() as ReviewModerationCommandResponse;
      if (!alive.current || generation !== commandGeneration.current) return;
      setPending(null); setItems(old => old.map(item => item.id === result.case.id ? result.case : item)); setFeedback(`Case action saved: ${label(result.action.command)}${result.replayed ? ' (previously saved)' : ''}.`);
      if (result.action.command !== 'ASSIGN') { await open(attempt.caseId); if (alive.current && generation === commandGeneration.current) setFeedback(`Case action saved: ${label(result.action.command)}.`); }
    } catch { if (alive.current && generation === commandGeneration.current) { setError('Saving was not confirmed. Retry the pending command with the same decision.'); setFeedback(''); } }
    finally { if (alive.current && generation === commandGeneration.current) setSaving(false); }
  }
  function assign(item: ReviewModerationQueueItem, recipient = assignee) {
    if (!uuid(recipient)) { setError('Enter the staff user ID for the intended assignee.'); return; }
    void send({ path: `/api/review-cases/${item.id}/assign`, caseId: item.id, body: { purpose: 'REVIEW_MODERATION', expected_version: item.version,
      assigned_staff_user_id: recipient, idempotency_key: crypto.randomUUID() } });
  }
  function decide(event: FormEvent) {
    event.preventDefault(); if (!detail) return;
    if (command === 'RESTORE' && !uuid(reversal)) { setError('Select the original suppression decision to reverse.'); return; }
    void send({ path: `/api/review-cases/${detail.case.id}/decisions`, caseId: detail.case.id, body: { purpose: 'REVIEW_MODERATION', expected_version: detail.case.version,
      expected_review_version: detail.review.version, command, reason_code: reason, reason_text: reasonText,
      ...(command === 'RESTORE' ? { reverses_action_id: reversal } : {}), idempotency_key: crypto.randomUUID() } });
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; queueGeneration.current++; detailGeneration.current++; commandGeneration.current++; }; }, []);
  const disabled = loading || saving || !!pending;
  return <main><Link href="/">Staff portal</Link><h1>Review moderation cases</h1>
    <p>Purpose: review moderation. Case assignment, evidence permission and current MFA authentication are checked for every request.</p>
    <a href="/api/auth/login">Sign in / refresh MFA</a>
    <form onSubmit={event => { event.preventDefault(); void load(); }}><fieldset disabled={disabled}><legend>Queue filters</legend>
      <label>Case status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{['OPEN', 'TRIAGED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'RESOLVED', 'CLOSED'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></label>
      <label>Severity<select value={severity} onChange={e => setSeverity(e.target.value)}><option value="">All severities</option>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Assignment<select value={assigned} onChange={e => setAssigned(e.target.value)}><option value="all">Authorized cases</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option></select></label>
      <button type="submit">Refresh case queue</button></fieldset></form>
    {loading && <p role="status">Loading review cases…</p>}{opening && <p role="status">Opening assigned case…</p>}
    {error && <p role="alert">{error}</p>}{feedback && <p role="status">{feedback}</p>}
    {pending && <button disabled={saving} onClick={() => void send(pending)}>{saving ? 'Saving…' : 'Retry pending case action'}</button>}
    {!loading && !error && !items.length && <p>No authorized review cases match these filters.</p>}
    {session && <label>Staff user ID for assignment or claim<input value={assignee} onChange={e => setAssignee(e.target.value)} disabled={disabled} /></label>}
    <ul aria-label="Authorized review case queue">{items.map(item => <li key={item.id}><h2>Case {item.id}</h2>
      <p>Review {item.review_id} · {label(item.reason)} · {item.severity} · {label(item.state)}</p>
      <p>Opened {new Date(item.opened_at).toLocaleString()} · Latest report {new Date(item.last_report_at).toLocaleString()} · Reports {item.report_count}</p>
      <p>Queue age: {Math.floor(item.age_seconds / 60)} minutes · Due {item.due_at ? new Date(item.due_at).toLocaleString() : 'Normal queue'}{item.overdue ? ' · Needs attention' : ''}</p>
      <p>Assigned staff: {item.assigned_staff_user_id ?? 'Unassigned'} · Next action: {label(item.next_action)}</p>
      <button disabled={disabled || opening} onClick={() => void open(item.id)}>Open case {item.id}</button>
      {permitted(item.id, 'case:assign') && (!['RESOLVED', 'CLOSED'].includes(item.state) || item.next_action === 'BEGIN_INVESTIGATION') && <button disabled={disabled} onClick={() => assign(item)}>Assign case {item.id}</button>}
      {session?.user_id && permitted(item.id, 'case:assign') && !item.assigned_staff_user_id && <button disabled={disabled} onClick={() => assign(item, session.user_id)}>Claim case {item.id}</button>}
    </li>)}</ul>
    {detail && selected === detail.case.id && <section aria-label="Assigned review case"><h2>Assigned case details</h2><p>Case {detail.case.id} · {label(detail.case.state)} · Version {detail.case.version}</p>
      <h3>Target review</h3><p>{label(detail.review.state)} · Rating {detail.review.rating} · Review version {detail.review.version}</p><p>{detail.review.text ?? 'No written feedback'}</p>
      <h3>Permitted report context</h3><ul>{detail.reports.map(report => <li key={report.id}>{label(report.reason)} · {new Date(report.created_at).toLocaleString()}<p>{report.details ?? 'No additional detail'}</p></li>)}</ul>
      <details><summary>Retained review revisions</summary><ul>{detail.revisions.map(r => <li key={r.version}>Version {r.version} · Rating {r.rating}<p>{r.text}</p></li>)}</ul></details>
      <h3>Immutable action history</h3><ul aria-label="Immutable moderation action history">{detail.actions.map(action => <li key={action.id}>{label(action.command)} · {label(action.reason_code)} · {new Date(action.created_at).toLocaleString()}
        <p>{action.reason_text}</p><p>Actor {action.actor_user_id} · Assigned staff {action.assigned_staff_user_id ?? 'Unassigned'} · {label(action.before_review_state)} → {label(action.after_review_state)} · Policy {action.policy_version}</p>
        {action.reverses_action_id && <p>Reverses decision {action.reverses_action_id}</p>}{action.appeal_deadline && <p>Appeal eligible until {new Date(action.appeal_deadline).toLocaleString()}, from durable notice availability. Appeal adjudication follows separately.</p>}</li>)}</ul>
      {detail.case.state === 'CLOSED' && detail.case.next_action === 'COMPLETED' ? <p>Case completed. Its decisions and evidence are retained.</p> : permitted(detail.case.id, 'review:moderate') && permitted(detail.case.id, 'moderation:act') &&
      <form onSubmit={decide}><fieldset disabled={disabled || !csrf}><legend>Record reason-coded decision</legend>
        <label>Moderation action<select value={command} onChange={e => { const next = e.target.value as ReviewModerationCommand; setCommand(next); setReason(next === 'REMOVE' ? 'REVIEW_POLICY_VIOLATION' : next === 'RESTORE' ? 'ELIGIBILITY_RESTORED' : next === 'RESOLVE' || next === 'CLOSE' ? 'CASE_COMPLETED' : 'INVESTIGATION'); }}>{commands.map(c => <option key={c} value={c}>{label(c)}</option>)}</select></label>
        <label>Decision reason<select value={reason} onChange={e => setReason(e.target.value as ReviewModerationReason)}>{reasons.map(r => <option key={r} value={r}>{label(r)}</option>)}</select></label>
        <label>Internal decision rationale<textarea required minLength={10} maxLength={2000} value={reasonText} onChange={e => setReasonText(e.target.value)} /></label>
        {command === 'RESTORE' && <label>Original suppression decision<select required value={reversal} onChange={e => setReversal(e.target.value)}><option value="">Choose a decision</option>{detail.actions.filter(a => ['HOLD', 'HIDE', 'REMOVE'].includes(a.command)).map(a => <option key={a.id} value={a.id}>{label(a.command)} · {a.id}</option>)}</select></label>}
        <button type="submit">Record moderation decision</button></fieldset></form>}
    </section>}
  </main>;
}
