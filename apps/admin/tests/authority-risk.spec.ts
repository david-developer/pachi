import {expect,test} from '@playwright/test';

test('synthetic case-scoped moderator records an allegation and versioned decision',async({page})=>{
  const caseId='00000000-0000-4000-8000-000000000101';
  const propertyId='00000000-0000-4000-8000-000000000102';
  let current:{id:string;property_id:string;relationship_id:null;principal_id:null;subject_scope:string;trigger_kind:string;allegation_kind:string;state:string;version:number;reason_code:string;safe_remediation:string;source_provenance:string;received_at:string;source_review_action_id:string|null} | null=null;
  await page.route('**/api/session',route=>route.fulfill({json:{csrf:'synthetic-csrf',session:{display_name:'Synthetic safety moderator',grants:[{role:'TRUST_SAFETY_MODERATOR',scope:{kind:'case',id:caseId,property_id:propertyId,permissions:['authority:risk_decide']},expires_at:new Date(Date.now()+3600_000).toISOString()}],absolute_expires_at:new Date(Date.now()+3600_000).toISOString(),idle_expires_at:new Date(Date.now()+1800_000).toISOString(),reauthentication_expires_at:new Date(Date.now()+900_000).toISOString()}}}));
  await page.route('**/api/authority-risk-cases**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/authority-risk-cases' && route.request().method()==='POST'){
      expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
      const payload=route.request().postDataJSON();
      expect(payload).toMatchObject({id:caseId,propertyId,subjectScope:'PROPERTY',triggerKind:'DISPUTE',allegationKind:'REPORTED',provenance:'STAFF_OBSERVATION',reasonCode:'DISPUTED_CONTROL'});
      current={id:caseId,property_id:propertyId,relationship_id:null,principal_id:null,subject_scope:'PROPERTY',trigger_kind:'DISPUTE',allegation_kind:'REPORTED',state:'OPEN',version:1,reason_code:'DISPUTED_CONTROL',safe_remediation:'Contact support for authority review.',source_provenance:'STAFF_OBSERVATION',received_at:new Date().toISOString(),source_review_action_id:null};
      return route.fulfill({status:201,json:current});
    }
    if(path===`/api/authority-risk-cases/${caseId}/decision`){
      const payload=route.request().postDataJSON();
      expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
      if(payload.outcome==='REVIEW_SOURCE'){
        expect(payload).toMatchObject({expected_version:1,reason_code:'SOURCE_SUPPORTS_DISPROOF',evidence_ref_type:'PROPERTY',evidence_ref_id:propertyId});
        current={...current!,version:2,source_review_action_id:'00000000-0000-4000-8000-000000000103'};
        return route.fulfill({status:201,json:current});
      }
      expect(payload).toMatchObject({expected_version:2,outcome:'RESOLVE',reason_code:'TRIGGER_DISPROVED',evidence_ref_type:'CASE_ACTION',evidence_ref_id:'00000000-0000-4000-8000-000000000103'});
      current={...current!,state:'RESOLVED',version:3};
      return route.fulfill({status:201,json:current});
    }
    if(path===`/api/authority-risk-cases/${caseId}` && current) return route.fulfill({json:current});
    throw new Error(`Unexpected synthetic route: ${path}`);
  });
  await page.goto('/');
  const section=page.getByRole('region',{name:'Authority risk cases'});
  await section.getByLabel('Case ID').fill(caseId);
  await section.getByLabel('Property ID').fill(propertyId);
  await section.getByLabel('Reason code').fill('DISPUTED_CONTROL');
  await section.getByRole('button',{name:'Record allegation or finding'}).click();
  await expect(section.getByText(/DISPUTE · REPORTED · OPEN/)).toBeVisible();
  await section.getByLabel('Internal reference ID').fill(propertyId);
  await section.getByRole('button',{name:'Record case decision'}).click();
  await expect(section.getByRole('status')).toContainText('Internal source review recorded.');
  await section.getByLabel('Decision').selectOption('RESOLVE');
  await section.getByRole('button',{name:'Record case decision'}).click();
  await expect(section.getByText(/DISPUTE · REPORTED · RESOLVED/)).toBeVisible();
  await expect(section.getByRole('status')).toContainText('A fresh system evaluation is required.');
});
