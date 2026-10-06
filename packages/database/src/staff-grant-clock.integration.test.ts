import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from './client.js';
import type { VerifiedTokenClaims } from './identity.js';
import { ListingPhotoReviewStore } from './listing-photo-review.js';
import { PropertyDraftStore } from './property.js';
import { ProviderVerificationStore } from './provider-verification.js';
import { StaffStore, type StaffPrincipal } from './staff.js';
import { validStaffScope, type StaffScope } from './staff-policy.js';

if (!process.env.DATABASE_TEST_URL && process.env.CI === 'true')
  throw new Error('DATABASE_TEST_URL is required');
const integration = process.env.DATABASE_TEST_URL ? test : test.skip;
const fixtureMaterial = 'synthetic-staff-encryption-secret-with-32-characters';
const adminScope: StaffScope = {
  kind: 'platform', id: 'pachi', permissions: ['admin:permissions_manage'],
};

function database() {
  const url = process.env.DATABASE_TEST_URL!;
  const parsed = new URL(url);
  assert.equal(`${parsed.hostname}:${parsed.port}${parsed.pathname}`, 'localhost:5433/pachi_test');
  return createDatabase(url);
}

function principal(userId: string, role: string, scope: StaffScope, now: Date): StaffPrincipal {
  return { row: { user_id: userId, authenticated_at: now }, grants: [{ role, scope }] } as StaffPrincipal;
}

void integration('committed DB-default staff grant registers with an earlier application clock', async () => {
  const { client } = database();
  try {
    const [user] = await client<{ id: string }[]>`INSERT INTO users(account_state) VALUES ('ACTIVE') RETURNING id`;
    const subject = randomUUID();
    await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${user!.id},'https://local.test/staff',${subject},'LOCAL_TEST')`;
    // Awaited autocommit: this is a committed durable grant, with the same default as the failed fixture.
    const [grant] = await client<{ id: string; earlier_app: string }[]>`
      INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason)
      VALUES (${user!.id},'SUPER_ADMIN',${JSON.stringify(adminScope)}::jsonb,now()+interval '1 day','test','isolated clock boundary')
      RETURNING id,(date_trunc('milliseconds',active_from)-interval '1 millisecond')::text AS earlier_app`;
    const now = new Date(grant!.earlier_app);
    const store = new StaffStore(client, fixtureMaterial, () => now);
    const claims: VerifiedTokenClaims = {
      issuer: 'https://local.test/staff', subject, clientId: 'staff', originJti: randomUUID(),
      jti: randomUUID(), expiresAt: new Date(+now + 300_000), issuedAt: now,
      scopes: ['pachi/staff'], provider: 'LOCAL_TEST',
    };
    const [boundary] = await client<{ app_active: boolean; db_active: boolean }[]>`
      SELECT active_from<=${now.toISOString()}::timestamptz AS app_active,
        active_from<=now() AND expires_at>now() AND revoked_at IS NULL AS db_active
      FROM staff_grants WHERE id=${grant!.id}`;
    assert.deepEqual(boundary, { app_active: false, db_active: true });
    const [precision] = await client<{ app_active: boolean; db_active: boolean }[]>`
      SELECT '2026-10-07T10:20:30.123456Z'::timestamptz<='2026-10-07T10:20:30.123Z'::timestamptz AS app_active,
        '2026-10-07T10:20:30.123456Z'::timestamptz<='2026-10-07T10:20:30.123456Z'::timestamptz AS db_active`;
    assert.deepEqual(precision, { app_active: false, db_active: true });
    const session = await store.register(claims, now, 'access', 'refresh');
    assert.equal((await store.grants(user!.id)).length, 1);
    assert.equal((await store.read(session, false)).row.id, session);
    await assert.rejects(store.register({ ...claims, originJti: randomUUID() }, new Date(+now + 1), 'access', 'refresh'), { code: 'AUTH_REQUIRED' });
    await assert.rejects(store.register({ ...claims, originJti: randomUUID() }, new Date(+now - 600_001), 'access', 'refresh'), { code: 'AUTH_REQUIRED' });
    await assert.rejects(store.register({ ...claims, expiresAt: now }, now, 'access', 'refresh'), { code: 'AUTH_REQUIRED' });
    await client`UPDATE staff_sessions SET revoked_at=now() WHERE id=${session}`;
    await assert.rejects(store.read(session, false), { code: 'AUTH_REQUIRED' });
  } finally { await client.end(); }
});

void integration('operator grants activate in the database clock and reject expiry already reached there', async () => {
  const { client } = database();
  try {
    const [user] = await client<{ id: string }[]>`INSERT INTO users(account_state) VALUES ('ACTIVE') RETURNING id`;
    const subject = randomUUID();
    await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${user!.id},'https://local.test/staff',${subject},'LOCAL_TEST')`;
    const [time] = await client<{ ahead: string; behind: string; expired: string }[]>`
      SELECT (now()+interval '1 minute')::text AS ahead,(now()-interval '1 minute')::text AS behind,now()::text AS expired`;
    let now = new Date(time!.ahead);
    const store = new StaffStore(client, fixtureMaterial, () => now);
    const input = {
      operator: 'test', userId: user!.id, issuer: 'https://local.test/staff', subject,
      role: 'SUPER_ADMIN' as const, scope: adminScope, reason: 'isolated operator clock test',
      // Valid in the database, although already past the deliberately ahead application clock.
      expiresAt: new Date(+new Date(time!.expired) + 30_000),
    };
    const id = await store.provision(input);
    const [grant] = await client<{ active: boolean }[]>`SELECT active_from<=now() AS active FROM staff_grants WHERE id=${id}`;
    assert.equal(grant!.active, true);
    now = new Date(time!.behind);
    await assert.rejects(store.provision({ ...input, expiresAt: new Date(time!.expired) }), { code: 'RESOURCE_SCOPE_DENIED' });
    assert.equal((await client<{ count: number }[]>`SELECT count(*)::int AS count FROM staff_grants WHERE user_id=${user!.id}`)[0]!.count, 1);
  } finally { await client.end(); }
});

