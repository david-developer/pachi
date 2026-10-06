'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { OwnBlockListResponse, OwnBlockResponse } from '@pachi/contracts';

export default function OwnBlocksPage() {
  const [items,setItems]=useState<OwnBlockResponse[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [csrf,setCsrf]=useState('');
  const [busy,setBusy]=useState(false);
  const [feedback,setFeedback]=useState('');
  const retry=useRef<{id:string;version:number;key:string}|null>(null);
  const generation=useRef(0);
  async function load(after?:string) {
    const current=++generation.current;
    const response=await fetch(`/api/account/blocks${after?`?cursor=${encodeURIComponent(after)}`:''}`,{cache:'no-store'});
    if(current!==generation.current)return;
    if(!response.ok)throw new Error();const page=await response.json() as OwnBlockListResponse;
    if(current!==generation.current)return;
    setItems(previous=>after?[...previous,...page.items]:page.items);setCursor(page.next_cursor);
  }
  useEffect(()=>{void(async()=>{try{const session=await fetch('/api/session',{cache:'no-store'}).then(r=>r.json()) as {authenticated?:boolean;csrfToken?:string};if(!session.authenticated)throw new Error();setCsrf(session.csrfToken??'');await load();}catch{setFeedback('Sign in to manage your blocks, or refresh to try again.');}})();},[]);
  async function unblock(row:OwnBlockResponse) {
    if(busy)return;const current=++generation.current;setBusy(true);setFeedback('Removing your block…');
    const previous=retry.current;const key=previous?.id===row.id&&previous.version===row.version?previous.key:crypto.randomUUID();retry.current={id:row.id,version:row.version,key};
    try{
      const response=await fetch(`/api/account/blocks/${row.id}/unblock`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':key},body:JSON.stringify({expected_version:row.version}),signal:AbortSignal.timeout(10_000)});
      if(!response.ok)throw new Error();const updated=await response.json() as OwnBlockResponse;
      if(current!==generation.current)return;
      setItems(previous=>previous.map(item=>item.id===updated.id?updated:item));retry.current=null;setFeedback('Your block was removed. Other restrictions may still apply.');
    }catch{setFeedback('Unblock was not confirmed. Retry or refresh your blocks.');}finally{setBusy(false);}
  }
  return <main className="publicShell"><Link href="/conversations">Your conversations</Link><h1>Your blocks</h1><p>Only your own safety preferences appear here. Removing one does not clear other contact restrictions.</p><button disabled={busy} onClick={()=>void load().catch(()=>setFeedback('Blocks could not be loaded.'))}>Refresh blocks</button><ul>{items.map(row=><li key={row.id}>{row.subject_kind==='PROVIDER_ACCOUNT'?'Provider contact':'Marketplace contact'} · {row.state==='ACTIVE'?'Blocked':'Removed'} · {new Date(row.created_at).toLocaleDateString()}{row.state==='ACTIVE'&&<button disabled={busy||!csrf} onClick={()=>void unblock(row)}>Unblock contact</button>}</li>)}</ul>{cursor&&<button disabled={busy} onClick={()=>void load(cursor).catch(()=>setFeedback('Blocks could not be loaded.'))}>Load more blocks</button>}{feedback&&<p role="status">{feedback}</p>}</main>;
}
