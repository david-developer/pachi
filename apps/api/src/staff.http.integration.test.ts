import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { AuthorityRiskStore, createDatabase, StaffStore, ProviderVerificationStore, ListingPhotoReviewStore, PropertyDraftStore } from '@pachi/database';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { StaffController, StaffAuthService } from './staff.controller.js';
import { StaffVerificationController } from './staff-verification.controller.js';
import { StaffListingPhotoController } from './staff-listing-photo.controller.js';
import { StaffAuthorityRiskController } from './staff-authority-risk.controller.js';
const integration = process.env.DATABASE_TEST_URL ? test : test.skip;
void integration(
  'actual staff HTTP controller accepts only registered staff tokens and live grants',
  async () => {
    const url = process.env.DATABASE_TEST_URL!;
    const parsed = new URL(url);
    assert.equal(parsed.port, '5433');
    assert.equal(parsed.pathname, '/pachi_test');
    const { client } = createDatabase(url),
      { privateKey, publicKey } = await generateKeyPair('RS256');
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const verifier = new CognitoAccessTokenVerifier({
      issuer: 'https://local.test/staff',
      getKey: async () => publicKey,
      allowedClientIds: new Set(['staff']),
      requiredScopes: new Set(['pachi/staff']),
      provider: 'LOCAL_TEST',
      strictStaff: true,
    });
    const store = new StaffStore(client, 'synthetic-staff-secret-long-enough-for-encryption');
    const verificationStore = new ProviderVerificationStore(client,'synthetic-evidence-key-for-http-staff-test',true);
    @Module({
      controllers: [StaffController, StaffVerificationController, StaffListingPhotoController, StaffAuthorityRiskController],
      providers: [
        { provide: 'STAFF_AUTH_SERVICE', useValue: new StaffAuthService(store, verifier) },
        { provide: 'PROVIDER_VERIFICATION_STORE', useValue: verificationStore },
        { provide: 'LISTING_PHOTO_REVIEW_STORE', useValue: new ListingPhotoReviewStore(client) },
        { provide: 'AUTHORITY_RISK_STORE', useValue: new AuthorityRiskStore(client) },
        { provide: 'LOCAL_PRIVATE_MEDIA_STORAGE', useValue: { readVariant: async () => Buffer.from('synthetic-private-preview') } },
      ],
    })
    class TestApp {}
    const app = await NestFactory.create(TestApp, { logger: false });
    app.setGlobalPrefix('v1');
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    const base = `http://127.0.0.1:${address.port}/v1/staff/session`;
    try {
      const users = await client<{ id: string }[]>`INSERT INTO users DEFAULT VALUES RETURNING id`;
      const userId = users[0]!.id,
        subject = randomUUID(),
        family = randomUUID();
      await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${userId},'https://local.test/staff',${subject},'LOCAL_TEST')`;
      const token = async (extra: Record<string, unknown> = {}) =>
        new SignJWT({
          client_id: 'staff',
          origin_jti: family,
          jti: randomUUID(),
          token_use: 'access',
          scope: 'pachi/staff',
          ...extra,
        })
          .setProtectedHeader({ alg: 'RS256' })
          .setSubject(subject)
          .setIssuer('https://local.test/staff')
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
      const good = await token(),
        get = (t: string) => fetch(base, { headers: { authorization: `Bearer ${t}` } });
      const verifiableClaims = await verifier.verify(good);
      assert.equal((await get(good)).status, 401); // no registered MFA evidence
      // Signed, valid staff identity is mapped, but has no eligible grant.
      // This is distinct from an absent identity mapping or malformed token.
      await assert.rejects(
        () => store.register(verifiableClaims, new Date(), 'access', 'refresh'),
        /RESOURCE_SCOPE_DENIED/,
      );
      const grant = await store.provision({
        operator: 'test',
        userId,
        issuer: 'https://local.test/staff',
        subject,
        role: 'ANALYST',
        scope: { kind: 'platform', id: 'pachi', permissions: ['analytics:aggregate'] },
        reason: 'HTTP integration staff grant',
        expiresAt: new Date(Date.now() + 86400_000),
      });
      const id = await store.register(await verifier.verify(good), new Date(), 'access', 'refresh');
      const success = await get(good);
      assert.equal(success.status, 200);
      assert.ok(!JSON.stringify(await success.json()).includes(subject));
      const applicantRows=await client<{id:string}[]>`INSERT INTO users(account_state) VALUES ('ACTIVE') RETURNING id`;
      const applicant=applicantRows[0]!.id;
      await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${applicant},'+237690000991',now(),1)`;
      const profile=await client<{id:string}[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name) VALUES (${applicant},ARRAY['OWNER'],'Staff HTTP Synthetic') RETURNING id`;
      await client`INSERT INTO provider_accounts(provider_profile_id) VALUES (${profile[0]!.id})`;
      const caseRecord=await verificationStore.submit(applicant,{idempotencyKey:`http_${randomUUID()}`,capacity:'OWNER',governmentId:'PACHI_SYNTHETIC_GOVERNMENT_ID_V1',liveSelfie:'PACHI_SYNTHETIC_LIVE_SELFIE_V1',requestId:randomUUID(),syntheticEnabled:true});
      const caseUrl=`http://127.0.0.1:${address.port}/v1/staff/verification-cases/${caseRecord.id}`;
      const caseGet=()=>fetch(caseUrl,{headers:{authorization:`Bearer ${good}`}});
      assert.equal((await caseGet()).status,403); // ANALYST cannot inspect verification case
      const officerGrant=await client<{id:string}[]>`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${userId},'VERIFICATION_OFFICER',${JSON.stringify({kind:'case',id:caseRecord.id,permissions:['provider:verify','evidence:read']})}::jsonb,now()+interval '1 day','test','isolated HTTP officer') RETURNING id`;
      await client`UPDATE verification_cases SET assigned_staff_user_id=${userId},version=2 WHERE id=${caseRecord.id}`;
      assert.equal((await caseGet()).status,200);
      const decision=(body:unknown)=>fetch(`${caseUrl}/decision`,{method:'POST',headers:{authorization:`Bearer ${good}`,'content-type':'application/json'},body:JSON.stringify(body)});
      assert.equal((await decision({expected_version:2,outcome:'VERIFIED',reason_code:'EVIDENCE_ACCEPTED'})).status,409); // evidence not reviewed
      assert.equal((await fetch(`${caseUrl}/evidence/GOVERNMENT_ID`,{headers:{authorization:`Bearer ${good}`}})).status,200);
      assert.equal((await fetch(`${caseUrl}/evidence/LIVE_SELFIE`,{headers:{authorization:`Bearer ${good}`}})).status,200);
      assert.equal((await decision({expected_version:2,outcome:'VERIFIED',reason_code:'EVIDENCE_ACCEPTED'})).status,201);
      assert.equal((await decision({expected_version:2,outcome:'VERIFIED',reason_code:'EVIDENCE_ACCEPTED'})).status,409);
      const photoUrl=`http://127.0.0.1:${address.port}/v1/staff/listing-photos`;
      assert.deepEqual((await (await fetch(photoUrl,{headers:{authorization:`Bearer ${good}`}})).json() as {photos:unknown[]}).photos,[]);
      const propertyStore=new PropertyDraftStore(client);
      const property=await propertyStore.createProperty(applicant,{propertyType:'APARTMENT',region:'Littoral',city:'Douala',neighborhood:'Akwa',relationshipType:'OWNER'});
      const listing=await propertyStore.createDraft(applicant,{propertyId:property.id,purpose:'RENT',title:'Staff photo HTTP fixture'});
      const riskCaseId=randomUUID();
      const riskUrl=`http://127.0.0.1:${address.port}/v1/staff/authority-risk-cases`;
      const riskHeaders={authorization:`Bearer ${good}`,'content-type':'application/json'};
      const riskInput={id:riskCaseId,propertyId:property.id,relationshipId:property.relationshipId,subjectScope:'RELATIONSHIP',triggerKind:'REPRESENTATION',allegationKind:'REPORTED',provenance:'STAFF_OBSERVATION',reasonCode:'STRUCTURED_REFERENCE_CONFLICT'};
      assert.equal((await fetch(riskUrl,{method:'POST',headers:riskHeaders,body:JSON.stringify(riskInput)})).status,403);
      const riskGrant=await client<{id:string}[]>`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${userId},'TRUST_SAFETY_MODERATOR',${JSON.stringify({kind:'case',id:riskCaseId,property_id:property.id,permissions:['authority:risk_decide']})}::jsonb,now()+interval '1 day','test','isolated authority HTTP') RETURNING id`;
      const riskEvidenceGrant=await client<{id:string}[]>`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${userId},'TRUST_SAFETY_MODERATOR',${JSON.stringify({kind:'case',id:riskCaseId,permissions:['evidence:read']})}::jsonb,now()+interval '1 day','test','isolated authority source review') RETURNING id`;
      assert.equal((await fetch(riskUrl,{method:'POST',headers:riskHeaders,body:JSON.stringify(riskInput)})).status,201);
      assert.equal((await fetch(`${riskUrl}/${riskCaseId}`,{headers:{authorization:`Bearer ${good}`}})).status,200);
      const riskDecision=(body:unknown)=>fetch(`${riskUrl}/${riskCaseId}/decision`,{method:'POST',headers:riskHeaders,body:JSON.stringify(body)});
      assert.equal((await riskDecision({expected_version:1,outcome:'REVIEW_SOURCE',reason_code:'SOURCE_SUPPORTS_DISPROOF',evidence_ref_type:'PROPERTY',evidence_ref_id:property.id})).status,409);
      const sourceReview=await riskDecision({expected_version:1,outcome:'REVIEW_SOURCE',reason_code:'SOURCE_SUPPORTS_DISPROOF',evidence_ref_type:'RELATIONSHIP',evidence_ref_id:property.relationshipId});
      assert.equal(sourceReview.status,409); // No immutable, probative internal source is implemented.
      assert.equal((await riskDecision({expected_version:1,outcome:'RESOLVE',reason_code:'TRIGGER_DISPROVED',evidence_ref_type:'RELATIONSHIP',evidence_ref_id:property.relationshipId})).status,409);
      assert.equal((await client`SELECT state FROM authority_risk_cases WHERE id=${riskCaseId}`)[0]?.state,'OPEN');
      await client`UPDATE staff_grants SET revoked_at=now() WHERE id=${riskGrant[0]!.id}`;
      await client`UPDATE staff_grants SET revoked_at=now() WHERE id=${riskEvidenceGrant[0]!.id}`;
      assert.equal((await fetch(`${riskUrl}/${riskCaseId}`,{headers:{authorization:`Bearer ${good}`}})).status,403);
      const providerAccount=await client<{id:string}[]>`SELECT id FROM provider_accounts WHERE provider_profile_id=${profile[0]!.id}`;
      const mediaAsset=await client<{id:string}[]>`INSERT INTO media_assets(owner_provider_account_id,classification,storage_reference,lifecycle,original_mime,original_bytes,derivative_manifest) VALUES (${providerAccount[0]!.id},'PUBLIC_MARKETPLACE',${randomUUID()},'READY','image/png',100,'{"320":{"mime":"image/webp","width":8,"height":6,"bytes":80}}'::jsonb) RETURNING id`;
      const association=await client<{id:string}[]>`INSERT INTO listing_media(listing_id,media_asset_id,display_order,is_cover,attached_by_user_id) VALUES (${listing.id},${mediaAsset[0]!.id},0,true,${applicant}) RETURNING id`;
      const listingGrant=await client<{id:string}[]>`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES (${userId},'LISTING_MODERATOR','{"kind":"region","id":"Littoral","permissions":["listing:moderate"]}'::jsonb,now()+interval '1 day','test','isolated listing photo HTTP') RETURNING id`;
      const pending=await (await fetch(photoUrl,{headers:{authorization:`Bearer ${good}`}})).json() as {photos:Array<{id:string;media_asset_id:string;version:number}>};
      assert.equal(pending.photos[0]?.id,association[0]!.id);
      const photoDecision=(payload:unknown)=>fetch(`${photoUrl}/${association[0]!.id}/decision`,{method:'POST',headers:{authorization:`Bearer ${good}`,'content-type':'application/json'},body:JSON.stringify(payload)});
      const command={media_asset_id:mediaAsset[0]!.id,expected_version:1,outcome:'APPROVED',reason_code:'CONTENT_REVIEWED',idempotency_key:randomUUID()};
      assert.equal((await photoDecision(command)).status,409); // preview is required
      const previewResponse=await fetch(`${photoUrl}/${association[0]!.id}/variants/320`,{headers:{authorization:`Bearer ${good}`}});
      assert.equal(previewResponse.status,200);
      assert.equal(previewResponse.headers.get('cache-control'),'private, no-store');
      assert.equal(await previewResponse.text(),'synthetic-private-preview');
      assert.equal((await photoDecision(command)).status,201);
      const duplicatePhotoDecision=await photoDecision(command);
      assert.equal(duplicatePhotoDecision.status,201,await duplicatePhotoDecision.text()); // same idempotency key
      assert.equal((await client`SELECT review_status FROM listing_media WHERE id=${association[0]!.id}`)[0]?.review_status,'APPROVED');
      await client`UPDATE staff_grants SET revoked_at=now() WHERE id=${listingGrant[0]!.id}`;
      assert.equal((await fetch(`${photoUrl}/${association[0]!.id}/variants/320`,{headers:{authorization:`Bearer ${good}`}})).status,403);
      await client`UPDATE staff_grants SET revoked_at=now() WHERE id=${officerGrant[0]!.id}`;
      assert.equal((await caseGet()).status,403);
      for (const extra of [
        { client_id: 'marketplace' },
        { scope: 'pachi/account' },
        { token_use: 'id' },
        { aud: 'unexpected' },
        { origin_jti: 'unregistered' },
      ])
        assert.equal((await get(await token(extra))).status, 401);
      const wrongIssuer = await new SignJWT({
        client_id: 'staff',
        scope: 'pachi/staff',
        token_use: 'access',
        origin_jti: family,
        jti: randomUUID(),
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject(subject)
        .setIssuer('https://local.test/marketplace')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      assert.equal((await get(wrongIssuer)).status, 401);
      assert.equal(
        (await fetch(base, { headers: { cookie: 'pachi_web_session=synthetic' } })).status,
        401,
      );
      await client`UPDATE staff_grants SET active_from=now()-interval '2 hours', expires_at=now()-interval '1 hour' WHERE id=${grant}`;
      assert.equal((await get(good)).status, 403);
      await client`UPDATE staff_grants SET expires_at=now()+interval '1 day', permission_scope='{"kind":"platform","id":"pachi","permissions":["admin:permissions_manage"]}'::jsonb WHERE id=${grant}`;
      assert.equal((await get(good)).status, 403); // analyst cannot acquire another role's permission
      await client`UPDATE staff_grants SET permission_scope='{"kind":"platform","id":"pachi","permissions":["analytics:aggregate"]}'::jsonb WHERE id=${grant}`;
      await client`UPDATE staff_grants SET revoked_at=now() WHERE id=${grant}`;
      assert.equal((await get(good)).status, 403);
      await client`UPDATE staff_grants SET revoked_at=NULL WHERE id=${grant}`;
      await store.revoke(id);
      assert.equal((await get(good)).status, 401);
    } finally {
      await app.close();
      await client`TRUNCATE users RESTART IDENTITY CASCADE`;
      await client.end();
    }
  },
);
