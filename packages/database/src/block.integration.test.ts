import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from './client.js';
import { fixtureFor } from './conversation-fixture.js';
import { BlockStore, type BlockActor } from './block.js';
import { ConversationStore } from './conversation.js';
import { InteractionStore } from './interaction.js';
import { contactProhibited } from './contact-safety.js';
import postgres from 'postgres';

const url=process.env.DATABASE_TEST_URL;
if(url){const u=new URL(url);assert.equal(u.hostname,'localhost');assert.equal(u.port,'5433');assert.equal(u.pathname,'/pachi_test');}
const integration=url?test:test.skip;
const command=()=>({idempotencyKey:randomUUID(),requestId:randomUUID()});
async function fixture() {
  const {client}=createDatabase(url!);await client`TRUNCATE users RESTART IDENTITY CASCADE`;
  const f=await fixtureFor(client);const actors={} as Record<'seeker'|'provider'|'other',BlockActor>;
  for(const [name,id] of [['seeker',f.seekerId],['provider',f.providerUserId],['other',f.otherUserId]] as const){
    const sessions=await client<{id:string}[]>`INSERT INTO security_sessions(user_id,issuer,app_client_id,origin_jti,current_jti,expires_at) VALUES (${id},'https://local.test/block','account',${randomUUID()},${randomUUID()},statement_timestamp()+interval '1 hour') RETURNING id`;
    actors[name]={userId:id,sessionId:sessions[0]!.id,securityVersion:0};
  }
  const inquiries=new InteractionStore(client,true),messages=new ConversationStore(client,true),blocks=new BlockStore(client,true);
  const inquiryKey=randomUUID();const interaction=await inquiries.createOrReuseInquiry(f.seekerId,f.listingId,inquiryKey);
  return {...f,client,actors,inquiries,messages,blocks,interaction,inquiryKey,async close(){await client`TRUNCATE users RESTART IDENTITY CASCADE`;await client.end();}};
}
async function effects(client:ReturnType<typeof createDatabase>['client']){
  const rows=await client`SELECT (SELECT count(*)::int FROM interactions) AS interactions,(SELECT count(*)::int FROM conversations) AS conversations,
    (SELECT count(*)::int FROM interaction_participants) AS participants,(SELECT count(*)::int FROM interaction_idempotency) AS inquiries,
    (SELECT count(*)::int FROM interaction_outbox) AS interaction_events,(SELECT count(*)::int FROM messages) AS messages,
    (SELECT count(*)::int FROM message_receipts) AS message_receipts,(SELECT coalesce(sum(message_count),0)::int FROM message_rate_limits) AS rates,
    (SELECT count(*)::int FROM communication_outbox) AS communication_events,(SELECT count(*)::int FROM block_relationships) AS blocks,
    (SELECT count(*)::int FROM block_actions) AS actions,(SELECT count(*)::int FROM block_outbox) AS events,
    (SELECT count(*)::int FROM block_command_receipts) AS receipts,(SELECT count(*)::int FROM audit_events WHERE target_type='BlockRelationship') AS audits`;
  return rows[0]!;
}

