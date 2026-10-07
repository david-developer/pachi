import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createDatabase } from './client.js';
import { OrganizationAssignmentStore } from './organization-assignments.js';
import { requireOrganizationResourceActor } from './organization-resource-actor.js';
import { organizationAssignmentFixture } from './organization-assignment-fixture.js';
import { ConversationStore } from './conversation.js';
import { BlockStore } from './block.js';

const url = process.env.DATABASE_TEST_URL;
if (url) {const u=new URL(url);assert.equal(u.hostname,'localhost');assert.equal(u.port,'5433');assert.equal(u.pathname,'/pachi_test');}
const integration = url ? test : test.skip;
async function fixture() {
  const {client}=createDatabase(url!);await client`TRUNCATE users RESTART IDENTITY CASCADE`;
  const f=await organizationAssignmentFixture(client);
  return {...f,client,store:new OrganizationAssignmentStore(client),async close(){await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client.end();}};
}
const denied={code:'RESOURCE_SCOPE_DENIED'};
async function effects(client:postgres.Sql) {
  return (await client`SELECT (SELECT count(*)::int FROM organization_resource_assignments) AS assignments,
    (SELECT count(*)::int FROM organization_assignment_actions) AS actions,(SELECT count(*)::int FROM organization_assignment_receipts) AS receipts,
    (SELECT count(*)::int FROM organization_assignment_outbox) AS events,(SELECT count(*)::int FROM audit_events WHERE target_type='ResourceAssignment') AS audits`)[0]!;
}

void integration('assignment episodes retain attribution, monotonic versions, normalized retries and atomic safe effects',async()=>{
  const f=await fixture();try {
    const r=f.resource('INTERACTION'),input={...f.command(),expectedVersion:0};
    const first=await f.store.assign(f.actors.owner,r,f.memberships.agent,input);
    assert.equal(first.version,1);assert.equal(first.state,'ACTIVE');
    const context=await f.store.authorize(f.actors.agent,r,'INTERACTION_OPERATION');
    assert.equal(context.assignmentId,first.id);assert.equal(context.membershipId,f.memberships.agent);assert.equal(context.providerAccountId,f.org.provider_account_id);
    const before=await effects(f.client);
    assert.deepEqual(await f.store.assign({...f.actors.owner,userId:f.actors.owner.userId.toUpperCase()},{...r,resourceId:r.resourceId.toUpperCase()},f.memberships.agent.toUpperCase(),{...input,idempotencyKey:input.idempotencyKey.toUpperCase()}),first);
    assert.deepEqual(await effects(f.client),before);
    await assert.rejects(f.store.assign(f.actors.owner,f.resource('INTERACTION',1),f.memberships.agent,input),{code:'IDEMPOTENCY_KEY_REUSED'});
    const remove={...f.command(),expectedVersion:1};const revoked=await f.store.revoke(f.actors.admin,r,first.id,remove);
    assert.equal(revoked.version,2);await assert.rejects(f.store.authorize(f.actors.agent,r,'INTERACTION_OPERATION'),denied);
    assert.deepEqual(await f.store.revoke(f.actors.admin,r,first.id,remove),revoked);
    const reassigned=await f.store.assign(f.actors.manager,r,f.memberships.agent,{...f.command(),expectedVersion:2});
    assert.notEqual(reassigned.id,first.id);assert.equal(reassigned.version,3);
    assert.deepEqual(await f.store.assign(f.actors.owner,r,f.memberships.agent,input),revoked);
    await assert.rejects(f.store.revoke(f.actors.owner,r,reassigned.id,{...f.command(),expectedVersion:1}),{code:'STALE_VERSION'});
    await assert.rejects(f.store.assign(f.actors.owner,r,f.memberships.agent,{...f.command(),expectedVersion:2}),{code:'STALE_VERSION'});
    const history=await f.store.list(f.actors.manager,r,{membershipId:f.memberships.agent});assert.equal(history.assignments.length,2);
    const paged=await f.store.list(f.actors.owner,r,{limit:1});assert.ok(paged.next_cursor);assert.equal((await f.store.list(f.actors.owner,r,{cursor:paged.next_cursor!,limit:1})).assignments.length,1);
    assert.deepEqual(Object.keys(first).sort(),['created_at','effective_at','id','membership_id','resource_id','resource_type','revoked_at','state','valid_until','version']);
    assert.deepEqual(await effects(f.client),{assignments:2,actions:3,receipts:3,events:3,audits:3});
    for(const table of ['organization_resource_assignments','organization_assignment_actions','organization_assignment_receipts','organization_assignment_outbox'])await assert.rejects(f.client.unsafe(`DELETE FROM ${table}`));
    await assert.rejects(f.client`UPDATE organization_resource_assignments SET revoked_at=NULL WHERE id=${first.id}`);
    await assert.rejects(f.client`UPDATE organization_resource_assignments SET membership_id=${f.memberships.manager} WHERE id=${reassigned.id}`);
    assert.equal((await f.client`SELECT user_id FROM interaction_participants WHERE interaction_id=${r.resourceId}`)[0]!.user_id,f.actors.agent.userId);
  }finally{await f.close();}
});

