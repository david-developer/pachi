import { createHash } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { IdentityError } from "./identity.js";
import { lockListingRegion } from "./region-publication.js";
import {
  requireOrganizationResourceActor,
  requireOrganizationResourceSession,
  type OrganizationResourceActorContext,
} from "./organization-resource-actor.js";
import type { OrganizationActor } from "./organization-lifecycle.js";
import {
  readPublicListingVisibility,
  discoverable,
} from "./listing-visibility.js";
import { ListingSubmissionStore } from "./listing-submission.js";
import { readAuthorityRisk } from "./authority-risk.js";
import { snapshotAnalyticsContext } from "./analytics-context.js";

export const MARKET_STATES = {
  RENT: ["AVAILABLE", "UNDER_OFFER", "RENTED", "TEMPORARILY_UNAVAILABLE"],
  SALE: ["AVAILABLE", "UNDER_OFFER", "SOLD"],
  SHORT_LET: ["AVAILABLE", "PARTIALLY_BOOKED", "UNAVAILABLE"],
} as const;
type Purpose = keyof typeof MARKET_STATES;
export type ListingLifecycleState = {
  listing_id: string;
  version: number;
  purpose: Purpose;
  market_status: string;
  publication_status: string;
  moderation_status: string;
  revision_id: string;
  offering_version_id: string;
  last_confirmed_at: string | null;
  expires_at: string | null;
  region_enabled: boolean;
  visible: boolean;
  eligibility_reason: string;
  allowed_market_states: readonly string[];
  can_confirm_freshness: boolean;
};
const common = {
  expectedVersion: z.number().int().positive(),
  expectedRevisionId: z.uuid(),
  expectedOfferingVersionId: z.uuid(),
  idempotencyKey: z.uuid(),
};
const commandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...common,
      operation: z.literal("MARKET"),
      marketStatus: z.enum([
        "AVAILABLE",
        "UNDER_OFFER",
        "RENTED",
        "TEMPORARILY_UNAVAILABLE",
        "SOLD",
        "PARTIALLY_BOOKED",
        "UNAVAILABLE",
      ]),
    })
    .strict(),
  z.object({ ...common, operation: z.literal("FRESHNESS") }).strict(),
]);
export type ListingLifecycleCommand = z.infer<typeof commandSchema>;
type Row = {
  id: string;
  provider_account_id: string;
  provider_profile_id: string | null;
  organization_id: string | null;
  kind: string;
  owner_user_id: string | null;
  purpose: Purpose;
  market_status: string;
  publication_status: string;
  moderation_status: string;
  current_revision_id: string;
  offering_version_id: string;
  lifecycle_version: number;
  last_confirmed_at: string | null;
  expires_at: string | null;
  freshness_episode_id: string | null;
  region_enabled: boolean;
};
function fail(code: string): never {
  throw new IdentityError(code, code);
}
function batch(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail("INVALID_INPUT");
}