void integration('block lifecycle uses stable principals, immutable episodes, normalized idempotency and private projections',async()=>{
  const f=await fixture();try{
    const input=command();const first=await f.blocks.block(f.actors.seeker,'interaction',f.interaction.interaction_id,input);
    assert.equal(first.subject_kind,'PROVIDER_ACCOUNT');assert.equal(first.state,'ACTIVE');
    const relation=(await f.client`SELECT * FROM block_relationships WHERE id=${first.id}`)[0]!;
    assert.equal(relation.blocked_user_id,null);
    const before=await effects(f.client);
    assert.deepEqual(await f.blocks.block({...f.actors.seeker,userId:f.seekerId.toUpperCase()},'interaction',f.interaction.interaction_id.toUpperCase(),{...input,idempotencyKey:input.idempotencyKey.toUpperCase()}),first);
    assert.deepEqual(await effects(f.client),before);
    await assert.rejects(f.blocks.block(f.actors.seeker,'interaction',randomUUID(),input),{code:'IDEMPOTENCY_KEY_REUSED'});
    const removal={...command(),expectedVersion:1};
    const revoked=await f.blocks.unblock(f.actors.seeker,first.id,removal);assert.equal(revoked.version,2);
    assert.deepEqual(await f.blocks.unblock(f.actors.seeker,first.id,removal),revoked);
    await assert.rejects(f.blocks.unblock(f.actors.seeker,first.id,{...command(),expectedVersion:1}),{code:'STALE_VERSION'});
    const later=await f.blocks.block(f.actors.seeker,'interaction',f.interaction.interaction_id,command());assert.notEqual(later.id,first.id);
    assert.deepEqual(await f.blocks.block(f.actors.seeker,'interaction',f.interaction.interaction_id,input),revoked);
    assert.deepEqual(await f.blocks.unblock(f.actors.seeker,first.id,removal),revoked);
    assert.equal((await f.blocks.list(f.actors.seeker)).items.find(r=>r.id===later.id)?.state,'ACTIVE');
    assert.deepEqual((await f.blocks.list(f.actors.provider)).items,[]);
    const owned=await f.blocks.list(f.actors.seeker,undefined,1);assert.equal(owned.items.length,1);assert.ok(owned.next_cursor);assert.equal((await f.blocks.list(f.actors.seeker,owned.next_cursor!,1)).items.length,1);
    assert.deepEqual(Object.keys(first).sort(),['created_at','id','revoked_at','state','subject_kind','version']);
    for(const table of ['block_actions','block_command_receipts','block_outbox']) {
      const rows=await f.client.unsafe(`SELECT * FROM ${table}`);assert.doesNotMatch(JSON.stringify(rows),/normalized_e164|body|phone|PRIVATE/);
      await assert.rejects(f.client.unsafe(`DELETE FROM ${table}`));
    }
    await assert.rejects(f.client`UPDATE block_relationships SET revoked_at=NULL WHERE id=${first.id}`);
    await assert.rejects(f.client`DELETE FROM block_relationships WHERE id=${first.id}`);
    await assert.rejects(f.blocks.unblock(f.actors.provider,later.id,{...command(),expectedVersion:1}),{code:'RESOURCE_SCOPE_DENIED'});
    assert.equal((await effects(f.client)).actions,3);assert.equal((await effects(f.client)).audits,3);assert.equal((await effects(f.client)).events,3);
  }finally{await f.close();}
});

for(const direction of ['seeker','provider','legacy'] as const)void integration(`${direction} block denies every inquiry path and new sends, while committed message replay/history/receipts survive`,async()=>{
  const f=await fixture();try{
    const input={client_message_id:randomUUID(),body:'Synthetic preserved message'};
    const sent=await f.messages.send(f.seekerId,f.interaction.conversation_id,input);
    if(direction==='legacy')await f.client`INSERT INTO block_relationships(blocker_user_id,blocked_user_id) VALUES (${f.seekerId},${f.providerUserId})`;
    else {const own=await f.blocks.block(f.actors[direction],'interaction',f.interaction.interaction_id,command());assert.equal(own.subject_kind,direction==='seeker'?'PROVIDER_ACCOUNT':'USER');}
    const before=await effects(f.client);
    for(const [listing,key] of [[f.listingId,randomUUID()],[f.listingId,f.inquiryKey],[f.otherListingId,randomUUID()]])await assert.rejects(f.inquiries.createOrReuseInquiry(f.seekerId,listing!,key!),{code:'CAPABILITY_RESTRICTED'});
    for(const user of [f.seekerId,f.providerUserId])await assert.rejects(f.messages.send(user,f.interaction.conversation_id,{client_message_id:randomUUID(),body:'Denied new message'}),{code:'CAPABILITY_RESTRICTED'});
    const replay=await f.messages.send(f.seekerId,f.interaction.conversation_id,input);assert.equal(replay.created,false);assert.equal(replay.message.id,sent.message.id);
    await assert.rejects(f.messages.send(f.seekerId,f.interaction.conversation_id,{...input,body:'Changed'}),{code:'IDEMPOTENCY_KEY_REUSED'});
    assert.deepEqual(await effects(f.client),before);
    const history=await f.messages.messages(f.providerUserId,f.interaction.conversation_id);assert.equal(history.can_send,false);assert.equal(history.items[0]?.body,input.body);
    await f.messages.acknowledge(f.providerUserId,f.interaction.conversation_id,{message_ids:[sent.message.id],state:'READ'});
    assert.equal((await f.inquiries.read(f.seekerId,f.interaction.interaction_id)).state,'OPEN');
    await f.client`UPDATE interactions SET state='CLOSED',closed_at=statement_timestamp() WHERE id=${f.interaction.interaction_id}`;
    await assert.rejects(f.inquiries.createOrReuseInquiry(f.seekerId,f.listingId,randomUUID()),{code:'CAPABILITY_RESTRICTED'});
    assert.equal((await effects(f.client)).interactions,1);
    const own=(await f.blocks.list(f.actors[direction==='provider'?'provider':'seeker'])).items[0]!;
    await f.blocks.unblock(f.actors[direction==='provider'?'provider':'seeker'],own.id,{...command(),expectedVersion:own.version});
    const next=await f.inquiries.createOrReuseInquiry(f.seekerId,f.listingId,randomUUID());assert.equal(next.created,true);
    const protectedEpisode=await f.blocks.block(f.actors.seeker,'interaction',next.interaction_id,command());
    await f.client`UPDATE interactions SET state='RESTRICTED' WHERE id=${next.interaction_id}`;
    await f.blocks.unblock(f.actors.seeker,protectedEpisode.id,{...command(),expectedVersion:1});
    await assert.rejects(f.inquiries.createOrReuseInquiry(f.seekerId,f.listingId,randomUUID()),{code:'CAPABILITY_RESTRICTED'});
    assert.equal((await f.messages.messages(f.seekerId,next.conversation_id)).can_send,false);
  }finally{await f.close();}
});

