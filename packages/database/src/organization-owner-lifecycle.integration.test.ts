import assert from 'node:assert/strict';
import test from 'node:test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';
import { createDatabase } from './client.js';
import { organizationOwnerFixture } from './organization-owner-fixture.js';
import { OrganizationOwnerStore } from './organization-owner-lifecycle.js';
import { LocalOrganizationOwnerStepUp } from './organization-owner-step-up.js';
import { OrganizationAssignmentStore } from './organization-assignments.js';

const url=process.env.DATABASE_TEST_URL;
if(url){const u=new URL(url);assert.equal(u.hostname,'localhost');assert.equal(u.port,'5433');assert.equal(u.pathname,'/pachi_test');}
const integration=url?test:test.skip;
// This file executes in its isolated node:test worker. Never a development service.
process.env.NODE_ENV='test';
async function fixture(){const {client}=createDatabase(url!);await client`SET client_min_messages TO warning`;await client`TRUNCATE users RESTART IDENTITY CASCADE`;const f=await organizationOwnerFixture(client);return{...f,async close(){await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client.end();}};}
const denied={code:'RESOURCE_SCOPE_DENIED'};
async function effects(sql:postgres.Sql){return(await sql`SELECT (SELECT count(*)::int FROM organization_owner_actions) AS actions,(SELECT count(*)::int FROM organization_owner_outbox) AS events,
  (SELECT count(*)::int FROM organization_command_receipts WHERE operation IN ('OWNER_ROLE','OWNER_REVOKE','TRANSFER_INITIATE','TRANSFER_ACCEPT','TRANSFER_COMPLETE','TRANSFER_CANCEL')) AS receipts`)[0]!;}

