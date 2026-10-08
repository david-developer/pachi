import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { createDatabase } from "./client.js";
import {
  listingLifecycleFixture,
  regionStaffFixture,
} from "./listing-lifecycle-fixture.js";
import { ListingLifecycleStore, MARKET_STATES } from "./listing-lifecycle.js";
import { RegionPublicationStore } from "./region-publication.js";
import { readPublicListingVisibility } from "./listing-visibility.js";
import { InteractionStore } from "./interaction.js";
import { AnalyticsStore } from "./analytics.js";
import { ListingSubmissionStore } from "./listing-submission.js";
import { ListingModerationStore } from "./listing-moderation.js";
import { organizationAssignmentFixture } from "./organization-assignment-fixture.js";
import { OrganizationAssignmentStore } from "./organization-assignments.js";
import { AuthorityRiskStore } from "./authority-risk.js";

const url = process.env.DATABASE_TEST_URL;
if (url) {
  const u = new URL(url);
  assert.equal(u.hostname, "localhost");
  assert.equal(u.port, "5433");
  assert.equal(u.pathname, "/pachi_test");
}
const integration = url ? test : test.skip;
function dedicated() {
  const c = postgres(url!, { max: 1, prepare: false });
  drizzle(c);
  return c;
}
async function fixture(purpose: keyof typeof MARKET_STATES = "RENT") {
  const { client } = createDatabase(url!);
  await client`SET client_min_messages TO warning`;
  await client`TRUNCATE users RESTART IDENTITY CASCADE`;
  await client`UPDATE region_publication_controls SET enabled=true`;
  try {
    return {
      ...(await listingLifecycleFixture(client, purpose)),
      client,
      close: () => client.end(),
    };
  } catch (error) {
    await client.end();
    throw error;
  }
}
for (const purpose of ["RENT", "SALE", "SHORT_LET"] as const)
  void integration(
    `G3-E canonical ${purpose} market states and server freshness window`,
    async () => {
      const f = await fixture(purpose);
      try {
        let state = f.state;
        for (const marketStatus of MARKET_STATES[purpose]) {
          state = await f.store.execute(f.actor, f.listingId, {
            ...f.command(state),
            operation: "MARKET",
            marketStatus,
          });
          assert.equal(state.market_status, marketStatus);
          assert.equal(
            state.visible,
            ["AVAILABLE", "UNDER_OFFER", "PARTIALLY_BOOKED"].includes(
              marketStatus,
            ),
          );
        }
        state = await f.store.execute(f.actor, f.listingId, {
          ...f.command(state),
          operation: "MARKET",
          marketStatus: "AVAILABLE",
        });
        state = await f.store.execute(f.actor, f.listingId, {
          ...f.command(state),
          operation: "FRESHNESS",
        });
        const days = (
          await f.client<
            { days: number }[]
          >`SELECT extract(epoch FROM expires_at-last_confirmed_at)/86400 AS days FROM listings WHERE id=${f.listingId}`
        )[0]!.days;
        assert.equal(
          Number(days),
          purpose === "RENT" ? 30 : purpose === "SALE" ? 60 : 14,
        );
        assert.ok(state.visible);
      } finally {
        await f.close();
      }
    },
  );
