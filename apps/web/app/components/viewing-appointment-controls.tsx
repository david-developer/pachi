'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ViewingNoticeListResponse, ViewingNoticeResponse, ViewingReminderResponse, ViewingRescheduleCommandResponse, ViewingRescheduleListResponse, ViewingRescheduleResponse, ViewingResponse } from '@pachi/contracts';
import { viewingTimeLabel, viewingTimeToUtc } from '@/lib/viewing-time';

type Attempt={path:string;body:Record<string,unknown>;key:string};
const labels:Record<string,string>={viewing_requested:'Viewing requested',viewing_accepted:'Viewing accepted',viewing_declined:'Viewing declined',viewing_confirmed:'Appointment time confirmed',viewing_scheduled:'Appointment scheduled',viewing_cancelled:'Appointment cancelled',viewing_expired:'Viewing request expired',viewing_reschedule_proposed:'Replacement time proposed',viewing_reschedule_accepted:'Replacement time approved',viewing_reschedule_rejected:'Replacement proposal rejected',viewing_reschedule_withdrawn:'Replacement proposal withdrawn',viewing_reschedule_expired:'Replacement proposal expired',viewing_reschedule_invalidated:'Replacement proposal unavailable',viewing_rescheduled:'Appointment time replaced',viewing_reschedule_finalized:'Replacement appointment confirmed',viewing_completion_claimed:'Attendance claim available',viewing_no_show_claimed:'No-show claim available',viewing_attendance_confirmed:'Attendance response recorded',viewing_attendance_disputed:'Attendance dispute update',viewing_attendance_finalized:'Attendance outcome available',viewing_reminder_24h:'Appointment reminder',viewing_reminder_2h:'Appointment reminder'};
const message=(status:number)=>status===401?'Sign in again to read appointment updates.':[403,404].includes(status)?'Appointment updates are unavailable with your current permissions.':status===409?'This appointment or proposal changed. Refresh the viewing before trying again.':status===400?'Check the future replacement times and try again.':'The change was not confirmed. Retry the pending change to check its result.';
async function send(attempt:Attempt,csrf:string){return fetch(attempt.path,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':attempt.key},body:JSON.stringify(attempt.body),cache:'no-store',signal:AbortSignal.timeout(10_000)});}
function Notice({notice,onRead,disabled}:{notice:ViewingNoticeResponse;onRead:(id:string)=>void;disabled:boolean}){
  return <li><p><strong>{labels[notice.event_type]??'Appointment update'}</strong> · {notice.read_at?'Read by you':'Unread'}</p>
    <p className="muted">Available in your inbox · {new Date(notice.available_at).toLocaleString()} · External delivery inactive</p>
    <Link href={`/viewings/${notice.viewing_id}`}>Open appointment</Link>{!notice.read_at&&<button disabled={disabled} onClick={()=>onRead(notice.id)}>Mark notice read</button>}
  </li>;
}
export function ViewingAppointmentControls({viewing,csrfToken,disabled,refreshVersion,onChange,onBusyChange,onDenied,onStale}:{viewing:ViewingResponse;csrfToken?:string|undefined;disabled:boolean;refreshVersion:number;onChange:(v:ViewingResponse)=>void;onBusyChange:(busy:boolean)=>void;onDenied:(status:number)=>void;onStale:()=>void}){
  const [data,setData]=useState<ViewingRescheduleListResponse|null>(null),[notices,setNotices]=useState<ViewingNoticeListResponse>({items:[],next_cursor:null});
  const [reminders,setReminders]=useState<ViewingReminderResponse|null>(null),[busy,setBusy]=useState(true),[sending,setSending]=useState(false);
  const [error,setError]=useState(''),[feedback,setFeedback]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[pending,setPending]=useState<Attempt|null>(null);
  const alive=useRef(true),reads=useRef(0),commands=useRef(0);
  async function load(after?:string){
    const generation=++reads.current;setBusy(true);setError('');
    try{
      const responses=await Promise.all([fetch(`/api/account/viewings/${viewing.id}/reschedules${after?`?cursor=${encodeURIComponent(after)}`:''}`,{cache:'no-store',signal:AbortSignal.timeout(10_000)}),fetch(`/api/account/viewing-notices?viewing_id=${viewing.id}`,{cache:'no-store',signal:AbortSignal.timeout(10_000)}),fetch(`/api/account/viewings/${viewing.id}/reminders`,{cache:'no-store',signal:AbortSignal.timeout(10_000)})]);
      if(!alive.current||generation!==reads.current)return;
      const failed=responses.find(r=>!r.ok);if(failed){setData(null);setNotices({items:[],next_cursor:null});setReminders(null);setError(message(failed.status));if([401,403,404].includes(failed.status))onDenied(failed.status);return;}
      const [proposals,inbox,jobs]=await Promise.all(responses.map(r=>r.json()));
      if(!alive.current||generation!==reads.current)return;
      const result=proposals as ViewingRescheduleListResponse;setData(old=>({...result,items:after&&old?[...new Map([...old.items,...result.items].map(p=>[p.id,p])).values()]:result.items}));setNotices(inbox as ViewingNoticeListResponse);setReminders(jobs as ViewingReminderResponse);
    }catch{if(alive.current&&generation===reads.current)setError('Appointment activity could not be loaded. Refresh to try again.');}
    finally{if(alive.current&&generation===reads.current)setBusy(false);}
  }
  useEffect(()=>{alive.current=true;setPending(null);setSending(false);setStart('');setEnd('');setFeedback('');return()=>{alive.current=false;reads.current++;commands.current++;onBusyChange(false);};},[viewing.id]);
  useEffect(()=>{void load();},[viewing.id,viewing.version,refreshVersion]);
  useEffect(()=>{onBusyChange(busy||sending||!!pending);},[busy,sending,pending,onBusyChange]);
  async function command(action?:'propose'|'accept'|'reject'|'withdraw',proposal?:ViewingRescheduleResponse,event?:FormEvent){
    event?.preventDefault();if(!csrfToken||sending||(!pending&&(disabled||busy)))return;
    let attempt=pending;
    if(!attempt){
      if(!action)return;
      let body:Record<string,unknown>={expected_version:viewing.version,expected_schedule_version:viewing.schedule_version};
      if(action==='propose'){
        try{const proposedStart=viewingTimeToUtc(start,viewing.display_timezone),proposedEnd=viewingTimeToUtc(end,viewing.display_timezone);if(Date.parse(proposedStart)<=Date.now()||Date.parse(proposedEnd)<=Date.parse(proposedStart))throw Error('Choose a future start and an end after the start.');body={...body,proposed_start:proposedStart,proposed_end:proposedEnd};}catch(e){setError(e instanceof Error?e.message:'Check the replacement time.');return;}
      }else{if(!proposal)return;body={...body,expected_proposal_version:proposal.version};}
      attempt={path:`/api/account/viewings/${viewing.id}/reschedules${action==='propose'?'':`/${proposal!.id}/${action}`}`,body,key:crypto.randomUUID()};
    }
    const generation=++commands.current;reads.current++;setBusy(false);setPending(attempt);setSending(true);setError('');setFeedback('Saving appointment proposal…');
    try{
      const response=await send(attempt,csrfToken);if(!alive.current||generation!==commands.current)return;
      if(!response.ok){setError(message(response.status));setFeedback('');if(response.status<500)setPending(null);if([401,403,404].includes(response.status))onDenied(response.status);if(response.status===409)onStale();return;}
      const result=await response.json() as ViewingRescheduleCommandResponse;if(!alive.current||generation!==commands.current)return;
      reads.current++;setPending(null);setStart('');setEnd('');setFeedback(result.proposal.state==='FINALIZED'?'Replacement appointment confirmed.':result.proposal.state==='PENDING'?'Proposal saved. Both sides must explicitly approve before the confirmed time changes.':'Proposal closed. The confirmed appointment time is unchanged.');
      onChange(result.viewing);
    }catch{if(alive.current&&generation===commands.current){setError(message(503));setFeedback('');}}
    finally{if(alive.current&&generation===commands.current)setSending(false);}
  }
  async function markRead(id:string){
    if(!csrfToken||sending||pending)return;setSending(true);setError('');const generation=++commands.current;
    try{const response=await send({path:`/api/account/viewing-notices/${id}/read`,body:{},key:crypto.randomUUID()},csrfToken);if(!alive.current||generation!==commands.current)return;if(!response.ok){setError(message(response.status));if([401,403,404].includes(response.status))onDenied(response.status);return;}const result=await response.json() as ViewingNoticeResponse;if(!alive.current||generation!==commands.current)return;reads.current++;setNotices(old=>({...old,items:old.items.map(n=>n.id===id?result:n)}));setFeedback('Notice marked read by you.');void load();}catch{if(alive.current&&generation===commands.current)setError('Notice reading was not confirmed. Try marking it read again.');}finally{if(alive.current&&generation===commands.current)setSending(false);}
  }
  const active=data?.current_proposal;const actionable=!busy&&!sending&&!pending&&!disabled&&!!csrfToken;
  return <section className="viewingPanel" aria-label="Appointment changes and notices">
    <h2>Appointment changes and notices</h2><button disabled={busy||sending} onClick={()=>void load()}>Refresh appointment activity</button>
    {busy&&<p role="status">Loading appointment activity…</p>}{error&&<p role="alert" className="error">{error}</p>}{feedback&&<p role="status">{feedback}</p>}
    {active&&<div aria-label="Pending replacement proposal"><h3>Proposed replacement time</h3>
      <p>{viewingTimeLabel(active.proposed_start,active.display_timezone)} – {viewingTimeLabel(active.proposed_end,active.display_timezone)}</p>
      <p>Proposed by {active.proposed_by_side==='SEEKER'?'seeker':'provider'} · Confirmed appointment stays unchanged until both approve.</p>
      <p>Seeker approval: {active.seeker_approved?'Approved':'Waiting'} · Provider approval: {active.provider_approved?'Approved':'Waiting'}</p>
      <p>Proposal expires: {viewingTimeLabel(active.expires_at,active.display_timezone)}</p>
      {Date.parse(active.expires_at)<=Date.now()&&<p>The response deadline has passed. This proposal cannot replace the confirmed appointment.</p>}
      {active.can_accept&&<button disabled={!actionable} onClick={()=>void command('accept',active)}>Approve replacement time</button>}
      {active.can_reject&&<button disabled={!actionable} onClick={()=>void command('reject',active)}>Reject replacement proposal</button>}
      {active.can_withdraw&&<button disabled={!actionable} onClick={()=>void command('withdraw',active)}>Withdraw replacement proposal</button>}
    </div>}
    {data?.can_propose&&!pending&&<form onSubmit={e=>void command('propose',undefined,e)}><fieldset disabled={!actionable}><legend>Propose a replacement time</legend>
      <label>Replacement start<input type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label>Replacement end<input type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></label>
      <p className="muted">Enter times in {viewing.display_timezone}. Proposing does not approve the replacement; both sides must explicitly approve it.</p><button type="submit">Propose replacement time</button>
    </fieldset></form>}
    {pending&&<button disabled={sending} onClick={()=>void command()}>{sending?'Saving…':'Retry pending appointment change'}</button>}
    {data&&!busy&&!data.items.length&&<p>No replacement proposals yet.</p>}
    {!!data?.items.length&&<ul aria-label="Replacement proposal history">{data.items.filter(p=>p.state!=='PENDING').map(p=><li key={p.id}>{p.state} · {viewingTimeLabel(p.proposed_start,p.display_timezone)}</li>)}</ul>}
    {data?.next_cursor&&<button disabled={busy||sending} onClick={()=>void load(data.next_cursor!)}>Load more replacement proposals</button>}
    {!!data?.schedule_history.length&&<details><summary>Previous confirmed times</summary><ul>{data.schedule_history.map(h=><li key={h.schedule_version}>Schedule {h.schedule_version} · {viewingTimeLabel(h.scheduled_start,h.display_timezone)} – {viewingTimeLabel(h.scheduled_end,h.display_timezone)}</li>)}</ul></details>}
    <h3>Appointment notices</h3><ul aria-label="Appointment notices">{notices.items.map(n=><Notice key={n.id} notice={n} disabled={!actionable} onRead={id=>void markRead(id)}/>)}</ul>
    {!busy&&!notices.items.length&&<p>No appointment notices available.</p>}<Link href="/viewings/notices">All appointment notices</Link>
    <h3>Reminder status</h3>{reminders&&<><p>Reminder plan: {reminders.plan_status.replaceAll('_',' ').toLowerCase()} · External delivery inactive</p><ul aria-label="Appointment reminders">{reminders.items.map(j=><li key={j.id}>{j.action_type==='REMINDER_24H'?'24-hour':'2-hour'} reminder · Schedule {j.expected_schedule_version} · {j.state==='PROCESSED'?'Available in inbox':j.state==='SKIPPED'?'Skipped':j.state==='LEASED'?'Processing':'Pending'} · {viewingTimeLabel(j.due_at,viewing.display_timezone)}</li>)}</ul>{!reminders.items.length&&<p>No future reminder intent for this schedule.</p>}</>}
    <p className="muted">Inbox availability, reading by you and external delivery are separate states.</p>
  </section>;
}

export function ViewingNoticeInbox(){
  const [items,setItems]=useState<ViewingNoticeResponse[]>([]),[cursor,setCursor]=useState<string|null>(null),[csrf,setCsrf]=useState('');
  const [busy,setBusy]=useState(true),[sending,setSending]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState('');
  const alive=useRef(true),reads=useRef(0),commands=useRef(0);
  async function load(after?:string){
    const generation=++reads.current;setBusy(true);setError('');
    try{
      const [response,session]=await Promise.all([fetch(`/api/account/viewing-notices${after?`?cursor=${encodeURIComponent(after)}`:''}`,{cache:'no-store',signal:AbortSignal.timeout(10_000)}),fetch('/api/session',{cache:'no-store',signal:AbortSignal.timeout(10_000)})]);
      if(!alive.current||generation!==reads.current)return;
      if(!response.ok||!session.ok){const status=response.ok?session.status:response.status;if([401,403,404].includes(status)){setItems([]);setCsrf('');}setError(status>=500?'Appointment notices could not be loaded. Refresh to try again.':message(status));return;}
      const [result,actor]=await Promise.all([response.json() as Promise<ViewingNoticeListResponse>,session.json() as Promise<{authenticated:boolean;csrfToken?:string}>]);
      if(!alive.current||generation!==reads.current)return;
      if(!actor.authenticated){setItems([]);setCsrf('');setError(message(401));return;}
      setItems(old=>after?[...new Map([...old,...result.items].map(n=>[n.id,n])).values()]:result.items);setCursor(result.next_cursor);setCsrf(actor.csrfToken??'');
    }catch{if(alive.current&&generation===reads.current)setError('Appointment notices could not be loaded. Refresh to try again.');}
    finally{if(alive.current&&generation===reads.current)setBusy(false);}
  }
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;reads.current++;commands.current++;};},[]);
  async function markRead(id:string){
    if(!csrf||sending||busy)return;const generation=++commands.current;reads.current++;setSending(true);setError('');setFeedback('Marking notice read…');
    try{
      const response=await send({path:`/api/account/viewing-notices/${id}/read`,body:{},key:crypto.randomUUID()},csrf);
      if(!alive.current||generation!==commands.current)return;
      if(!response.ok){if([401,403,404].includes(response.status)){setItems([]);setCsrf('');}setError(message(response.status));setFeedback('');return;}
      const result=await response.json() as ViewingNoticeResponse;if(!alive.current||generation!==commands.current)return;
      setItems(old=>old.map(n=>n.id===id?result:n));setFeedback('Notice marked read by you.');
    }catch{if(alive.current&&generation===commands.current){setError('Notice reading was not confirmed. Try marking it read again.');setFeedback('');}}
    finally{if(alive.current&&generation===commands.current)setSending(false);}
  }
  return <section className="viewingPanel" aria-label="Appointment notice inbox"><button disabled={busy||sending} onClick={()=>void load()}>Refresh appointment notices</button>
    {busy&&<p role="status">Loading appointment notices…</p>}{error&&<p role="alert" className="error">{error}</p>}{feedback&&<p role="status">{feedback}</p>}
    <ul aria-label="Appointment notices">{items.map(n=><Notice key={n.id} notice={n} disabled={busy||sending||!csrf} onRead={id=>void markRead(id)}/>)}</ul>
    {!busy&&!error&&!items.length&&<p>No appointment notices yet.</p>}{cursor&&<button disabled={busy||sending} onClick={()=>void load(cursor)}>Load more appointment notices</button>}
    <p className="muted">These updates are available in-app. Marking one read records your acknowledgement; external email, SMS and push delivery are inactive.</p>
  </section>;
}