void integration('owner grants ADMIN and multiple OWNER roles; demotion/revocation preserve final owner and immutable safe effects',async()=>{
 const f=await fixture();try{
  const input={...await f.context(f.actors.owner),expectedMembershipVersion:1,command:'ROLE' as const,role:'ADMIN' as const};
  const admin=await f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.manager,input);assert.equal(admin.role,'ADMIN');assert.equal(admin.version,2);
  const before=await effects(f.client);
  assert.deepEqual(await f.store.mutateMember({...f.actors.owner,userId:f.actors.owner.userId.toUpperCase()},f.org.id.toUpperCase(),f.memberships.manager.toUpperCase(),{...input,idempotencyKey:input.idempotencyKey.toUpperCase()}),admin);
  assert.deepEqual(await effects(f.client),before);
  await assert.rejects(f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.manager,{...input,role:'OWNER'}),{code:'IDEMPOTENCY_KEY_REUSED'});
  await f.role(f.actors.owner,f.memberships.agent,'OWNER');
  await f.role(f.actors.owner,f.memberships.owner,'AGENT');
  await assert.rejects(f.role(f.actors.owner,f.memberships.admin,'OWNER'),denied);
  await f.role(f.actors.agent,f.memberships.manager,'ANALYST');
  const removed=await f.store.mutateMember(f.actors.agent,f.org.id,f.memberships.admin,{...await f.context(f.actors.agent),expectedMembershipVersion:1,command:'REVOKE'});assert.equal(removed.state,'REVOKED');
  await assert.rejects(f.role(f.actors.agent,f.memberships.agent,'ANALYST'),{code:'FINAL_OWNER_PROTECTED'});
  for(const table of ['organization_owner_actions','organization_owner_outbox','organization_owner_denials']) await assert.rejects(f.client.unsafe(`DELETE FROM ${table}`));
  const safe=JSON.stringify(await f.client`SELECT safe_payload FROM organization_owner_outbox`);assert.doesNotMatch(safe,/token|secret|phone|address|evidence|message_body|session/);
 }finally{await f.close();}
});
void integration('dedicated transfer requires recipient acceptance and completes roles, receipt, attribution and outbox atomically',async()=>{
 const f=await fixture();try{
  const transfer=await f.initiate();assert.equal(transfer.state,'PENDING_ACCEPTANCE');
  await assert.rejects(f.store.transferCommand(f.actors.admin,f.org.id,transfer.id,await f.transferInput(f.actors.admin,transfer,'ACCEPT')),denied);
  const accepted=await f.store.transferCommand(f.actors.agent,f.org.id,transfer.id,await f.transferInput(f.actors.agent,transfer,'ACCEPT'));assert.equal(accepted.state,'ACCEPTED');
  const input=await f.transferInput(f.actors.owner,accepted,'COMPLETE');
  const completed=await f.store.transferCommand(f.actors.owner,f.org.id,transfer.id,input);assert.equal(completed.state,'COMPLETED');assert.equal(completed.version,3);
  const before=await effects(f.client);assert.deepEqual(await f.store.transferCommand(f.actors.owner,f.org.id,transfer.id,input),completed);assert.deepEqual(await effects(f.client),before);
  await assert.rejects(f.store.transferCommand(f.actors.owner,f.org.id,transfer.id,{...input,...f.command()}),denied);
  const members=await f.client`SELECT id,role,version FROM organization_memberships WHERE id IN (${f.memberships.owner},${f.memberships.agent}) ORDER BY id`;
  assert.equal(members.find(m=>m.id===f.memberships.owner)?.role,'AGENT');assert.equal(members.find(m=>m.id===f.memberships.agent)?.role,'OWNER');
  const row=(await f.client`SELECT initiated_by,accepted_by,completed_by FROM organization_ownership_transfers WHERE id=${transfer.id}`)[0]!;
  assert.deepEqual(row,{initiated_by:f.actors.owner.userId,accepted_by:f.actors.agent.userId,completed_by:f.actors.owner.userId});
  assert.deepEqual((await f.client`SELECT action FROM organization_owner_actions WHERE transfer_id=${transfer.id} ORDER BY created_at,id`).map(r=>r.action).sort(),['PRIVILEGED_ROLE_CHANGED','PRIVILEGED_ROLE_CHANGED','TRANSFER_ACCEPTED','TRANSFER_COMPLETED','TRANSFER_INITIATED'].sort());
  await assert.rejects(f.client`UPDATE organization_ownership_transfers SET state='PENDING_ACCEPTANCE',version=version+1 WHERE id=${transfer.id}`);
  await assert.rejects(f.client`DELETE FROM organization_ownership_transfers WHERE id=${transfer.id}`);
 }finally{await f.close();}
});
void integration('cancellation and membership invalidation remain terminal; neither revoked nor stale episodes are resurrected',async()=>{
 const f=await fixture();try{
  const transfer=await f.initiate();const cancelled=await f.store.transferCommand(f.actors.owner,f.org.id,transfer.id,await f.transferInput(f.actors.owner,transfer,'CANCEL'));assert.equal(cancelled.state,'CANCELLED');
  await assert.rejects(f.store.transferCommand(f.actors.agent,f.org.id,transfer.id,await f.transferInput(f.actors.agent,cancelled,'ACCEPT')),{code:'INVALID_STATE'});
  const pending=await f.initiate();
  await f.lifecycle.mutateMember(f.actors.owner,f.org.id,f.memberships.agent,{...f.command(),expectedVersion:1,command:'SUSPEND'});
  assert.equal((await f.client`SELECT state FROM organization_ownership_transfers WHERE id=${pending.id}`)[0]?.state,'INVALIDATED');
  await f.lifecycle.mutateMember(f.actors.owner,f.org.id,f.memberships.agent,{...f.command(),expectedVersion:2,command:'REACTIVATE'});
  await assert.rejects(f.store.transferCommand(f.actors.agent,f.org.id,pending.id,{...await f.transferInput(f.actors.agent,pending,'ACCEPT'),expectedTransferVersion:2}),{code:'INVALID_STATE'});
 }finally{await f.close();}
});
for(const actor of ['admin','manager','agent','analyst','unrelated','otherOwner','invited','suspended','revoked'] as const)void integration(`privileged mutation denies current ${actor} authority`,async()=>{
 const f=await fixture();try{
  const input={...await f.context(f.actors[actor]),expectedMembershipVersion:1,command:'ROLE' as const,role:'OWNER' as const};
  await assert.rejects(f.store.mutateMember(f.actors[actor],f.org.id,f.memberships.agent,input),denied);
  assert.deepEqual(await effects(f.client),{actions:0,events:0,receipts:0});
 }finally{await f.close();}
});
for(const loss of ['PENDING_PHONE','SUSPENDED','DEACTIVATED','expired','revokedSession','securityVersion','phone','organization','membershipSuspend','membershipRevoke'] as const)void integration(`sensitive commands recheck ${loss} after actor capture and before receipt replay`,async()=>{
 const f=await fixture();try{
  const input={...await f.context(f.actors.owner),expectedMembershipVersion:1,command:'ROLE' as const,role:'ADMIN' as const};
  await f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.manager,input);
  if(['PENDING_PHONE','SUSPENDED','DEACTIVATED'].includes(loss))await f.client`UPDATE users SET account_state=${loss} WHERE id=${f.actors.owner.userId}`;
  else if(loss==='expired')await f.client`UPDATE security_sessions SET expires_at=statement_timestamp()-interval '1 second' WHERE id=${f.actors.owner.sessionId}`;
  else if(loss==='revokedSession')await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${f.actors.owner.sessionId}`;
  else if(loss==='securityVersion')await f.client`UPDATE users SET security_version=security_version+1 WHERE id=${f.actors.owner.userId}`;
  else if(loss==='phone')await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${f.actors.owner.userId}`;
  else if(loss==='organization')await f.client`UPDATE organizations SET state='SUSPENDED' WHERE id=${f.org.id}`;
  else {await f.client`INSERT INTO organization_memberships(organization_id,user_id,role,state,changed_by) VALUES(${f.org.id},${f.actors.admin.userId},'OWNER','ACTIVE',${f.actors.owner.userId}) ON CONFLICT DO NOTHING`;
   await f.client`UPDATE organization_memberships SET role='OWNER' WHERE id=${f.memberships.admin}`;
   await f.client`UPDATE organization_memberships SET state=${loss==='membershipSuspend'?'SUSPENDED':'REVOKED'},version=version+1 WHERE id=${f.memberships.owner}`;}
  const code=['expired','revokedSession','securityVersion'].includes(loss)?'AUTH_REQUIRED':['organization','membershipSuspend','membershipRevoke'].includes(loss)?'RESOURCE_SCOPE_DENIED':'CAPABILITY_RESTRICTED';
  await assert.rejects(f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.manager,input),{code});
 }finally{await f.close();}
});
void integration('trusted owner step-up is recent, session/security-version/org bound, TEST-only and absent in normal execution',async()=>{
 const f=await fixture();try{
  const input={...await f.context(f.actors.owner),expectedMembershipVersion:1,command:'ROLE' as const,role:'ADMIN' as const};
  await assert.rejects(new OrganizationOwnerStore(f.client).mutateMember(f.actors.owner,f.org.id,f.memberships.manager,input),{code:'STEP_UP_REQUIRED'});
  const at=new Date('2026-10-07T00:00:00Z');let now=at;
  const step=new LocalOrganizationOwnerStepUp(f.client,()=>now);await step.establish(f.actors.owner,f.org.id);now=new Date(+at+900000);
  await assert.rejects(new OrganizationOwnerStore(f.client,step).mutateMember(f.actors.owner,f.org.id,f.memberships.manager,{...input,...f.command()}),{code:'STEP_UP_REQUIRED'});
  now=new Date(+at-1);await assert.rejects(new OrganizationOwnerStore(f.client,step).mutateMember(f.actors.owner,f.org.id,f.memberships.manager,{...input,...f.command()}),{code:'STEP_UP_REQUIRED'});
  process.env.NODE_ENV='production';assert.throws(()=>new LocalOrganizationOwnerStepUp(f.client),{code:'STEP_UP_REQUIRED'});process.env.NODE_ENV='test';
  await f.client`UPDATE auth_identities SET provider='COGNITO' WHERE user_id=${f.actors.owner.userId}`;
  await assert.rejects(f.stepUp.establish(f.actors.owner,f.org.id),{code:'STEP_UP_REQUIRED'});
 }finally{process.env.NODE_ENV='test';await f.close();}
});
void integration('cross-organization, stale versions, ineligible targets and ordinary endpoint escalation are denied',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.otherOwner,{...await f.context(f.actors.owner),expectedMembershipVersion:1,command:'ROLE',role:'ADMIN'}),denied);
  await assert.rejects(f.store.initiate(f.actors.owner,f.org.id,f.memberships.suspended,{...await f.context(f.actors.owner),expectedRecipientMembershipVersion:1,sourceRoleAfter:'AGENT'}),denied);
  await assert.rejects(f.store.initiate(f.actors.owner,f.org.id,f.memberships.revoked,{...await f.context(f.actors.owner),expectedRecipientMembershipVersion:1,sourceRoleAfter:'AGENT'}),denied);
  await assert.rejects(f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.manager,{...await f.context(f.actors.owner),expectedMembershipVersion:2,command:'ROLE',role:'ADMIN'}),{code:'STALE_VERSION'});
  await assert.rejects(f.lifecycle.mutateMember(f.actors.owner,f.org.id,f.memberships.agent,{...f.command(),expectedVersion:1,command:'CHANGE_ROLE',role:'OWNER'}),{code:'PRIVILEGED_GOVERNANCE_UNAVAILABLE'});
  await assert.rejects(f.lifecycle.mutateMember(f.actors.owner,f.org.id,f.memberships.owner,{...f.command(),expectedVersion:1,command:'SUSPEND'}),{code:'PRIVILEGED_GOVERNANCE_UNAVAILABLE'});
  await assert.rejects(f.store.list(f.actors.unrelated,f.org.id),denied);await assert.rejects(f.store.list(f.actors.otherOwner,f.org.id),denied);
  const pending=await f.initiate();assert.equal((await f.store.list(f.actors.analyst,f.org.id)).transfers.length,0);assert.equal((await f.store.list(f.actors.agent,f.org.id)).transfers[0]?.id,pending.id);
  await assert.rejects(f.store.transferCommand(f.actors.agent,f.otherOrg.id,pending.id,await f.transferInput(f.actors.agent,pending,'ACCEPT')),denied);
 }finally{await f.close();}
});
void integration('role transitions immediately resolve assignment scope without rewriting assignment or participant history',async()=>{
 const f=await fixture();try{
  const assignments=new OrganizationAssignmentStore(f.client),resource=f.resource('INTERACTION');
  const grant=await assignments.assign(f.actors.owner,resource,f.memberships.agent,{...f.command(),expectedVersion:0});
  await f.role(f.actors.owner,f.memberships.agent,'ADMIN');await assignments.authorize(f.actors.agent,f.resource('INTERACTION',1),'INTERACTION_OPERATION');
  await f.role(f.actors.owner,f.memberships.agent,'AGENT');await assert.rejects(assignments.authorize(f.actors.agent,f.resource('INTERACTION',1),'INTERACTION_OPERATION'),denied);
  await assignments.authorize(f.actors.agent,resource,'INTERACTION_OPERATION');
  await f.role(f.actors.owner,f.memberships.agent,'ADMIN');await f.role(f.actors.owner,f.memberships.agent,'ANALYST');
  await assert.rejects(assignments.authorize(f.actors.agent,resource,'INTERACTION_OPERATION'),denied);
  assert.equal((await f.client`SELECT revoked_at,version FROM organization_resource_assignments WHERE id=${grant.id}`)[0]?.version,1);
  assert.equal((await f.client`SELECT user_id FROM interaction_participants WHERE interaction_id=${resource.resourceId}`)[0]?.user_id,f.actors.agent.userId);
 }finally{await f.close();}
});

