import assert from 'node:assert/strict';
import test from 'node:test';
import { forwardOrganizationRequest } from './organization-forward.js';
const path='organizations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/resources/LISTING/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/assignments';
void test('assignment BFF keeps mutation credentials server-side and requires same-origin CSRF before forwarding',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({});});
  const request=()=>new Request(`http://localhost:3000/api/account/${path}`,{method:'POST',headers:{origin:'http://attacker.test','x-csrf-token':'csrf'},body:JSON.stringify({membership_id:'target',expected_version:0})});
  const anonymous=await forwardOrganizationRequest(request(),path,{},true);assert.equal(anonymous.status,401);
  const rejected=await forwardOrganizationRequest(request(),path,{accessToken:'server-only',csrfToken:'csrf'},true);assert.equal(rejected.status,403);assert.equal(calls,0);
  assert.equal(rejected.headers.get('cache-control'),'private, no-store');
});
void test('assignment BFF forwards only scoped pagination/membership and preserves version/idempotency without backend details',async t=>{
  t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{
    const target=new URL(url);assert.equal(target.origin+target.pathname,`http://localhost:3001/v1/account/${path}`);
    assert.deepEqual([...target.searchParams].sort(),[['limit','10'],['membership_id','member']]);assert.equal(init.cache,'no-store');
    return Response.json({assignments:[],next_cursor:null});
  });
  const response=await forwardOrganizationRequest(new Request(`http://localhost:3000/api/account/${path}?membership_id=member&limit=10&role=OWNER&provider_account_id=forged`),path,{accessToken:'server-only'},false,['cursor','limit','membership_id']);
  assert.equal(response.status,200);
  t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{
    assert.equal(url,`http://localhost:3001/v1/account/${path}`);assert.equal((init.headers as Record<string,string>).authorization,'Bearer server-only');
    assert.equal((init.headers as Record<string,string>)['idempotency-key'],'same-retry');assert.deepEqual(JSON.parse(init.body as string),{membership_id:'member',expected_version:2});
    return Response.json({message:'PRIVATE_ASSIGNMENT_DETAILS'},{status:409});
  });
  const failure=await forwardOrganizationRequest(new Request(`http://localhost:3000/api/account/${path}`,{method:'POST',headers:{origin:'http://localhost:3000','x-csrf-token':'csrf','idempotency-key':'same-retry'},body:JSON.stringify({membership_id:'member',expected_version:2})}),path,{accessToken:'server-only',csrfToken:'csrf'},true);
  assert.equal(failure.status,409);assert.deepEqual(await failure.json(),{error:'organization_request_failed'});
});
