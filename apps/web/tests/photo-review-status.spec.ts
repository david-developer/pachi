import { test, expect } from '@playwright/test';

test('synthetic provider photo status gives replacement action after a staff decision', async ({ page }) => {
  let status = 'NOT_REVIEWED';
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({json:{authenticated:true,participationAllowed:true,accountState:'ACTIVE',csrfToken:'synthetic'}});
    if (path === '/api/account/provider/verification') return route.fulfill({json:{case:null,synthetic_intake_available:false}});
    if (path === '/api/account/properties') return route.fulfill({json:{properties:[{id:'property',city:'Douala',neighborhood:'Akwa'}]}});
    if (path === '/api/account/listing-drafts') return route.fulfill({json:{drafts:[{id:'draft',property_id:'property',title:'Synthetic draft',purpose:'RENT',description:'Description',amount_minor:1000,pricing_period:'MONTHLY',currency:'XAF',publication_status:'DRAFT',version:1}]}});
    if (path.endsWith('/readiness')) return route.fulfill({json:{publication_status:'DRAFT',checks:[{code:'MEDIA_CONTENT_APPROVAL_REQUIRED',field:'media.approval',label:'Photo content approval',status:status==='APPROVED'?'READY':'BLOCKED',message:status==='APPROVED'?null:'Replace photos marked changes required.'}],can_submit:false}});
    if (path.endsWith('/media')) return route.fulfill({json:{media:[{id:'association',media_asset_id:'asset',status:'READY',review_status:status,review_reason_code:status==='CHANGES_REQUIRED'?'PRIVACY_EXPOSURE':null,next_action:status==='CHANGES_REQUIRED'?'REPLACE_PHOTO':'WAIT_FOR_REVIEW',display_order:0,is_cover:true,variants:[],width:8,height:6,size_bytes:128,failure_code:null,retryable:false}]}});
    if (path.includes('/variants/')) return route.fulfill({status:204});
    if (path.endsWith('/draft')) return route.fulfill({json:{id:'draft',property_id:'property',title:'Synthetic draft',purpose:'RENT',description:'Description',amount_minor:1000,pricing_period:'MONTHLY',currency:'XAF',publication_status:'DRAFT',version:1}});
    throw new Error(`Unexpected synthetic route: ${path}`);
  });
  await page.goto('/provider');
  await page.getByRole('button',{name:/Synthetic draft/}).click();
  await expect(page.getByText('Content review: not reviewed.',{exact:false})).toBeVisible();
  status = 'CHANGES_REQUIRED';
  await page.getByRole('button',{name:'Refresh status'}).click();
  await expect(page.getByText('Content review: changes required.',{exact:false})).toContainText('Next action: replace photo');
});