void integration('staff grant database boundaries deny future, expired, revoked and invalid scopes without tolerance', async () => {
  const { client } = database();
  try {
    await client.begin(async tx => {
      const [user] = await tx<{ id: string }[]>`INSERT INTO users(account_state) VALUES ('ACTIVE') RETURNING id`;
      const subject = randomUUID();
      await tx`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES (${user!.id},'https://local.test/staff',${subject},'LOCAL_TEST')`;
      const [time] = await tx<{ app_now: string }[]>`SELECT (date_trunc('milliseconds',now())-interval '1 millisecond')::text AS app_now`;
      const now = new Date(time!.app_now), store = new StaffStore(tx as unknown as typeof client, fixtureMaterial, () => now);
      const claims: VerifiedTokenClaims = {
        issuer: 'https://local.test/staff', subject, clientId: 'staff', originJti: randomUUID(),
        jti: randomUUID(), expiresAt: new Date(+now + 300_000), issuedAt: now,
        scopes: ['pachi/staff'], provider: 'LOCAL_TEST',
      };
      const [grant] = await tx<{ id: string }[]>`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason)
        VALUES (${user!.id},'SUPER_ADMIN',${JSON.stringify(adminScope)}::jsonb,now()+interval '1 day','test','isolated negative boundary') RETURNING id`;
      assert.equal((await store.grants(user!.id)).length, 1);
      const session = await store.register(claims, now, 'access', 'refresh');
      // now() is fixed within this transaction. Even one microsecond in the future remains unavailable.
      await tx`UPDATE staff_grants SET active_from=now()+interval '1 microsecond' WHERE id=${grant!.id}`;
      assert.deepEqual(await store.grants(user!.id), []);
      const ahead = new StaffStore(tx as unknown as typeof client, fixtureMaterial, () => new Date(+now + 60_000));
      assert.deepEqual(await ahead.grants(user!.id), []); // an ahead app clock cannot activate a future grant
      await assert.rejects(store.read(session, false), { code: 'RESOURCE_SCOPE_DENIED' });
      await assert.rejects(store.register({ ...claims, originJti: randomUUID() }, now, 'access', 'refresh'), { code: 'RESOURCE_SCOPE_DENIED' });
      await tx`UPDATE staff_grants SET active_from=now()-interval '1 day',expires_at=now() WHERE id=${grant!.id}`;
      assert.deepEqual(await store.grants(user!.id), []); // exact expiry, despite the earlier app clock
      await tx`UPDATE staff_grants SET expires_at=now()+interval '1 day',revoked_at=now() WHERE id=${grant!.id}`;
      assert.deepEqual(await store.grants(user!.id), []);
      const invalid = { ...adminScope, permissions: ['evidence:read'] };
      assert.equal(validStaffScope('SUPER_ADMIN', invalid), false);
      assert.equal(validStaffScope('UNRECOGNIZED_ROLE', adminScope), false);
      await tx`UPDATE staff_grants SET revoked_at=NULL,permission_scope=${JSON.stringify(invalid)}::jsonb WHERE id=${grant!.id}`;
      assert.deepEqual(await store.grants(user!.id), []);
      await assert.rejects(store.register({ ...claims, originJti: randomUUID() }, now, 'access', 'refresh'), { code: 'RESOURCE_SCOPE_DENIED' });
    });
  } finally { await client.end(); }
});