async function waiting(observer:postgres.Sql,pid:number){const deadline=Date.now()+10000;while(Date.now()<deadline){if((await observer`SELECT pid FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'`)[0])return;await new Promise<void>(resolve=>setImmediate(resolve));}throw Error('Expected owner command at actual PostgreSQL lock barrier');}
const races=['owners-demote-each-other','owners-revoke-each-other','final-self-demotion-then-promotion','promotion-then-self-demotion','source-demotion-then-accept','accept-then-source-demotion','recipient-revoke-then-accept','accept-then-recipient-revoke','duplicate-accept','competing-accept','duplicate-completion','competing-completion','stale-member-after-role','stale-org-completion','stale-transfer-completion','admin-then-owner-change','owner-change-then-admin','duplicate-sensitive-role','conflicting-sensitive-keys'] as const;
for(const race of races)void integration(`controlled ownership race: ${race}`,async()=>{
 const f=await fixture(),a=postgres(url!,{max:1,prepare:false}),b=postgres(url!,{max:1,prepare:false}),gate=postgres(url!,{max:1,prepare:false});
 drizzle(a); drizzle(b);
 let release!:()=>void,arrived!:()=>void;const freed=new Promise<void>(r=>{release=r;}),held=new Promise<void>(r=>{arrived=r;});let holder:Promise<unknown>|undefined;const pending:Promise<PromiseSettledResult<unknown>[]>[]=[];
 try{
  if(race.startsWith('owners-')||race.includes('source-demotion'))await f.role(f.actors.owner,f.memberships.admin,'OWNER');
  let transfer= ['source-demotion-then-accept','accept-then-source-demotion','recipient-revoke-then-accept','accept-then-recipient-revoke','duplicate-accept','competing-accept','duplicate-completion','competing-completion','stale-org-completion','stale-transfer-completion'].includes(race)?await f.initiate():null;
  if(transfer&&race.includes('completion'))transfer=await f.store.transferCommand(f.actors.agent,f.org.id,transfer.id,await f.transferInput(f.actors.agent,transfer,'ACCEPT'));
  const first=new OrganizationOwnerStore(a,f.stepUp),second=new OrganizationOwnerStore(b,f.stepUp);
  const base=await f.context(f.actors.owner),admin=await f.context(f.actors.admin),recipient=await f.context(f.actors.agent);
  const role=(store:OrganizationOwnerStore,actor:typeof f.actors.owner,target:string,desired:'OWNER'|'ADMIN'|'AGENT',versions=base)=>store.mutateMember(actor,f.org.id,target,{...versions,expectedMembershipVersion:1,command:'ROLE',role:desired});
  const tInput=transfer?await f.transferInput(race.includes('completion')?f.actors.owner:f.actors.agent,transfer,race.includes('completion')?'COMPLETE':'ACCEPT'):null;
  const transferCommand=(store:OrganizationOwnerStore,override={})=>store.transferCommand(race.includes('completion')?f.actors.owner:f.actors.agent,f.org.id,transfer!.id,{...tInput!,...override});
  const sourceDemote=(store:OrganizationOwnerStore)=>role(store,f.actors.admin,f.memberships.owner,'AGENT',admin);
  const revokeRecipient=(sql:postgres.Sql)=>new (f.lifecycle.constructor as typeof import('./organization-lifecycle.js').OrganizationStore)(sql).mutateMember(f.actors.owner,f.org.id,f.memberships.agent,{...f.command(),expectedVersion:1,command:'REVOKE'});
  const revokeOwner=(store:OrganizationOwnerStore,actor:typeof f.actors.owner,target:string,versions=base)=>store.mutateMember(actor,f.org.id,target,{...versions,expectedMembershipVersion:target===f.memberships.admin?2:1,command:'REVOKE'});
  holder=gate.begin(async tx=>{await tx`SELECT id FROM organizations WHERE id=${f.org.id} FOR UPDATE`;arrived();await freed;});await held;
  const aPid=(await a<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid,bPid=(await b<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
  const demoteAdmin=(store:OrganizationOwnerStore)=>store.mutateMember(f.actors.owner,f.org.id,f.memberships.admin,{...base,expectedMembershipVersion:race.includes('source-demotion')?2:1,command:'ROLE',role:'AGENT'});
  const one=race==='owners-demote-each-other'?storeRoleAdmin(first)
   :race==='owners-revoke-each-other'?revokeOwner(first,f.actors.owner,f.memberships.admin)
   :race==='final-self-demotion-then-promotion'?role(first,f.actors.owner,f.memberships.owner,'AGENT')
   :race==='source-demotion-then-accept'?sourceDemote(first)
   :race==='recipient-revoke-then-accept'?revokeRecipient(a)
   :race==='admin-then-owner-change'?role(first,f.actors.admin,f.memberships.manager,'OWNER',admin)
   :race==='owner-change-then-admin'?demoteAdmin(first)
   :race==='stale-org-completion'?role(first,f.actors.owner,f.memberships.manager,'ADMIN')
   :race.includes('accept')||race.includes('completion')?transferCommand(first,race==='stale-transfer-completion'?{expectedTransferVersion:1}:{})
   :role(first,f.actors.owner,f.memberships.agent,race==='stale-member-after-role'?'ADMIN':'OWNER');
  function storeRoleAdmin(store:OrganizationOwnerStore){return store.mutateMember(f.actors.owner,f.org.id,f.memberships.admin,{...base,expectedMembershipVersion:2,command:'ROLE',role:'AGENT'});}
  pending.push(Promise.allSettled([one]));await waiting(f.client,aPid);
  const two=race==='owners-demote-each-other'?role(second,f.actors.admin,f.memberships.owner,'AGENT',admin)
   :race==='owners-revoke-each-other'?revokeOwner(second,f.actors.admin,f.memberships.owner,admin)
   :race==='final-self-demotion-then-promotion'?role(second,f.actors.owner,f.memberships.agent,'OWNER',{...base,...f.command()})
   :race==='promotion-then-self-demotion'?role(second,f.actors.owner,f.memberships.owner,'AGENT',{...base,...f.command(),expectedOrganizationVersion:base.expectedOrganizationVersion+1})
   :race==='accept-then-source-demotion'?sourceDemote(second)
   :race==='accept-then-recipient-revoke'?revokeRecipient(b)
   :race==='admin-then-owner-change'?demoteAdmin(second)
   :race==='owner-change-then-admin'?role(second,f.actors.admin,f.memberships.manager,'OWNER',admin)
   :race==='stale-member-after-role'?role(second,f.actors.owner,f.memberships.agent,'OWNER',{...base,...f.command(),expectedOrganizationVersion:base.expectedOrganizationVersion+1})
   :race.includes('accept')||race.includes('completion')?transferCommand(second,race.startsWith('competing-')||race==='stale-transfer-completion'?f.command():{})
   :role(second,f.actors.owner,f.memberships.agent,'OWNER',race==='conflicting-sensitive-keys'?{...base,...f.command()}:base);
  pending.push(Promise.allSettled([two]));await waiting(f.client,bPid);release();await holder;
  const results=[(await pending[0]!)[0]!, (await pending[1]!)[0]!];
  const codes=results.map(r=>r.status==='fulfilled'?'PASS':(r.reason as {code?:string}).code);
  const expected:Record<typeof race,[string,string]>={
   'owners-demote-each-other':['PASS','RESOURCE_SCOPE_DENIED'],'owners-revoke-each-other':['PASS','RESOURCE_SCOPE_DENIED'],
   'final-self-demotion-then-promotion':['FINAL_OWNER_PROTECTED','PASS'],'promotion-then-self-demotion':['PASS','PASS'],
   'source-demotion-then-accept':['PASS','STALE_VERSION'],'accept-then-source-demotion':['PASS','STALE_VERSION'],
   'recipient-revoke-then-accept':['PASS','RESOURCE_SCOPE_DENIED'],'accept-then-recipient-revoke':['PASS','PASS'],
   'duplicate-accept':['PASS','PASS'],'competing-accept':['PASS','STALE_VERSION'],'duplicate-completion':['PASS','PASS'],'competing-completion':['PASS','RESOURCE_SCOPE_DENIED'],
   'stale-member-after-role':['PASS','STALE_VERSION'],'stale-org-completion':['PASS','STALE_VERSION'],'stale-transfer-completion':['STALE_VERSION','PASS'],
   'admin-then-owner-change':['RESOURCE_SCOPE_DENIED','PASS'],'owner-change-then-admin':['PASS','RESOURCE_SCOPE_DENIED'],'duplicate-sensitive-role':['PASS','PASS'],'conflicting-sensitive-keys':['PASS','STALE_VERSION']
  };
  assert.deepEqual(codes,expected[race]);
  assert.ok((await f.client`SELECT id FROM organization_memberships WHERE organization_id=${f.org.id} AND role='OWNER' AND state='ACTIVE'`).length>=1);
  if(race.startsWith('duplicate-')){assert.deepEqual((results[0] as PromiseFulfilledResult<unknown>).value,(results[1] as PromiseFulfilledResult<unknown>).value);}
  if(race==='recipient-revoke-then-accept'||race==='accept-then-recipient-revoke'||race==='source-demotion-then-accept')assert.equal((await f.client`SELECT state FROM organization_ownership_transfers WHERE id=${transfer!.id}`)[0]?.state,'INVALIDATED');
 }finally{release();if(holder)await holder;await Promise.all(pending);await Promise.all([a.end(),b.end(),gate.end()]);await f.close();}
});

void integration('controlled ownership race: late-stepup-rollback',async()=>{
 const f=await fixture(),gate=postgres(url!,{max:1,prepare:false}),worker=postgres(url!,{max:1,prepare:false});
 let release!:()=>void,arrived!:()=>void;const freed=new Promise<void>(r=>{release=r;}),held=new Promise<void>(r=>{arrived=r;});let holder:Promise<unknown>|undefined,pending:Promise<PromiseSettledResult<unknown>[]>|undefined;
 try{
  let now=new Date();const step=new LocalOrganizationOwnerStepUp(f.client,()=>now);await step.establish(f.actors.owner,f.org.id);
  const store=new OrganizationOwnerStore(worker,step),input={...await f.context(f.actors.owner),expectedMembershipVersion:1,command:'ROLE' as const,role:'ADMIN' as const};
  const pid=(await worker<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
  holder=gate.begin(async tx=>{await tx`SELECT id FROM users WHERE id=${f.actors.agent.userId} FOR UPDATE`;arrived();await freed;});await held;
  pending=Promise.allSettled([store.mutateMember(f.actors.owner,f.org.id,f.memberships.agent,input)]);await waiting(f.client,pid);now=new Date(+now+900000);release();await holder;
  const result=(await pending)[0]!;assert.equal(result.status,'rejected');assert.equal((result as PromiseRejectedResult).reason.code,'STEP_UP_REQUIRED');
  assert.deepEqual(await effects(f.client),{actions:0,events:0,receipts:0});assert.equal((await f.client`SELECT role,version FROM organization_memberships WHERE id=${f.memberships.agent}`)[0]?.role,'AGENT');assert.equal((await f.client`SELECT version FROM organizations WHERE id=${f.org.id}`)[0]?.version,1);
 }finally{release();if(holder)await holder;if(pending)await pending;await Promise.all([gate.end(),worker.end()]);await f.close();}
});
for(const loss of ['recipient-session-expired','recipient-session-revoked','recipient-security-version','recipient-phone-replaced','recipient-account-suspended'] as const)void integration(`completion rechecks accepted ${loss} and commits no ownership effects`,async()=>{
 const f=await fixture();try{
  let transfer=await f.initiate();transfer=await f.store.transferCommand(f.actors.agent,f.org.id,transfer.id,await f.transferInput(f.actors.agent,transfer,'ACCEPT'));
  const input=await f.transferInput(f.actors.owner,transfer,'COMPLETE'),before=await effects(f.client);
  if(loss==='recipient-session-expired')await f.client`UPDATE security_sessions SET expires_at=statement_timestamp()-interval '1 second' WHERE id=${f.actors.agent.sessionId}`;
  else if(loss==='recipient-session-revoked')await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${f.actors.agent.sessionId}`;
  else if(loss==='recipient-security-version')await f.client`UPDATE users SET security_version=security_version+1 WHERE id=${f.actors.agent.userId}`;
  else if(loss==='recipient-phone-replaced')await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${f.actors.agent.userId}`;
  else await f.client`UPDATE users SET account_state='SUSPENDED' WHERE id=${f.actors.agent.userId}`;
  await assert.rejects(f.store.transferCommand(f.actors.owner,f.org.id,transfer.id,input),{code:loss.includes('phone')||loss.includes('account')?'RESOURCE_SCOPE_DENIED':'AUTH_REQUIRED'});
  assert.deepEqual(await effects(f.client),before);assert.equal((await f.client`SELECT state FROM organization_ownership_transfers WHERE id=${transfer.id}`)[0]?.state,'ACCEPTED');
 }finally{await f.close();}
});

void integration('privileged revocation contains a suspended admin without reviving the episode; stale actor/org versions deny',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.manager,{...await f.context(f.actors.owner),expectedActorMembershipVersion:2,expectedMembershipVersion:1,command:'ROLE',role:'ADMIN'}),{code:'STALE_VERSION'});
  await assert.rejects(f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.manager,{...await f.context(f.actors.owner),expectedOrganizationVersion:2,expectedMembershipVersion:1,command:'ROLE',role:'ADMIN'}),{code:'STALE_VERSION'});
  await f.client`UPDATE organization_memberships SET state='SUSPENDED',version=version+1 WHERE id=${f.memberships.admin}`;
  const removed=await f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.admin,{...await f.context(f.actors.owner),expectedMembershipVersion:2,command:'REVOKE'});assert.equal(removed.state,'REVOKED');assert.equal(removed.version,3);
  await assert.rejects(f.role(f.actors.owner,f.memberships.admin,'OWNER'),{code:'INVALID_STATE'});
 }finally{await f.close();}
});

