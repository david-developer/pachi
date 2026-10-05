import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabase } from '@pachi/database';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AuthGuard } from './auth.guard.js';
import { OrganizationSettingsGuard } from './organization.guard.js';

const integration = process.env.DATABASE_TEST_URL ? test : test.skip;
void integration('real authentication/module guards recheck organization membership for an existing session', async () => {
  const url = process.env.DATABASE_TEST_URL!;
  const parsed = new URL(url);
  assert.equal(parsed.hostname, 'localhost'); assert.equal(parsed.port, '5433'); assert.equal(parsed.pathname, '/pachi_test');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey); jwk.kid = 'organization-test';
  const server = createServer((_req, res) => { res.setHeader('content-type','application/json'); res.end(JSON.stringify({keys:[jwk]})); });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const issuer = 'http://127.0.0.1/organization-test';
  Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:url,COGNITO_ISSUER:issuer,COGNITO_JWKS_URI:`http://127.0.0.1:${address.port}/jwks`,COGNITO_CLIENT_IDS:'organization-test',AUTH_REQUIRED_SCOPES:'pachi/account'});
  const {AuthModule,authDatabaseClient} = await import('./auth.module.js');
  // Test-only probe preserves the original settings-guard boundary alongside
  // the separately authorized organization lifecycle routes.
  @Controller('organizations/:organizationId/settings-probe')
  @UseGuards(AuthGuard,OrganizationSettingsGuard)
  class ProtectedProbe { @Get() read() { return {authorized:true}; } }
  @Module({imports:[AuthModule],controllers:[ProtectedProbe]})
  class ProbeApp {}
  const app = await NestFactory.create(ProbeApp,{logger:false,abortOnError:false}).catch(async error => { await authDatabaseClient.end(); server.close(); throw error; });
  await app.listen(0,'127.0.0.1');
  const base = await app.getUrl();
  const {client} = createDatabase(url);
  const ids = [randomUUID(), randomUUID()];
  const orgs = [randomUUID(),randomUUID()];
  try {
    for (const [i,id] of ids.entries()) {
      await client`INSERT INTO users(id,account_state) VALUES (${id},'ACTIVE')`;
      await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${id},${'+23769999100'+i},now(),1)`;
      await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${id},${issuer},${id},'LOCAL_TEST')`;
    }
    for (const id of orgs) await client`INSERT INTO organizations(id,state) VALUES (${id},'ACTIVE')`;
    const user=ids[0]!,other=ids[1]!,org=orgs[0]!;
    await client`INSERT INTO organization_memberships(organization_id,user_id,role,state,changed_by) VALUES (${org},${user},'ADMIN','ACTIVE',${other}),(${org},${other},'OWNER','ACTIVE',${other})`;
    const token=await new SignJWT({client_id:'organization-test',origin_jti:randomUUID(),jti:randomUUID(),token_use:'access',scope:'pachi/account'})
      .setProtectedHeader({alg:'RS256',kid:'organization-test'}).setIssuer(issuer).setSubject(user).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const get=(id=org)=>fetch(`${base}/organizations/${id}/settings-probe`,{headers:{authorization:`Bearer ${token}`,'x-organization-role':'OWNER'}});
    assert.equal((await get()).status,200);
    const sessions=await client`SELECT id FROM security_sessions WHERE user_id=${user}`;
    assert.equal(sessions.length,1);
    assert.equal((await get(orgs[1]!)).status,403);
    for (const state of ['SUSPENDED','REVOKED','INVITED','EXPIRED','DECLINED']) {
      await client`UPDATE organization_memberships SET state=${state},changed_at=now() WHERE organization_id=${org} AND user_id=${user}`;
      assert.equal((await get()).status,403,state);
      assert.equal((await client`SELECT revoked_at FROM security_sessions WHERE id=${sessions[0]!.id}`)[0]?.revoked_at,null);
    }
    // Fixture restoration only, not a lifecycle command. Reuse exact same JWT.
    await client`UPDATE organization_memberships SET state='ACTIVE',role='ANALYST' WHERE organization_id=${org} AND user_id=${user}`;
    assert.equal((await get()).status,403);
    await client`UPDATE organization_memberships SET role='AGENT' WHERE organization_id=${org} AND user_id=${user}`;
    assert.equal((await get()).status,403);
    await client`UPDATE organization_memberships SET role='ADMIN' WHERE organization_id=${org} AND user_id=${user}`;
    assert.equal((await get()).status,200);
    await client`UPDATE phone_contacts SET replaced_at=now() WHERE user_id=${user}`;
    assert.equal((await get()).status,403,'a replaced verified phone must not grant organization settings access');
    await client`UPDATE phone_contacts SET replaced_at=NULL,verified_at=NULL WHERE user_id=${user}`;
    assert.equal((await get()).status,403,'an unverified current phone must not grant organization settings access');
    await client`UPDATE phone_contacts SET verified_at=now() WHERE user_id=${user}`;
    assert.equal((await get()).status,200);
    await client`UPDATE organizations SET state='SUSPENDED' WHERE id=${org}`;
    assert.equal((await get()).status,403);
    await client`UPDATE organizations SET state='ACTIVE' WHERE id=${org}`;
    await client`UPDATE users SET account_state='LIMITED' WHERE id=${user}`;
    assert.equal((await get()).status,403);
    await client`UPDATE users SET account_state='ACTIVE' WHERE id=${user}`;
    await client`UPDATE security_sessions SET revoked_at=now() WHERE user_id=${user}`;
    assert.equal((await get()).status,401);
    await assert.rejects(client`INSERT INTO organization_memberships(organization_id,user_id,role,state,changed_by) VALUES (${org},${other},'OWNER','ACTIVE',${other})`);
  } finally {
    await client`DELETE FROM organization_memberships WHERE organization_id IN ${client(orgs)}`;
    await client`DELETE FROM organizations WHERE id IN ${client(orgs)}`;
    await app.close(); await client.end(); await authDatabaseClient.end();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
