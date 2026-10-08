import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { generateKeyPair, SignJWT } from "jose";
import {
  createDatabase,
  IdentityStore,
  ListingLifecycleStore,
} from "@pachi/database";
import { ListingLifecycleController } from "./listing-lifecycle.controller.js";
import { OrganizationOwnerNoStoreGuard } from "./organization-owner.controller.js";
import { OrganizationExceptionFilter } from "./organization-exception.filter.js";
import { requestIdMiddleware } from "./logging.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { CognitoAccessTokenVerifier } from "./token-verifier.js";
process.env.NODE_ENV = "test";
const integration = process.env.DATABASE_TEST_URL ? test : test.skip;
async function scenario(
  run: (
    call: (
      actor: string,
      path?: string,
      body?: unknown,
      key?: string | null,
    ) => Promise<Response>,
    f: {
      listingId: string;
      client: ReturnType<typeof createDatabase>["client"];
    },
  ) => Promise<void>,
) {
  const url = process.env.DATABASE_TEST_URL!,
    u = new URL(url);
  assert.equal(u.hostname, "localhost");
  assert.equal(u.port, "5433");
  assert.equal(u.pathname, "/pachi_test");
  const { client } = createDatabase(url);
  await client`SET client_min_messages TO warning`;
  await client`TRUNCATE users RESTART IDENTITY CASCADE`;
  await client`UPDATE region_publication_controls SET enabled=true`;
  const { listingLifecycleFixture } = await import(
    new URL(
      "../../../packages/database/dist/listing-lifecycle-fixture.js",
      import.meta.url,
    ).href
  );
  const f = await listingLifecycleFixture(client),
    { privateKey, publicKey } = await generateKeyPair("RS256");
  const issuer = "https://local.test/lifecycle";
  const tokens: Record<string, string> = {};
  for (const [name, userId] of [
    ["provider", f.providerUserId],
    ["other", f.seekerId],
  ]) {
    await client`INSERT INTO auth_identities(user_id,issuer,subject,provider) VALUES(${userId},${issuer},${name},'LOCAL_TEST')`;
    tokens[name!] = await new SignJWT({
      client_id: "account",
      origin_jti: randomUUID(),
      jti: randomUUID(),
      token_use: "access",
      scope: "pachi/account",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setSubject(name!)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  }
  const verifier = new CognitoAccessTokenVerifier({
    issuer,
    getKey: async () => publicKey,
    allowedClientIds: new Set(["account"]),
    requiredScopes: new Set(["pachi/account"]),
    provider: "LOCAL_TEST",
  });
  @Module({
    controllers: [ListingLifecycleController],
    providers: [
      AuthGuard,
      OrganizationOwnerNoStoreGuard,
      {
        provide: "AUTH_SERVICE",
        useValue: new AuthService(new IdentityStore(client), verifier),
      },
      {
        provide: "LISTING_LIFECYCLE_STORE",
        useValue: new ListingLifecycleStore(client, true),
      },
    ],
  })
  class TestApp {}
  const app = await NestFactory.create(TestApp, { logger: false });
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new OrganizationExceptionFilter(app.getHttpAdapter()));
  app.setGlobalPrefix("v1");
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  try {
    await run(
      async (actor, path = "", body, key = randomUUID()) => {
        const response = await fetch(
          `${base}/v1/account/listings/${f.listingId}/lifecycle${path}`,
          {
            method: body === undefined ? "GET" : "POST",
            headers: {
              ...(tokens[actor]
                ? { authorization: `Bearer ${tokens[actor]}` }
                : {}),
              ...(body !== undefined
                ? {
                    "content-type": "application/json",
                    ...(key ? { "idempotency-key": key } : {}),
                  }
                : {}),
            },
            ...(body === undefined
              ? {}
              : {
                  body: typeof body === "string" ? body : JSON.stringify(body),
                }),
          },
        );
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store",
        );
        return response;
      },
      { listingId: f.listingId, client },
    );
  } finally {
    await app.close();
    await client`UPDATE region_publication_controls SET enabled=true`;
    await client.end();
  }
}
void integration(
  "G3-E HTTP current authentication, neutral cross-provider denial and parser failures remain private",
  () =>
    scenario(async (call) => {
      assert.equal((await call("anonymous")).status, 401);
      assert.equal((await call("other")).status, 404);
      assert.equal(
        (await call("provider", "/market", "{ malformed")).status,
        400,
      );
      assert.equal(
        (
          await call("provider", "/freshness", {
            expected_version: 1,
            last_confirmed_at: "client-time",
          })
        ).status,
        400,
      );
      const missing = await call("provider", "/freshness", {}, null);
      assert.equal(missing.status, 400);
      assert.equal(
        ((await missing.json()) as { message: string }).message,
        "INVALID_INPUT",
      );
    }),
);
void integration(
  "G3-E HTTP versioned market transition, committed replay and conflicting retry use the real guard stack",
  () =>
    scenario(async (call) => {
      const current = (await (await call("provider")).json()) as {
        version: number;
        revision_id: string;
        offering_version_id: string;
      };
      const body = {
          expected_version: current.version,
          expected_revision_id: current.revision_id,
          expected_offering_version_id: current.offering_version_id,
          market_status: "UNDER_OFFER",
        },
        key = randomUUID();
      const first = await call("provider", "/market", body, key);
      assert.equal(first.status, 201);
      const result = await first.json();
      assert.deepEqual(
        await (await call("provider", "/market", body, key)).json(),
        result,
      );
      const changed = await call(
        "provider",
        "/market",
        { ...body, market_status: "RENTED" },
        key,
      );
      assert.equal(changed.status, 409);
      assert.equal(
        ((await changed.json()) as { message: string }).message,
        "IDEMPOTENCY_KEY_REUSED",
      );
      assert.equal(
        (await call("provider", "/market", { ...body, market_status: "SOLD" }))
          .status,
        409,
      );
    }),
);
void integration(
  "G3-E HTTP freshness and renewal reject disabled regions, stale snapshots and client eligibility flags",
  () =>
    scenario(async (call, f) => {
      const current = (await (await call("provider")).json()) as {
        version: number;
        revision_id: string;
        offering_version_id: string;
      };
      const body = {
        expected_version: current.version,
        expected_revision_id: current.revision_id,
        expected_offering_version_id: current.offering_version_id,
      };
      assert.equal(
        (
          await call("provider", "/freshness", {
            ...body,
            region_enabled: true,
          })
        ).status,
        400,
      );
      await f.client`UPDATE region_publication_controls SET enabled=false WHERE region='Littoral'`;
      assert.equal((await call("provider", "/freshness", body)).status, 409);
      assert.equal(
        ((await (await call("provider")).json()) as { region_enabled: boolean })
          .region_enabled,
        false,
      );
      await f.client`UPDATE region_publication_controls SET enabled=true WHERE region='Littoral'`;
      const success = await call("provider", "/freshness", body);
      assert.equal(success.status, 201);
      assert.ok(((await success.json()) as { expires_at: string }).expires_at);
    }),
);