for(const name of ['unrelated','otherOwner','invited','suspended','revoked','analyst','agent'] as const)void integration(`current authority denies ${name} without matching eligible membership/assignment`,async()=>{
  const f=await fixture();try {
    for(const type of ['LISTING','INTERACTION'] as const) {
      const r=f.resource(type);
      await assert.rejects(f.store.authorize(f.actors[name],r,type==='LISTING'?'LISTING_DRAFT':'INTERACTION_OPERATION'),denied);
      await assert.rejects(f.store.assign(f.actors[name],r,f.memberships.agent,{...f.command(),expectedVersion:0}),denied);
      await assert.rejects(f.store.list(f.actors[name],r),denied);
    }
    assert.deepEqual(await effects(f.client),{assignments:0,actions:0,receipts:0,events:0,audits:0});
  }finally{await f.close();}
});
for(const name of ['invited','suspended','revoked','analyst','otherOwner'] as const)void integration(`assignment recipient ${name} cannot receive an operational grant`,async()=>{
  const f=await fixture();try {await assert.rejects(f.store.assign(f.actors.owner,f.resource('LISTING'),f.memberships[name],{...f.command(),expectedVersion:0}),denied);}finally{await f.close();}
});
for(const loss of ['expired','revoked','securityVersion','SUSPENDED','DELETED','phone'] as const)void integration(`assignment commands and resolver recheck ${loss} after actor capture and before replay`,async()=>{
  const f=await fixture();try {
    const r=f.resource('LISTING'),input={...f.command(),expectedVersion:0};await f.store.assign(f.actors.owner,r,f.memberships.agent,input);
    if(loss==='expired')await f.client`UPDATE security_sessions SET expires_at=statement_timestamp()-interval '1 second' WHERE id=${f.actors.owner.sessionId}`;
    else if(loss==='revoked')await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${f.actors.owner.sessionId}`;
    else if(loss==='securityVersion')await f.client`UPDATE users SET security_version=security_version+1 WHERE id=${f.actors.owner.userId}`;
    else if(loss==='phone')await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${f.actors.owner.userId}`;
    else await f.client`UPDATE users SET account_state=${loss} WHERE id=${f.actors.owner.userId}`;
    const expected={code:['expired','revoked','securityVersion'].includes(loss)?'AUTH_REQUIRED':'CAPABILITY_RESTRICTED'};
    const before=await effects(f.client);
    await assert.rejects(f.store.authorize(f.actors.owner,r,'LISTING_DRAFT'),expected);await assert.rejects(f.store.assign(f.actors.owner,r,f.memberships.agent,input),expected);
    await assert.rejects(f.store.revoke(f.actors.owner,r,(await f.client`SELECT id FROM organization_resource_assignments`)[0]!.id,{...f.command(),expectedVersion:1}),expected);
    assert.deepEqual(await effects(f.client),before);
  }finally{await f.close();}
});