void integration(
  "G3-E exact receipt replay is effect-free and changed bodies or revoked authority fail closed",
  async () => {
    const f = await fixture();
    try {
      const command = {
        ...f.command(),
        operation: "MARKET" as const,
        marketStatus: "UNDER_OFFER" as const,
      };
      const one = await f.store.execute(f.actor, f.listingId, command);
      assert.deepEqual(
        await f.store.execute(f.actor, f.listingId, command),
        one,
      );
      assert.equal(
        (
          await f.client`SELECT id FROM listing_lifecycle_actions WHERE listing_id=${f.listingId}`
        ).length,
        1,
      );
      assert.equal(
        (await f.client`SELECT id FROM listing_lifecycle_outbox`).length,
        1,
      );
      await assert.rejects(
        f.store.execute(f.actor, f.listingId, {
          ...command,
          marketStatus: "RENTED",
        }),
        { code: "IDEMPOTENCY_KEY_REUSED" },
      );
      await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${f.actor.sessionId}`;
      await assert.rejects(f.store.execute(f.actor, f.listingId, command), {
        code: "AUTH_REQUIRED",
      });
    } finally {
      await f.close();
    }
  },
);
for (const denial of [
  "pending-phone",
  "suspended",
  "deactivated",
  "revoked-session",
  "expired-session",
  "security-version",
  "unrelated-provider",
  "provider-inactive",
  "relationship-expired",
  "authority-stale",
  "stale-version",
  "purpose-invalid",
  "archived",
  "removed",
  "hidden",
  "media-ineligible",
  "identity-revoked",
  "disabled-region",
] as const)
  void integration(`G3-E denial: ${denial}`, async () => {
    const f = await fixture();
    try {
      let actor = f.actor;
      let command = { ...f.command(), operation: "FRESHNESS" as const };
      if (["pending-phone", "suspended", "deactivated"].includes(denial))
        await f.client`UPDATE users SET account_state=${denial === "pending-phone" ? "PENDING_PHONE" : denial.toUpperCase()} WHERE id=${f.actor.userId}`;
      if (denial === "revoked-session")
        await f.client`UPDATE security_sessions SET revoked_at=statement_timestamp() WHERE id=${f.actor.sessionId}`;
      if (denial === "expired-session")
        await f.client`UPDATE security_sessions SET expires_at=statement_timestamp()-interval '1 second' WHERE id=${f.actor.sessionId}`;
      if (denial === "security-version")
        actor = { ...actor, securityVersion: 1 };
      if (denial === "unrelated-provider")
        actor = { ...actor, userId: f.seekerId };
      if (denial === "provider-inactive")
        await f.client`UPDATE provider_accounts SET state='SUSPENDED' WHERE id=(SELECT provider_account_id FROM listings WHERE id=${f.listingId})`;
      if (denial === "relationship-expired")
        await f.client`UPDATE provider_property_relationships SET valid_until=statement_timestamp()-interval '1 second' WHERE id=(SELECT provider_property_relationship_id FROM listings WHERE id=${f.listingId})`;
      if (denial === "authority-stale")
        await f.client`UPDATE provider_property_relationships SET authorization_status='PENDING' WHERE id=(SELECT provider_property_relationship_id FROM listings WHERE id=${f.listingId})`;
      if (denial === "stale-version")
        command = { ...command, expectedVersion: 1 };
      if (["archived", "removed", "hidden"].includes(denial)) {
        await f.client`UPDATE listings SET publication_status=${denial.toUpperCase()} WHERE id=${f.listingId}`;
        command = {
          ...command,
          ...f.command(await f.store.read(actor, f.listingId)),
        };
      }
      if (denial === "media-ineligible")
        await f.client`UPDATE listing_media SET review_status='REJECTED' WHERE listing_id=${f.listingId}`;
      if (denial === "identity-revoked")
        await f.client`UPDATE verification_claims SET revoked_at=statement_timestamp() WHERE provider_profile_id=(SELECT provider_profile_id FROM provider_accounts WHERE id=(SELECT provider_account_id FROM listings WHERE id=${f.listingId}))`;
      if (denial === "disabled-region")
        await f.client`UPDATE region_publication_controls SET enabled=false WHERE region='Littoral'`;
      const invalid =
        denial === "purpose-invalid"
          ? {
              ...f.command(),
              operation: "MARKET" as const,
              marketStatus: "SOLD" as const,
            }
          : command;
      await assert.rejects(f.store.execute(actor, f.listingId, invalid));
      assert.equal(
        (await f.client`SELECT * FROM listing_lifecycle_actions`).length,
        0,
      );
    } finally {
      await f.client`UPDATE region_publication_controls SET enabled=true`;
      await f.close();
    }
  });
void integration(
  "G3-E expiry denies public reads before materialization, unchanged renewal explicitly republishes and analytics deduplicate",
  async () => {
    const f = await fixture();
    try {
      await f.client`UPDATE listings SET last_confirmed_at=statement_timestamp()-interval '31 days',expires_at=statement_timestamp()-interval '1 day' WHERE id=${f.listingId}`;
      assert.equal(
        (
          await readPublicListingVisibility(f.client, f.listingId, {
            allowSyntheticVerification: true,
          })
        ).visible,
        false,
      );
      await assert.rejects(
        new InteractionStore(f.client, true).createOrReuseInquiry(
          f.seekerId,
          f.listingId,
          randomUUID(),
        ),
        { code: "PUBLIC_LISTING_NOT_FOUND" },
      );
      assert.equal(await f.store.expireOnce(), 1);
      assert.equal(await f.store.expireOnce(), 0);
      const state = await f.store.read(f.actor, f.listingId);
      assert.equal(state.publication_status, "EXPIRED");
      const renewed = await f.store.execute(f.actor, f.listingId, {
        ...f.command(state),
        operation: "FRESHNESS",
      });
      assert.equal(renewed.publication_status, "PUBLISHED");
      assert.equal(renewed.visible, true);
      const analytics = new AnalyticsStore(
        f.client,
        "synthetic-only-lifecycle-analytics-secret",
      );
      assert.equal(
        (
          await analytics.processAnalyticsOnce({
            streams: ["listing_lifecycle_outbox"],
          })
        ).consumed,
        2,
      );
      assert.equal(
        (
          await analytics.processAnalyticsOnce({
            streams: ["listing_lifecycle_outbox"],
          })
        ).consumed,
        0,
      );
    } finally {
      await f.close();
    }
  },
);
void integration(
  "G3-E stale material snapshot returns to canonical submitted review and never refreshes approval",
  async () => {
    const f = await fixture();
    try {
      const revision = (
        await f.client<
          { id: string }[]
        >`INSERT INTO listing_revisions(listing_id,version,title,description,created_by_user_id) VALUES(${f.listingId},2,'Changed title','Changed material description',${f.actor.userId}) RETURNING id`
      )[0]!;
      await f.client`UPDATE listings SET current_revision_id=${revision.id},publication_status='EXPIRED' WHERE id=${f.listingId}`;
      await new AuthorityRiskStore(f.client).evaluate(
        (
          await f.client`SELECT provider_property_relationship_id AS id FROM listings WHERE id=${f.listingId}`
        )[0]!.id,
      );
      const state = await f.store.read(f.actor, f.listingId),
        next = await f.store.execute(f.actor, f.listingId, {
          ...f.command(state),
          operation: "FRESHNESS",
        });
      assert.equal(next.publication_status, "PENDING_REVIEW");
      assert.equal(next.moderation_status, "IN_REVIEW");
      assert.equal(next.visible, false);
      const readiness = await new ListingSubmissionStore(
        f.client,
        true,
      ).readiness(f.actor.userId, f.listingId);
      assert.ok(readiness.submission);
      assert.equal(readiness.submission.revisionId, next.revision_id);
    } finally {
      await f.close();
    }
  },
);
void integration(
  "G3-E reminder intents are future-only, episode-unique, ineligible and missed deadlines skip without retroactive events",
  async () => {
    const f = await fixture();
    try {
      const first = await f.store.prepareRemindersOnce();
      assert.equal(first.eligible, 4);
      assert.deepEqual(await f.store.prepareRemindersOnce(), {
        eligible: 0,
        skipped: 0,
      });
      const next = await f.store.execute(f.actor, f.listingId, {
        ...f.command(),
        operation: "FRESHNESS",
      });
      assert.ok(next.expires_at);
      await f.client`UPDATE listing_freshness_reminders SET intended_at=statement_timestamp()-interval '1 day' WHERE state='PENDING'`;
      assert.deepEqual(await f.store.prepareRemindersOnce(), {
        eligible: 0,
        skipped: 2,
      });
      await f.store.execute(f.actor, f.listingId, {
        ...f.command(next),
        operation: "FRESHNESS",
      });
      await f.client`UPDATE region_publication_controls SET enabled=false WHERE region='Littoral'`;
      assert.deepEqual(await f.store.prepareRemindersOnce(), {
        eligible: 0,
        skipped: 2,
      });
      assert.equal(
        (
          await f.client`SELECT id FROM listing_lifecycle_outbox WHERE event_type='listing_freshness_reminder_scheduled'`
        ).length,
        4,
      );
      await assert.rejects(
        f.client`UPDATE listing_lifecycle_actions SET reason_code='PROVIDER_MARKET_CHANGE'`,
      );
      await assert.rejects(f.client`DELETE FROM listing_lifecycle_receipts`);
    } finally {
      await f.client`UPDATE region_publication_controls SET enabled=true`;
      await f.close();
    }
  },
);
void integration(
  "G3-E current organization roles and exact assignments permit withdrawal without inventing BUSINESS publication authority",
  async () => {
    const f = await fixture();
    try {
      const org = await organizationAssignmentFixture(f.client);
      const id = f.listingId;
      const relationship = (
        await f.client`INSERT INTO provider_property_relationships(property_id,provider_account_id,relationship_type) SELECT property_id,${org.org.provider_account_id},'OWNER' FROM listings WHERE id=${id} RETURNING id`
      )[0]!;
      await f.client`UPDATE listings SET provider_account_id=${org.org.provider_account_id},provider_property_relationship_id=${relationship.id} WHERE id=${id}`;
      org.listingIds[0] = id;
      const assignments = new OrganizationAssignmentStore(f.client);
      const assignment = await assignments.assign(
        org.actors.owner,
        org.resource("LISTING"),
        org.memberships.agent,
        { ...org.command(), expectedVersion: 0 },
      );
      for (const name of ["owner", "admin", "manager", "agent"] as const) {
        const state = await f.store.read(org.actors[name], id);
        const result = await f.store.execute(org.actors[name], id, {
          ...f.command(state),
          operation: "MARKET",
          marketStatus: "RENTED",
        });
        assert.equal(result.market_status, "RENTED");
        assert.equal(result.can_confirm_freshness, false);
      }
      for (const name of [
        "analyst",
        "unrelated",
        "otherOwner",
        "invited",
        "suspended",
        "revoked",
      ] as const)
        await assert.rejects(f.store.read(org.actors[name], id));
      await assignments.revoke(
        org.actors.owner,
        org.resource("LISTING"),
        assignment.id,
        { ...org.command(), expectedVersion: 1 },
      );
      await assert.rejects(f.store.read(org.actors.agent, id), {
        code: "RESOURCE_SCOPE_DENIED",
      });
      const state = await f.store.read(org.actors.owner, id);
      await assert.rejects(
        f.store.execute(org.actors.owner, id, {
          ...f.command(state),
          operation: "MARKET",
          marketStatus: "AVAILABLE",
        }),
        { code: "PUBLICATION_REQUIREMENTS_BLOCKED" },
      );
    } finally {
      await f.close();
    }
  },
);
void integration(
  "G3-E explicit region grant, current step-up and versioned receipt control all public surfaces while preserving safe history",
  async () => {
    const f = await fixture();
    try {
      const interactions = new InteractionStore(f.client, true),
        inquiry = await interactions.createOrReuseInquiry(
          f.seekerId,
          f.listingId,
          randomUUID(),
        );
      const staff = await regionStaffFixture(f.client),
        store = new RegionPublicationStore(f.client),
        version = (
          await f.client`SELECT version FROM region_publication_controls WHERE region='Littoral'`
        )[0]!.version;
      const command = {
        region: "Littoral" as const,
        enabled: false,
        expectedVersion: version,
        idempotencyKey: randomUUID(),
      };
      const one = await store.configure(staff, command);
      assert.equal(
        (await store.configure(staff, command)).version,
        one.version,
      );
      await assert.rejects(
        store.configure(staff, { ...command, enabled: true }),
        { code: "IDEMPOTENCY_KEY_REUSED" },
      );
      assert.equal(
        (
          await readPublicListingVisibility(f.client, f.listingId, {
            allowSyntheticVerification: true,
          })
        ).visible,
        false,
      );
      await assert.rejects(
        interactions.createOrReuseInquiry(
          f.otherUserId,
          f.listingId,
          randomUUID(),
        ),
        { code: "PUBLIC_LISTING_NOT_FOUND" },
      );
      assert.equal(
        (await interactions.read(f.seekerId, inquiry.interaction_id))
          .listing_visible,
        false,
      );
      await f.client`UPDATE staff_grants SET revoked_at=statement_timestamp() WHERE user_id=${staff.row.user_id}`;
      await assert.rejects(store.configure(staff, command), {
        code: "RESOURCE_SCOPE_DENIED",
      });
    } finally {
      await f.client`UPDATE region_publication_controls SET enabled=true`;
      await f.close();
    }
  },
);

// Watchdog only bounds a failed test. Actual backend lock queues establish overlap.
async function waiting(observer: postgres.Sql, pid: number) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (
      (
        await observer`SELECT pid FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'`
      )[0]
    )
      return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw Error("Expected G3-E backend at PostgreSQL lock barrier");
}