async function selfRevokeFixture(){
 const f=await fixture();await f.role(f.actors.owner,f.memberships.agent,'OWNER');
 const input={...await f.context(f.actors.owner),expectedMembershipVersion:1,command:'REVOKE' as const};
 return{...f,input};
}
async function selfRevokeEffects(f:Awaited<ReturnType<typeof selfRevokeFixture>>){
 const counts=await effects(f.client);
 return{actions:Number(counts.actions),events:Number(counts.events),receipts:Number(counts.receipts),audit:Number((await f.client`SELECT count(*)::int AS count FROM audit_events`)[0]!.count),
  member:(await f.client`SELECT id,role,state,version,revoked_at,changed_by FROM organization_memberships WHERE id=${f.memberships.owner}`)[0],
  organization:(await f.client`SELECT version FROM organizations WHERE id=${f.org.id}`)[0],
  owners:(await f.client`SELECT id FROM organization_memberships WHERE organization_id=${f.org.id} AND role='OWNER' AND state='ACTIVE' ORDER BY id`).map(r=>r.id)};
}
void integration('committed OWNER self-revocation survives a lost response with exact effect-free replay and body-bound key conflict',async()=>{
 const f=await selfRevokeFixture();try{
  const before=await selfRevokeEffects(f),first=await f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.owner,f.input);
  assert.equal(first.state,'REVOKED');assert.equal(first.version,2);
  const committed=await selfRevokeEffects(f);
  for(const count of ['actions','events','receipts','audit'] as const)assert.equal(committed[count],before[count]+1);
  assert.equal(committed.organization?.version,before.organization!.version+1);assert.deepEqual(committed.owners,[f.memberships.agent]);
  const retry=await f.store.mutateMember({...f.actors.owner,userId:f.actors.owner.userId.toUpperCase()},f.org.id.toUpperCase(),f.memberships.owner.toUpperCase(),{...f.input,idempotencyKey:f.input.idempotencyKey.toUpperCase(),requestId:randomUUID()});
  assert.deepEqual(retry,first);assert.deepEqual(await selfRevokeEffects(f),committed);
  for(const change of [{expectedOrganizationVersion:f.input.expectedOrganizationVersion+1},{expectedMembershipVersion:2},{expectedActorMembershipVersion:2}])
   await assert.rejects(f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.owner,{...f.input,...change}),{code:'IDEMPOTENCY_KEY_REUSED'});
  await assert.rejects(f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.agent,f.input),{code:'IDEMPOTENCY_KEY_REUSED'});
  assert.deepEqual(await selfRevokeEffects(f),committed);
 }finally{await f.close();}
});
for(const loss of ['expired','revokedSession','securityVersion','unregisteredSession','unverifiedPhone','replacedPhone','PENDING_PHONE','SUSPENDED','DEACTIVATED'] as const)
void integration(`committed self-revoke replay denies current ${loss} without business or audit effects`,async()=>{
 const f=await selfRevokeFixture();try{
  await f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.owner,f.input);const before=await selfRevokeEffects(f);
  let actor=f.actors.owner;
  if(loss==='expired')await f.client`UPDATE security_sessions SET expires_at=statement_timestamp()-interval '1 second' WHERE id=${actor.sessionId}`;
  else if(loss==='revokedSession')await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${actor.sessionId}`;
  else if(loss==='securityVersion')await f.client`UPDATE users SET security_version=security_version+1 WHERE id=${actor.userId}`;
  else if(loss==='unregisteredSession')actor={...actor,sessionId:randomUUID()};
  else if(loss==='unverifiedPhone')await f.client`UPDATE phone_contacts SET verified_at=NULL WHERE user_id=${actor.userId}`;
  else if(loss==='replacedPhone')await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${actor.userId}`;
  else await f.client`UPDATE users SET account_state=${loss} WHERE id=${actor.userId}`;
  const code=['expired','revokedSession','securityVersion','unregisteredSession'].includes(loss)?'AUTH_REQUIRED':'CAPABILITY_RESTRICTED';
  await assert.rejects(f.store.mutateMember(actor,f.org.id,f.memberships.owner,f.input),{code});
  assert.deepEqual(await selfRevokeEffects(f),before);
 }finally{await f.close();}
});
void integration('self-revoke confirmation preserves current trusted step-up policy and fails closed without fresh evidence',async()=>{
 const f=await selfRevokeFixture();try{
  let now=new Date();const step=new LocalOrganizationOwnerStepUp(f.client,()=>now);await step.establish(f.actors.owner,f.org.id);
  const store=new OrganizationOwnerStore(f.client,step);await store.mutateMember(f.actors.owner,f.org.id,f.memberships.owner,f.input);
  const before=await selfRevokeEffects(f);now=new Date(+now+900000);
  await assert.rejects(store.mutateMember(f.actors.owner,f.org.id,f.memberships.owner,f.input),{code:'STEP_UP_REQUIRED'});
  await assert.rejects(new OrganizationOwnerStore(f.client).mutateMember(f.actors.owner,f.org.id,f.memberships.owner,f.input),{code:'STEP_UP_REQUIRED'});
  assert.deepEqual(await selfRevokeEffects(f),before);
 }finally{await f.close();}
});
void integration('self-revoke receipt grants no new organization authority, other-actor replay or cross-organization result',async()=>{
 const f=await selfRevokeFixture();try{
  const otherRevoke={...await f.context(f.actors.owner),expectedMembershipVersion:1,command:'REVOKE' as const};
  await f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.admin,otherRevoke);
  let transfer=await f.store.initiate(f.actors.agent,f.org.id,f.memberships.manager,{...await f.context(f.actors.agent),expectedRecipientMembershipVersion:1,sourceRoleAfter:'AGENT'});
  transfer=await f.store.transferCommand(f.actors.manager,f.org.id,transfer.id,await f.transferInput(f.actors.manager,transfer,'ACCEPT'));
  const selfInput={...await f.context(f.actors.owner),expectedMembershipVersion:1,command:'REVOKE' as const};
  await f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.owner,selfInput);const before=await effects(f.client);
  await assert.rejects(f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.admin,otherRevoke),denied);
  await assert.rejects(f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.owner,{...selfInput,...f.command()}),denied);
  await assert.rejects(f.store.mutateMember(f.actors.owner,f.org.id,f.memberships.agent,{...await f.context(f.actors.owner),expectedMembershipVersion:2,command:'ROLE',role:'ADMIN'}),denied);
  await assert.rejects(f.store.initiate(f.actors.owner,f.org.id,f.memberships.manager,{...await f.context(f.actors.owner),expectedRecipientMembershipVersion:1,sourceRoleAfter:'AGENT'}),denied);
  for(const command of ['COMPLETE','CANCEL'] as const)await assert.rejects(f.store.transferCommand(f.actors.owner,f.org.id,transfer.id,await f.transferInput(f.actors.owner,transfer,command)),denied);
  await assert.rejects(f.store.list(f.actors.owner,f.org.id),denied);
  await assert.rejects(new OrganizationAssignmentStore(f.client).authorize(f.actors.owner,f.resource('INTERACTION'),'INTERACTION_OPERATION'),denied);
  for(const actor of [f.actors.unrelated,f.actors.otherOwner])await assert.rejects(f.store.mutateMember(actor,f.org.id,f.memberships.owner,selfInput),denied);
  await assert.rejects(f.store.mutateMember(f.actors.agent,f.org.id,f.memberships.owner,selfInput),{code:'STALE_VERSION'});
  await assert.rejects(f.store.mutateMember(f.actors.owner,f.otherOrg.id,f.memberships.owner,selfInput),{code:'IDEMPOTENCY_KEY_REUSED'});
  assert.deepEqual(await effects(f.client),before);assert.equal((await f.client`SELECT state FROM organization_ownership_transfers WHERE id=${transfer.id}`)[0]?.state,'ACCEPTED');
 }finally{await f.close();}
});
void integration('controlled ownership race: duplicate-self-revoke',async()=>{
 const f=await selfRevokeFixture(),a=postgres(url!,{max:1,prepare:false}),b=postgres(url!,{max:1,prepare:false}),gate=postgres(url!,{max:1,prepare:false});
 drizzle(a);drizzle(b);
 let release!:()=>void,arrived!:()=>void;const freed=new Promise<void>(r=>{release=r;}),held=new Promise<void>(r=>{arrived=r;});
 let holder:Promise<unknown>|undefined;const pending:Promise<PromiseSettledResult<unknown>[]>[]=[];
 try{
  const before=await selfRevokeEffects(f),first=new OrganizationOwnerStore(a,f.stepUp),second=new OrganizationOwnerStore(b,f.stepUp);
  const aPid=(await a<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid,bPid=(await b<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
  holder=gate.begin(async tx=>{await tx`SELECT id FROM organizations WHERE id=${f.org.id} FOR UPDATE`;arrived();await freed;});await held;
  pending.push(Promise.allSettled([first.mutateMember(f.actors.owner,f.org.id,f.memberships.owner,f.input)]));await waiting(f.client,aPid);
  pending.push(Promise.allSettled([second.mutateMember(f.actors.owner,f.org.id,f.memberships.owner,f.input)]));await waiting(f.client,bPid);
  release();await holder;const one=(await pending[0]!)[0]!,two=(await pending[1]!)[0]!;
  assert.equal(one.status,'fulfilled');assert.equal(two.status,'fulfilled');
  const result=(one as PromiseFulfilledResult<{state:string;version:number}>).value;assert.deepEqual(result,(two as PromiseFulfilledResult<unknown>).value);
  assert.equal(result.state,'REVOKED');assert.equal(result.version,2);
  const committed=await selfRevokeEffects(f);for(const count of ['actions','events','receipts','audit'] as const)assert.equal(committed[count],before[count]+1);
  assert.equal(committed.organization?.version,before.organization!.version+1);assert.deepEqual(committed.owners,[f.memberships.agent]);
  assert.equal(committed.member?.state,'REVOKED');assert.equal(committed.member?.version,2);
 }finally{release();if(holder)await holder;await Promise.all(pending);await Promise.all([a.end(),b.end(),gate.end()]);await f.close();}
});
