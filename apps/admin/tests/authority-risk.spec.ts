import {expect,test} from '@playwright/test';

test('synthetic case-scoped moderator records an allegation and cannot make an unsupported decision',async({page})=>{
  const caseId='00000000-0000-4000-8000-000000000101';
  const propertyId='00000000-0000-4000-8000-000000000102';
  const relationshipId='00000000-0000-4000-8000-000000000104';
  let current:{id:string;property_id:string;relationship_id:string|null;principal_id:null;subject_scope:string;trigger_kind:string;allegation_kind:string;state:string;version:number;reason_code:string;safe_remediation:string;source_provenance:string;received_at:string;source_review_action_id:string|null} | null=null;
  await page.route('**/api/session',route=>route.fulfill({json:{csrf:'synthetic-csrf',session:{display_name:'Synthetic safety moderator',grants:[{role:'TRUST_SAFETY_MODERATOR',scope:{kind:'case',id:caseId,property_id:propertyId,permissions:['authority:risk_decide']},expires_at:new Date(Date.now()+3600_000).toISOString()}],absolute_expires_at:new Date(Date.now()+3600_000).toISOString(),idle_expires_at:new Date(Date.now()+1800_000).toISOString(),reauthentication_expires_at:new Date(Date.now()+900_000).toISOString()}}}));
  await page.route('**/api/authority-risk-cases**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/authority-risk-cases' && route.request().method()==='POST'){
      expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
      const payload=route.request().postDataJSON();
      expect(payload).toMatchObject({id:caseId,propertyId,relationshipId,subjectScope:'RELATIONSHIP',triggerKind:'REPRESENTATION',allegationKind:'REPORTED',provenance:'STAFF_OBSERVATION',reasonCode:'STRUCTURED_REFERENCE_CONFLICT'});
      current={id:caseId,property_id:propertyId,relationship_id:relationshipId,principal_id:null,subject_scope:'RELATIONSHIP',trigger_kind:'REPRESENTATION',allegation_kind:'REPORTED',state:'OPEN',version:1,reason_code:'STRUCTURED_REFERENCE_CONFLICT',safe_remediation:'Contact support for authority review.',source_provenance:'STAFF_OBSERVATION',received_at:new Date().toISOString(),source_review_action_id:null};
      return route.fulfill({status:201,json:current});
    }
    if(path===`/api/authority-risk-cases/${caseId}/decision`) throw new Error('Unsupported source decision must not be sent by staff UI');
    if(path===`/api/authority-risk-cases/${caseId}` && current) return route.fulfill({json:current});
    throw new Error(`Unexpected synthetic route: ${path}`);
  });
  await page.goto('/');
  const section=page.getByRole('region',{name:'Authority risk cases'});
  await section.getByLabel('Case ID').fill(caseId);
  await section.getByLabel('Property ID').fill(propertyId);
  await section.getByLabel('Relationship ID, if scoped').fill(relationshipId);
  await section.getByLabel('Subject scope').selectOption('RELATIONSHIP');
  await section.getByLabel('Trigger').selectOption('REPRESENTATION');
  await section.getByLabel('Reason code').fill('STRUCTURED_REFERENCE_CONFLICT');
  await section.getByRole('button',{name:'Record reported allegation'}).click();
  await expect(section.getByText(/REPRESENTATION · REPORTED · OPEN/)).toBeVisible();
  await expect(section.getByText(/Source review and hold resolution are unavailable/)).toBeVisible();
  await expect(section.getByRole('button',{name:'Record case decision'})).toBeDisabled();
});