for (const material of ["property", "media-order"] as const)
  void integration(
    `G3-E material approval snapshot: ${material} requires renewed moderation`,
    async () => {
      const f = await fixture();
      try {
        if (material === "property")
          await f.client`UPDATE properties SET bedrooms=3 WHERE id=(SELECT property_id FROM listings WHERE id=${f.listingId})`;
        else
          await f.client`UPDATE listing_media SET display_order=1 WHERE listing_id=${f.listingId}`;
        await new AuthorityRiskStore(f.client).evaluate(
          (
            await f.client`SELECT provider_property_relationship_id AS id FROM listings WHERE id=${f.listingId}`
          )[0]!.id,
        );
        const state = await f.store.read(f.actor, f.listingId);
        assert.equal(state.visible, false);
        const next = await f.store.execute(f.actor, f.listingId, {
          ...f.command(state),
          operation: "FRESHNESS",
        });
        assert.equal(next.publication_status, "PENDING_REVIEW");
        assert.equal(next.moderation_status, "IN_REVIEW");
        assert.equal(next.visible, false);
      } finally {
        await f.close();
      }
    },
  );
void integration(
  "G3-E reassigned provider cannot renew the original listing or inherit its historical approval",
  async () => {
    const f = await fixture();
    try {
      const old = (
        await f.client`SELECT initial_provider_account_id FROM listings WHERE id=${f.listingId}`
      )[0]!;
      const profile = (
        await f.client`INSERT INTO provider_profiles(user_id,provider_types,display_name,state) VALUES(${f.seekerId},ARRAY['OWNER'],'Changed responsible provider','ACTIVE') RETURNING id`
      )[0]!;
      const provider = (
        await f.client`INSERT INTO provider_accounts(provider_profile_id,state) VALUES(${profile.id},'ACTIVE') RETURNING id`
      )[0]!;
      const relationship = (
        await f.client`INSERT INTO provider_property_relationships(property_id,provider_account_id,relationship_type) SELECT property_id,${provider.id},'OWNER' FROM listings WHERE id=${f.listingId} RETURNING id`
      )[0]!;
      await f.client`UPDATE listings SET provider_account_id=${provider.id},provider_property_relationship_id=${relationship.id} WHERE id=${f.listingId}`;
      const session = (
        await f.client`INSERT INTO security_sessions(user_id,issuer,app_client_id,origin_jti,current_jti,expires_at) VALUES(${f.seekerId},'https://local.test/lifecycle','account',${randomUUID()},${randomUUID()},statement_timestamp()+interval '1 hour') RETURNING id`
      )[0]!;
      const actor = {
        userId: f.seekerId,
        sessionId: session.id,
        securityVersion: 0,
      };
      await assert.rejects(f.store.read(f.actor, f.listingId), {
        code: "RESOURCE_SCOPE_DENIED",
      });
      const state = await f.store.read(actor, f.listingId);
      assert.equal(state.eligibility_reason, "PROVIDER_CONTEXT_CHANGED");
      await assert.rejects(
        f.store.execute(actor, f.listingId, {
          ...f.command(state),
          operation: "FRESHNESS",
        }),
        { code: "PUBLICATION_REQUIREMENTS_BLOCKED" },
      );
      assert.equal(
        (
          await f.client`SELECT initial_provider_account_id FROM listings WHERE id=${f.listingId}`
        )[0]!.initial_provider_account_id,
        old.initial_provider_account_id,
      );
      await assert.rejects(
        f.client`UPDATE listings SET initial_provider_account_id=${provider.id} WHERE id=${f.listingId}`,
      );
    } finally {
      await f.close();
    }
  },
);

