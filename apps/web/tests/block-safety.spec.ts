import { expect, test, type Page, type Route } from '@playwright/test';

const ids={listing:'00000000-0000-4000-8000-000000000091',interaction:'00000000-0000-4000-8000-000000000092',conversation:'00000000-0000-4000-8000-000000000093',block:'00000000-0000-4000-8000-000000000094'};
const block={id:ids.block,subject_kind:'PROVIDER_ACCOUNT',state:'ACTIVE',created_at:'2026-10-06T00:00:00.000Z',revoked_at:null,version:1};
const message={id:'00000000-0000-4000-8000-000000000095',conversation_id:ids.conversation,sender_user_id:'00000000-0000-4000-8000-000000000096',sender_side:'SEEKER',client_message_id:'00000000-0000-4000-8000-000000000097',body:'Preserved synthetic history',sequence:'1',sent_at:'2026-10-06T00:00:00.000Z',visibility_state:'VISIBLE',receipts:[]};
const context={interaction_id:ids.interaction,conversation_id:ids.conversation,listing_id:ids.listing,state:'OPEN',opened_at:block.created_at,title:'Safety fixture flat',listing_visible:true,created:false};
const listing={id:ids.listing,purpose:'RENT',title:'Safety fixture flat',description:'Synthetic listing',price:{amount_minor:200000,currency:'XAF',pricing_period:'MONTHLY'},property:{property_type:'APARTMENT',bedrooms:2},location:{city:'Douala',region:'Littoral'},media:[]};
async function fixture(page:Page,side='SEEKER',otherRestriction=false) {
  const state={own:false,canSend:true,side,holdHistory:undefined as undefined|((route:Route)=>Promise<void>),holdInquiry:undefined as undefined|((route:Route)=>Promise<void>),send:undefined as undefined|((route:Route)=>Promise<void>),inquiryDenied:false};
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path==='/api/session')return route.fulfill({json:{authenticated:true,participationAllowed:true,csrfToken:'synthetic'}});
    if(path.startsWith('/api/public/listings/'))return route.fulfill({json:listing});
    if(path.endsWith('/contact-safety'))return route.fulfill({json:{can_contact:state.canSend&&!state.own&&!otherRestriction,can_block:!state.own,own_block:state.own?{...block,subject_kind:side==='PROVIDER'?'USER':'PROVIDER_ACCOUNT'}:null}});
    if(path.endsWith('/block')||path.endsWith('/block-provider')){
      expect(route.request().headers()['x-csrf-token']).toBe('synthetic');expect(route.request().headers()['idempotency-key']).toMatch(/^[\da-f-]{36}$/);expect(route.request().postDataJSON()).toEqual({});state.own=true;state.canSend=false;return route.fulfill({status:201,json:{...block,subject_kind:side==='PROVIDER'?'USER':'PROVIDER_ACCOUNT'}});
    }
    if(path.endsWith('/unblock')){expect(route.request().postDataJSON()).toEqual({expected_version:1});state.own=false;state.canSend=!otherRestriction;return route.fulfill({status:201,json:{...block,state:'REVOKED',version:2,revoked_at:block.created_at}});}
    if(path==='/api/account/blocks')return route.fulfill({json:{items:state.own?[block]:[],next_cursor:null}});
    if(path.endsWith('/inquiry')){if(state.holdInquiry){const respond=state.holdInquiry;state.holdInquiry=undefined;return respond(route);}return route.fulfill({status:state.inquiryDenied?403:201,json:state.inquiryDenied?{message:'Contact is not available'}:context});}
    if(path.endsWith('/messages')){
      if(method==='POST'){if(state.send)return state.send(route);return route.fulfill({status:403,json:{message:'Unavailable'}});}
      if(state.holdHistory){const respond=state.holdHistory;state.holdHistory=undefined;return respond(route);}
      return route.fulfill({json:{items:[message],next_cursor:null,can_send:state.canSend,actor_side:side}});
    }
    if(path===`/api/account/interactions/${ids.interaction}`)return route.fulfill({json:context});
    throw Error(`Unexpected synthetic safety route: ${path}`);
  });
  return state;
}
function barrier() {
  let release!:()=>void;let started!:()=>void;const arrived=new Promise<void>(r=>{started=r;});const pending=new Promise<void>(r=>{release=r;});
  return {arrived,release,async respond(route:Route,json:unknown){started();await pending;await route.fulfill({json});}};
}
for(const side of ['SEEKER','PROVIDER'])test(`${side} blocks conversation contact, preserves history and safely unblocks`,async({page})=>{
  await fixture(page,side);await page.goto(`/conversations/${ids.interaction}`);await expect(page.getByLabel('Message',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Block contact',exact:true}).click();await expect(page.getByRole('button',{name:'Unblock contact',exact:true})).toBeVisible();
  await expect(page.getByLabel('Message',{exact:true})).toHaveCount(0);await expect(page.getByText(message.body,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Unblock contact',exact:true}).click();await expect(page.getByLabel('Message',{exact:true})).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/Bearer|blocked_by|\+237|blocked_user_id/);expect(page.url()).not.toMatch(/token|target|user_id/);
});
test('unblock leaves reciprocal or independent restrictions unavailable generically',async({page})=>{
  const state=await fixture(page,'SEEKER',true);state.own=true;state.canSend=false;
  await page.goto(`/conversations/${ids.interaction}`);await page.getByRole('button',{name:'Unblock contact',exact:true}).click();
  await expect(page.getByRole('button',{name:'Block contact',exact:true})).toBeVisible();await expect(page.getByLabel('Message',{exact:true})).toHaveCount(0);await expect(page.getByText(message.body,{exact:true})).toBeVisible();
  await expect(page.getByText('Messaging is not available. You can still view the history.',{exact:true})).toBeVisible();
});
test('delayed history cannot restore composer after a committed block',async({page})=>{
  const state=await fixture(page);await page.goto(`/conversations/${ids.interaction}`);await expect(page.getByLabel('Message',{exact:true})).toBeVisible();
  const hold=barrier();state.holdHistory=route=>hold.respond(route,{items:[message],next_cursor:null,can_send:true,actor_side:'SEEKER'});
  await page.getByRole('button',{name:'Refresh conversation',exact:true}).click();await hold.arrived;
  await page.getByRole('button',{name:'Block contact',exact:true}).click();await expect(page.getByRole('button',{name:'Unblock contact',exact:true})).toBeVisible();hold.release();
  await expect(page.getByLabel('Message',{exact:true})).toHaveCount(0);await expect(page.getByText(message.body,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Refresh conversation',exact:true}).click();await expect(page.getByLabel('Message',{exact:true})).toHaveCount(0);
});
test('ambiguous persisted-message confirmation retains the exact client ID after blocking',async({page})=>{
  const state=await fixture(page);let first:string|undefined;let calls=0;
  state.send=async route=>{calls++;const input=route.request().postDataJSON() as {client_message_id:string;body:string};if(!first){first=input.client_message_id;return route.abort('failed');}expect(input.client_message_id).toBe(first);return route.fulfill({json:{message:{...message,client_message_id:first,body:input.body},created:false}});};
  await page.goto(`/conversations/${ids.interaction}`);await page.getByLabel('Message',{exact:true}).fill('Ambiguous committed send');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByText(/The message was not confirmed/)).toBeVisible();await page.getByRole('button',{name:'Block contact',exact:true}).click();
  await page.getByRole('button',{name:'Confirm pending message',exact:true}).click();await expect(page.getByText('Ambiguous committed send',{exact:true})).toBeVisible();expect(calls).toBe(2);await expect(page.getByLabel('Message',{exact:true})).toHaveCount(0);
});
test('blocked listing inquiry receives generic feedback instead of false phone instructions',async({page})=>{
  const state=await fixture(page);state.inquiryDenied=true;await page.goto(`/listings/${ids.listing}`);await page.getByRole('button',{name:'Contact provider',exact:true}).click();
  await expect(page.getByText('Contact is not available for this listing.',{exact:true})).toBeVisible();await expect(page.getByText(/phone verification|verify your phone/i)).toHaveCount(0);
  await page.getByRole('button',{name:'Block provider',exact:true}).click();await expect(page.getByRole('button',{name:'Contact provider',exact:true})).toBeDisabled();
});
test('late inquiry response cannot navigate or restore contact after listing block',async({page})=>{
  const state=await fixture(page);const hold=barrier();state.holdInquiry=route=>hold.respond(route,context);await page.goto(`/listings/${ids.listing}`);
  await page.getByRole('button',{name:'Contact provider',exact:true}).click();await hold.arrived;await page.getByRole('button',{name:'Block provider',exact:true}).click();
  await expect(page.getByRole('button',{name:'Unblock contact',exact:true})).toBeVisible();hold.release();await expect(page.getByRole('button',{name:'Contact provider',exact:true})).toBeDisabled();await expect(page).toHaveURL(new RegExp(`/listings/${ids.listing}$`));
});
test('own block manager unblocks after source listing and interaction disappear, without participation',async({page})=>{
  const state=await fixture(page);state.own=true;state.canSend=false;
  await page.route('**/api/session',route=>route.fulfill({json:{authenticated:true,participationAllowed:false,accountState:'LIMITED',csrfToken:'synthetic'}}));
  await page.route('**/api/public/listings/**',route=>route.fulfill({status:404,json:{}}));
  await page.goto('/blocks');await page.getByRole('button',{name:'Unblock contact',exact:true}).click();await expect(page.getByText(/Your block was removed/)).toBeVisible();await expect(page.getByRole('button',{name:'Unblock contact',exact:true})).toHaveCount(0);expect(state.own).toBe(false);
});
test('delayed own-block refresh cannot restore an episode after confirmed unblock',async({page})=>{
  const state=await fixture(page);state.own=true;
  const hold=barrier();let delayed=false;
  await page.route('**/api/account/blocks',route=>delayed?hold.respond(route,{items:[block],next_cursor:null}):route.fallback());
  await page.goto('/blocks');await expect(page.getByRole('button',{name:'Unblock contact',exact:true})).toBeVisible();
  delayed=true;await page.getByRole('button',{name:'Refresh blocks',exact:true}).click();await hold.arrived;
  await page.getByRole('button',{name:'Unblock contact',exact:true}).click();await expect(page.getByText(/Your block was removed/)).toBeVisible();
  const completed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/blocks');
  hold.release();await (await completed).finished();
  // The barrier establishes commit order; allow the released old response's
  // render work to settle before asserting it cannot revive the owned episode.
  await page.waitForTimeout(150);
  await expect(page.getByRole('button',{name:'Unblock contact',exact:true})).toHaveCount(0);
  await expect(page.getByText(/Provider contact · Removed/)).toBeVisible();
});
