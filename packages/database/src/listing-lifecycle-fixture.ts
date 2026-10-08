// Synthetic fixture only; callers must enforce the disposable TEST URL guard.
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { fixtureFor } from "./conversation-fixture.js";
import {
  ListingLifecycleStore,
  type ListingLifecycleState,
} from "./listing-lifecycle.js";
import type { ListingPurpose } from "./property.js";
import type { StaffPrincipal } from "./staff.js";
export async function listingLifecycleFixture(
  client: postgres.Sql,
  purpose: ListingPurpose = "RENT",
) {
  const f = await fixtureFor(client, purpose);
  const session = (
    await client<
      { id: string }[]
    >`INSERT INTO security_sessions(user_id,issuer,app_client_id,origin_jti,current_jti,expires_at)
    VALUES(${f.providerUserId},'https://local.test/lifecycle','account',${randomUUID()},${randomUUID()},statement_timestamp()+interval '1 hour') RETURNING id`
  )[0]!;
  const actor = {
    userId: f.providerUserId,
    sessionId: session.id,
    securityVersion: 0,
  };
  const store = new ListingLifecycleStore(client, true);
  const state = await store.read(actor, f.listingId);
  return {
    ...f,
    actor,
    store,
    state,
    command: (s: ListingLifecycleState = state) => ({
      expectedVersion: s.version,
      expectedRevisionId: s.revision_id,
      expectedOfferingVersionId: s.offering_version_id,
      idempotencyKey: randomUUID(),
    }),
  };
}
export async function regionStaffFixture(
  client: postgres.Sql,
): Promise<StaffPrincipal> {
  const user = (
    await client<
      { id: string }[]
    >`INSERT INTO users(account_state) VALUES('ACTIVE') RETURNING id`
  )[0]!;
  const identity = (
    await client<
      { id: string }[]
    >`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES(${user.id},'https://local.test/configuration',${randomUUID()},'LOCAL_TEST') RETURNING id`
  )[0]!;
  const session = (
    await client`INSERT INTO staff_sessions(user_id,identity_id,issuer,app_client_id,origin_jti,security_version,authenticated_at,mfa_method,last_seen_at,absolute_expires_at,idle_expires_at,token_expires_at,access_token_ciphertext,refresh_token_ciphertext)
    VALUES(${user.id},${identity.id},'https://local.test/configuration','staff',${randomUUID()},0,statement_timestamp(),'COGNITO_REQUIRED_TOTP',statement_timestamp(),statement_timestamp()+interval '1 hour',statement_timestamp()+interval '30 minutes',statement_timestamp()+interval '10 minutes',decode('00','hex'),decode('00','hex')) RETURNING *`
  )[0]!;
  await client`INSERT INTO staff_grants(user_id,role,permission_scope,expires_at,granted_by,reason) VALUES(${user.id},'SUPER_ADMIN',${JSON.stringify({ kind: "region", id: "Littoral", permissions: ["configuration:manage"] })}::jsonb,statement_timestamp()+interval '1 hour','synthetic-test','G3-E TEST fixture')`;
  return { row: session, grants: [] } as unknown as StaffPrincipal;
}