void integration('canonical action matrix: manager drafts/assignment scope, explicit interaction scope, agents exact resources, analysts never',async()=>{
  const f=await fixture();try {
    for(const name of ['owner','admin','manager'] as const)assert.equal((await f.store.authorize(f.actors[name],f.resource('LISTING'),'LISTING_DRAFT')).assignmentId,null);
    for(const name of ['owner','admin'] as const)assert.equal((await f.store.authorize(f.actors[name],f.resource('INTERACTION'),'INTERACTION_OPERATION')).assignmentId,null);
    await assert.rejects(f.store.authorize(f.actors.manager,f.resource('INTERACTION'),'INTERACTION_OPERATION'),denied);
    for(const [type,name] of [['LISTING','agent'],['INTERACTION','agent'],['INTERACTION','manager']] as const) {
      const r=f.resource(type);await f.store.assign(f.actors.manager,r,f.memberships[name],{...f.command(),expectedVersion:0});
      assert.ok((await f.store.authorize(f.actors[name],r,type==='LISTING'?'LISTING_DRAFT':'INTERACTION_OPERATION')).assignmentId);
      await assert.rejects(f.store.authorize(f.actors[name],f.resource(type,1),type==='LISTING'?'LISTING_DRAFT':'INTERACTION_OPERATION'),denied);
    }
    await f.client`UPDATE organization_memberships SET role='ANALYST',version=version+1 WHERE id=${f.memberships.agent}`;
    await assert.rejects(f.store.authorize(f.actors.agent,f.resource('LISTING'),'LISTING_DRAFT'),denied);
    await assert.rejects(f.store.authorize(f.actors.owner,f.resource('INTERACTION'),'LISTING_DRAFT'),denied);
    await assert.rejects(f.store.authorize(f.actors.owner,{...f.resource('LISTING'),resourceType:'VIEWING' as 'LISTING'},'LISTING_DRAFT'),denied);
  }finally{await f.close();}
});

for(const loss of ['SUSPENDED','REVOKED'] as const)void integration(`membership ${loss} immediately ends access despite retained active assignment and participant history`,async()=>{
  const f=await fixture();try {
    const r=f.resource('INTERACTION');await f.store.assign(f.actors.owner,r,f.memberships.agent,{...f.command(),expectedVersion:0});
    await f.client`UPDATE organization_memberships SET state=${loss},version=version+1 WHERE id=${f.memberships.agent}`;
    assert.equal((await f.client`SELECT revoked_at FROM organization_resource_assignments`)[0]!.revoked_at,null);
    await assert.rejects(f.store.authorize(f.actors.agent,r,'INTERACTION_OPERATION'),denied);
    assert.equal((await f.client`SELECT count(*)::int AS n FROM interaction_participants`)[0]!.n,2);
  }finally{await f.close();}
});

void integration('database constraints reject cross-organization resources/members/principals and preserve ownership-change history',async()=>{
  const f=await fixture();try {
    const r=f.resource('LISTING');const row=await f.store.assign(f.actors.owner,r,f.memberships.agent,{...f.command(),expectedVersion:0});
    await assert.rejects(f.store.authorize(f.actors.owner,{...r,organizationId:f.otherOrg.id},'LISTING_DRAFT'),denied);
    await assert.rejects(f.store.assign(f.actors.owner,{...r,resourceId:f.foreignListingId},f.memberships.manager,{...f.command(),expectedVersion:0}),denied);
    for(const [memberId,listingId,providerId] of [[f.memberships.otherOwner,r.resourceId,f.org.provider_account_id],[f.memberships.manager,f.foreignListingId,f.org.provider_account_id],[f.memberships.manager,r.resourceId,f.otherOrg.provider_account_id],[f.memberships.analyst,r.resourceId,f.org.provider_account_id]]) {
      await assert.rejects(f.client`INSERT INTO organization_resource_assignments(organization_id,provider_account_id,membership_id,resource_type,listing_id,assigned_by_user_id,assigned_by_membership_id,grant_request_id,version)
        VALUES(${f.org.id},${providerId!},${memberId!},'LISTING',${listingId!},${f.actors.owner.userId},${f.memberships.owner},${randomUUID()},1)`);
    }
    const interactionGrant=await f.store.assign(f.actors.owner,f.resource('INTERACTION'),f.memberships.agent,{...f.command(),expectedVersion:0});
    await f.client`UPDATE listings SET provider_account_id=${f.otherOrg.provider_account_id} WHERE id=${r.resourceId}`;
    assert.ok((await f.client`SELECT revoked_at FROM organization_resource_assignments WHERE id=${row.id}`)[0]!.revoked_at);
    assert.equal((await f.client`SELECT revocation_reason FROM organization_resource_assignments WHERE id=${interactionGrant.id}`)[0]!.revocation_reason,'RESOURCE_CHANGED');
    await f.client`UPDATE listings SET provider_account_id=${f.org.provider_account_id} WHERE id=${r.resourceId}`;
    await assert.rejects(f.store.authorize(f.actors.agent,r,'LISTING_DRAFT'),denied);
    await assert.rejects(f.store.authorize(f.actors.agent,f.resource('INTERACTION'),'INTERACTION_OPERATION'),denied);
    assert.equal((await f.store.assign(f.actors.owner,r,f.memberships.agent,{...f.command(),expectedVersion:2})).version,3);
  }finally{await f.close();}
});

