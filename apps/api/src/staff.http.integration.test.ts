import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPair, SignJWT } from 'jose';
import { createDatabase, StaffStore } from '@pachi/database';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { StaffController, StaffAuthService } from './staff.controller.js';
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
    @Module({
      controllers: [StaffController],
      providers: [
        { provide: 'STAFF_AUTH_SERVICE', useValue: new StaffAuthService(store, verifier) },
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
      assert.equal((await get(good)).status, 401); // no registered MFA evidence
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
