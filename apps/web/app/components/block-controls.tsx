'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ContactSafetyResponse, OwnBlockResponse } from '@pachi/contracts';

export function BlockControls({source,id,onStart,onChange,onCapability}:{source:'interactions'|'listings';id:string;onStart?:()=>void;onChange?:(blocked:boolean)=>void;onCapability?:(canContact:boolean)=>void}) {
  const [safety,setSafety]=useState<ContactSafetyResponse|null>(null);
  const [csrf,setCsrf]=useState('');
  const [busy,setBusy]=useState(false);
  const [feedback,setFeedback]=useState('');
  const generation=useRef(0);
  const retry=useRef<{identity:string;key:string}|null>(null);
  useEffect(()=>{
    let active=true;const current=++generation.current;setSafety(null);setCsrf('');retry.current=null;
    void (async()=>{
      try{
        const session=await fetch('/api/session',{cache:'no-store'}).then(r=>r.json()) as {authenticated?:boolean;csrfToken?:string};
        if(!active||!session.authenticated)return;
        setCsrf(session.csrfToken??'');
        const response=await fetch(`/api/account/${source}/${id}/contact-safety`,{cache:'no-store',signal:AbortSignal.timeout(10_000)});
        if(!response.ok)return;
        const result=await response.json() as ContactSafetyResponse;
        if(active&&current===generation.current&&typeof result.can_block==='boolean')setSafety(result);
      }catch{/* Safe controls stay unavailable until authority is established. */}
    })();
    return ()=>{active=false;generation.current++;};
  },[source,id]);
  // Notify only from the committed projection, never from delayed old reads.
  useEffect(()=>{if(safety&&onCapability)onCapability(safety.can_contact);},[safety,onCapability]);
  async function mutate() {
    if(!safety||!csrf||busy)return;
    const own=safety.own_block;
    const identity=own?`${own.id}:${own.version}`:`${source}:${id}`;
    const key=retry.current?.identity===identity?retry.current.key:crypto.randomUUID();
    retry.current={identity,key};const current=++generation.current;
    setBusy(true);setFeedback('Saving safety preference…');onStart?.();
    try{
      const response=await fetch(own?`/api/account/blocks/${own.id}/unblock`:`/api/account/${source}/${id}/${source==='listings'?'block-provider':'block'}`,{
        method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':key},body:JSON.stringify(own?{expected_version:own.version}:{}),signal:AbortSignal.timeout(10_000)
      });
      if(!response.ok)throw new Error();
      const result=await response.json() as OwnBlockResponse;
      if(current!==generation.current)return;
      retry.current=null;
      const blocked=result.state==='ACTIVE';
      setSafety({can_contact:false,can_block:!blocked,own_block:blocked?result:null});onChange?.(blocked);
      setFeedback(blocked?'You blocked this contact. Your history is preserved.':'Your block was removed. Other restrictions may still apply.');
      const updated=await fetch(`/api/account/${source}/${id}/contact-safety`,{cache:'no-store',signal:AbortSignal.timeout(10_000)});
      if(updated.ok){const value=await updated.json() as ContactSafetyResponse;if(current===generation.current)setSafety(value);}
    }catch{if(current===generation.current)setFeedback('Safety preference was not confirmed. Retry the same action or manage your blocks.');}
    finally{if(current===generation.current)setBusy(false);}
  }
  return <div>{csrf&&<Link href="/blocks">Manage your blocks</Link>}{safety&&csrf&&(safety.own_block||safety.can_block)&&<button type="button" disabled={busy} onClick={()=>void mutate()}>{safety.own_block?'Unblock contact':source==='listings'?'Block provider':'Block contact'}</button>}{feedback&&<p role="status">{feedback}</p>}</div>;
}
