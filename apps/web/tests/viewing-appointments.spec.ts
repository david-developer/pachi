import { expect, test, type Page } from '@playwright/test';
import type { ViewingNoticeResponse, ViewingRescheduleResponse, ViewingResponse } from '@pachi/contracts';
const id='00000000-0000-4000-8000-000000000701',pid='00000000-0000-4000-8000-000000000702',nid='00000000-0000-4000-8000-000000000703';
const guide='SYNTHETIC_PRIVATE_F2_GUIDANCE: staffed reception';
const now=new Date().toISOString(),expiry=new Date(Date.now()+48*3600000).toISOString();
const seed:ViewingResponse={id,interaction_id:'00000000-0000-4000-8000-000000000704',listing_id:'00000000-0000-4000-8000-000000000705',provider_account_id:'00000000-0000-4000-8000-000000000706',seeker_user_id:'00000000-0000-4000-8000-000000000707',state:'SCHEDULED',proposed_start:'2031-01-12T13:00:00.000Z',proposed_end:'2031-01-12T14:00:00.000Z',scheduled_start:'2031-01-12T13:00:00.000Z',scheduled_end:'2031-01-12T14:00:00.000Z',display_timezone:'Africa/Douala',response_deadline:expiry,version:4,schedule_version:1,seeker_confirmed:true,provider_confirmed:true,private_instructions:guide,reason:null,created_at:now,updated_at:now,actor_side:'SEEKER',can_accept:false,can_decline:false,can_confirm:false,can_cancel:true};
async function fixture(page:Page,side:'SEEKER'|'PROVIDER'='SEEKER'){
  const state={side,viewing:{...seed},proposal:null as ViewingRescheduleResponse|null,history:[] as {schedule_version:number;scheduled_start:string;scheduled_end:string;display_timezone:string;superseded_at:string}[],
    notices:[{id:nid,viewing_id:id,recipient_side:side,event_type:'viewing_scheduled',schedule_version:1,event_at:now,available_at:now,inbox_state:'AVAILABLE',external_state:'NOT_ENABLED',read_at:null}] as ViewingNoticeResponse[],readStatus:200,nextStatus:0,abortNext:false,
    commands:[] as {path:string;body:Record<string,unknown>;key:string}[],effects:0,holdRead:null as null|{arrived:()=>void;wait:Promise<void>},holdCommand:null as null|{arrived:()=>void;wait:Promise<void>}};
  const receipts=new Map<string,{body:string}>();
  const viewing=()=>({...state.viewing,actor_side:state.side});
  const proposal=()=>state.proposal?{...state.proposal,actor_side:state.side,can_accept:state.proposal.state==='PENDING'&&!(state.side==='SEEKER'?state.proposal.seeker_approved:state.proposal.provider_approved),can_reject:state.proposal.state==='PENDING'&&state.proposal.proposed_by_side!==state.side,can_withdraw:state.proposal.state==='PENDING'&&state.proposal.proposed_by_side===state.side}:null;
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path==='/api/session')return route.fulfill({json:{authenticated:true,csrfToken:'synthetic',participationAllowed:true}});
    if(request.method()==='GET'){
      if(state.readStatus!==200)return route.fulfill({status:state.readStatus,json:{message:'PRIVATE_BACKEND_SENTINEL'}});
      if(path.endsWith('/reviews'))return route.fulfill({json:{viewing_id:id,interaction_id:seed.interaction_id,actor_side:state.side,eligibility:null,own_review:null}});
      if(path===`/api/account/viewings/${id}`){const snapshot=viewing(),hold=state.holdRead;state.holdRead=null;if(hold){hold.arrived();await hold.wait;}return route.fulfill({json:snapshot});}
      if(path.endsWith('/reschedules'))return route.fulfill({json:{items:state.proposal?[proposal()]:[],current_proposal:state.proposal?.state==='PENDING'?proposal():null,next_cursor:null,can_propose:!state.proposal||state.proposal.state!=='PENDING',schedule_history:state.history}});
      if(path.endsWith('/reminders'))return route.fulfill({json:{schedule_version:state.viewing.schedule_version,plan_status:'PLANNED',planned_at:now,items:[{id:nid,action_type:'REMINDER_24H',expected_schedule_version:state.viewing.schedule_version,due_at:'2031-01-11T13:00:00.000Z',state:'PENDING',reason_code:null}],external_state:'NOT_ENABLED'}});
      if(path.endsWith('/attendance'))return route.fulfill({json:{viewing_id:id,schedule_version:state.viewing.schedule_version,version:state.viewing.version,state:'NONE',outcome:null,actor_side:state.side,can_claim_completion:false,can_claim_no_show:false,claims:[],next_cursor:null,case:null,response_window_hours:48,review_eligibility_created:false}});
      if(path==='/api/account/viewing-notices')return route.fulfill({json:{items:state.notices,next_cursor:null}});
    }
    if(request.method()==='POST'){
      expect(request.headers()['x-csrf-token']).toBe('synthetic');const body=request.postDataJSON() as Record<string,unknown>,key=request.headers()['idempotency-key']!;state.commands.push({path,body,key});expect(key).toMatch(/^[0-9a-f-]{36}$/);
      if(state.nextStatus){const status=state.nextStatus;state.nextStatus=0;return route.fulfill({status,json:{code:'STALE_PROPOSAL_VERSION',message:'PRIVATE_BACKEND_SENTINEL'}});}
      if(path.endsWith('/read')){state.notices=state.notices.map(n=>n.id===nid?{...n,read_at:now}:n);return route.fulfill({status:201,json:state.notices[0]});}
      const replay=receipts.get(key);
      if(replay)expect(JSON.stringify(body)).toBe(replay.body);
      else{
        expect(body.expected_version).toBe(state.viewing.version);expect(body.expected_schedule_version).toBe(state.viewing.schedule_version);state.effects++;
        if(path.endsWith('/reschedules')){state.proposal={id:pid,viewing_id:id,base_schedule_version:state.viewing.schedule_version,proposed_start:body.proposed_start as string,proposed_end:body.proposed_end as string,display_timezone:state.viewing.display_timezone,proposed_by_user_id:seed.seeker_user_id,proposed_by_side:state.side,state:'PENDING',version:1,seeker_approved:false,provider_approved:false,finalized_schedule_version:null,expires_at:expiry,created_at:now,updated_at:now,actor_side:state.side,can_accept:true,can_reject:false,can_withdraw:true};}
        else{
          const p=state.proposal!;expect(body.expected_proposal_version).toBe(p.version);p.version++;
          if(path.endsWith('/accept')){if(state.side==='SEEKER')p.seeker_approved=true;else p.provider_approved=true;if(p.seeker_approved&&p.provider_approved){state.history.push({schedule_version:state.viewing.schedule_version,scheduled_start:state.viewing.scheduled_start!,scheduled_end:state.viewing.scheduled_end!,display_timezone:state.viewing.display_timezone,superseded_at:now});state.viewing={...state.viewing,scheduled_start:p.proposed_start,scheduled_end:p.proposed_end,schedule_version:state.viewing.schedule_version+1};p.state='FINALIZED';p.finalized_schedule_version=state.viewing.schedule_version;}}
          else p.state=path.endsWith('/reject')?'REJECTED':'WITHDRAWN';
        }
        state.viewing.version++;receipts.set(key,{body:JSON.stringify(body)});
      }
      const hold=state.holdCommand;state.holdCommand=null;if(hold){hold.arrived();await hold.wait;}
      if(state.abortNext){state.abortNext=false;return route.abort('failed');}
      return route.fulfill({status:201,json:{viewing:viewing(),proposal:proposal(),replayed:!!replay}});
    }
    throw Error(`Unexpected G3-F2 synthetic API route ${path}`);
  });
  return state;
}
async function propose(page:Page){await page.getByLabel('Replacement start',{exact:true}).fill('2031-01-13T14:00');await page.getByLabel('Replacement end',{exact:true}).fill('2031-01-13T15:00');const button=page.getByRole('button',{name:'Propose replacement time',exact:true});await expect(button).toBeEnabled();await button.click();}
async function ready(page:Page){await page.goto(`/viewings/${id}`);await expect(page.getByRole('button',{name:'Propose replacement time',exact:true})).toBeEnabled();}
function hold(){let arrived!:()=>void,release!:()=>void;return {arrived:new Promise<void>(r=>{arrived=r;}),wait:new Promise<void>(r=>{release=r;}),notify:()=>arrived(),release:()=>release()};}

