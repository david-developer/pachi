import { createHash } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { IdentityError } from "./identity.js";
import type { StaffPrincipal } from "./staff.js";
import {
  StaffAccessError,
  validStaffScope,
  type StaffRole,
  type StaffScope,
} from "./staff-policy.js";

// Acquire before provider/listing locks. Region disable needs only this row's
// exclusive lock; publication, renewal and fresh inquiries retain a shared lock.
export async function lockListingRegion(
  tx: postgres.TransactionSql,
  listingId: string,
): Promise<void> {
  await tx`SELECT c.region FROM region_publication_controls c JOIN properties p ON p.region=c.region
    JOIN listings l ON l.property_id=p.id WHERE l.id=${listingId} FOR SHARE OF c`;
}
export async function regionPublishingEnabled(
  tx: postgres.Sql | postgres.TransactionSql,
  region: string,
): Promise<boolean> {
  const rows = await tx<
    { enabled: boolean }[]
  >`SELECT enabled FROM region_publication_controls WHERE region=${region}`;
  return rows[0]?.enabled === true;
}

const command = z
  .object({
    region: z.enum(["Southwest", "Littoral"]),
    enabled: z.boolean(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.uuid(),
  })
  .strict();
/** Internal configuration boundary, not a public maintenance endpoint. Every
 * invocation reloads current MFA/session/security version and the exact region
 * grant. A SUPER_ADMIN title or a platform grant is not region authority. */
export class RegionPublicationStore {
  constructor(private readonly client: postgres.Sql) {}
  async configure(principal: StaffPrincipal, input: z.infer<typeof command>) {
    const parsed = command.safeParse(input);
    if (!parsed.success)
      throw new IdentityError("INVALID_INPUT", "INVALID_INPUT");
    const hash = createHash("sha256")
      .update(JSON.stringify(parsed.data))
      .digest("hex");
    return this.client.begin(async (tx) => {
      const current = (
        await tx<
          { enabled: boolean; version: number }[]
        >`SELECT enabled,version FROM region_publication_controls WHERE region=${input.region} FOR UPDATE`
      )[0]!;
      const sessions =
        await tx`SELECT ss.id FROM staff_sessions ss JOIN users u ON u.id=ss.user_id JOIN auth_identities ai ON ai.id=ss.identity_id AND ai.user_id=u.id
        WHERE ss.id=${principal.row.id} AND ss.user_id=${principal.row.user_id} AND ai.unlinked_at IS NULL AND ai.issuer=ss.issuer
          AND ss.issuer=${principal.row.issuer} AND ss.app_client_id=${principal.row.app_client_id} AND ss.origin_jti=${principal.row.origin_jti}
          AND ss.revoked_at IS NULL AND ss.security_version=u.security_version AND u.account_state='ACTIVE'
          AND ss.mfa_method='COGNITO_REQUIRED_TOTP' AND ss.absolute_expires_at>statement_timestamp()
          AND ss.idle_expires_at>statement_timestamp() AND ss.token_expires_at>statement_timestamp()
          AND ss.authenticated_at BETWEEN statement_timestamp()-interval '15 minutes' AND statement_timestamp() FOR SHARE OF ss,u,ai`;
      if (!sessions[0]) throw new StaffAccessError("AUTH_REQUIRED");
      const grants = await tx<
        { role: StaffRole; permission_scope: StaffScope }[]
      >`SELECT role,permission_scope FROM staff_grants WHERE user_id=${principal.row.user_id}
        AND revoked_at IS NULL AND active_from<=statement_timestamp() AND expires_at>statement_timestamp() FOR SHARE`;
      if (
        !grants.some(
          (g) =>
            validStaffScope(g.role, g.permission_scope) &&
            g.permission_scope.kind === "region" &&
            g.permission_scope.id === input.region &&
            g.permission_scope.permissions.includes("configuration:manage"),
        )
      )
        throw new StaffAccessError("RESOURCE_SCOPE_DENIED");
      const prior = (
        await tx`SELECT * FROM region_publication_actions WHERE actor_user_id=${principal.row.user_id} AND idempotency_key=${input.idempotencyKey}`
      )[0];
      if (prior) {
        if (prior.request_hash !== hash)
          throw new IdentityError(
            "IDEMPOTENCY_KEY_REUSED",
            "IDEMPOTENCY_KEY_REUSED",
          );
        return {
          region: prior.region as string,
          enabled: prior.enabled as boolean,
          version: prior.version as number,
          idempotent: true,
        };
      }
      if (current.version !== input.expectedVersion)
        throw new IdentityError("STALE_VERSION", "STALE_VERSION");
      const next = (
        await tx<
          { version: number }[]
        >`UPDATE region_publication_controls SET enabled=${input.enabled},version=version+1,updated_at=statement_timestamp() WHERE region=${input.region} RETURNING version`
      )[0]!;
      const action = (
        await tx<
          { id: string }[]
        >`INSERT INTO region_publication_actions(region,actor_user_id,idempotency_key,request_hash,previous_enabled,enabled,version)
        VALUES(${input.region},${principal.row.user_id},${input.idempotencyKey},${hash},${current.enabled},${input.enabled},${next.version}) RETURNING id`
      )[0]!;
      await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,safe_metadata)
        VALUES(${principal.row.user_id},'REGION_PUBLICATION_CONFIGURED','RegionPublicationAction',${action.id},'EXPLICIT_REGION_CONFIGURATION',${JSON.stringify({ region: input.region, enabled: input.enabled, version: next.version })}::jsonb)`;
      return {
        region: input.region,
        enabled: input.enabled,
        version: next.version,
        idempotent: false,
      };
    });
  }
}
