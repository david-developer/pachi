import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from './client.js';
import { AuthorityRiskStore, readAuthorityRisk } from './authority-risk.js';
import { PropertyDraftStore } from './property.js';
import { ListingSubmissionStore } from './listing-submission.js';
import type { StaffPrincipal } from './staff.js';
import type { StaffScope } from './staff-policy.js';

if (!process.env.DATABASE_TEST_URL && process.env.CI==='true') throw new Error('DATABASE_TEST_URL is required');
const integration=process.env.DATABASE_TEST_URL?test:test.skip;
void integration('internal authority risk evaluation, scoped decisions and lineage fail closed',async()=>{
  const url=process.env.DATABASE_TEST_URL!;
  const parsed=new URL(url);
  assert.equal(`${parsed.hostname}:${parsed.port}${parsed.pathname}`,'localhost:5433/pachi_test');
  const {client}=createDatabase(url);
  const store=new AuthorityRiskStore(client);
  const properties=new PropertyDraftStore(client);
  const submissions=new ListingSubmissionStore(client);
  const principal=(userId:string,scope:StaffScope,authenticatedAt=new Date(),role='TRUST_SAFETY_MODERATOR')=>({row:{user_id:userId,authenticated_at:authenticatedAt},grants:[{role,scope}]} as unknown as StaffPrincipal);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const users=await client<{id:string}[]>`INSERT INTO users(account_state) VALUES ('ACTIVE'),('ACTIVE'),('ACTIVE'),('ACTIVE') RETURNING id`;
    const [owner,moderator,other,admin]=users;
    assert.ok(owner&&moderator&&other&&admin);
    for(const [id,phone] of [[owner.id,'+237690002001'],[other.id,'+237690002002']] as const) await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${id},${phone},now(),1)`;
    const profile=await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name) VALUES (${owner.id},ARRAY['OWNER'],'Authority fixture') RETURNING id`;
    const account=await client<{id:string}[]>`INSERT INTO provider_accounts(provider_profile_id) VALUES (${profile[0]!.id}) RETURNING id`;
    const otherProfile=await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name) VALUES (${other.id},ARRAY['OWNER'],'Other fixture') RETURNING id`;
    const otherAccount=await client<{id:string}[]>`INSERT INTO provider_accounts(provider_profile_id) VALUES (${otherProfile[0]!.id}) RETURNING id`;
    const home=await properties.createProperty(owner.id,{propertyType:'HOUSE',region:'Littoral',city:'Douala',neighborhood:'Akwa',bedrooms:2,relationshipType:'OWNER'});
    const draft=await properties.createDraft(owner.id,{propertyId:home.id,purpose:'RENT',title:'Authority fixture',description:'A synthetic property draft',amountMinor:100000,availableFrom:'2026-10-01'});
    assert.equal((await submissions.readiness(owner.id,draft.id)).checks.find(c=>c.code==='PROPERTY_RISK_HOLD_EVALUATION_UNAVAILABLE')?.status,'BLOCKED');
    const clear=await store.evaluate(home.relationshipId);
    assert.equal(clear.outcome,'CLEAR');
    assert.equal((await store.evaluate(home.relationshipId) as {id:string}).id,(clear as {id:string}).id);
    assert.equal((await submissions.readiness(owner.id,draft.id)).checks.find(c=>c.code==='PROPERTY_RISK_HOLD_EVALUATION_UNAVAILABLE')?.status,'READY');
    assert.equal((await submissions.readiness(owner.id,draft.id)).canSubmit,false);
    assert.equal((await submissions.readiness(owner.id,draft.id)).checks.find(c=>c.code==='PROVIDER_IDENTITY_VERIFICATION_UNAVAILABLE')?.status,'BLOCKED');
    await assert.rejects(store.evaluateOwned(other.id,draft.id),{code:'RESOURCE_SCOPE_DENIED'});

    const caseId=randomUUID();
    const scope={kind:'case' as const,id:caseId,property_id:home.id,permissions:['authority:risk_decide']};
    const grant=await client<{id:string}[]>`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${moderator.id},'TRUST_SAFETY_MODERATOR',${JSON.stringify(scope)}::jsonb,now()+interval '1 day','test','isolated authority case') RETURNING id`;
    const evidenceGrant=await client<{id:string}[]>`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${moderator.id},'TRUST_SAFETY_MODERATOR',${JSON.stringify({kind:'case',id:caseId,permissions:['evidence:read']})}::jsonb,now()+interval '1 day','test','isolated internal source review') RETURNING id`;
    const staff=principal(moderator.id,scope);
    const input={id:caseId,propertyId:home.id,relationshipId:home.relationshipId,subjectScope:'RELATIONSHIP' as const,triggerKind:'REPRESENTATION' as const,allegationKind:'REPORTED' as const,provenance:'THIRD_PARTY_REPORT' as const,reasonCode:'STRUCTURED_REFERENCE_CONFLICT',requestId:randomUUID()};
    await assert.rejects(store.openCase(principal(admin.id,{kind:'platform',id:'pachi',permissions:['admin:permissions_manage']},new Date(),'SUPER_ADMIN'),input),{code:'RESOURCE_SCOPE_DENIED'});
    await assert.rejects(store.openCase(principal(moderator.id,{...scope,property_id:randomUUID()}),input),{code:'RESOURCE_SCOPE_DENIED'});
    await assert.rejects(store.openCase(principal(moderator.id,scope,new Date(Date.now()-16*60_000)),input),{code:'STEP_UP_REQUIRED'});
    await assert.rejects(store.openCase(principal(owner.id,scope),input),{code:'RESOURCE_SCOPE_DENIED'});
    const opened=await store.openCase(staff,input);
    assert.equal(opened.allegation_kind,'REPORTED');
    assert.equal(opened.state,'OPEN');
    await assert.rejects(client`UPDATE authority_risk_cases SET subject_scope='PRINCIPAL',principal_id=${account[0]!.id},version=version+1 WHERE id=${caseId}`,/authority risk case transition denied/);
    await assert.rejects(client`UPDATE authority_risk_case_actions SET reason_code='ERASED' WHERE case_id=${caseId}`,/append-only/);
    assert.equal((await readAuthorityRisk(client,home.relationshipId,account[0]!.id)).status,'STALE');
    const hold=await store.evaluate(home.relationshipId);
    assert.equal(hold.outcome,'HOLD');
    assert.equal((hold as {applicable_case_ids:string[]}).applicable_case_ids.includes(caseId),true);
    assert.equal((await submissions.readiness(owner.id,draft.id)).checks.find(c=>c.code==='PROPERTY_RISK_HOLD_EVALUATION_UNAVAILABLE')?.status,'BLOCKED');
    await assert.rejects(store.decide(staff,caseId,{expectedVersion:1,outcome:'REVIEW_SOURCE',reasonCode:'SOURCE_SUPPORTS_DISPROOF',evidenceRefType:'PROPERTY',evidenceRefId:home.id,requestId:randomUUID()}),{code:'EVIDENCE_INCOMPLETE'});
    await client`UPDATE staff_grants SET revoked_at=now() WHERE id=${evidenceGrant[0]!.id}`;
    await assert.rejects(store.decide(staff,caseId,{expectedVersion:1,outcome:'REVIEW_SOURCE',reasonCode:'SOURCE_SUPPORTS_DISPROOF',evidenceRefType:'RELATIONSHIP',evidenceRefId:home.relationshipId,requestId:randomUUID()}),{code:'RESOURCE_SCOPE_DENIED'});
    await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${moderator.id},'TRUST_SAFETY_MODERATOR',${JSON.stringify({kind:'case',id:caseId,permissions:['evidence:read']})}::jsonb,now()+interval '1 day','test','isolated internal source review restored')`;
    const reviewInput={expectedVersion:1,outcome:'REVIEW_SOURCE' as const,reasonCode:'SOURCE_SUPPORTS_DISPROOF',evidenceRefType:'RELATIONSHIP' as const,evidenceRefId:home.relationshipId,requestId:randomUUID()};
    const reviewed=await store.decide(staff,caseId,reviewInput);
    assert.ok(reviewed.source_review_action_id);
    assert.equal((await store.decide(staff,caseId,reviewInput)).version,reviewed.version);
    const decisions=await Promise.allSettled([0,1].map(()=>store.decide(staff,caseId,{expectedVersion:2,outcome:'RESOLVE',reasonCode:'TRIGGER_DISPROVED',evidenceRefType:'CASE_ACTION',evidenceRefId:reviewed.source_review_action_id!,requestId:randomUUID()})));
    assert.deepEqual(decisions.map(x=>x.status).sort(),['fulfilled','rejected']);
    assert.equal((await readAuthorityRisk(client,home.relationshipId,account[0]!.id)).status,'STALE');
    assert.equal((await store.evaluate(home.relationshipId)).outcome,'CLEAR');
    assert.equal((await client`SELECT count(*)::int AS count FROM authority_risk_case_actions WHERE case_id=${caseId}`)[0]?.count,3);
    assert.equal((await client`SELECT count(*)::int AS count FROM audit_events WHERE target_id=${caseId} AND action IN ('AUTHORITY_RISK_CASE_OPENED','AUTHORITY_RISK_CASE_DECIDED')`)[0]?.count,3);

    // A principal-specific finding must not accuse a different principal on the same property.
    const secondCase=randomUUID();
    const secondScope={...scope,id:secondCase};
    await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${moderator.id},'TRUST_SAFETY_MODERATOR',${JSON.stringify(secondScope)}::jsonb,now()+interval '1 day','test','isolated principal case')`;
    await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${moderator.id},'TRUST_SAFETY_MODERATOR',${JSON.stringify({kind:'case',id:secondCase,permissions:['evidence:read']})}::jsonb,now()+interval '1 day','test','isolated principal source review')`;
    await store.openCase(principal(moderator.id,secondScope),{...input,id:secondCase,subjectScope:'PRINCIPAL',principalId:account[0]!.id,triggerKind:'REPRESENTATION',provenance:'STAFF_OBSERVATION',reasonCode:'STRUCTURED_REFERENCE_CONFLICT',requestId:randomUUID()});
    const principalSource=await store.decide(principal(moderator.id,secondScope),secondCase,{expectedVersion:1,outcome:'REVIEW_SOURCE',reasonCode:'SOURCE_SUPPORTS_FINDING',evidenceRefType:'RELATIONSHIP',evidenceRefId:home.relationshipId,requestId:randomUUID()});
    const confirmed=await store.decide(principal(moderator.id,secondScope),secondCase,{expectedVersion:2,outcome:'CONFIRM',reasonCode:'FINDING_CONFIRMED',evidenceRefType:'CASE_ACTION',evidenceRefId:principalSource.source_review_action_id!,requestId:randomUUID()});
    assert.equal(confirmed.allegation_kind,'ESTABLISHED');
    const otherRelation=await client<{id:string}[]>`INSERT INTO provider_property_relationships(property_id,provider_account_id,relationship_type) VALUES (${home.id},${otherAccount[0]!.id},'OWNER') RETURNING id`;
    assert.equal((await store.evaluate(otherRelation[0]!.id)).outcome,'CLEAR');
    assert.equal((await store.evaluate(home.relationshipId)).outcome,'HOLD');
    await client`UPDATE provider_property_relationships SET relationship_type='PROPERTY_MANAGER' WHERE id=${home.relationshipId}`;
    assert.equal((await readAuthorityRisk(client,home.relationshipId,account[0]!.id)).status,'STALE');

    // A property-scoped finding follows an immutable merge to its canonical successor.
    const canonical=await properties.createProperty(other.id,{propertyType:'HOUSE',region:'Littoral',city:'Douala',neighborhood:'Bonanjo',bedrooms:3,relationshipType:'OWNER'});
    await client`UPDATE properties SET record_state='MERGED' WHERE id=${home.id}`;
    assert.equal((await store.evaluate(canonical.relationshipId)).outcome,'INCOMPLETE');
    const merge=await client<{id:string}[]>`INSERT INTO property_merges(source_property_id,canonical_property_id,reason_code) VALUES (${home.id},${canonical.id},'DUPLICATE_ASSET') RETURNING id`;
    assert.equal((await store.evaluate(canonical.relationshipId)).outcome,'CLEAR');
    const thirdCase=randomUUID(); const thirdScope={...scope,id:thirdCase};
    await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${moderator.id},'TRUST_SAFETY_MODERATOR',${JSON.stringify(thirdScope)}::jsonb,now()+interval '1 day','test','isolated merged property case')`;
    await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${moderator.id},'TRUST_SAFETY_MODERATOR',${JSON.stringify({kind:'case',id:thirdCase,permissions:['evidence:read']})}::jsonb,now()+interval '1 day','test','isolated merged source review')`;
    await store.openCase(principal(moderator.id,thirdScope),{...input,id:thirdCase,relationshipId:null,subjectScope:'PROPERTY',triggerKind:'DISPUTE',reasonCode:'DISPUTED_CONTROL',requestId:randomUUID()});
    assert.equal((await store.evaluate(canonical.relationshipId)).outcome,'HOLD');
    await assert.rejects(store.decide(principal(moderator.id,thirdScope),thirdCase,{expectedVersion:1,outcome:'REVIEW_SOURCE',reasonCode:'SOURCE_SUPPORTS_DISPROOF',evidenceRefType:'PROPERTY',evidenceRefId:home.id,requestId:randomUUID()}),{code:'EVIDENCE_INCOMPLETE'});
    assert.equal((await readAuthorityRisk(client,canonical.relationshipId,otherAccount[0]!.id)).status,'HOLD');
    await assert.rejects(client`INSERT INTO property_merges(source_property_id,canonical_property_id,reason_code) VALUES (${canonical.id},${home.id},'INVALID_CYCLE')`,/property merge cycle/);
    assert.equal((await client`SELECT count(*)::int AS count FROM property_merges WHERE id=${merge[0]!.id}`)[0]?.count,1);

    // An adverse status with no decision history is recorded as legacy provenance.
    await client`UPDATE provider_property_relationships SET authorization_status='REJECTED' WHERE id=${canonical.relationshipId}`;
    const legacy=await client<{id:string;source_provenance:string;assigned_staff_user_id:string|null}[]>`SELECT id,source_provenance,assigned_staff_user_id FROM authority_risk_cases WHERE relationship_id=${canonical.relationshipId} AND trigger_kind='ADVERSE' ORDER BY observed_at DESC LIMIT 1`;
    assert.equal(legacy[0]?.source_provenance,'LEGACY_STATUS'); assert.equal(legacy[0]?.assigned_staff_user_id,null);
    const legacyScope={kind:'case' as const,id:legacy[0]!.id,property_id:canonical.id,permissions:['authority:risk_decide']};
    await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${moderator.id},'TRUST_SAFETY_MODERATOR',${JSON.stringify(legacyScope)}::jsonb,now()+interval '1 day','test','isolated legacy review')`;
    await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${moderator.id},'TRUST_SAFETY_MODERATOR',${JSON.stringify({kind:'case',id:legacy[0]!.id,permissions:['evidence:read']})}::jsonb,now()+interval '1 day','test','isolated legacy source review')`;
    await assert.rejects(store.case(principal(moderator.id,legacyScope),legacy[0]!.id),{code:'RESOURCE_SCOPE_DENIED'});
    const claimed=await store.claimLegacyCase(principal(moderator.id,legacyScope),legacy[0]!.id,1,randomUUID());
    assert.equal(claimed.version,2);
    await client`UPDATE provider_property_relationships SET authorization_status='DECLARED' WHERE id=${canonical.relationshipId}`;
    assert.equal((await store.evaluate(canonical.relationshipId)).outcome,'HOLD');
    await assert.rejects(store.decide(principal(moderator.id,legacyScope),legacy[0]!.id,{expectedVersion:2,outcome:'REVIEW_SOURCE',reasonCode:'SOURCE_SUPPORTS_DISPROOF',evidenceRefType:'PROPERTY',evidenceRefId:canonical.id,requestId:randomUUID()}),{code:'EVIDENCE_INCOMPLETE'});
    assert.equal((await store.evaluate(canonical.relationshipId)).outcome,'HOLD'); // merged-property dispute remains

    // Direct source mutation racing evaluation cannot leave an effective stale CLEAR.
    const isolated=await properties.createProperty(other.id,{propertyType:'ROOM',region:'Littoral',city:'Douala',neighborhood:'Deido',relationshipType:'OWNER'});
    await store.evaluate(isolated.relationshipId);
    const fourthCase=randomUUID(); const fourthScope={kind:'case' as const,id:fourthCase,property_id:isolated.id,permissions:['authority:risk_decide']};
    await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${moderator.id},'TRUST_SAFETY_MODERATOR',${JSON.stringify(fourthScope)}::jsonb,now()+interval '1 day','test','isolated race')`;
    await Promise.all([store.evaluate(isolated.relationshipId),store.openCase(principal(moderator.id,fourthScope),{...input,id:fourthCase,propertyId:isolated.id,relationshipId:null,subjectScope:'PROPERTY',triggerKind:'DISPUTE',reasonCode:'DISPUTED_CONTROL',requestId:randomUUID()})]);
    assert.notEqual((await readAuthorityRisk(client,isolated.relationshipId,otherAccount[0]!.id)).status,'CLEAR');
    assert.equal((await store.evaluate(isolated.relationshipId)).outcome,'HOLD');
    await client`DELETE FROM authority_risk_source_clock WHERE singleton`;
    assert.equal((await readAuthorityRisk(client,isolated.relationshipId,otherAccount[0]!.id)).status,'INCOMPLETE');
    assert.equal((await store.evaluate(isolated.relationshipId)).outcome,'INCOMPLETE');
    await client`INSERT INTO authority_risk_source_clock(singleton,version) VALUES (true,1000000)`;
    await client`UPDATE staff_grants SET revoked_at=now() WHERE id=${grant[0]!.id}`;
    await assert.rejects(store.case(staff,caseId),{code:'RESOURCE_SCOPE_DENIED'});
  } finally {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});
