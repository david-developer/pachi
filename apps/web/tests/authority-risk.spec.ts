import { expect, test } from '@playwright/test';

test('synthetic provider requests a scoped system evaluation and still sees independent blockers', async ({page})=>{
  let evaluated=false;
  const draft={id:'synthetic-draft',property_id:'synthetic-property',title:'Synthetic authority draft',purpose:'RENT',description:'Sample draft',amount_minor:1000,pricing_period:'MONTHLY',currency:'XAF',publication_status:'DRAFT',moderation_status:'NOT_REVIEWED',version:1,utilities_included:null};
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/session') return route.fulfill({json:{authenticated:true,participationAllowed:true,accountState:'ACTIVE',csrfToken:'synthetic-csrf'}});
    if(path==='/api/account/provider/verification') return route.fulfill({json:{case:null,synthetic_intake_available:false}});
    if(path==='/api/account/properties') return route.fulfill({json:{properties:[{id:draft.property_id,version:1,property_type:'HOUSE',region:'Littoral',city:'Synthetic city',neighborhood:'Synthetic area',relationship_type:'OWNER',bedrooms:2,bathrooms:null,size_sqm:null,furnishing:null}]}});
    if(path==='/api/account/listing-drafts') return route.fulfill({json:{drafts:[draft]}});
    if(path===`/api/account/listing-drafts/${draft.id}`) return route.fulfill({json:draft});
    if(path===`/api/account/listing-drafts/${draft.id}/media`) return route.fulfill({json:{media:[]}});
    if(path===`/api/account/listing-drafts/${draft.id}/authority-risk/evaluate`){
      expect(route.request().method()).toBe('POST'); expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf'); evaluated=true;
      return route.fulfill({json:{status:'CLEAR',next_action:'No authority risk action is required under the evaluated internal rules.',evaluation_id:'synthetic-evaluation'}});
    }
    if(path===`/api/account/listing-drafts/${draft.id}/readiness`) return route.fulfill({json:{publication_status:'DRAFT',moderation_status:'NOT_REVIEWED',can_submit:false,checks:[
      {code:'PROPERTY_RISK_HOLD_EVALUATION_UNAVAILABLE',label:'Authority risk-hold evaluation',status:evaluated?'READY':'BLOCKED',message:evaluated?null:'Request a fresh authority risk evaluation.'},
      {code:'PROVIDER_NOT_ACTIVE',label:'Provider profile',status:'BLOCKED',message:'Provider not active.'},
      {code:'PROVIDER_IDENTITY_VERIFICATION_UNAVAILABLE',label:'Provider identity verification',status:'BLOCKED',message:'Verification unavailable.'},
    ]}});
    throw new Error(`Unexpected synthetic route: ${path}`);
  });
  await page.goto('/provider');
  await page.getByRole('button',{name:/Synthetic authority draft/}).click();
  const checks=page.locator('.readinessList li');
  await expect(checks.filter({hasText:'Authority risk-hold evaluation'})).toHaveClass(/readinessBlocked/);
  await page.getByRole('button',{name:'Request authority risk evaluation'}).click();
  await expect(checks.filter({hasText:'Authority risk-hold evaluation'})).toHaveClass(/readinessReady/);
  await expect(checks.filter({hasText:'Provider profile'})).toHaveClass(/readinessBlocked/);
  await expect(checks.filter({hasText:'Provider identity verification'})).toHaveClass(/readinessBlocked/);
  await expect(page.getByRole('button',{name:'Submit for review'})).toBeDisabled();
  expect(evaluated).toBe(true);
});