void integration('precontact block resolves listing server-side; own safety survives limited account, replaced phone and disappeared target',async()=>{
  const f=await fixture();try{
    await f.client`UPDATE phone_contacts SET replaced_at=statement_timestamp() WHERE user_id=${f.seekerId}`;
    await f.client`UPDATE users SET account_state='LIMITED' WHERE id=${f.seekerId}`;
    const block=await f.blocks.block(f.actors.seeker,'listing',f.otherListingId,command());assert.equal(block.subject_kind,'PROVIDER_ACCOUNT');
    const safety=await f.blocks.safety(f.actors.seeker,'listing',f.listingId);assert.equal(safety.can_contact,false);assert.equal(safety.own_block?.id,block.id);
    await assert.rejects(f.blocks.block(f.actors.provider,'listing',f.listingId,command()),{code:'RESOURCE_SCOPE_DENIED'});
    await assert.rejects(f.blocks.block(f.actors.other,'interaction',f.interaction.interaction_id,command()),{code:'RESOURCE_SCOPE_DENIED'});
    await f.client`UPDATE listings SET publication_status='HIDDEN' WHERE provider_account_id=(SELECT blocked_provider_account_id FROM block_relationships WHERE id=${block.id})`;
    await f.client`UPDATE provider_profiles SET state='SUSPENDED' WHERE user_id=${f.providerUserId}`;
    await assert.rejects(f.blocks.safety(f.actors.seeker,'listing',f.listingId),{code:'RESOURCE_SCOPE_DENIED'});
    assert.equal((await f.blocks.list(f.actors.seeker)).items[0]?.id,block.id);
    assert.equal((await f.blocks.unblock(f.actors.seeker,block.id,{...command(),expectedVersion:1})).state,'REVOKED');
    await f.client`UPDATE users SET account_state='DELETED' WHERE id=${f.seekerId}`;
    await assert.rejects(f.blocks.list(f.actors.seeker),{code:'AUTH_REQUIRED'});
  }finally{await f.close();}
});

