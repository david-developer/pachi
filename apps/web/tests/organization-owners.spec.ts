import {expect,test,type Page} from '@playwright/test';
import type {OrganizationSummary,OrganizationMember,OrganizationOwnershipTransfer} from '@pachi/contracts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const orgId=id(801),ownerId=id(802),memberId=id(803),transferId=id(804),root='/api/account/organizations';
async function workspace(page:Page,recipient=false){
 const organization:OrganizationSummary={id:orgId,public_name:'Synthetic owner lifecycle',organization_type:'REAL_ESTATE_AGENCY',state:'ACTIVE',version:2,provider_account_id:id(805),business_verification:'NOT_VERIFIED',publication_eligible:false,public_contact:{phone:null},membership:{id:recipient?memberId:ownerId,role:recipient?'AGENT':'OWNER',state:'ACTIVE',version:1},created_at:'2026-10-07T00:00:00Z'};
 const members:OrganizationMember[]=[{id:ownerId,organization_id:orgId,user_id:ownerId,role:'OWNER',state:'ACTIVE',version:1,activated_at:'2026-10-07T00:00:00Z',revoked_at:null},{id:memberId,organization_id:orgId,user_id:memberId,role:'AGENT',state:'ACTIVE',version:1,activated_at:'2026-10-07T00:00:00Z',revoked_at:null}];
 const transfer:OrganizationOwnershipTransfer={id:transferId,organization_id:orgId,source_membership_id:ownerId,recipient_membership_id:memberId,source_membership_version:1,recipient_membership_version:1,source_role_after:'AGENT',state:recipient?'PENDING_ACCEPTANCE':'ACCEPTED',version:recipient?1:2,organization_version:2,created_at:'2026-10-07T00:00:00Z',accepted_at:recipient?null:'2026-10-07T00:01:00Z',completed_at:null};
 const state={organization,members,transfer,calls:[] as {path:string;body:Record<string,unknown>;key:string;csrf:string}[],stepUp:true};
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/session')return route.fulfill({json:{authenticated:true,participationAllowed:true,csrfToken:'synthetic-owner-csrf'}});
  if(request.method()==='GET'){
   if(path===root)return route.fulfill({json:{organizations:[state.organization],next_cursor:null}});
   if(path==='/api/account/organization-invitations'||path.endsWith('/invitations'))return route.fulfill({json:{invitations:[],next_cursor:null}});
   if(path.endsWith('/members'))return route.fulfill({json:{members:state.members,next_cursor:null}});
   if(path.endsWith('/ownership-transfers'))return route.fulfill({json:{transfers:[state.transfer],next_cursor:null}});
   return route.fulfill({json:state.organization});
  }
  const body=request.postDataJSON() as Record<string,unknown>;state.calls.push({path,body,key:request.headers()['idempotency-key']??'',csrf:request.headers()['x-csrf-token']??''});
  if(state.stepUp)return route.fulfill({status:403,json:{error:'step_up_required'}});
  if(path.endsWith('/accept')){state.transfer.state='ACCEPTED';state.transfer.version++;state.organization.version++;state.transfer.organization_version=state.organization.version;return route.fulfill({json:state.transfer});}
  if(path.endsWith('/complete')){state.transfer.state='COMPLETED';state.transfer.version++;state.organization.version++;state.organization.membership.role='AGENT';state.organization.membership.version++;return route.fulfill({json:state.transfer});}
  return route.fulfill({status:409,json:{error:'final_owner_protected'}});
 });
 await page.goto('/organizations');await page.getByRole('button',{name:/^Synthetic owner lifecycle ·/}).click();
 await expect(page.getByRole('region',{name:'Ownership and admin management'})).toBeVisible();return state;
}
test('owner BFF routes deny anonymous mutations and reads privately and keep recovery unavailable',async({request})=>{
 for(const [path,mutation]of [[`${root}/${orgId}/ownership-transfers`,false],[`${root}/${orgId}/members/${memberId}/privileged-role`,true],[`${root}/${orgId}/ownership-transfers/${transferId}/accept`,true]] as const){
  const response=mutation?await request.post(path,{data:{mfa:true}}):await request.get(path);expect(response.status()).toBe(401);expect(response.headers()['cache-control']).toBe('private, no-store');expect(await response.json()).toEqual({error:'authentication_required'});
 }
 const recovery=await request.post(`${root}/${orgId}/recovery`,{data:{}});expect(recovery.status()).toBe(404);expect(recovery.headers()['cache-control']).toBe('private, no-store');
});
test('privileged role control shows server step-up-required without clearing workspace or pretending MFA',async({page})=>{
 const state=await workspace(page);await page.getByRole('combobox',{name:`Privileged role for ${memberId}`,exact:true}).selectOption('ADMIN');
 const controls=page.getByRole('region',{name:'Ownership and admin management'});await controls.getByRole('button',{name:'Apply privileged role'}).last().click();
 await expect(page.getByText('Recent MFA-backed verification is required. Step-up is currently unavailable; no ownership or admin change was made.')).toBeVisible();
 expect(state.calls).toHaveLength(1);expect(state.calls[0]?.body).toEqual({expected_organization_version:2,expected_actor_membership_version:1,expected_membership_version:1,role:'ADMIN'});
 expect(state.calls[0]?.csrf).toBe('synthetic-owner-csrf');expect(state.calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
 await expect(page.getByRole('heading',{name:'Synthetic owner lifecycle'})).toBeVisible();await expect(page.getByText('Final-owner recovery is unavailable and deferred to a future scoped staff process.')).toBeVisible();
});
test('intended recipient can load and accept a transfer using versions without supplying ownership or MFA facts',async({page})=>{
 const state=await workspace(page,true);state.stepUp=false;await page.getByRole('button',{name:'Load ownership transfers'}).click();await page.getByRole('button',{name:'Accept ownership transfer'}).click();
 await expect(page.getByText('Sensitive organization change confirmed.')).toBeVisible();expect(state.calls[0]?.path).toContain('/accept');expect(state.calls[0]?.body).toEqual({expected_organization_version:2,expected_actor_membership_version:1,expected_transfer_version:1,expected_source_membership_version:1,expected_recipient_membership_version:1});
 await expect(page.getByRole('button',{name:'Apply privileged role'})).toHaveCount(0);
});
test('completion refreshes current source role and removes privileged controls',async({page})=>{
 const state=await workspace(page);state.stepUp=false;await page.getByRole('button',{name:'Load ownership transfers'}).click();await page.getByRole('button',{name:'Complete ownership transfer'}).click();
 await expect(page.getByText('Sensitive organization change confirmed.')).toBeVisible();await expect(page.getByRole('button',{name:'Apply privileged role'})).toHaveCount(0);expect(state.organization.membership.role).toBe('AGENT');expect(state.calls[0]?.path).toContain('/complete');
});
