import assert from 'node:assert/strict';
import test from 'node:test';
import { forwardBlockRequest } from './block-forward.js';
const input=(origin='http://localhost:3000')=>new Request('http://localhost:3000/api/account/blocks/id/unblock?target=private',{method:'POST',headers:{origin,'x-csrf-token':'synthetic','idempotency-key':'retry-key'},body:JSON.stringify({expected_version:1})});
void test('block BFF requires registered web auth, matching CSRF and origin before forwarding',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('should not forward');});
  for(const [session,request,status] of [[{},input(),401],[{accessToken:'server-token',csrfToken:'wrong'},input(),403],[{accessToken:'server-token',csrfToken:'synthetic'},input('https://other.test'),403]] as const){const response=await forwardBlockRequest(request,'blocks/id/unblock',session,true);assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'private, no-store');}
  assert.equal(calls,0);
});
void test('block BFF preserves exact command payload/key and hides arbitrary backend error content',async t=>{
  t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{assert.equal(url,'http://localhost:3001/v1/account/blocks/id/unblock');assert.equal(init.body,JSON.stringify({expected_version:1}));assert.equal((init.headers as Record<string,string>)['idempotency-key'],'retry-key');assert.equal(init.cache,'no-store');return Response.json({message:'PRIVATE_TARGET_SENTINEL'},{status:409});});
  const response=await forwardBlockRequest(input(),'blocks/id/unblock',{accessToken:'server-token',csrfToken:'synthetic'},true);assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'request_conflict'});assert.equal(response.headers.get('cache-control'),'private, no-store');
});
