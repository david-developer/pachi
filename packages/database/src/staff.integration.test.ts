import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabase } from './client.js';
import { StaffStore } from './staff.js';
import { validStaffScope, requireStaffPermission } from './staff-policy.js';
import type { VerifiedTokenClaims } from './identity.js';
const url = process.env.DATABASE_URL;
const integration = url ? test : test.skip;
void integration(
  'staff grants, expiry, revocation, refresh locking and audit isolation',
  async () => {
    const parsed = new URL(url!);
    assert.equal(parsed.port, '5433');
    assert.equal(parsed.pathname, '/pachi_test');
    const { client } = createDatabase(url);
    let now = new Date();
    now.setMilliseconds(0);
    const initial = new Date(now),
      store = new StaffStore(
        client,
        'synthetic-staff-encryption-secret-with-32-characters',
        () => now,
      );
    try {
      const users = await client<
        { id: string }[]
      >`INSERT INTO users(display_name) VALUES ('Synthetic staff') RETURNING id`;
      const userId = users[0]!.id,
        subject = randomUUID();
      const claims: VerifiedTokenClaims = {
        issuer: 'https://local.test/staff',
        subject,
        clientId: 'staff',
        originJti: randomUUID(),
        jti: randomUUID(),
        expiresAt: new Date(+now + 300_000),
        issuedAt: now,
        scopes: ['pachi/staff'],
        provider: 'LOCAL_TEST',
      };
      await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${userId},${claims.issuer},${subject},'LOCAL_TEST')`;
      const scope = {
        kind: 'platform' as const,
        id: 'pachi',
        permissions: ['admin:permissions_manage'],
      };
      await assert.rejects(
        () => store.register(claims, now, 'access', 'refresh'),
        /RESOURCE_SCOPE_DENIED/,
      );
      const grant = await store.provision({
        operator: 'test-operator',
        userId,
        issuer: claims.issuer,
        subject,
        role: 'SUPER_ADMIN',
        scope,
        reason: 'Isolated test grant',
        expiresAt: new Date(+now + 86400_000),
      });
      const transaction = await store.beginLogin();
      assert.ok(await store.consumeLogin(transaction));
      await assert.rejects(() => store.consumeLogin(transaction));
      const id = await store.register(claims, now, 'access', 'refresh');
      const principal = await store.authenticate(claims);
      assert.equal(principal.row.id, id);
      assert.equal(store.projection(principal).display_name, 'Synthetic staff');
      assert.ok(!JSON.stringify(store.projection(principal)).includes(subject));
      assert.ok(!validStaffScope('SUPER_ADMIN', { ...scope, permissions: ['evidence:read'] }));
      requireStaffPermission(principal.grants, 'admin:permissions_manage', scope, initial, now);
      assert.throws(
        () => requireStaffPermission(principal.grants, 'user:suspend', scope, initial, now),
        /RESOURCE_SCOPE_DENIED/,
      );
      assert.throws(
        () =>
          requireStaffPermission(
            principal.grants,
            'admin:permissions_manage',
            { kind: 'case', id: 'case' },
            initial,
            now,
          ),
        /RESOURCE_SCOPE_DENIED/,
      );
      now = new Date(+initial + 900_000);
      assert.throws(
        () =>
          requireStaffPermission(principal.grants, 'admin:permissions_manage', scope, initial, now),
        /STEP_UP_REQUIRED/,
      );
      let refreshes = 0;
      const refresh = async () => {
        refreshes++;
        await new Promise((r) => setTimeout(r, 20));
        return {
          access: 'new-access',
          refresh: 'new-refresh',
          expiresAt: new Date(+now + 300_000),
          claims: { ...claims, expiresAt: new Date(+now + 300_000) },
        };
      };
      assert.deepEqual(await Promise.all([store.tokens(id, refresh), store.tokens(id, refresh)]), [
        'new-access',
        'new-access',
      ]);
      assert.equal(refreshes, 1);
      assert.equal(+(await store.read(id)).row.authenticated_at, +initial);
      await client`UPDATE staff_grants SET revoked_at=${now.toISOString()} WHERE id=${grant}`;
      await assert.rejects(() => store.read(id), /RESOURCE_SCOPE_DENIED/);
      await client`UPDATE staff_grants SET revoked_at=NULL,expires_at=${now.toISOString()} WHERE id=${grant}`;
      await assert.rejects(() => store.read(id), /RESOURCE_SCOPE_DENIED/);
      await client`UPDATE staff_grants SET expires_at=${new Date(+initial + 86400_000).toISOString()} WHERE id=${grant}`;
      now = new Date(+initial + 2700_000);
      await assert.rejects(() => store.read(id), /AUTH_REQUIRED/); // exact 30m idle
      now = new Date(initial);
      const id2 = await store.register(
        { ...claims, originJti: randomUUID() },
        now,
        'access',
        'refresh',
      );
      for (let i = 1; i < 29; i++) {
        now = new Date(+initial + i * 1000_000);
        await store.read(id2);
      }
      now = new Date(+initial + 8 * 3600_000);
      await assert.rejects(() => store.read(id2), /AUTH_REQUIRED/);
      now = new Date(initial);
      const family = { ...claims, originJti: randomUUID() };
      const id3 = await store.register(family, now, 'access', 'refresh');
      await client`UPDATE users SET account_state='SUSPENDED' WHERE id=${userId}`;
      await assert.rejects(() => store.read(id3), /AUTH_REQUIRED/);
      await client`UPDATE users SET account_state='PENDING_PHONE', security_version=security_version+1 WHERE id=${userId}`;
      await assert.rejects(() => store.read(id3), /AUTH_REQUIRED/);
      await client`UPDATE users SET security_version=security_version-1 WHERE id=${userId}`;
      await client`UPDATE auth_identities SET unlinked_at=now() WHERE issuer=${claims.issuer} AND subject=${subject}`;
      await assert.rejects(() => store.read(id3), /AUTH_REQUIRED/);
      await client`UPDATE auth_identities SET unlinked_at=NULL WHERE issuer=${claims.issuer} AND subject=${subject}`;
      await store.revoke(id3);
      await assert.rejects(() => store.authenticate(family));
      await assert.rejects(() => store.register(family, now, 'access', 'refresh'));
      const failedId = await store.register(
        { ...claims, originJti: randomUUID() },
        now,
        'access',
        'refresh',
      );
      now = new Date(+initial + 300_000);
      await assert.rejects(
        () =>
          store.tokens(failedId, async () => {
            throw new Error('provider unavailable');
          }),
        /AUTH_REQUIRED/,
      );
      await assert.rejects(() => store.read(failedId), /AUTH_REQUIRED/);
      const privilegeId = await store.register(
        { ...claims, originJti: randomUUID(), expiresAt: new Date(+now + 300_000) },
        now,
        'access',
        'refresh',
      );
      await store.provision({
        operator: 'test-operator', userId, issuer: claims.issuer, subject,
        role: 'ANALYST',
        scope: { kind: 'platform', id: 'pachi', permissions: ['analytics:aggregate'] },
        reason: 'Explicit additional grant requires a new session',
        expiresAt: new Date(+now + 86400_000),
      });
      await assert.rejects(() => store.read(privilegeId), /AUTH_REQUIRED/);
      const rows = await client`SELECT id FROM staff_access_audit WHERE target_user_id=${userId}`;
      assert.ok(rows.length >= 4);
      await assert.rejects(
        () => client`DELETE FROM staff_access_audit WHERE target_user_id=${userId}`,
        /append-only/,
      );
    } finally {
      await client.end();
    }
  },
);