for(const loss of ['revoked','expired','version','ownership'] as const)void integration(`captured block authority rechecks ${loss} before mutations/retries`,async()=>{
  const f=await fixture();try{
    const input=command();const block=await f.blocks.block(f.actors.provider,'interaction',f.interaction.interaction_id,input);const before=await effects(f.client);
    if(loss==='revoked')await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${f.actors.provider.sessionId}`;
    if(loss==='expired')await f.client`UPDATE security_sessions SET expires_at=statement_timestamp()-interval '1 second' WHERE id=${f.actors.provider.sessionId}`;
    if(loss==='version')await f.client`UPDATE users SET security_version=security_version+1 WHERE id=${f.providerUserId}`;
    if(loss==='ownership')await f.client`UPDATE provider_profiles SET user_id=${f.otherUserId} WHERE user_id=${f.providerUserId}`;
    await assert.rejects(f.blocks.block(f.actors.provider,'interaction',f.interaction.interaction_id,input),{code:loss==='ownership'?'RESOURCE_SCOPE_DENIED':'AUTH_REQUIRED'});
    if(loss!=='ownership')await assert.rejects(f.blocks.unblock(f.actors.provider,block.id,{...command(),expectedVersion:1}),{code:'AUTH_REQUIRED'});
    assert.deepEqual(await effects(f.client),before);
  }finally{await f.close();}
});

void integration('organization stable target supports seeker protection without membership-derived organization-side authority',async()=>{
  const f=await fixture();try{
    const org=(await f.client`INSERT INTO organizations(state) VALUES ('ACTIVE') RETURNING id`)[0]!.id;
    const account=(await f.client`INSERT INTO provider_accounts(kind,organization_id,state) VALUES ('ORGANIZATION',${org},'ACTIVE') RETURNING id`)[0]!.id;
    await f.client`INSERT INTO organization_memberships(organization_id,user_id,role,state,changed_by) VALUES (${org},${f.providerUserId},'OWNER','ACTIVE',${f.providerUserId})`;
    // Synthetic foundation context; organization inquiry creation remains deferred.
    await f.client`UPDATE interactions SET provider_account_id=${account} WHERE id=${f.interaction.interaction_id}`;
    const block=await f.blocks.block(f.actors.seeker,'interaction',f.interaction.interaction_id,command());assert.equal(block.subject_kind,'PROVIDER_ACCOUNT');
    assert.equal(await contactProhibited(f.client,f.seekerId,account,null),true);
    await assert.rejects(f.blocks.block(f.actors.provider,'interaction',f.interaction.interaction_id,command()),{code:'RESOURCE_SCOPE_DENIED'});
    await assert.rejects(f.blocks.block(f.actors.other,'interaction',f.interaction.interaction_id,command()),{code:'RESOURCE_SCOPE_DENIED'});
    assert.equal((await effects(f.client)).actions,1);
  }finally{await f.close();}
});

async function waitFor(client:ReturnType<typeof createDatabase>['client'],kind:'advisory'|'relation',mode:string,count=1) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){const rows=await client<{n:number}[]>`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND locktype=${kind} AND mode=${mode}`;if(rows[0]!.n>=count)return;await new Promise(r=>setTimeout(r,10));}
  throw Error(`Expected database barrier ${kind}/${mode}`);
}
for(const first of ['message','inquiry','block-message','block-inquiry'] as const)void integration(`real connection barrier: earlier ${first} commits before later competing contact/block`,async()=>{
  const f=await fixture();const blocksFirst=first.startsWith('block-');const table=first==='message'?'messages':first==='inquiry'?'interactions':'block_relationships';
  const gate=createDatabase(url!).client;let release!:()=>void;let ready!:()=>void;
  const held=new Promise<void>(r=>{ready=r;});const released=new Promise<void>(r=>{release=r;});
  const holder=gate.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(920029)`;ready();await released;});
  try{
    await held;await f.client.unsafe(`CREATE FUNCTION g3b_test_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(920029); RETURN NEW; END $$; CREATE TRIGGER g3b_test_barrier BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION g3b_test_barrier()`);
    const earlier=first==='message'?f.messages.send(f.seekerId,f.interaction.conversation_id,{client_message_id:randomUUID(),body:'Earlier committed'}):first==='inquiry'?f.inquiries.createOrReuseInquiry(f.seekerId,f.otherListingId,randomUUID()):f.blocks.block(f.actors.seeker,'interaction',f.interaction.interaction_id,command());
    await waitFor(f.client,'advisory','ExclusiveLock');
    const later=first==='block-message'?f.messages.send(f.seekerId,f.interaction.conversation_id,{client_message_id:randomUUID(),body:'Later denied'}):first==='block-inquiry'?f.inquiries.createOrReuseInquiry(f.seekerId,f.otherListingId,randomUUID()):f.blocks.block(f.actors.seeker,'interaction',f.interaction.interaction_id,command());
    const laterCheck=blocksFirst?assert.rejects(later,{code:'CAPABILITY_RESTRICTED'}):later;
    await waitFor(f.client,'relation',blocksFirst?'ShareLock':'ShareRowExclusiveLock');
    release();await holder;await earlier;await laterCheck;
    await assert.rejects(f.inquiries.createOrReuseInquiry(f.seekerId,f.otherListingId,randomUUID()),{code:'CAPABILITY_RESTRICTED'});
    assert.equal((await effects(f.client)).actions,1);
  }finally{release();await holder;await f.client.unsafe(`DROP TRIGGER IF EXISTS g3b_test_barrier ON ${table}; DROP FUNCTION IF EXISTS g3b_test_barrier()`);await gate.end();await f.close();}
});