void integration('provider assignment and current case grants use database validity with a frozen earlier application clock', async () => {
  const { client } = database();
  try {
    const users = await client<{ id: string }[]>`INSERT INTO users(account_state) VALUES ('ACTIVE'),('ACTIVE'),('ACTIVE') RETURNING id`;
    const [applicant, officer, admin] = users;
    const [profile] = await client<{ id: string }[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name) VALUES (${applicant!.id},ARRAY['OWNER'],'Synthetic clock fixture') RETURNING id`;
    const [row] = await client<{ id: string }[]>`INSERT INTO verification_cases(provider_profile_id,applicant_user_id,verification_type,state,policy_version,idempotency_key,submitted_at)
      VALUES (${profile!.id},${applicant!.id},'PROVIDER_IDENTITY','PENDING','provider-identity-synthetic-v1',${randomUUID()},now()) RETURNING id`;
    const scope: StaffScope = { kind: 'case', id: row!.id, permissions: ['provider:verify', 'evidence:read'] };
    const [time] = await client<{ earlier_app: string }[]>`SELECT (date_trunc('milliseconds',now())-interval '1 millisecond')::text AS earlier_app`;
    const now = new Date(time!.earlier_app);
    const store = new ProviderVerificationStore(client, fixtureMaterial, false, () => now);
    const operator = principal(admin!.id, 'SUPER_ADMIN', adminScope, now);
    const staff = principal(officer!.id, 'VERIFICATION_OFFICER', scope, now);
    await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason)
      VALUES (${admin!.id},'SUPER_ADMIN',${JSON.stringify(adminScope)}::jsonb,now()+interval '1 day','test','isolated operator clock grant')`;
    const [grant] = await client<{ id: string }[]>`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason)
      VALUES (${officer!.id},'VERIFICATION_OFFICER',${JSON.stringify(scope)}::jsonb,now()+interval '1 day','test','isolated assignee clock grant') RETURNING id`;
    assert.equal((await store.assign(operator, row!.id, officer!.id, 1, randomUUID())).version, 2);
    assert.equal((await store.assigned(staff, row!.id)).id, row!.id);
    await client`UPDATE staff_grants SET active_from=now()+interval '1 day',expires_at=now()+interval '2 days' WHERE id=${grant!.id}`;
    await assert.rejects(store.assigned(staff, row!.id), { code: 'RESOURCE_SCOPE_DENIED' });
    await assert.rejects(store.assign(operator, row!.id, officer!.id, 2, randomUUID()), { code: 'RESOURCE_SCOPE_DENIED' });
    await client`UPDATE staff_grants SET active_from=now()-interval '1 day',expires_at=now() WHERE id=${grant!.id}`;
    await assert.rejects(store.assigned(staff, row!.id), { code: 'RESOURCE_SCOPE_DENIED' });
    await client`UPDATE staff_grants SET expires_at=now()+interval '1 day',revoked_at=now() WHERE id=${grant!.id}`;
    await assert.rejects(store.assigned(staff, row!.id), { code: 'RESOURCE_SCOPE_DENIED' });
  } finally { await client.end(); }
});