for (const denial of [
  "platform-scope",
  "wrong-region",
  "expired-grant",
  "stale-step-up",
  "session-security-version",
] as const)
  void integration(`G3-E region configuration denial: ${denial}`, async () => {
    const f = await fixture();
    try {
      const staff = await regionStaffFixture(f.client),
        store = new RegionPublicationStore(f.client),
        version = (
          await f.client`SELECT version FROM region_publication_controls WHERE region='Littoral'`
        )[0]!.version;
      if (denial === "platform-scope" || denial === "wrong-region")
        await f.client`UPDATE staff_grants SET permission_scope=${JSON.stringify({ kind: denial === "platform-scope" ? "platform" : "region", id: denial === "platform-scope" ? "platform" : "Southwest", permissions: ["configuration:manage"] })}::jsonb WHERE user_id=${staff.row.user_id}`;
      if (denial === "expired-grant")
        await f.client`UPDATE staff_grants SET active_from=statement_timestamp()-interval '2 hours',expires_at=statement_timestamp()-interval '1 hour' WHERE user_id=${staff.row.user_id}`;
      if (denial === "stale-step-up")
        await f.client`UPDATE staff_sessions SET authenticated_at=statement_timestamp()-interval '16 minutes' WHERE id=${staff.row.id}`;
      if (denial === "session-security-version")
        await f.client`UPDATE users SET security_version=security_version+1 WHERE id=${staff.row.user_id}`;
      await assert.rejects(
        store.configure(staff, {
          region: "Littoral",
          enabled: false,
          expectedVersion: version,
          idempotencyKey: randomUUID(),
        }),
      );
      assert.equal(
        (
          await f.client`SELECT enabled FROM region_publication_controls WHERE region='Littoral'`
        )[0]!.enabled,
        true,
      );
    } finally {
      await f.close();
    }
  });
