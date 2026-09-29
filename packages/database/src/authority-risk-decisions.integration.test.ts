import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createDatabase} from './client.js';
import {AuthorityRiskStore, readAuthorityRisk, type AuthorityRiskCaseInput, type AuthorityRiskDecisionInput} from './authority-risk.js';
import {PropertyDraftStore} from './property.js';
import {StaffStore, type StaffPrincipal} from './staff.js';
import type {VerifiedTokenClaims} from './identity.js';
import type {StaffScope} from './staff-policy.js';

if (!process.env.DATABASE_TEST_URL && process.env.CI==='true') throw new Error('DATABASE_TEST_URL is required');
const integration=process.env.DATABASE_TEST_URL?test:test.skip;

void integration('structured representation source supports scoped confirmation and disproof',async()=>{
  const url=process.env.DATABASE_TEST_URL!;
  const target=new URL(url);
  assert.equal(`${target.hostname}:${target.port}${target.pathname}`,'localhost:5433/pachi_test');
  const {client}=createDatabase(url);
  const store=new AuthorityRiskStore(client);
  const properties=new PropertyDraftStore(client);
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const users=await client<{id:string}[]>`INSERT INTO users(account_state) VALUES ('ACTIVE'),('ACTIVE'),('ACTIVE'),('ACTIVE') RETURNING id`;
    const [owner,moderator,other,secondModerator]=users;
    assert.ok(owner&&moderator&&other&&secondModerator);
    const moderatorId=moderator.id;
    for(const [userId,phone] of [[owner.id,'+237690003001'],[other.id,'+237690003002']] as const)
      await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${userId},${phone},now(),1)`;
    const profile=await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name) VALUES (${owner.id},ARRAY['OWNER'],'Source owner fixture') RETURNING id`;
    const account=await client<{id:string}[]>`INSERT INTO provider_accounts(provider_profile_id) VALUES (${profile[0]!.id}) RETURNING id`;
    const otherProfile=await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name) VALUES (${other.id},ARRAY['OWNER'],'Other source fixture') RETURNING id`;
    const otherAccount=await client<{id:string}[]>`INSERT INTO provider_accounts(provider_profile_id) VALUES (${otherProfile[0]!.id}) RETURNING id`;
    const property=await properties.createProperty(owner.id,{propertyType:'HOUSE',region:'Littoral',city:'Douala',neighborhood:'Akwa',relationshipType:'OWNER'});
    const draft=await properties.createDraft(owner.id,{propertyId:property.id,purpose:'RENT',title:'Synthetic principal reference fixture'});
    const staffStore=new StaffStore(client,'synthetic-staff-encryption-secret-with-32-characters');
    async function session(userId:string) {
      const subject=randomUUID();
      await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${userId},'https://local.test/staff',${subject},'LOCAL_TEST')`;
      const now=new Date();
      const claims:VerifiedTokenClaims={issuer:'https://local.test/staff',subject,clientId:'staff',originJti:randomUUID(),jti:randomUUID(),expiresAt:new Date(+now+300_000),issuedAt:now,scopes:['pachi/staff'],provider:'LOCAL_TEST'};
      return staffStore.register(claims,now,'access','refresh');
    }
    async function grant(caseId:string,staffId=moderatorId,propertyId=property.id,permission='authority:risk_decide') {
      const scope={kind:'case' as const,id:caseId,property_id:propertyId,permissions:[permission]};
      const rows=await client<{id:string}[]>`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${staffId},'TRUST_SAFETY_MODERATOR',${JSON.stringify(scope)}::jsonb,now()+interval '1 day','test','isolated authority evidence grant') RETURNING id`;
      return {scope,id:rows[0]!.id};
    }
    const decision=(expectedVersion:number,outcome:AuthorityRiskDecisionInput['outcome'],reasonCode:string,evidenceRefType:AuthorityRiskDecisionInput['evidenceRefType'],evidenceRefId:string,requestId=randomUUID()):AuthorityRiskDecisionInput=>({expectedVersion,outcome,reasonCode,evidenceRefType,evidenceRefId,requestId});
    const caseInput=(id:string):AuthorityRiskCaseInput=>({id,propertyId:property.id,relationshipId:property.relationshipId,subjectScope:'RELATIONSHIP',triggerKind:'REPRESENTATION',allegationKind:'REPORTED',provenance:'STAFF_OBSERVATION',reasonCode:'LISTING_RELATIONSHIP_PRINCIPAL_CONFLICT',evidenceRefType:'LISTING',evidenceRefId:draft.id,requestId:randomUUID()});

    const firstCase=randomUUID();
    const firstGrant=await grant(firstCase);
    await grant(firstCase,secondModerator.id,property.id,'authority:risk_decide');
    const sessionId=await session(moderator.id);
    const otherSessionId=await session(secondModerator.id);
    const principal=(userId:string,scope:StaffScope,id=sessionId,authenticatedAt=new Date())=>({row:{id,user_id:userId,authenticated_at:authenticatedAt},grants:[{role:'TRUST_SAFETY_MODERATOR',scope}]} as unknown as StaffPrincipal);
    const firstStaff=principal(moderator.id,firstGrant.scope);
    await assert.rejects(store.openCase(principal(moderator.id,{...firstGrant.scope,property_id:randomUUID()}),caseInput(firstCase)),{code:'RESOURCE_SCOPE_DENIED'});
    await store.openCase(firstStaff,caseInput(firstCase));
    await assert.rejects(store.internalSource(firstStaff,firstCase,randomUUID()),{code:'RESOURCE_SCOPE_DENIED'});
    await grant(firstCase,moderator.id,randomUUID(),'evidence:read');
    await assert.rejects(store.internalSource(firstStaff,firstCase,randomUUID()),{code:'RESOURCE_SCOPE_DENIED'});
    const firstEvidence=await grant(firstCase,moderator.id,property.id,'evidence:read');
    await grant(firstCase,secondModerator.id,property.id,'evidence:read');
    await assert.rejects(store.internalSource(principal(secondModerator.id,firstGrant.scope,otherSessionId),firstCase,randomUUID()),{code:'RESOURCE_SCOPE_DENIED'});
    await assert.rejects(store.internalSource(principal(moderator.id,firstGrant.scope,sessionId,new Date(Date.now()-16*60_000)),firstCase,randomUUID()),{code:'STEP_UP_REQUIRED'});
    const laggedStore=new AuthorityRiskStore(client,()=>new Date(Date.now()-1000));
    const laggedStaff=principal(moderator.id,firstGrant.scope,sessionId,new Date(Date.now()-5000));
    assert.equal((await laggedStore.internalSource(laggedStaff,firstCase,randomUUID())).finding,'ABSENT');
    const source=await store.internalSource(firstStaff,firstCase,randomUUID());
    assert.equal(source.finding,'ABSENT');
    assert.equal(source.listing_provider_account_id,source.relationship_provider_account_id);
    await assert.rejects(store.decide(firstStaff,firstCase,decision(1,'REVIEW_SOURCE','SOURCE_SUPPORTS_FINDING','LISTING',draft.id)),{code:'EVIDENCE_INCOMPLETE'});
    await assert.rejects(store.decide(firstStaff,firstCase,decision(1,'CONFIRM','FINDING_CONFIRMED','CASE_ACTION',randomUUID())),{code:'EVIDENCE_INCOMPLETE'});
    const reviewInput=decision(1,'REVIEW_SOURCE','SOURCE_SUPPORTS_DISPROOF','LISTING',draft.id);
    const reviewed=await store.decide(firstStaff,firstCase,reviewInput);
    assert.equal(reviewed.version,2);
    assert.ok(reviewed.source_review_action_id);
    assert.deepEqual(await store.decide(firstStaff,firstCase,reviewInput),reviewed);
    await assert.rejects(store.decide(firstStaff,firstCase,{...reviewInput,reasonCode:'SOURCE_SUPPORTS_FINDING'}),{code:'STALE_VERSION'});
    assert.equal((await store.evaluate(property.relationshipId)).outcome,'HOLD');
    const resolved=await store.decide(firstStaff,firstCase,decision(2,'RESOLVE','TRIGGER_DISPROVED','CASE_ACTION',reviewed.source_review_action_id!));
    assert.equal(resolved.state,'RESOLVED');
    assert.equal((await readAuthorityRisk(client,property.relationshipId,account[0]!.id)).status,'CLEAR');
    assert.equal((await client`SELECT count(*)::int AS count FROM authority_risk_case_actions WHERE case_id=${firstCase}`)[0]?.count,3);

    const secondCase=randomUUID();
    const secondGrant=await grant(secondCase);
    await grant(secondCase,moderator.id,property.id,'evidence:read');
    const secondStaff=principal(moderator.id,secondGrant.scope);
    await store.openCase(secondStaff,caseInput(secondCase));
    await client`UPDATE listings SET provider_account_id=${otherAccount[0]!.id} WHERE id=${draft.id}`;
    const conflict=await store.internalSource(secondStaff,secondCase,randomUUID());
    assert.equal(conflict.finding,'PRESENT');
    const findingReview=await store.decide(secondStaff,secondCase,decision(1,'REVIEW_SOURCE','SOURCE_SUPPORTS_FINDING','LISTING',draft.id));
    const concurrent=await Promise.allSettled([0,1].map(()=>store.decide(secondStaff,secondCase,decision(2,'CONFIRM','FINDING_CONFIRMED','CASE_ACTION',findingReview.source_review_action_id!))));
    assert.deepEqual(concurrent.map(result=>result.status).sort(),['fulfilled','rejected']);
    const confirmed=await store.case(secondStaff,secondCase);
    assert.equal(confirmed.allegation_kind,'ESTABLISHED');
    assert.equal(confirmed.version,3);
    assert.equal((await readAuthorityRisk(client,property.relationshipId,account[0]!.id)).status,'HOLD');
    await client`UPDATE listings SET provider_account_id=${account[0]!.id} WHERE id=${draft.id}`;
    await assert.rejects(store.decide(secondStaff,secondCase,decision(3,'RESOLVE','TRIGGER_DISPROVED','CASE_ACTION',findingReview.source_review_action_id!)),{code:'STALE_VERSION'});
    const disproofReview=await store.decide(secondStaff,secondCase,decision(3,'REVIEW_SOURCE','SOURCE_SUPPORTS_DISPROOF','LISTING',draft.id));

    const otherHold=randomUUID();
    const otherGrant=await grant(otherHold);
    await grant(otherHold,moderator.id,property.id,'evidence:read');
    const otherStaff=principal(moderator.id,otherGrant.scope);
    await store.openCase(otherStaff,{...caseInput(otherHold),subjectScope:'PROPERTY',relationshipId:null,triggerKind:'DISPUTE',reasonCode:'DISPUTED_CONTROL',evidenceRefType:null,evidenceRefId:null});
    await assert.rejects(store.internalSource(otherStaff,otherHold,randomUUID()),{code:'EVIDENCE_INCOMPLETE'});
    await assert.rejects(store.decide(otherStaff,otherHold,decision(1,'REVIEW_SOURCE','SOURCE_SUPPORTS_DISPROOF','LISTING',draft.id)),{code:'EVIDENCE_INCOMPLETE'});
    await store.decide(secondStaff,secondCase,decision(4,'RESOLVE','TRIGGER_DISPROVED','CASE_ACTION',disproofReview.source_review_action_id!));
    assert.equal((await readAuthorityRisk(client,property.relationshipId,account[0]!.id)).status,'HOLD');
    assert.equal((await client`SELECT state FROM authority_risk_cases WHERE id=${otherHold}`)[0]?.state,'OPEN');
    const reviews=await client<{source_snapshot:unknown;actor_user_id:string;prior_version:number}[]>`SELECT source_snapshot,actor_user_id,prior_version FROM authority_risk_case_actions WHERE case_id=${secondCase} AND action='SOURCE_REVIEWED' ORDER BY recorded_at`;
    assert.equal(reviews.length,2);
    assert.ok(reviews.every(r=>r.source_snapshot && r.actor_user_id===moderator.id && r.prior_version>0));
    assert.equal((await client`SELECT count(*)::int AS count FROM audit_events WHERE target_id=${secondCase} AND action='AUTHORITY_RISK_CASE_DECIDED'`)[0]?.count,4);
    await client`UPDATE staff_grants SET revoked_at=now() WHERE id=${firstEvidence.id}`;
    await assert.rejects(store.internalSource(firstStaff,firstCase,randomUUID()),{code:'RESOURCE_SCOPE_DENIED'});
    await client`UPDATE staff_sessions SET revoked_at=now() WHERE id=${sessionId}`;
    await assert.rejects(store.case(secondStaff,secondCase),{code:'AUTH_REQUIRED'});
  } finally {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    await client.end();
  }
});