void integration('photo review current grants use database validity with a frozen earlier application clock', async () => {
  const { client } = database();
  try {
    await client`TRUNCATE users RESTART IDENTITY CASCADE`;
    const [owner, moderator] = await client<{ id: string }[]>`INSERT INTO users(account_state) VALUES ('ACTIVE'),('ACTIVE') RETURNING id`;
    await client`INSERT INTO phone_contacts(user_id,normalized_e164,verified_at,verification_version) VALUES (${owner!.id},'+237690003001',now(),1)`;
    const [profile] = await client<{ id: string }[]>`INSERT INTO provider_profiles(user_id,provider_types,display_name) VALUES (${owner!.id},ARRAY['OWNER'],'Synthetic clock fixture') RETURNING id`;
    const [account] = await client<{ id: string }[]>`INSERT INTO provider_accounts(provider_profile_id) VALUES (${profile!.id}) RETURNING id`;
    const properties = new PropertyDraftStore(client);
    const property = await properties.createProperty(owner!.id, { propertyType: 'APARTMENT', region: 'Littoral', city: 'Douala', neighborhood: 'Akwa', bedrooms: 2, relationshipType: 'OWNER' });
    const draft = await properties.createDraft(owner!.id, { propertyId: property.id, purpose: 'RENT', title: 'Clock fixture', description: 'Synthetic photo clock fixture', amountMinor: 200000, availableFrom: '2026-10-01' });
    const [asset] = await client<{ id: string }[]>`INSERT INTO media_assets(owner_provider_account_id,classification,storage_reference,lifecycle,original_mime,original_bytes,derivative_manifest)
      VALUES (${account!.id},'PUBLIC_MARKETPLACE',${randomUUID()},'READY','image/png',128,'{"320":{"mime":"image/webp","width":8,"height":6,"bytes":80}}'::jsonb) RETURNING id`;
    const [photo] = await client<{ id: string }[]>`INSERT INTO listing_media(listing_id,media_asset_id,display_order,is_cover,attached_by_user_id)
      VALUES (${draft.id},${asset!.id},0,true,${owner!.id}) RETURNING id`;
    const scope: StaffScope = { kind: 'region', id: 'Littoral', permissions: ['listing:moderate'] };
    const [grant] = await client<{ id: string; earlier_app: string }[]>`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason)
      VALUES (${moderator!.id},'LISTING_MODERATOR',${JSON.stringify(scope)}::jsonb,now()+interval '1 day','test','isolated photo clock grant')
      RETURNING id,(date_trunc('milliseconds',active_from)-interval '1 millisecond')::text AS earlier_app`;
    const now = new Date(grant!.earlier_app), store = new ListingPhotoReviewStore(client, () => now);
    const staff = principal(moderator!.id, 'LISTING_MODERATOR', scope, now);
    assert.equal((await store.queue(staff)).length, 1);
    assert.equal((await store.preview(staff, photo!.id, 320, randomUUID(), async () => Buffer.from('synthetic-preview'))).mime, 'image/webp');
    await client`UPDATE staff_grants SET active_from=now()+interval '1 day',expires_at=now()+interval '2 days' WHERE id=${grant!.id}`;
    assert.deepEqual(await store.queue(staff), []);
    await client`UPDATE staff_grants SET active_from=now()-interval '1 day',expires_at=now() WHERE id=${grant!.id}`;
    assert.deepEqual(await store.queue(staff), []);
    await client`UPDATE staff_grants SET expires_at=now()+interval '1 day',revoked_at=now() WHERE id=${grant!.id}`;
    assert.deepEqual(await store.queue(staff), []);
    await assert.rejects(store.preview(staff, photo!.id, 320, randomUUID(), async () => Buffer.from('synthetic-preview')), { code: 'RESOURCE_SCOPE_DENIED' });
  } finally { await client.end(); }
});