const races = [
  "competing-market",
  "same-key",
  "changed-body",
  "duplicate-confirmation",
  "withdraw-then-inquiry",
  "region-then-renewal",
  "renewal-then-region",
  "region-then-inquiry",
  "region-then-publication",
  "revision-then-renewal",
  "offering-then-renewal",
  "eligibility-loss-then-return",
] as const;
for (const race of races)
  void integration(`controlled G3-E race: ${race}`, async () => {
    const f = await fixture(),
      a = dedicated(),
      b = dedicated(),
      gate = dedicated();
    let release!: () => void, arrived!: () => void;
    const free = new Promise<void>((r) => {
        release = r;
      }),
      held = new Promise<void>((r) => {
        arrived = r;
      });
    let holder: Promise<unknown> | undefined;
    const pending: Promise<PromiseSettledResult<unknown>[]>[] = [];
    try {
      let state = f.state;
      if (race.includes("return"))
        state = await f.store.execute(f.actor, f.listingId, {
          ...f.command(state),
          operation: "MARKET",
          marketStatus: "RENTED",
        });
      const command = { ...f.command(state), operation: "FRESHNESS" as const },
        market = {
          ...f.command(state),
          operation: "MARKET" as const,
          marketStatus: race.includes("return")
            ? ("AVAILABLE" as const)
            : ("RENTED" as const),
        };
      const firstStore = new ListingLifecycleStore(a, true),
        secondStore = new ListingLifecycleStore(b, true);
      const region = race.includes("region");
      const staff = await regionStaffFixture(f.client);
      if (race === "region-then-publication")
        await f.client`UPDATE listings SET publication_status='PENDING_REVIEW',moderation_status='IN_REVIEW' WHERE id=${f.listingId}`;
      holder = gate.begin(async (tx) => {
        if (region)
          await tx`SELECT region FROM region_publication_controls WHERE region='Littoral' FOR UPDATE`;
        else
          await tx`SELECT id FROM listings WHERE id=${f.listingId} FOR UPDATE`;
        arrived();
        await free;
      });
      await held;
      const aPid = (
          await a<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
        )[0]!.pid,
        bPid = (await b<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!
          .pid;
      const disable = (c: postgres.Sql) =>
        c`UPDATE region_publication_controls SET enabled=false WHERE region='Littoral'`;
      const revision = (c: postgres.Sql) =>
        c.begin(async (tx) => {
          await tx`SELECT id FROM listings WHERE id=${f.listingId} FOR UPDATE`;
          const rev = (
            await tx`INSERT INTO listing_revisions(listing_id,version,title,description,created_by_user_id) VALUES(${f.listingId},2,'Race changed title','Race description',${f.actor.userId}) RETURNING id`
          )[0]!;
          await tx`UPDATE listings SET current_revision_id=${rev.id} WHERE id=${f.listingId}`;
        });
      const offering = (c: postgres.Sql) =>
        c.begin(async (tx) => {
          await tx`SELECT id FROM listings WHERE id=${f.listingId} FOR UPDATE`;
          const version = (
            await tx`INSERT INTO offering_versions(offering_id,version,currency,amount_minor,pricing_period,available_from,created_by_user_id) SELECT offering_id,2,currency,amount_minor+100,pricing_period,available_from,created_by_user_id FROM offering_versions WHERE id=${state.offering_version_id} RETURNING id,offering_id`
          )[0]!;
          await tx`UPDATE offerings SET current_version_id=${version.id} WHERE id=${version.offering_id}`;
        });
      const loss = (c: postgres.Sql) =>
        c.begin(async (tx) => {
          await tx`SELECT id FROM listings WHERE id=${f.listingId} FOR UPDATE`;
          await tx`UPDATE verification_claims SET revoked_at=statement_timestamp() WHERE provider_profile_id=(SELECT provider_profile_id FROM provider_accounts WHERE id=(SELECT provider_account_id FROM listings WHERE id=${f.listingId}))`;
        });
      const first = race.startsWith("region-")
        ? disable(a)
        : race === "revision-then-renewal"
          ? revision(a)
          : race === "offering-then-renewal"
            ? offering(a)
            : race === "eligibility-loss-then-return"
              ? loss(a)
              : race.includes("market") ||
                  race === "same-key" ||
                  race === "changed-body" ||
                  race === "withdraw-then-inquiry" ||
                  race.includes("return")
                ? firstStore.execute(f.actor, f.listingId, market)
                : firstStore.execute(f.actor, f.listingId, command);
      pending.push(Promise.allSettled([first]));
      await waiting(f.client, aPid);
      let second: Promise<unknown>;
      if (race.endsWith("inquiry"))
        second = new InteractionStore(b, true).createOrReuseInquiry(
          f.seekerId,
          f.listingId,
          randomUUID(),
        );
      else if (race === "region-then-publication") {
        const s = (
          await f.client`SELECT approved_submission_id AS id,current_revision_id AS revision_id FROM listings WHERE id=${f.listingId}`
        )[0]!;
        const rev = (
          await f.client`SELECT version FROM listing_revisions WHERE id=${s.revision_id}`
        )[0]!.version;
        await f.client`UPDATE staff_grants SET role='LISTING_MODERATOR',permission_scope=${JSON.stringify({ kind: "region", id: "Littoral", permissions: ["listing:moderate"] })}::jsonb WHERE user_id=${staff.row.user_id}`;
        second = new ListingModerationStore(
          b,
          new ListingSubmissionStore(b, true),
        ).decide(staff, f.listingId, {
          submissionId: s.id,
          revisionId: s.revision_id,
          expectedVersion: rev,
          command: "APPROVE_AND_PUBLISH",
          reasonCode: "CONTENT_REVIEWED",
          reasonText: "Synthetic race review",
          idempotencyKey: randomUUID(),
          requestId: randomUUID(),
        });
      } else if (race === "renewal-then-region") second = disable(b);
      else if (race === "same-key")
        second = secondStore.execute(f.actor, f.listingId, market);
      else if (race === "changed-body")
        second = secondStore.execute(f.actor, f.listingId, {
          ...market,
          marketStatus: "UNDER_OFFER",
        });
      else if (race === "competing-market")
        second = secondStore.execute(f.actor, f.listingId, {
          ...market,
          idempotencyKey: randomUUID(),
          marketStatus: "UNDER_OFFER",
        });
      else
        second = secondStore.execute(
          f.actor,
          f.listingId,
          race.includes("return")
            ? market
            : { ...command, idempotencyKey: randomUUID() },
        );
      pending.push(Promise.allSettled([second]));
      await waiting(f.client, bPid);
      release();
      await holder;
      const one = (await pending[0]!)[0]!,
        two = (await pending[1]!)[0]!;
      assert.equal(
        one.status,
        "fulfilled",
        one.status === "rejected" ? String(one.reason) : "",
      );
      const expected =
        race === "same-key" || race === "renewal-then-region"
          ? null
          : race === "changed-body"
            ? "IDEMPOTENCY_KEY_REUSED"
            : race.endsWith("inquiry")
              ? "PUBLIC_LISTING_NOT_FOUND"
              : race.startsWith("region-") ||
                  race === "eligibility-loss-then-return"
                ? "PUBLICATION_REQUIREMENTS_BLOCKED"
                : "STALE_VERSION";
      assert.equal(
        two.status,
        expected ? "rejected" : "fulfilled",
        two.status === "rejected"
          ? String(two.reason)
          : "unexpected fulfillment",
      );
      if (expected)
        assert.equal((two as PromiseRejectedResult).reason.code, expected);
      if (race === "same-key")
        assert.deepEqual(
          (one as PromiseFulfilledResult<unknown>).value,
          (two as PromiseFulfilledResult<unknown>).value,
        );
      if (region || race === "withdraw-then-inquiry")
        assert.equal(
          (
            await readPublicListingVisibility(f.client, f.listingId, {
              allowSyntheticVerification: true,
            })
          ).visible,
          false,
        );
    } finally {
      release?.();
      await holder?.catch(() => {});
      await Promise.all(pending);
      await Promise.all([a.end(), b.end(), gate.end()]);
      await f.client`UPDATE region_publication_controls SET enabled=true`;
      await f.close();
    }
  });
for (const kind of ["expiry", "reminder"] as const)
  void integration(
    `controlled G3-E workers: duplicate ${kind} workers skip a locked listing and commit unique effects`,
    async () => {
      const f = await fixture(),
        a = dedicated(),
        b = dedicated(),
        gate = dedicated();
      let release!: () => void, arrived!: () => void;
      const free = new Promise<void>((r) => {
          release = r;
        }),
        held = new Promise<void>((r) => {
          arrived = r;
        });
      let holder: Promise<unknown> | undefined;
      try {
        if (kind === "expiry")
          await f.client`UPDATE listings SET last_confirmed_at=statement_timestamp()-interval '31 days',expires_at=statement_timestamp()-interval '1 day' WHERE id IN (${f.listingId},${f.otherListingId})`;
        holder = gate.begin(async (tx) => {
          await tx`SELECT id FROM listings WHERE id IN (${f.listingId},${f.otherListingId}) FOR UPDATE`;
          arrived();
          await free;
        });
        await held;
        const first = new ListingLifecycleStore(a, true),
          second = new ListingLifecycleStore(b, true);
        const results = await Promise.all(
          kind === "expiry"
            ? [first.expireOnce(), second.expireOnce()]
            : [first.prepareRemindersOnce(), second.prepareRemindersOnce()],
        );
        assert.deepEqual(
          results,
          kind === "expiry"
            ? [0, 0]
            : [
                { eligible: 0, skipped: 0 },
                { eligible: 0, skipped: 0 },
              ],
        );
        release();
        await holder;
        await Promise.all(
          kind === "expiry"
            ? [first.expireOnce(), second.expireOnce()]
            : [first.prepareRemindersOnce(), second.prepareRemindersOnce()],
        );
        const count = (
          await f.client`SELECT id FROM listing_lifecycle_outbox WHERE event_type=${kind === "expiry" ? "listing_expired" : "listing_freshness_reminder_scheduled"}`
        ).length;
        assert.equal(count, kind === "expiry" ? 2 : 4);
      } finally {
        release?.();
        await holder?.catch(() => {});
        await Promise.all([a.end(), b.end(), gate.end()]);
        await f.close();
      }
    },
  );

for (const purpose of ["RENT", "SALE", "FRESHNESS"] as const)
  for (const order of ["confirmation-first", "worker-first"] as const)
    void integration(
      `controlled G3-E actual expiry worker: ${purpose} return ${order}`,
      async () => {
        const f = await fixture(purpose === "SALE" ? "SALE" : "RENT"),
          a = dedicated(),
          b = dedicated(),
          gate = dedicated();
        let release!: () => void, arrived!: () => void;
        const free = new Promise<void>((r) => {
            release = r;
          }),
          held = new Promise<void>((r) => {
            arrived = r;
          });
        let holder: Promise<unknown> | undefined;
        const pending: Promise<PromiseSettledResult<unknown>[]>[] = [];
        try {
          const unavailable =
            purpose === "FRESHNESS"
              ? f.state
              : await f.store.execute(f.actor, f.listingId, {
                  ...f.command(),
                  operation: "MARKET",
                  marketStatus: purpose === "RENT" ? "RENTED" : "SOLD",
                });
          assert.ok(unavailable.version);
          await f.client`UPDATE listings SET last_confirmed_at=statement_timestamp()-interval '61 days',expires_at=statement_timestamp()-interval '1 day' WHERE id=${f.listingId}`;
          const state = await f.store.read(f.actor, f.listingId),
            command =
              purpose === "FRESHNESS"
                ? { ...f.command(state), operation: "FRESHNESS" as const }
                : {
                    ...f.command(state),
                    operation: "MARKET" as const,
                    marketStatus: "AVAILABLE" as const,
                  };
          // Both actual implementations reach their action INSERT only after retaining
          // the listing lock. A table lock stops that INSERT, proving the first writer
          // is still uncommitted when the second worker/command reaches the database.
          holder = gate.begin(async (tx) => {
            await tx`LOCK TABLE listing_lifecycle_actions IN SHARE MODE`;
            arrived();
            await free;
          });
          await held;
          const first = new ListingLifecycleStore(a, true),
            second = new ListingLifecycleStore(b, true),
            aPid = (
              await a<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
            )[0]!.pid;
          pending.push(
            Promise.allSettled([
              order === "confirmation-first"
                ? first.execute(f.actor, f.listingId, command)
                : first.expireOnce(),
            ]),
          );
          await waiting(f.client, aPid);
          if (order === "confirmation-first") {
            assert.equal(await second.expireOnce(), 0); // actual SKIP LOCKED, while A holds the target
            release();
            await holder;
            assert.equal((await pending[0]!)[0]!.status, "fulfilled");
            assert.equal(
              (await f.store.read(f.actor, f.listingId)).visible,
              true,
            );
            assert.equal(
              (
                await f.client`SELECT id FROM listing_lifecycle_actions WHERE listing_id=${f.listingId} AND event_type='listing_expired'`
              ).length,
              0,
            );
          } else {
            const bPid = (
              await b<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
            )[0]!.pid;
            pending.push(
              Promise.allSettled([
                second.execute(f.actor, f.listingId, command),
              ]),
            );
            await waiting(f.client, bPid);
            release();
            await holder;
            assert.equal((await pending[0]!)[0]!.status, "fulfilled");
            const outcome = (await pending[1]!)[0]!;
            assert.equal(outcome.status, "rejected");
            assert.equal(
              (outcome as PromiseRejectedResult).reason.code,
              "STALE_VERSION",
            );
            const expired = await f.store.read(f.actor, f.listingId);
            assert.equal(expired.publication_status, "EXPIRED");
            assert.equal(expired.visible, false);
            const restored = await f.store.execute(
              f.actor,
              f.listingId,
              purpose === "FRESHNESS"
                ? { ...f.command(expired), operation: "FRESHNESS" }
                : {
                    ...f.command(expired),
                    operation: "MARKET",
                    marketStatus: "AVAILABLE",
                  },
            );
            assert.equal(restored.visible, true);
          }
        } finally {
          release?.();
          await holder?.catch(() => {});
          await Promise.all(pending);
          await Promise.all([a.end(), b.end(), gate.end()]);
          await f.close();
        }
      },
    );
