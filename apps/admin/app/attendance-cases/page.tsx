'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AttendanceCaseQueueItem, AttendanceCaseDetailResponse, AttendanceDecisionOutcome, AttendanceDecisionReason,
  AttendanceAdjudicationCommandResponse, AttendanceAppealDecisionRequest, StaffSessionResponse } from '@pachi/contracts';
const label=(v:string)=>v.replaceAll('_',' ').toLowerCase();
const outcomes:AttendanceDecisionOutcome[]=['COMPLETED','SEEKER_NO_SHOW','PROVIDER_NO_SHOW','CLAIM_INVALIDATED','INSUFFICIENT_EVIDENCE'];
const reasonFor=(v:AttendanceDecisionOutcome):AttendanceDecisionReason=>v==='COMPLETED'?'ATTENDANCE_SUPPORTED':v.endsWith('NO_SHOW')?'NO_SHOW_SUPPORTED':v==='CLAIM_INVALIDATED'?'UNSUPPORTED_CLAIM':'INSUFFICIENT_EVIDENCE';
type Attempt={path:string;body:Record<string,unknown>;caseId:string};
async function errorText(r:Response){const b=await r.json().catch(()=>({})) as {code?:string};return b.code==='STEP_UP_REQUIRED'?'Sign in again with MFA before opening evidence or deciding a case.':r.status===401?'Your staff session expired. Sign in again.':[403,404].includes(r.status)?'This case is unavailable with your current assignment and permissions.':r.status===409?'The case changed. Refresh and open it again.':r.status===400?'Check the decision, reason and evidence references.':'The request was not confirmed. Retry the pending action.';}
export default function AttendanceCasesPage(){
  const [session,setSession]=useState<StaffSessionResponse|null>(null),[csrf,setCsrf]=useState('');
  const [items,setItems]=useState<AttendanceCaseQueueItem[]>([]),[detail,setDetail]=useState<AttendanceCaseDetailResponse|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[pending,setPending]=useState<Attempt|null>(null);
  const [assignee,setAssignee]=useState(''),[outcome,setOutcome]=useState<AttendanceDecisionOutcome>('INSUFFICIENT_EVIDENCE'),[reason,setReason]=useState<AttendanceDecisionReason>('INSUFFICIENT_EVIDENCE'),[text,setText]=useState(''),[references,setReferences]=useState<string[]>([]);
  const [selectedAppeal,setSelectedAppeal]=useState(''),[appealOutcome,setAppealOutcome]=useState<AttendanceAppealDecisionRequest['appeal_outcome']>('UPHELD'),[mode,setMode]=useState<AttendanceAppealDecisionRequest['review_mode']>('INDEPENDENT_REVIEW');
  const alive=useRef(true),generation=useRef(0);
  const permission=(id:string,p:string)=>session?.grants.some(g=>g.role==='TRUST_SAFETY_MODERATOR'&&g.scope.kind==='case'&&g.scope.id===id&&g.scope.permissions.includes(p));
  async function load(){const gen=++generation.current;setBusy(true);setDetail(null);setError('');
    try{const [s,q]=await Promise.all([fetch('/api/session',{cache:'no-store',signal:AbortSignal.timeout(10000)}),fetch('/api/attendance-cases?purpose=ATTENDANCE_ADJUDICATION',{cache:'no-store',signal:AbortSignal.timeout(10000)})]);
      if(!alive.current||gen!==generation.current)return;
      if(!s.ok||!q.ok){const message=await errorText(!s.ok?s:q);if(alive.current&&gen===generation.current){setError(message);setItems([]);setSession(null);setCsrf('');}return;}
      const [identity,queue]=await Promise.all([s.json(),q.json()]) as [{session:StaffSessionResponse;csrf:string},{items:AttendanceCaseQueueItem[]}];
      if(alive.current&&gen===generation.current){setSession(identity.session);setCsrf(identity.csrf);setItems(queue.items);}
    }catch{if(alive.current&&gen===generation.current){setItems([]);setError('The queue could not be loaded. Refresh to try again.');}}
    finally{if(alive.current&&gen===generation.current)setBusy(false);}}
  async function open(id:string){const gen=++generation.current;setBusy(true);setDetail(null);setError('');setText('');setReferences([]);setSelectedAppeal('');setMode('INDEPENDENT_REVIEW');setAppealOutcome('UPHELD');
    try{const r=await fetch(`/api/attendance-cases/${id}?purpose=ATTENDANCE_ADJUDICATION`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!r.ok){const message=await errorText(r);if(alive.current&&gen===generation.current)setError(message);return;}
      const d=await r.json() as AttendanceCaseDetailResponse;if(alive.current&&gen===generation.current){setDetail(d);setOutcome('INSUFFICIENT_EVIDENCE');setReason('INSUFFICIENT_EVIDENCE');}}
    catch{if(alive.current&&gen===generation.current)setError('Case evidence could not be loaded. Open it again.');}
    finally{if(alive.current&&gen===generation.current)setBusy(false);}}
  async function send(attempt:Attempt){if(busy||!csrf)return;const gen=++generation.current;setBusy(true);setPending(attempt);setDetail(null);setError('');setFeedback('Saving attendance action…');
    try{const r=await fetch(attempt.path,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(attempt.body),cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!r.ok){const message=await errorText(r);if(alive.current&&gen===generation.current){setError(message);setFeedback('');if(r.status<500)setPending(null);if([401,403,404].includes(r.status))setItems([]);}return;}
      const result=await r.json() as AttendanceAdjudicationCommandResponse;if(!alive.current||gen!==generation.current)return;
      setPending(null);setItems(old=>old.map(item=>item.id===result.case.id?result.case:item));setFeedback(`Attendance action saved: ${label(result.action.command)}${result.replayed?' (previously saved)':''}.`);
    }catch{if(alive.current&&gen===generation.current){setError('Saving was not confirmed. Retry the identical pending action.');setFeedback('');}}
    finally{if(alive.current&&gen===generation.current)setBusy(false);}}
  function assign(item:AttendanceCaseQueueItem,recipient:string){if(!/^[0-9a-f-]{36}$/i.test(recipient)){setError('Enter the intended staff user ID.');return;}void send({caseId:item.id,path:`/api/attendance-cases/${item.id}/assign`,body:{purpose:'ATTENDANCE_ADJUDICATION',expected_version:item.version,assigned_staff_user_id:recipient,idempotency_key:crypto.randomUUID()}});}
  function decide(event:FormEvent){event.preventDefault();if(!detail)return;const ap=detail.appeals.find(a=>a.id===selectedAppeal);
    void send({caseId:detail.case.id,path:`/api/attendance-cases/${detail.case.id}/${ap?'appeal-decisions':'decisions'}`,body:{purpose:'ATTENDANCE_ADJUDICATION',expected_version:detail.case.version,outcome,reason_code:reason,reason_text:text,evidence:references.map(reference=>({kind:'MESSAGE',reference})),idempotency_key:crypto.randomUUID(),...(ap?{appeal_id:ap.id,original_action_id:ap.original_action_id,appeal_outcome:appealOutcome,review_mode:mode}:{})}});}
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;generation.current++;};},[]);
  const disabled=busy||!!pending;
  const refs=detail?[...new Set([...detail.reports.flatMap(r=>r.evidence),...detail.appeals.flatMap(a=>a.evidence)].map(e=>e.reference))]:[];
  return <main><Link href="/">Staff portal</Link><h1>Attendance dispute cases</h1>
    <p>Assigned case access requires current grants and recent MFA. Staff decisions remain distinct from participant confirmations.</p>
    <a href="/api/auth/login">Sign in / refresh MFA</a><button disabled={disabled} onClick={()=>void load()}>Refresh attendance queue</button>
    {busy&&<p role="status">Loading or saving attendance case…</p>}{error&&<p role="alert">{error}</p>}{feedback&&<p role="status">{feedback}</p>}
    {pending&&<button disabled={busy} onClick={()=>void send(pending)}>Retry pending attendance action</button>}
    {!busy&&!error&&!items.length&&<p>No authorized attendance cases.</p>}
    <label>Assignee staff user ID<input disabled={disabled} value={assignee} onChange={e=>setAssignee(e.target.value)}/></label>
    <ul aria-label="Attendance case queue">{items.map(item=><li key={item.id}><h2>Case {item.id}</h2><p>Viewing {item.viewing_id} · Schedule {item.schedule_version} · {label(item.state)} · {item.severity}</p><p>Queue age {Math.floor(item.age_seconds/60)} minutes · Assigned {item.assigned_staff_user_id??'Unassigned'} · Pending appeals {item.pending_appeals}</p>
      <button disabled={disabled} onClick={()=>void open(item.id)}>Open attendance case {item.id}</button>
      {permission(item.id,'case:assign')&&<><button disabled={disabled} onClick={()=>assign(item,assignee)}>Assign attendance case {item.id}</button>{!item.assigned_staff_user_id&&<button disabled={disabled} onClick={()=>assign(item,session!.user_id!)}>Claim attendance case {item.id}</button>}</>}
    </li>)}</ul>
    {detail&&<section aria-label="Assigned attendance case"><h2>Permitted attendance evidence</h2><p>Case version {detail.case.version} · Outcome {detail.case.outcome?label(detail.case.outcome):'Not decided'}</p>
      <h3>Claims</h3><ul>{detail.claims.map(c=><li key={c.id}>{c.claimant_side} · {label(c.claimed_outcome)} · {label(c.state)} · {c.validation_method??'No participant validation'}</li>)}</ul>
      <h3>Schedule history</h3><ul>{detail.schedules.map(s=><li key={s.schedule_version}>Schedule {s.schedule_version}: {new Date(s.scheduled_start).toLocaleString()} – {new Date(s.scheduled_end).toLocaleString()}</li>)}</ul>
      <h3>Reports and existing references</h3><ul>{detail.reports.map(r=><li key={r.id}>{label(r.reason_code)} · {new Date(r.submitted_at).toLocaleString()}{r.evidence.map(e=><p key={e.reference}>Message reference {e.reference}</p>)}</li>)}</ul>
      <h3>Immutable viewing events</h3><ul>{detail.events.map(e=><li key={e.id}>{label(e.event_type)} · Version {e.version} · {new Date(e.created_at).toLocaleString()}</li>)}</ul>
      <h3>Appeals</h3><ul>{detail.appeals.map(a=><li key={a.id}>{label(a.state)} · {a.reason} · Original decision {a.original_action_id}{a.evidence.map(e=><p key={e.reference}>Message reference {e.reference}</p>)}</li>)}</ul>
      <h3>Immutable decision history</h3><ul aria-label="Attendance decision history">{detail.actions.map(a=><li key={a.id}>{label(a.command)} · {a.outcome?label(a.outcome):'Assignment'}<p>{a.reason_text}</p><p>Actor {a.actor_user_id} · {a.before_state} → {a.after_state} · {a.policy_version} · {new Date(a.created_at).toLocaleString()}</p><p>{label(a.review_mode)}</p>{a.review_mode==='SOLE_OPERATOR_RECONSIDERATION'&&<p>Reconsideration by the original operator. This is not an independent review.</p>}{a.original_action_id&&<p>Linked original decision {a.original_action_id}</p>}</li>)}</ul>
      {detail.case.state==='TRIAGED'&&permission(detail.case.id,'moderation:act')&&<button disabled={disabled} onClick={()=>void send({caseId:detail.case.id,path:`/api/attendance-cases/${detail.case.id}/investigation`,body:{purpose:'ATTENDANCE_ADJUDICATION',expected_version:detail.case.version,reason_text:'Begin fresh attendance evidence investigation',idempotency_key:crypto.randomUUID()}})}>Start attendance investigation</button>}
      {permission(detail.case.id,'moderation:act')&&(detail.case.state==='UNDER_REVIEW'||detail.appeals.some(a=>a.state==='SUBMITTED')&&permission(detail.case.id,'appeal:resolve'))&&<form onSubmit={decide}><fieldset disabled={disabled}><legend>Record staff attendance decision</legend>
        {detail.case.outcome&&<><label>Appeal to decide<select required value={selectedAppeal} onChange={e=>{setSelectedAppeal(e.target.value);const ap=detail.appeals.find(a=>a.id===e.target.value),original=detail.actions.find(a=>a.id===ap?.original_action_id);if(original?.outcome){setOutcome(original.outcome);setReason(reasonFor(original.outcome));}}}><option value="">Select an appeal</option>{detail.appeals.filter(a=>a.state==='SUBMITTED').map(a=><option key={a.id} value={a.id}>{a.id}</option>)}</select></label>
          <label>Appeal result<select value={appealOutcome} onChange={e=>setAppealOutcome(e.target.value as typeof appealOutcome)}>{['UPHELD','OVERTURNED','PARTIALLY_UPHELD'].map(v=><option key={v}>{v}</option>)}</select></label>
          <label>Review mode<select value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="INDEPENDENT_REVIEW">Different reviewer</option><option value="SOLE_OPERATOR_RECONSIDERATION">Original operator reconsideration</option></select></label><p>Use original operator reconsideration only when no other nonconflicted authorized reviewer is available. Review the evidence afresh.</p></>}
        <label>Attendance outcome<select value={outcome} onChange={e=>{const v=e.target.value as AttendanceDecisionOutcome;setOutcome(v);setReason(reasonFor(v));}}>{outcomes.map(v=><option key={v}>{v}</option>)}</select></label>
        <label>Decision reason<select value={reason} onChange={e=>setReason(e.target.value as AttendanceDecisionReason)}>{['ATTENDANCE_SUPPORTED','NO_SHOW_SUPPORTED','CONTRADICTORY_CLAIM','UNSUPPORTED_CLAIM','INSUFFICIENT_EVIDENCE'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label>Internal decision rationale<textarea required minLength={10} maxLength={2000} value={text} onChange={e=>setText(e.target.value)}/></label>
        {refs.map(ref=><label key={ref}><input type="checkbox" checked={references.includes(ref)} onChange={e=>setReferences(old=>e.target.checked?[...old,ref]:old.filter(v=>v!==ref))}/>Reviewed message reference {ref}</label>)}
        <p>Rationale and evidence remain private to assigned staff. Participants receive a reason category and safe outcome explanation.</p><button type="submit">Record attendance decision</button>
      </fieldset></form>}
    </section>}
  </main>;
}