void integration('new authority helper never enables organization messaging, inbox, reads or authored blocks',async()=>{
  const f=await fixture();try {
    const r=f.resource('INTERACTION');await f.store.assign(f.actors.owner,r,f.memberships.agent,{...f.command(),expectedVersion:0});
    const conversations=new ConversationStore(f.client,true),blocks=new BlockStore(f.client,true);
    for(const name of ['owner','admin','manager','agent','analyst'] as const) {
      await assert.rejects(conversations.send(f.actors[name].userId,f.conversationIds[0]!,{client_message_id:randomUUID(),body:'Denied organization message'}),denied);
      await assert.rejects(conversations.messages(f.actors[name].userId,f.conversationIds[0]!),denied);
      assert.deepEqual((await conversations.inbox(f.actors[name].userId)).items,[]);
      await assert.rejects(blocks.block(f.actors[name],'interaction',r.resourceId,f.command()),denied);
    }
    assert.equal((await f.client`SELECT count(*)::int AS n FROM messages`)[0]!.n,0);
  }finally{await f.close();}
});

// Dedicated backend lock queues prove overlap and order. Polling observes a
// PostgreSQL barrier; elapsed time/sleeps never establish correctness.
async function waiting(observer:postgres.Sql,pid:number) {
  const deadline=Date.now()+10000;
  while(Date.now()<deadline) {
    const rows=await observer`SELECT pid FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'`;
    if(rows[0])return;
    await new Promise<void>(resolve=>setImmediate(resolve));
  }
  throw Error('Expected dedicated backend at database lock barrier');
}
const races=['duplicate-command','competing-assigners','assign-then-revoke','revoke-then-stale-assign','revoke-then-reassign','authorize-then-revoke','revoke-then-authorize','suspend-then-authorize','authorize-then-suspend','membership-revoke-then-authorize','ownership-then-assign','assign-then-ownership','stale-revoke-then-reassign','reassign-then-stale-revoke'] as const;
for(const race of races)void integration(`controlled assignment race: ${race}`,async()=>{
  const f=await fixture(),a=postgres(url!,{max:1,prepare:false}),b=postgres(url!,{max:1,prepare:false}),gate=postgres(url!,{max:1,prepare:false});
  let release!:()=>void;const freed=new Promise<void>(resolve=>{release=resolve;});let arrived!:()=>void;const held=new Promise<void>(resolve=>{arrived=resolve;});
  const r=f.resource('LISTING'),firstStore=new OrganizationAssignmentStore(a),secondStore=new OrganizationAssignmentStore(b);
  let holder:Promise<unknown>|undefined;const pending:Promise<PromiseSettledResult<unknown>[]>[]=[];
  try {
    let old:string|null=null;
    if(!['duplicate-command','competing-assigners','ownership-then-assign','assign-then-ownership'].includes(race))old=(await f.store.assign(f.actors.owner,r,f.memberships.agent,{...f.command(),expectedVersion:0})).id;
    if(race.startsWith('stale-') || race==='reassign-then-stale-revoke')await f.store.revoke(f.actors.owner,r,old!,{...f.command(),expectedVersion:1});
    const input={...f.command(),expectedVersion:0};
    const assign=(store:OrganizationAssignmentStore,expectedVersion:number,admin=false)=>store.assign(admin?f.actors.admin:f.actors.owner,r,f.memberships.agent,{...input,expectedVersion,...(admin?f.command():{})});
    const revoke=(store:OrganizationAssignmentStore)=>store.revoke(f.actors.owner,r,old!,{...f.command(),expectedVersion:1});
    const authorize=(sql:postgres.Sql)=>sql.begin(tx=>requireOrganizationResourceActor(tx,f.actors.agent,r,'LISTING_DRAFT'));
    const suspend=(sql:postgres.Sql,state='SUSPENDED')=>sql`UPDATE organization_memberships SET state=${state},version=version+1 WHERE id=${f.memberships.agent}`;
    const ownership=(sql:postgres.Sql)=>sql`UPDATE listings SET provider_account_id=${f.otherOrg.provider_account_id} WHERE id=${r.resourceId}`;
    const resourceGate=race.includes('ownership');
    holder=gate.begin(async tx=>{if(resourceGate)await tx`SELECT id FROM listings WHERE id=${r.resourceId} FOR UPDATE`;else await tx`SELECT id FROM organizations WHERE id=${f.org.id} FOR UPDATE`;arrived();await freed;});
    await held;
    const aPid=(await a<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid,bPid=(await b<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    const first= race==='duplicate-command'||race==='competing-assigners'?assign(firstStore,0)
      :race==='assign-then-revoke'?assign(firstStore,1)
      :race==='authorize-then-revoke'||race==='authorize-then-suspend'?authorize(a)
      :race==='suspend-then-authorize'?suspend(a)
      :race==='membership-revoke-then-authorize'?suspend(a,'REVOKED')
      :race==='ownership-then-assign'?ownership(a)
      :race==='assign-then-ownership'?assign(firstStore,0)
      :race==='reassign-then-stale-revoke'?assign(firstStore,2):revoke(firstStore);
    pending.push(Promise.allSettled([first]));await waiting(f.client,aPid);
    const second=race==='duplicate-command'?assign(secondStore,0)
      :race==='competing-assigners'?assign(secondStore,0,true)
      :race==='revoke-then-stale-assign'?assign(secondStore,1)
      :race==='revoke-then-reassign'||race==='stale-revoke-then-reassign'?assign(secondStore,2)
      :race.endsWith('then-authorize')?authorize(b)
      :race==='authorize-then-suspend'?suspend(b)
      :race==='ownership-then-assign'?assign(secondStore,0)
      :race==='assign-then-ownership'?ownership(b):revoke(secondStore);
    pending.push(Promise.allSettled([second]));await waiting(f.client,bPid);release();await holder;
    const one=(await pending[0]!)[0]!,two=(await pending[1]!)[0]!;
    const expectedFirst=race==='stale-revoke-then-reassign'?'STALE_VERSION':null;
    const expectedSecond=['competing-assigners','revoke-then-stale-assign','reassign-then-stale-revoke'].includes(race)?'STALE_VERSION'
      :['revoke-then-authorize','suspend-then-authorize','membership-revoke-then-authorize','ownership-then-assign'].includes(race)?'RESOURCE_SCOPE_DENIED':null;
    for(const [result,expected] of [[one,expectedFirst],[two,expectedSecond]] as const) {
      assert.equal(result.status,expected?'rejected':'fulfilled',result.status==='rejected'?`${result.reason.code}: ${result.reason.message}`:'unexpected fulfillment');
      if(expected)assert.equal((result as PromiseRejectedResult).reason.code,expected);
    }
    if(race==='duplicate-command')assert.deepEqual((one as PromiseFulfilledResult<unknown>).value,(two as PromiseFulfilledResult<unknown>).value);
    const active=await f.client`SELECT id,version FROM organization_resource_assignments WHERE revoked_at IS NULL`;
    const allow=['duplicate-command','competing-assigners','revoke-then-reassign','stale-revoke-then-reassign','reassign-then-stale-revoke'].includes(race);
    if(allow)assert.ok((await f.store.authorize(f.actors.agent,r,'LISTING_DRAFT')).assignmentId);
    else await assert.rejects(f.store.authorize(f.actors.agent,r,'LISTING_DRAFT'),denied);
    assert.ok(active.length<=1);
    if(race.includes('reassign')){assert.notEqual(active[0]?.id,old);assert.equal(active[0]?.version,3);}
    if(race==='assign-then-ownership')assert.equal((await f.client`SELECT revocation_reason FROM organization_resource_assignments`)[0]!.revocation_reason,'RESOURCE_CHANGED');
  }finally{release();if(holder)await holder;await Promise.all(pending);await Promise.all([a.end(),b.end(),gate.end()]);await f.close();}
});