export class ListingLifecycleStore {
  constructor(
    private readonly client: postgres.Sql,
    private readonly allowSyntheticVerification = false,
  ) {}
  async read(
    actor: OrganizationActor,
    listingId: string,
  ): Promise<ListingLifecycleState> {
    if (!z.uuid().safeParse(listingId).success) fail("RESOURCE_SCOPE_DENIED");
    return this.client.begin(async (tx) => {
      await lockListingRegion(tx, listingId);
      const { row, organization } = await this.authorize(tx, actor, listingId);
      return this.project(tx, row, organization);
    });
  }
  async execute(
    actor: OrganizationActor,
    listingId: string,
    input: ListingLifecycleCommand,
  ): Promise<ListingLifecycleState> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success || !z.uuid().safeParse(listingId).success)
      fail("INVALID_INPUT");
    const command = parsed.data;
    const hash = createHash("sha256")
      .update(
        JSON.stringify({ listingId: listingId.toLowerCase(), ...command }),
      )
      .digest("hex");
    return this.client.begin(async (tx) => {
      await lockListingRegion(tx, listingId);
      await requireOrganizationResourceSession(tx, actor);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`listing-lifecycle:${actor.userId}:${command.idempotencyKey}`},0))`;
      const { row, organization } = await this.authorize(tx, actor, listingId);
      // Receipts are results, never grants. Resolve the CURRENT principal first.
      const prior = (
        await tx<
          {
            request_hash: string;
            provider_account_id: string;
            result: ListingLifecycleState;
          }[]
        >`SELECT request_hash,provider_account_id,result FROM listing_lifecycle_receipts WHERE actor_user_id=${actor.userId} AND idempotency_key=${command.idempotencyKey}`
      )[0];
      if (prior) {
        if (prior.provider_account_id !== row.provider_account_id)
          fail("RESOURCE_SCOPE_DENIED");
        if (prior.request_hash !== hash) fail("IDEMPOTENCY_KEY_REUSED");
        return prior.result;
      }
      if (
        row.lifecycle_version !== command.expectedVersion ||
        row.current_revision_id !== command.expectedRevisionId ||
        row.offering_version_id !== command.expectedOfferingVersionId
      )
        fail("STALE_VERSION");
      if (
        !["PUBLISHED", "EXPIRED"].includes(row.publication_status) ||
        row.moderation_status !== "APPROVED"
      )
        fail("INVALID_STATE");
      const target =
        command.operation === "MARKET"
          ? command.marketStatus
          : row.market_status;
      if (!(MARKET_STATES[row.purpose] as readonly string[]).includes(target))
        fail("INVALID_INPUT");
      const confirm =
        command.operation === "FRESHNESS" ||
        (target === "AVAILABLE" &&
          ["RENTED", "SOLD"].includes(row.market_status));
      if (
        confirm &&
        organization?.role === "AGENT" &&
        row.publication_status === "EXPIRED"
      )
        fail("CAPABILITY_RESTRICTED");
      if (confirm) {
        const eligibility = await readPublicListingVisibility(tx, listingId, {
          allowSyntheticVerification: this.allowSyntheticVerification,
          renewal: true,
          marketStatus: target,
        });
        if (!eligibility.visible) {
          // Material changes return to the existing draft/submission workflow.
          // Clone the current revision so an old submission receipt cannot be
          // reused when only the OfferingVersion changed.
          if (
            eligibility.reason === "APPROVED_SNAPSHOT_STALE" &&
            row.kind === "INDIVIDUAL"
          ) {
            const readiness = await new ListingSubmissionStore(
              this.client,
              this.allowSyntheticVerification,
            ).readinessInTransaction(tx, actor.userId, listingId);
            if (!readiness.checks.every((c) => c.status === "READY"))
              fail("PUBLICATION_REQUIREMENTS_BLOCKED");
            const revision = (
              await tx<
                { id: string }[]
              >`INSERT INTO listing_revisions(listing_id,version,title,description,created_by_user_id)
              SELECT listing_id,(SELECT max(version)+1 FROM listing_revisions WHERE listing_id=${listingId}),title,description,${actor.userId} FROM listing_revisions WHERE id=${row.current_revision_id} RETURNING id`
            )[0]!;
            await tx`UPDATE listings SET current_revision_id=${revision.id},publication_status='DRAFT',moderation_status='CHANGES_REQUIRED',
              approved_revision_id=NULL,approved_submission_id=NULL,approved_by_user_id=NULL,approved_at=NULL,updated_at=statement_timestamp() WHERE id=${listingId}`;
            const submitted = await new ListingSubmissionStore(
              this.client,
              this.allowSyntheticVerification,
            ).submitInTransaction(
              tx,
              actor.userId,
              listingId,
              {
                revisionId: revision.id,
                offeringVersionId: row.offering_version_id,
                idempotencyKey: command.idempotencyKey,
                requestId: null,
              },
              true,
            );
            if (!submitted.submission) fail("PUBLICATION_REQUIREMENTS_BLOCKED");
            await this.record(
              tx,
              row,
              actor,
              organization,
              "listing_renewal_review_required",
              "RENEWAL_REVIEW_REQUIRED",
            );
          } else fail("PUBLICATION_REQUIREMENTS_BLOCKED");
        } else {
          await tx`UPDATE listings SET market_status=${target},publication_status='PUBLISHED',last_confirmed_at=statement_timestamp(),
            expires_at=statement_timestamp()+CASE purpose WHEN 'RENT' THEN interval '30 days' WHEN 'SALE' THEN interval '60 days' ELSE interval '14 days' END,
            updated_at=statement_timestamp() WHERE id=${listingId}`;
          await this.record(
            tx,
            row,
            actor,
            organization,
            "listing_freshness_confirmed",
            "PROVIDER_FRESHNESS_CONFIRMATION",
          );
        }
      } else {
        // Withdrawal remains possible after expiry/region disable. Restoration
        // to a discoverable state needs every current guard (including expiry).
        if (discoverable(row.purpose, target)) {
          const eligible = await readPublicListingVisibility(tx, listingId, {
            allowSyntheticVerification: this.allowSyntheticVerification,
            marketStatus: target,
          });
          if (!eligible.visible) fail("PUBLICATION_REQUIREMENTS_BLOCKED");
        }
        await tx`UPDATE listings SET market_status=${target},updated_at=statement_timestamp() WHERE id=${listingId}`;
        if (target !== row.market_status)
          await this.record(
            tx,
            row,
            actor,
            organization,
            "listing_market_status_changed",
            "PROVIDER_MARKET_CHANGE",
          );
      }
      await requireOrganizationResourceSession(tx, actor);
      const next = (await this.rows(tx, listingId))[0]!;
      const result = await this.project(tx, next, organization);
      await tx`INSERT INTO listing_lifecycle_receipts(actor_user_id,idempotency_key,listing_id,provider_account_id,request_hash,result)
        VALUES(${actor.userId},${command.idempotencyKey},${listingId},${row.provider_account_id},${hash},${JSON.stringify(result)}::jsonb)`;
      return result;
    });
  }
  private async authorize(
    tx: postgres.TransactionSql,
    actor: OrganizationActor,
    listingId: string,
  ) {
    await requireOrganizationResourceSession(tx, actor);
    let row = (await this.rows(tx, listingId))[0];
    if (!row) fail("RESOURCE_SCOPE_DENIED");
    let organization: OrganizationResourceActorContext | null = null;
    if (row.kind === "ORGANIZATION" && row.organization_id) {
      organization = await requireOrganizationResourceActor(
        tx,
        actor,
        {
          organizationId: row.organization_id,
          resourceType: "LISTING",
          resourceId: listingId,
        },
        "LISTING_DRAFT",
      );
    } else if (row.kind !== "INDIVIDUAL" || row.owner_user_id !== actor.userId)
      fail("RESOURCE_SCOPE_DENIED");
    // Keep the provider context stable while a command waits for the listing.
    const provider =
      await tx`SELECT id FROM provider_accounts WHERE id=${row.provider_account_id} AND state='ACTIVE' FOR SHARE`;
    if (!provider[0]) fail("CAPABILITY_RESTRICTED");
    if (row.provider_profile_id) {
      const profile =
        await tx`SELECT id FROM provider_profiles WHERE id=${row.provider_profile_id} AND user_id=${actor.userId} AND state='ACTIVE' FOR SHARE`;
      if (!profile[0]) fail("CAPABILITY_RESTRICTED");
    }
    await tx`SELECT id FROM listings WHERE id=${listingId} FOR UPDATE`;
    const current = (await this.rows(tx, listingId))[0]!;
    if (
      current.provider_account_id !== row.provider_account_id ||
      current.organization_id !== row.organization_id ||
      current.owner_user_id !== row.owner_user_id
    )
      fail("RESOURCE_SCOPE_DENIED");
    row = current;
    // Pin the mutable eligibility inputs until the producing transaction commits.
    await tx`SELECT p.id,r.id FROM listings l JOIN properties p ON p.id=l.property_id JOIN provider_property_relationships r ON r.id=l.provider_property_relationship_id WHERE l.id=${listingId} FOR SHARE OF p,r`;
    await tx`SELECT o.id,ov.id FROM offerings o JOIN offering_versions ov ON ov.id=o.current_version_id WHERE o.listing_id=${listingId} FOR SHARE OF o,ov`;
    await tx`SELECT lm.id,ma.id FROM listing_media lm JOIN media_assets ma ON ma.id=lm.media_asset_id WHERE lm.listing_id=${listingId} FOR SHARE OF lm,ma`;
    if (row.provider_profile_id)
      await tx`SELECT provider_profile_id FROM verification_claims WHERE provider_profile_id=${row.provider_profile_id} FOR SHARE`;
    const relationship = (
      await tx<
        { id: string }[]
      >`SELECT provider_property_relationship_id AS id FROM listings WHERE id=${listingId}`
    )[0]!;
    const relationshipCurrent =
      await tx`SELECT r.id FROM provider_property_relationships r JOIN properties p ON p.id=r.property_id WHERE r.id=${relationship.id} AND r.provider_account_id=${row.provider_account_id} AND p.record_state='ACTIVE' AND r.authorization_status IN ('DECLARED','VERIFIED') AND (r.valid_from IS NULL OR r.valid_from<=statement_timestamp()) AND (r.valid_until IS NULL OR r.valid_until>statement_timestamp())`;
    if (!relationshipCurrent[0]) fail("CAPABILITY_RESTRICTED");
    await readAuthorityRisk(tx, relationship.id, row.provider_account_id, true);
    await requireOrganizationResourceSession(tx, actor);
    return { row, organization };
  }
  private rows(tx: postgres.TransactionSql, listingId: string) {
    return tx<
      Row[]
    >`SELECT l.id,l.provider_account_id,pa.kind,pa.provider_profile_id,pa.organization_id,pp.user_id AS owner_user_id,
      l.purpose,l.market_status,l.publication_status,l.moderation_status,l.current_revision_id,o.current_version_id AS offering_version_id,
      l.lifecycle_version,l.last_confirmed_at::text,l.expires_at::text,l.freshness_episode_id,
      COALESCE((SELECT enabled FROM region_publication_controls WHERE region=p.region),false) AS region_enabled
      FROM listings l JOIN provider_accounts pa ON pa.id=l.provider_account_id LEFT JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
      JOIN properties p ON p.id=l.property_id JOIN offerings o ON o.listing_id=l.id JOIN listing_revisions lr ON lr.id=l.current_revision_id AND lr.listing_id=l.id WHERE l.id=${listingId}`;
  }
  private async project(
    tx: postgres.TransactionSql,
    row: Row,
    organization: OrganizationResourceActorContext | null,
  ): Promise<ListingLifecycleState> {
    const visibility = await readPublicListingVisibility(tx, row.id, {
      allowSyntheticVerification: this.allowSyntheticVerification,
    });
    return {
      listing_id: row.id,
      version: row.lifecycle_version,
      purpose: row.purpose,
      market_status: row.market_status,
      publication_status: row.publication_status,
      moderation_status: row.moderation_status,
      revision_id: row.current_revision_id,
      offering_version_id: row.offering_version_id,
      last_confirmed_at: row.last_confirmed_at,
      expires_at: row.expires_at,
      region_enabled: row.region_enabled,
      visible: visibility.visible,
      eligibility_reason:
        row.kind === "ORGANIZATION"
          ? "BUSINESS_VERIFICATION_UNAVAILABLE"
          : visibility.reason,
      allowed_market_states: MARKET_STATES[row.purpose],
      can_confirm_freshness:
        row.kind === "INDIVIDUAL" &&
        row.region_enabled &&
        !(organization?.role === "AGENT") &&
        ["PUBLISHED", "EXPIRED"].includes(row.publication_status),
    };
  }
  private async record(
    tx: postgres.TransactionSql,
    before: Row,
    actor: OrganizationActor | null,
    organization: OrganizationResourceActorContext | null,
    event: string,
    reason: string,
    reminder?: { id: string; intended_at: string; days_before: number },
  ) {
    const after = (await this.rows(tx, before.id))[0]!;
    const action = (
      await tx<
        { id: string }[]
      >`INSERT INTO listing_lifecycle_actions(listing_id,provider_account_id,actor_user_id,membership_id,assignment_id,event_type,
      previous_market_status,market_status,previous_publication_status,publication_status,version,reason_code,episode_id,reminder_id)
      VALUES(${before.id},${before.provider_account_id},${actor?.userId ?? null},${organization?.membershipId ?? null},${organization?.assignmentId ?? null},${event},
        ${before.market_status},${after.market_status},${before.publication_status},${after.publication_status},${after.lifecycle_version},${reason},${after.freshness_episode_id},${reminder?.id ?? null}) RETURNING id`
    )[0]!;
    const payload = {
      listing_id: before.id,
      provider_account_id: before.provider_account_id,
      version: after.lifecycle_version,
      episode_id: after.freshness_episode_id,
      ...(reminder
        ? {
            reminder_id: reminder.id,
            intended_at: reminder.intended_at,
            days_before: reminder.days_before,
          }
        : {}),
      ...(["listing_freshness_confirmed", "listing_expired"].includes(event) &&
      before.kind === "INDIVIDUAL"
        ? {
            analytics: await snapshotAnalyticsContext(
              tx,
              before.id,
              this.allowSyntheticVerification,
            ),
          }
        : {}),
    };
    const emitted =
      await tx`INSERT INTO listing_lifecycle_outbox(action_id,event_type,safe_payload) SELECT ${action.id},${event},${JSON.stringify(payload)}::jsonb WHERE (${reminder?.intended_at ?? null}::timestamptz IS NULL OR ${reminder?.intended_at ?? null}::timestamptz>=statement_timestamp()) RETURNING id`;
    if (!emitted[0]) fail("REMINDER_DEADLINE_PASSED");
    await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,safe_metadata) VALUES(${actor?.userId ?? null},${event.toUpperCase()},'Listing',${before.id},${reason},${JSON.stringify({ action_id: action.id, version: after.lifecycle_version })}::jsonb)`;
  }
  async expireOnce(limit = 100): Promise<number> {
    batch(limit);
    return this.client.begin(async (tx) => {
      const candidates = await tx<
        { id: string }[]
      >`SELECT id FROM listings WHERE publication_status='PUBLISHED' AND expires_at<=statement_timestamp() ORDER BY expires_at,id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      for (const c of candidates) {
        const row = (await this.rows(tx, c.id))[0]!;
        await tx`UPDATE listings SET publication_status='EXPIRED',updated_at=statement_timestamp() WHERE id=${c.id}`;
        await this.record(
          tx,
          row,
          null,
          null,
          "listing_expired",
          "FRESHNESS_DEADLINE_ELAPSED",
        );
      }
      return candidates.length;
    });
  }
  /** Prepare durable FUTURE eligibility intents, not delivery. The future
   * notification consumer must recheck current episode/eligibility at intended_at.
   * Late polling skips a deadline rather than emitting a retroactive reminder. */
  async prepareRemindersOnce(
    limit = 100,
  ): Promise<{ eligible: number; skipped: number }> {
    batch(limit);
    // Read bounded candidates without retaining child locks while acquiring region
    // and listing locks. Each transaction locks parent before reminder receipt.
    const candidates = await this.client<
      { id: string; listing_id: string }[]
    >`SELECT r.id,e.listing_id FROM listing_freshness_reminders r JOIN listing_freshness_episodes e ON e.id=r.episode_id WHERE r.state='PENDING' ORDER BY r.intended_at,r.id LIMIT ${limit}`;
    let eligible = 0,
      skipped = 0;
    for (const c of candidates) {
      const outcome = await this.client
        .begin(async (tx) => {
          await lockListingRegion(tx, c.listing_id);
          const locked =
            await tx`SELECT id FROM listings WHERE id=${c.listing_id} FOR UPDATE SKIP LOCKED`;
          if (!locked[0]) return null;
          const reminder = (
            await tx<
              {
                id: string;
                episode_id: string;
                days_before: number;
                intended_at: string;
                timely: boolean;
              }[]
            >`SELECT id,episode_id,days_before,intended_at::text,(intended_at>=statement_timestamp()) AS timely FROM listing_freshness_reminders WHERE id=${c.id} AND state='PENDING' FOR UPDATE SKIP LOCKED`
          )[0];
          if (!reminder) return null;
          const row = (await this.rows(tx, c.listing_id))[0]!;
          const visibility = await readPublicListingVisibility(
            tx,
            c.listing_id,
            {
              allowSyntheticVerification: this.allowSyntheticVerification,
            },
          );
          const ok =
            reminder.timely &&
            reminder.episode_id === row.freshness_episode_id &&
            visibility.visible;
          await tx`UPDATE listing_freshness_reminders SET state=${ok ? "ELIGIBLE" : "SKIPPED"},processed_at=statement_timestamp() WHERE id=${c.id}`;
          if (ok)
            await this.record(
              tx,
              row,
              null,
              null,
              "listing_freshness_reminder_scheduled",
              "REMINDER_ELIGIBILITY",
              reminder,
            );
          return ok;
        })
        .catch(async (error: unknown) => {
          if (
            !(error instanceof IdentityError) ||
            error.code !== "REMINDER_DEADLINE_PASSED"
          )
            throw error;
          // The producing transaction rolled back every effect; persist only the
          // missed schedule disposition. No event and no delivery retry.
          await this
            .client`UPDATE listing_freshness_reminders SET state='SKIPPED',processed_at=statement_timestamp() WHERE id=${c.id} AND state='PENDING' AND intended_at<statement_timestamp()`;
          return false;
        });
      if (outcome === true) eligible++;
      else if (outcome === false) skipped++;
    }
    return { eligible, skipped };
  }
}
