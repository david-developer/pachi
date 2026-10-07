'use client';
import { useRef, useState } from 'react';
import type { OrganizationSummary, OrganizationMember, OrganizationOwnershipTransfer, OrganizationOwnershipTransferListResponse, OrganizationRole } from '@pachi/contracts';
const root='/api/account/organizations';
const roles:OrganizationRole[]=['OWNER','ADMIN','LISTING_MANAGER','AGENT','ANALYST'];
export function OwnerControls({organization,members,busy,execute}:{organization:OrganizationSummary;members:OrganizationMember[];busy:boolean;execute:(path:string,payload:Record<string,unknown>)=>Promise<unknown>}){
 const [transfers,setTransfers]=useState<OrganizationOwnershipTransfer[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const generation=useRef(0);
 const owner=organization.membership.role==='OWNER';
 const versions={expected_organization_version:organization.version,expected_actor_membership_version:organization.membership.version};
 async function load(){const current=++generation.current;setLoading(true);setError('');try{
  const response=await fetch(`${root}/${organization.id}/ownership-transfers`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Transfers are unavailable to your current account. Refresh your organizations.');
  const result=await response.json() as OrganizationOwnershipTransferListResponse;
  if(current===generation.current)setTransfers(result.transfers);
 }catch{if(current===generation.current)setError('Transfers are unavailable to your current account. Refresh your organizations.');}finally{if(current===generation.current)setLoading(false);}}
 async function transferCommand(transfer:OrganizationOwnershipTransfer,command:string){
  await execute(`${root}/${organization.id}/ownership-transfers/${transfer.id}/${command}`,{...versions,expected_organization_version:transfer.organization_version,expected_transfer_version:transfer.version,expected_source_membership_version:transfer.source_membership_version,expected_recipient_membership_version:transfer.recipient_membership_version});
  // Clear old projections; refresh requires a new server read and does not retry a mutation.
  setTransfers([]);
 }
 return <section aria-label="Ownership and admin management"><h3>Ownership and admin management</h3>
  <p>Ownership and admin changes require recent MFA-backed verification. Step-up is currently unavailable in this development interface. The server will require it before a change can proceed.</p>
  <p>Final-owner recovery is unavailable and deferred to a future scoped staff process.</p>
  {owner&&members.filter(member=>member.state==='ACTIVE').map(member=><PrivilegedMember key={`${member.id}:${member.version}`} member={member} busy={busy} execute={async(command,role)=>{
   await execute(`${root}/${organization.id}/members/${member.id}/${command}`,{...versions,expected_membership_version:member.version,...(role?{role}:{})});
  }} initiate={member.role==='OWNER'?undefined:async()=>{
   await execute(`${root}/${organization.id}/ownership-transfers`,{...versions,recipient_membership_id:member.id,expected_recipient_membership_version:member.version,source_role_after:'AGENT'});
  }}/>) }
  <button type="button" disabled={busy||loading} onClick={()=>void load()}>{loading?'Loading ownership transfers…':'Load ownership transfers'}</button>
  {error&&<p role="alert">{error}</p>}
  <ul aria-label="Ownership transfers">{transfers.map(transfer=><li key={transfer.id}><p>Transfer {transfer.id} · {transfer.state}. Source membership becomes {transfer.source_role_after} when completed.</p>
   {transfer.state==='PENDING_ACCEPTANCE'&&transfer.recipient_membership_id===organization.membership.id&&<button disabled={busy} type="button" onClick={()=>void transferCommand(transfer,'accept')}>Accept ownership transfer</button>}
   {owner&&transfer.source_membership_id===organization.membership.id&&<>
    {transfer.state==='ACCEPTED'&&<button disabled={busy} type="button" onClick={()=>void transferCommand(transfer,'complete')}>Complete ownership transfer</button>}
    {['PENDING_ACCEPTANCE','ACCEPTED'].includes(transfer.state)&&<button disabled={busy} type="button" onClick={()=>void transferCommand(transfer,'cancel')}>Cancel ownership transfer</button>}
   </>}
  </li>)}</ul>
 </section>;
}
function PrivilegedMember({member,busy,execute,initiate}:{member:OrganizationMember;busy:boolean;execute:(command:string,role?:OrganizationRole)=>Promise<void>;initiate?:(()=>Promise<void>)|undefined}){
 const [role,setRole]=useState<OrganizationRole>(member.role);
 const privileged=member.role==='OWNER'||member.role==='ADMIN';
 return <div><p>Privileged commands for member {member.user_id} · {member.role}</p>
  <label>Privileged role for {member.user_id}<select disabled={busy} value={role} onChange={event=>setRole(event.target.value as OrganizationRole)}>{roles.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
  <button type="button" disabled={busy||role===member.role||(!privileged&&!['OWNER','ADMIN'].includes(role))} onClick={()=>void execute('privileged-role',role)}>Apply privileged role</button>
  {privileged&&<button disabled={busy} type="button" onClick={()=>void execute('privileged-revoke')}>Remove privileged member</button>}
  {initiate&&<button disabled={busy} type="button" onClick={()=>void initiate()}>Initiate ownership transfer to this member</button>}
 </div>;
}