for(const side of ['SEEKER','PROVIDER'] as const)test(`G3-F2 ${side} proposes in Africa/Douala; confirmed time changes only after both explicit approvals`,async({page})=>{
  const state=await fixture(page,side);await ready(page);const confirmed=page.getByRole('group',{name:'Confirmed appointment time'});await expect(confirmed).toContainText('12 Jan 2031');await propose(page);
  await expect(page.getByLabel('Pending replacement proposal')).toBeVisible();await expect(confirmed).toContainText('12 Jan 2031');expect(state.commands[0]!.body.proposed_start).toBe('2031-01-13T13:00:00.000Z');
  await page.getByRole('button',{name:'Approve replacement time',exact:true}).click();await expect(confirmed).toContainText('12 Jan 2031');await expect(page.getByLabel('Pending replacement proposal')).toContainText(side==='SEEKER'?'Seeker approval: Approved':'Provider approval: Approved');
  state.side=side==='SEEKER'?'PROVIDER':'SEEKER';await page.reload();await expect(page.getByRole('button',{name:'Approve replacement time',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Approve replacement time',exact:true}).click();await expect(confirmed).toContainText('13 Jan 2031');await expect(page.getByText('Replacement appointment confirmed.',{exact:true})).toBeVisible();expect(state.viewing.schedule_version).toBe(2);
  await page.getByText('Previous confirmed times',{exact:true}).click();await expect(page.getByText(/Schedule 1 · 12 Jan 2031/)).toBeVisible();
});
for(const action of ['reject','withdraw'] as const)test(`G3-F2 ${action} closes a proposal and preserves the confirmed time`,async({page})=>{
  const state=await fixture(page);await ready(page);await propose(page);if(action==='reject'){state.side='PROVIDER';await page.reload();}
  const button=page.getByRole('button',{name:action==='reject'?'Reject replacement proposal':'Withdraw replacement proposal',exact:true});await expect(button).toBeEnabled();await button.click();await expect(page.getByRole('group',{name:'Confirmed appointment time'})).toContainText('12 Jan 2031');await expect(page.getByRole('list',{name:'Replacement proposal history'})).toContainText(action==='reject'?'REJECTED':'WITHDRAWN');expect(state.viewing.schedule_version).toBe(1);
});

test('G3-F2 ambiguous persisted proposal retries the exact body and key, with one business effect and no unilateral time change',async({page})=>{
  const state=await fixture(page);await ready(page);state.abortNext=true;await propose(page);await expect(page.getByRole('button',{name:'Retry pending appointment change'})).toBeVisible();await expect(page.getByText(guide,{exact:true})).not.toBeVisible();
  const first=state.commands[0]!;await page.getByRole('button',{name:'Retry pending appointment change'}).click();await expect(page.getByLabel('Pending replacement proposal')).toBeVisible();expect(state.commands[1]!.key).toBe(first.key);expect(state.commands[1]!.body).toEqual(first.body);expect(state.effects).toBe(1);await expect(page.getByRole('group',{name:'Confirmed appointment time'})).toContainText('12 Jan 2031');
});
test('G3-F2 a stale approval hides guidance and requires a complete refresh before further commands',async({page})=>{
  const state=await fixture(page);await ready(page);await propose(page);await expect(page.getByRole('button',{name:'Approve replacement time'})).toBeEnabled();state.nextStatus=409;await page.getByRole('button',{name:'Approve replacement time'}).click();await expect(page.getByRole('alert').filter({hasText:'This appointment or proposal changed'})).toBeVisible();await expect(page.getByText(guide,{exact:true})).not.toBeVisible();await expect(page.getByRole('button',{name:'Approve replacement time'})).toBeDisabled();
  await page.getByRole('button',{name:'Refresh viewing',exact:true}).click();await expect(page.getByRole('button',{name:'Approve replacement time'})).toBeEnabled();await expect(page.getByText(guide,{exact:true})).toBeVisible();
});
test('G3-F2 a delayed old viewing read cannot overwrite a finalized replacement or restore old confirmed times',async({page})=>{
  const state=await fixture(page);await ready(page);await propose(page);await page.getByRole('button',{name:'Approve replacement time'}).click();await expect(page.getByLabel('Pending replacement proposal')).toContainText('Seeker approval: Approved');state.side='PROVIDER';await page.reload();await expect(page.getByRole('button',{name:'Approve replacement time'})).toBeEnabled();
  const command=hold();state.holdCommand={arrived:command.notify,wait:command.wait};await page.getByRole('button',{name:'Approve replacement time'}).click();await command.arrived;
  // The API has committed; deliver a previous authorized viewing snapshot late.
  const previous={...state.viewing,scheduled_start:seed.scheduled_start,scheduled_end:seed.scheduled_end,schedule_version:1,version:state.viewing.version-1};
  const read=hold();await page.route(`**/api/account/viewings/${id}`,async route=>{read.notify();await read.wait;await route.fulfill({json:previous});},{times:1});
  await page.getByRole('button',{name:'Refresh viewing',exact:true}).click();await read.arrived;command.release();await expect(page.getByRole('group',{name:'Confirmed appointment time'})).toContainText('13 Jan 2031');read.release();await expect(page.getByRole('group',{name:'Confirmed appointment time'})).toContainText('13 Jan 2031');expect(state.viewing.schedule_version).toBe(2);
});
test('G3-F2 current-scope denial clears the appointment, directions and proposal controls without raw backend details',async({page})=>{
  const state=await fixture(page);await ready(page);await expect(page.getByText(guide,{exact:true})).toBeVisible();state.readStatus=404;await page.getByRole('button',{name:'Refresh appointment activity'}).click();await expect(page.getByText(guide,{exact:true})).not.toBeVisible();await expect(page.getByLabel('Replacement start',{exact:true})).not.toBeVisible();await expect(page.locator('main')).not.toContainText('PRIVATE_BACKEND_SENTINEL');await expect(page.getByRole('alert').filter({hasText:'current account permissions'})).toBeVisible();
});
test('G3-F2 invalid replacement ranges and DST gaps remain accessible local errors without sending a proposal',async({page})=>{
  const state=await fixture(page);await ready(page);await page.getByLabel('Replacement start',{exact:true}).fill('2031-01-13T15:00');await page.getByLabel('Replacement end',{exact:true}).fill('2031-01-13T14:00');await page.getByRole('button',{name:'Propose replacement time',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'end after the start'})).toBeVisible();expect(state.commands.length).toBe(0);
  state.viewing.display_timezone='America/New_York';await page.reload();await expect(page.getByRole('button',{name:'Propose replacement time',exact:true})).toBeEnabled();await page.getByLabel('Replacement start',{exact:true}).fill('2027-03-14T02:30');await page.getByLabel('Replacement end',{exact:true}).fill('2027-03-14T04:00');await page.getByRole('button',{name:'Propose replacement time',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'skipped or repeated'})).toBeVisible();expect(state.commands.length).toBe(0);
});
test('G3-F2 notice inbox distinguishes availability, own reading and inactive external delivery, with safe empty/error states',async({page})=>{
  const state=await fixture(page);Object.assign(state.notices[0]!,{private_instructions:guide,location:'PRIVATE_LOCATION_SENTINEL'});await page.goto('/viewings/notices');await expect(page.getByRole('button',{name:'Mark notice read'})).toBeEnabled();await expect(page.locator('main')).not.toContainText(guide);await expect(page.locator('main')).not.toContainText('PRIVATE_LOCATION_SENTINEL');await expect(page.getByText(/Available in your inbox/)).toBeVisible();
  await page.getByRole('button',{name:'Mark notice read'}).click();await expect(page.getByRole('list',{name:'Appointment notices'})).toContainText('Read by you');await expect(page.getByText('Notice marked read by you.',{exact:true})).toBeVisible();expect(state.commands[0]!.body).toEqual({});
  state.notices=[];await page.getByRole('button',{name:'Refresh appointment notices'}).click();await expect(page.getByText('No appointment notices yet.')).toBeVisible();state.readStatus=503;await page.getByRole('button',{name:'Refresh appointment notices'}).click();await expect(page.getByRole('alert').filter({hasText:'could not be loaded'})).toBeVisible();await expect(page.locator('main')).not.toContainText('PRIVATE_BACKEND_SENTINEL');
});
test('G3-F2 actual BFF proposal, reminder and notice routes deny anonymous access with private no-store responses',async({request})=>{
  for(const path of [`/api/account/viewings/${id}/reschedules`,`/api/account/viewings/${id}/reminders`,'/api/account/viewing-notices']){const r=await request.get(path);expect(r.status()).toBe(401);expect(r.headers()['cache-control']).toBe('private, no-store');expect(await r.json()).toEqual({error:'authentication_required'});}
  for(const path of [`/api/account/viewings/${id}/reschedules`,`/api/account/viewings/${id}/reschedules/${pid}/accept`,`/api/account/viewing-notices/${nid}/read`]){const r=await request.post(path,{data:{}});expect(r.status()).toBe(401);expect(r.headers()['cache-control']).toBe('private, no-store');}
  const unsupported=await request.post(`/api/account/viewings/${id}/reschedules/${pid}/finalize`,{data:{}});expect(unsupported.status()).toBe(404);expect(unsupported.headers()['cache-control']).toBe('private, no-store');
});
