import { expect, test } from '@playwright/test';
test('organization assignment BFF exposes no anonymous resource data and keeps failure responses private',async({request})=>{
  const path='/api/account/organizations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/resources/LISTING/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/assignments';
  for(const response of [await request.get(path),await request.post(path,{data:{membership_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',expected_version:0}})]) {
    expect(response.status()).toBe(401);expect(response.headers()['cache-control']).toBe('private, no-store');expect(await response.json()).toEqual({error:'authentication_required'});
  }
  const invalid=await request.get(path.replace('/LISTING/','/VIEWING/'));expect(invalid.status()).toBe(404);expect(invalid.headers()['cache-control']).toBe('private, no-store');
});
