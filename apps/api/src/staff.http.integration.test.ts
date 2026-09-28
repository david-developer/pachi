import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { createDatabase, StaffStore, ProviderVerificationStore } from '@pachi/database';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { StaffController, StaffAuthService } from './staff.controller.js';
import { StaffVerificationController } from './staff-verification.controller.js';
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
    const verifier = new CognitoAccessTokenVerifier({
      issuer: 'https://local.test/staff',
      getKey: async () => publicKey,
      allowedClientIds: new Set(['staff']),
      requiredScopes: new Set(['pachi/staff']),
      provider: 'LOCAL_TEST',
      strictStaff: true,
    });
    const store = new StaffStore(client, 'synthetic-staff-secret-long-enough-for-encryption');
    const verificationStore = new ProviderVerificationStore(client,'synthetic-evidence-key-for-http-staff-test');
    @Module({
      controllers: [StaffController, StaffVerificationController],
      providers: [
        { provide: 'STAFF_AUTH_SERVICE', useValue: new StaffAuthService(store, verifier) },
        { provide: 'PROVIDER_VERIFICATION_STORE', useValue: verificationStore },
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
      await client.end();
    }
  },
);
