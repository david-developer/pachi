'use client';
import Link from 'next/link';
import { useEffect,useRef,useState,type FormEvent } from 'react';
import type { AttendanceParticipantResolution,AttendanceAppealRequest,AttendanceAppealCommandResponse } from '@pachi/contracts';
const explanation={ATTENDANCE_SUPPORTED:'The completed viewing was supported by the reviewed evidence. Review opportunities can resume when their other eligibility requirements are satisfied.',NO_SHOW_SUPPORTED:'The no-show outcome was supported by the reviewed evidence. No-show outcomes do not create star ratings.',CONTRADICTORY_CLAIM:'The attendance claim was invalidated because the evidence contradicted it. Reviews based on this claim are excluded from reputation.',UNSUPPORTED_CLAIM:'The attendance claim was not supported. No attendance outcome is confirmed. Reviews based on this claim are excluded from reputation.',INSUFFICIENT_EVIDENCE:'The available evidence was insufficient to confirm attendance or a no-show.'};
const label=(v:string)=>v.replaceAll('_',' ').toLowerCase();
const safeError=(status:number)=>status===401?'Sign in again to see your attendance decision.':[403,404].includes(status)?'This attendance case is unavailable with your current access.':status===409?'The decision changed or its appeal opportunity is no longer available. Refresh to check.':'The request was not confirmed. Refresh or retry the pending appeal.';
export function AttendanceResolutionControls({viewingId}:{viewingId:string}){
  const [data,setData]=useState<AttendanceParticipantResolution|null>(null),[csrf,setCsrf]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState(''),[feedback,setFeedback]=useState('');
  const [reason,setReason]=useState(''),[refs,setRefs]=useState(''),[pending,setPending]=useState<AttendanceAppealRequest|null>(null);
  const alive=useRef(true),generation=useRef(0);
  const path=`/api/account/viewings/${encodeURIComponent(viewingId)}/attendance`;
  async function load(){const gen=++generation.current;setBusy(true);setData(null);setError('');
    try{const [s,r]=await Promise.all([fetch('/api/session',{cache:'no-store',signal:AbortSignal.timeout(10000)}),fetch(`${path}/resolution`,{cache:'no-store',signal:AbortSignal.timeout(10000)})]);
      if(!r.ok||!s.ok){if(alive.current&&gen===generation.current)setError(safeError(!s.ok?s.status:r.status));return;}
      const [session,resolution]=await Promise.all([s.json(),r.json()]) as [{csrfToken?:string},AttendanceParticipantResolution];
      if(alive.current&&gen===generation.current){setCsrf(session.csrfToken??'');setData(resolution);}}
    catch{if(alive.current&&gen===generation.current)setError('Your decision could not be loaded. Refresh to try again.');}
    finally{if(alive.current&&gen===generation.current)setBusy(false);}}
  async function submit(event?:FormEvent){event?.preventDefault();if(busy||!csrf)return;
    let attempt=pending;
    if(!attempt){if(!data?.current_decision?.can_appeal)return;const references=refs.split(/[\s,]+/).filter(Boolean);
      if(references.length>5||new Set(references).size!==references.length||references.some(ref=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ref))){setError('Use up to five different message reference IDs from this viewing conversation.');return;}
      attempt={original_action_id:data.current_decision.id,reason,evidence:references.map(reference=>({kind:'MESSAGE',reference})),idempotency_key:crypto.randomUUID()};}
    const gen=++generation.current;setPending(attempt);setBusy(true);setData(null);setError('');
    try{const r=await fetch(`${path}/appeals`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(attempt),cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!r.ok){if(alive.current&&gen===generation.current){setError(safeError(r.status));if(r.status<500)setPending(null);}return;}
      const result=await r.json() as AttendanceAppealCommandResponse;if(alive.current&&gen===generation.current){setData(result.resolution);setPending(null);setReason('');setRefs('');setFeedback('Your appeal is recorded. The current decision remains effective during review.');}}
    catch{if(alive.current&&gen===generation.current)setError('Saving was not confirmed. Retry the pending appeal to check its result.');}
    finally{if(alive.current&&gen===generation.current)setBusy(false);}}
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;generation.current++;};},[viewingId]);
  return <section aria-label="Private attendance resolution"><h1>Attendance decision and appeal</h1><Link href={`/viewings/${encodeURIComponent(viewingId)}`}>Viewing details</Link>
    <button disabled={busy||!!pending} onClick={()=>void load()}>Refresh attendance decision</button>
    {busy&&<p role="status">Loading or saving your attendance case…</p>}{error&&<p role="alert">{error}</p>}{feedback&&<p role="status">{feedback}</p>}
    {pending&&<button disabled={busy} onClick={()=>void submit()}>Retry pending attendance appeal</button>}
    {data&&!data.current_decision&&<p>Your attendance dispute is awaiting a staff decision.</p>}
    {data?.current_decision&&<><h2>{label(data.current_decision.outcome)}</h2><p>{explanation[data.current_decision.reason_code]}</p>
      <p>Staff adjudication · {data.current_decision.reviewer_label} · {new Date(data.current_decision.decided_at).toLocaleString()}</p>
      {data.current_decision.review_mode==='SOLE_OPERATOR_RECONSIDERATION'&&<p>The original operator reviewed the evidence again. This was reconsideration, not an independent review.</p>}
      {data.current_decision.can_appeal&&<form onSubmit={event=>{void submit(event);}}><fieldset disabled={busy||!!pending||!csrf}><legend>Challenge this decision</legend><p>Submit within 30 days of the private decision notice, before {new Date(data.current_decision.appeal_deadline).toLocaleString()}.</p>
        <label>Appeal reason<textarea required minLength={10} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <label>Existing message reference IDs (optional)<input value={refs} onChange={e=>setRefs(e.target.value)}/></label><p>Use only messages from this viewing conversation. Evidence uploads are unavailable.</p><button type="submit">Submit attendance appeal</button>
      </fieldset></form>}
      {!data.current_decision.can_appeal&&!data.own_appeals.length&&<p>No further appeal is available for this decision.</p>}
    </>}
    {data&&!!data.own_appeals.length&&<><h2>Your appeals</h2><ul aria-label="Your attendance appeals">{data.own_appeals.map(a=><li key={a.id}>{label(a.state)} · {new Date(a.submitted_at).toLocaleString()}<p>{a.reason}</p>{a.review_mode&&<p>{label(a.review_mode)}</p>}</li>)}</ul></>}
  </section>;
}