const writerRaces=['duplicate-block','duplicate-unblock','block-then-unblock','unblock-then-reblock','stale-unblock-then-reblock','reblock-then-stale-unblock','reblock-then-old-unblock-retry'] as const;
for(const race of writerRaces)void integration(`controlled dedicated writer connections: ${race}`,async()=>{
  const f=await fixture();
  // Dedicated one-connection clients make backend identity and the waiting
  // lock queue observable; Promise.all alone would not prove overlap/order.
  const firstClient=postgres(url!,{max:1,prepare:false});
  const secondClient=postgres(url!,{max:1,prepare:false});
  const gate=postgres(url!,{max:1,prepare:false});
  const firstStore=new BlockStore(firstClient,true),secondStore=new BlockStore(secondClient,true);
  let release!:()=>void;let held:Promise<unknown>|undefined;
  const pending:Promise<PromiseSettledResult<unknown>[]>[]=[];
  try {
    const blockInput=command();const revokeInput={...command(),expectedVersion:1};
    const old=race==='duplicate-block'?null:await f.blocks.block(f.actors.seeker,'interaction',f.interaction.interaction_id,blockInput);
    if(race.includes('stale')||race==='reblock-then-old-unblock-retry')await f.blocks.unblock(f.actors.seeker,old!.id,revokeInput);
    const aPid=(await firstClient<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    const bPid=(await secondClient<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    assert.notEqual(aPid,bPid);
    let ready!:()=>void;const arrived=new Promise<void>(r=>{ready=r;});const freed=new Promise<void>(r=>{release=r;});
    held=gate.begin(async tx=>{await tx`LOCK TABLE block_relationships IN SHARE ROW EXCLUSIVE MODE`;ready();await freed;});
    await arrived;
    const create=(store:BlockStore)=>store.block(f.actors.seeker,'interaction',f.interaction.interaction_id,race==='duplicate-block'?blockInput:command());
    const revoke=(store:BlockStore)=>store.unblock(f.actors.seeker,old!.id,race==='duplicate-unblock'||race==='reblock-then-old-unblock-retry'?revokeInput:{...command(),expectedVersion:1});
    const first=race==='duplicate-unblock'||race==='unblock-then-reblock'||race==='stale-unblock-then-reblock'?revoke(firstStore):create(firstStore);
    pending.push(Promise.allSettled([first]));
    const waiting=async(pid:number)=>{
      const deadline=Date.now()+5000;
      while(Date.now()<deadline){
        const rows=await f.client`SELECT pid FROM pg_locks WHERE pid=${pid} AND locktype='relation' AND relation='block_relationships'::regclass AND mode='ShareRowExclusiveLock' AND NOT granted`;
        if(rows[0])return;await new Promise(r=>setTimeout(r,10));
      }
      throw Error('Expected dedicated writer to wait at block-table gate');
    };
    await waiting(aPid);
    const second=race==='duplicate-block'||race==='unblock-then-reblock'||race==='stale-unblock-then-reblock'?create(secondStore):revoke(secondStore);
    pending.push(Promise.allSettled([second]));await waiting(bPid);
    release();await held;
    const [a]=await pending[0]!;const [b]=await pending[1]!;
    if(race==='stale-unblock-then-reblock'){assert.equal(a!.status,'rejected');assert.equal((a as PromiseRejectedResult).reason.code,'STALE_VERSION');}
    else assert.equal(a!.status,'fulfilled');
    if(race==='reblock-then-stale-unblock'){assert.equal(b!.status,'rejected');assert.equal((b as PromiseRejectedResult).reason.code,'STALE_VERSION');}
    else assert.equal(b!.status,'fulfilled');
    const rows=(await f.blocks.list(f.actors.seeker)).items;
    const active=rows.filter(row=>row.state==='ACTIVE');
    const expectedActive=race==='duplicate-unblock'||race==='block-then-unblock'?0:1;
    assert.equal(active.length,expectedActive);
    if(race==='duplicate-block'||race==='duplicate-unblock')assert.deepEqual((a as PromiseFulfilledResult<unknown>).value,(b as PromiseFulfilledResult<unknown>).value);
    if(race.includes('reblock')){assert.notEqual(active[0]!.id,old!.id);assert.equal(rows.find(row=>row.id===old!.id)?.state,'REVOKED');}
    const expectedActions=race==='duplicate-block'?1:race==='duplicate-unblock'||race==='block-then-unblock'?2:3;
    const result=await effects(f.client);
    assert.equal(result.actions,expectedActions);assert.equal(result.events,expectedActions);assert.equal(result.audits,expectedActions);
    assert.equal(result.receipts,race==='duplicate-block'?1:race==='duplicate-unblock'?2:3);
    assert.equal(result.blocks,race.includes('reblock')?2:1);
  } finally {
    release?.();if(held)await held;await Promise.all(pending);
    await Promise.all([firstClient.end(),secondClient.end(),gate.end()]);await f.close();
  }
});
