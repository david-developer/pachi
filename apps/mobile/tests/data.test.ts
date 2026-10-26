import assert from "node:assert/strict";
import test from "node:test";
import type { PublicListing } from "@pachi/contracts";
import {
  createMarketplaceClient,
  dedupeMedia,
  MarketplaceError,
  mergeListings,
  parseQueryParams,
  serializeQuery,
  validateQuery,
} from "../src/data/marketplace";

const id = "00000000-0000-4000-8000-000000000151";
const mediaId = "00000000-0000-4000-8000-000000000152";
const listing: PublicListing = {
  id,
  purpose: "RENT",
  title: "TEST · Public apartment",
  description: "Synthetic TEST inventory.",
  price: {
    amount_minor: 200000,
    currency: "XAF",
    pricing_period: "MONTHLY",
    negotiable: false,
  },
  terms: {
    deposit_amount_minor: 200000,
    advance_months: 3,
    minimum_lease_months: 12,
    utilities_included: false,
    service_charge_amount_minor: 10000,
    weekly_amount_minor: null,
    minimum_nights: null,
    guest_limit: null,
    check_in_time: null,
    check_out_time: null,
    cleaning_fee_minor: null,
  },
  property: {
    property_type: "APARTMENT",
    bedrooms: 2,
    bathrooms: 2,
    size_sqm: "95.5",
    furnishing: "PARTLY_FURNISHED",
  },
  location: { region: "Littoral", city: "Douala", neighborhood: "Akwa" },
  market_status: "AVAILABLE",
  available_from: "2026-10-20",
  expires_at: "2026-11-20T00:00:00Z",
  media: [{ id: mediaId, is_cover: true, widths: [320, 640, 1280] }],
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const clientFor = (value: unknown) =>
  createMarketplaceClient("http://192.168.1.8:3001/v1", {
    fetch: async () => json(value),
  });
const code = (expected: string) => (error: unknown) =>
  error instanceof MarketplaceError && error.code === expected;

void test("detail provider context is optional, validated and stripped of private fields", async () => {
  const old = await clientFor(listing).detail(id);
  assert.equal(old.provider, undefined);
  assert.equal(old.last_confirmed_at, undefined);
  const provider = { display_name: "TEST · Fako Living", identity_verified: true, authority_declared: true };
  const confirmed = "2026-10-25T12:00:00Z";
  const detail = await clientFor({ ...listing, provider: { ...provider, email: "PRIVATE_CANARY", phone_number: "PRIVATE_CANARY", provider_profile_id: "PRIVATE_CANARY", verification_case_id: "PRIVATE_CANARY", property_authority_verified: true }, last_confirmed_at: confirmed }).detail(id);
  assert.deepEqual(detail.provider, provider);
  assert.equal(detail.last_confirmed_at, confirmed);
  assert.ok(!JSON.stringify(detail).includes("PRIVATE_CANARY"));
  assert.ok(!JSON.stringify(detail).includes("property_authority_verified"));
  const noClaims = await clientFor({ ...listing, provider: { ...provider, identity_verified: false, authority_declared: false }, last_confirmed_at: null }).detail(id);
  assert.equal(noClaims.provider?.identity_verified, false);
  assert.equal(noClaims.provider?.authority_declared, false);
  assert.equal(noClaims.last_confirmed_at, null);
  const multiline = await clientFor({ ...listing, provider: { ...provider, display_name: "Fako\nLiving" } }).detail(id);
  assert.equal(multiline.provider?.display_name, "Fako Living");
  for (const invalid of [null, {}, { ...provider, display_name: " " }, { ...provider, display_name: "a".repeat(121) }, { ...provider, identity_verified: "true" }, { ...provider, authority_declared: 1 }]) {
    await assert.rejects(clientFor({ ...listing, provider: invalid }).detail(id), code("unavailable"));
  }
  for (const invalid of ["yesterday", "2026-02-30T12:00:00Z", "2026-10-25", 1]) {
    await assert.rejects(clientFor({ ...listing, last_confirmed_at: invalid }).detail(id), code("unavailable"));
  }
});

void test("query validation uses supported filters, safe whole XAF, and defaults", () => {
  const input = {
    purpose: "RENT",
    city: " Douala ",
    min_price: "0001000",
    max_price: "200000",
    min_bathrooms: "2",
    limit: "20",
    unsupported: "secret",
  };
  assert.deepEqual(
    validateQuery(input as Parameters<typeof validateQuery>[0]),
    {
      query: {
        purpose: "RENT",
        city: "Douala",
        min_price: "1000",
        max_price: "200000",
        min_bathrooms: "2",
        limit: "20",
        sort: "newest",
      },
      errors: {},
    },
  );
  assert.equal(serializeQuery({}).toString(), "");
});

void test("invalid money, ranges, choices, dates, limits and repeated params are rejected", () => {
  for (const value of [
    "1.5",
    "-1",
    "1e6",
    "Infinity",
    "9007199254740992",
    "NaN",
  ])
    assert.equal(
      validateQuery({ max_price: value }).errors.max_price,
      "whole_number",
    );
  assert.equal(
    validateQuery({ min_price: "100", max_price: "99" }).errors.max_price,
    "price_range",
  );
  assert.equal(
    validateQuery({ region: "Other" as never }).errors.region,
    "invalid_option",
  );
  for (const value of ["2026-02-30", "2026-2-01", "2026-13-01"])
    assert.equal(
      validateQuery({ available_from: value }).errors.available_from,
      "invalid_date",
    );
  assert.deepEqual(
    validateQuery({
      available_from: "2028-02-29",
      min_price: "0",
      min_bedrooms: "0",
    }).errors,
    {},
  );
  for (const limit of ["0", "21", "2.5"])
    assert.equal(validateQuery({ limit }).errors.limit, "whole_number");
  assert.ok(
    validateQuery(
      parseQueryParams(new URLSearchParams("city=Douala&city=Buea")),
    ).errors.city,
  );
  assert.throws(
    () => serializeQuery({ min_price: "2.5" }),
    code("invalid-query"),
  );
});

void test("UTF-8 locations and opaque cursors are safely encoded without adding unsupported filters", () => {
  const query = parseQueryParams({
    city: " Cité des Palmiers ",
    cursor: "opaque+/=cursor",
    sort: "price_asc",
    private_address: "canary",
  });
  const params = serializeQuery(query);
  assert.equal(params.get("city"), "Cité des Palmiers");
  assert.equal(params.get("cursor"), "opaque+/=cursor");
  assert.equal(params.get("private_address"), null);
  assert.equal(
    validateQuery({ cursor: "unsafe\nvalue" }).errors.cursor,
    "invalid_cursor",
  );
  assert.equal(
    validateQuery({ city: "x".repeat(121) }).errors.city,
    "too_long",
  );
});

void test("anonymous public requests use API base paths and omit credentials, authorization and redirects", async () => {
  let destination = "",
    init: RequestInit | undefined;
  const client = createMarketplaceClient("http://192.168.1.8:3001/v1/", {
    fetch: async (url, options) => {
      destination = String(url);
      init = options;
      return json({
        items: [listing],
        has_more: false,
        next_cursor: null,
        filters: { private_address: "canary" },
      });
    },
  });
  const result = await client.search({ city: "Douala", purpose: "RENT" });
  assert.equal(
    destination,
    "http://192.168.1.8:3001/v1/public/listings?purpose=RENT&city=Douala",
  );
  assert.equal(init?.method, "GET");
  assert.equal(init?.credentials, "omit");
  assert.equal(init?.cache, "no-store");
  assert.equal(init?.redirect, "error");
  assert.deepEqual(init?.headers, { Accept: "application/json" });
  assert.deepEqual(result.filters, {});
});

void test("runtime listing projection discards unknown private fields at every nested boundary", async () => {
  const result = await clientFor({
    ...listing,
    private_address: "PRIVATE_CANARY",
    provider_phone: "PRIVATE_CANARY",
    provider_user_id: "PRIVATE_CANARY",
    price: { ...listing.price, internal_commission: "PRIVATE_CANARY" },
    terms: { ...listing.terms, private_notes: "PRIVATE_CANARY" },
    property: { ...listing.property, coordinates: "PRIVATE_CANARY" },
    location: {
      ...listing.location,
      private_address: "PRIVATE_CANARY",
      latitude: 4.2,
    },
    media: [
      {
        ...listing.media[0],
        storage_reference: "PRIVATE_CANARY",
        original_url: "PRIVATE_CANARY",
      },
    ],
  }).detail(id);
  assert.deepEqual(result, listing);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_CANARY"));
});

void test("hidden location remains coarse without an invented neighborhood", async () => {
  const input = {
    ...listing,
    location: { region: "Littoral", city: "Douala" },
  };
  assert.deepEqual(
    (await clientFor(input).detail(id)).location,
    input.location,
  );
});

void test("malformed identifiers, amounts, media and response pagination fail closed", async () => {
  const mutations = [
    { id: "invalid-id" },
    { price: { ...listing.price, amount_minor: "200000" } },
    { price: { ...listing.price, amount_minor: Number.MAX_SAFE_INTEGER + 1 } },
    { price: { ...listing.price, amount_minor: -1 } },
    { price: { ...listing.price, currency: "USD" } },
    { media: [{ id: mediaId, is_cover: true, widths: [999] }] },
    { media: [{ id: "../original", is_cover: true, widths: [640] }] },
    { available_from: "2026-02-30" },
  ];
  for (const mutation of mutations)
    await assert.rejects(
      clientFor({ ...listing, ...mutation }).detail(id),
      code("unavailable"),
    );
  await assert.rejects(
    clientFor({ ...listing, id: mediaId }).detail(id),
    code("unavailable"),
  );
  await assert.rejects(
    clientFor({ items: [], has_more: true, next_cursor: null }).search(),
    code("unavailable"),
  );
  await assert.rejects(
    clientFor({ items: [], has_more: false, next_cursor: "opaque" }).search(),
    code("unavailable"),
  );
});

void test("empty successful inventory is different from unavailable responses", async () => {
  assert.deepEqual(
    (
      await clientFor({
        items: [],
        has_more: false,
        next_cursor: null,
      }).search()
    ).items,
    [],
  );
  const client = createMarketplaceClient("https://api.example.test/v1", {
    fetch: async () => json({ message: "PRIVATE_SERVER_ERROR" }, 500),
  });
  await assert.rejects(
    client.search(),
    (error: unknown) =>
      code("unavailable")(error) &&
      !String(error).includes("PRIVATE_SERVER_ERROR"),
  );
});

void test("detail and reputation missing states are safe and never expose server response details", async () => {
  const client = createMarketplaceClient("https://api.example.test/v1", {
    fetch: async () => json({ message: "PRIVATE_SERVER_ERROR" }, 404),
  });
  await assert.rejects(client.detail(id), code("missing"));
  await assert.rejects(client.reputation(id), code("missing"));
  await assert.rejects(client.detail("../../private"), code("missing"));
});

void test("missing and unsafe API configuration never makes a request", async () => {
  let calls = 0;
  for (const base of [
    undefined,
    "",
    "file:///v1",
    "http://user:password@example.test/v1",
    "https://example.test/v1?secret=x",
    "https://example.test/v1#token",
    " https://example.test/v1",
    "https://example.test/a%2fb",
  ]) {
    const client = createMarketplaceClient(base, {
      fetch: async () => {
        calls++;
        return json(listing);
      },
    });
    assert.equal(client.configured, false);
    await assert.rejects(client.detail(id), code("invalid-config"));
    assert.equal(client.mediaUrl(id, listing.media[0]), null);
  }
  assert.equal(calls, 0);
  assert.equal(createMarketplaceClient("http://10.0.2.2:3001/v1").configured, true);
  assert.equal(createMarketplaceClient("https://api.example.test/v1").configured, true);
  assert.equal(createMarketplaceClient("https://api.example.test/v1", { timeoutMs: 0 }).configured, false);
});

void test("network and invalid JSON failures produce distinct safe errors", async () => {
  const network = createMarketplaceClient("http://10.0.2.2:3001/v1", {
    fetch: async () => {
      throw new Error("PRIVATE_NETWORK_DETAILS");
    },
  });
  await assert.rejects(
    network.search(),
    (error: unknown) =>
      code("network")(error) &&
      !String(error).includes("PRIVATE_NETWORK_DETAILS"),
  );
  const malformed = createMarketplaceClient("http://10.0.2.2:3001/v1", {
    fetch: async () => new Response("PRIVATE_INVALID_JSON", { status: 200 }),
  });
  await assert.rejects(malformed.search(), code("unavailable"));
});

void test("timeouts abort the underlying request; caller cancellation remains distinct", async () => {
  const abortedFetch: typeof fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options?.signal?.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      );
    });
  const timed = createMarketplaceClient("http://10.0.2.2:3001/v1", {
    fetch: abortedFetch,
    timeoutMs: 10,
  });
  await assert.rejects(timed.search(), code("timeout"));
  const controller = new AbortController();
  const cancelled = createMarketplaceClient("http://10.0.2.2:3001/v1", {
    fetch: abortedFetch,
  });
  const request = cancelled.search({}, controller.signal);
  controller.abort();
  await assert.rejects(request, code("aborted"));
  await assert.rejects(
    cancelled.search({}, controller.signal),
    code("aborted"),
  );
});

void test("pagination merges refreshed duplicate projections without duplicate cards", () => {
  const updated = { ...listing, title: "TEST · Refreshed title" },
    second = { ...listing, id: mediaId };
  assert.deepEqual(mergeListings([listing], [updated, second]), [
    updated,
    second,
  ]);
  assert.deepEqual(
    dedupeMedia([...listing.media, ...listing.media]),
    listing.media,
  );
});

void test("media URLs use only offered public derivatives and never private originals", () => {
  const client = createMarketplaceClient("http://192.168.1.8:3001/v1");
  assert.equal(
    client.mediaUrl(id, listing.media[0], 500),
    `http://192.168.1.8:3001/v1/public/listings/${id}/media/${mediaId}/variants/640`,
  );
  assert.ok(client.mediaUrl(id, listing.media[0], 1920)?.endsWith("/1280"));
  assert.equal(
    client.mediaUrl(id, { id: mediaId, widths: [], is_cover: true }),
    null,
  );
  assert.equal(client.mediaUrl("../private", listing.media[0]), null);
  assert.equal(client.mediaUrl(id, undefined), null);
});

void test("reputation uses only the public aggregate and does not infer undisclosed ratings", async () => {
  const empty = await clientFor({
    items: [],
    next_cursor: null,
    reputation: { count: 2, average: null, hidden_count: 20 },
    hidden_reviews: ["PRIVATE_CANARY"],
  }).reputation(id);
  assert.deepEqual(empty, {
    items: [],
    next_cursor: null,
    reputation: { count: 2, average: null },
  });
  assert.deepEqual(
    (
      await clientFor({
        items: [],
        next_cursor: null,
        reputation: { count: 3, average: 4.3 },
      }).reputation(id)
    ).reputation,
    { count: 3, average: 4.3 },
  );
  for (const reputation of [
    { count: 2, average: 4 },
    { count: -1, average: null },
    { count: 3, average: 6 },
    { count: 3, average: null },
  ]) {
    await assert.rejects(
      clientFor({ items: [], next_cursor: null, reputation }).reputation(id),
      code("unavailable"),
    );
  }
});

void test("published review projection validates public fields and excludes moderation/private metadata", async () => {
  const review = {
    id: mediaId,
    direction: "SEEKER_TO_PROVIDER",
    rating: 4,
    text: null,
    criteria: { communication: 5 },
    date: "2026-10-19",
    author_display_name: "TEST Seeker",
    author_role: "SEEKER",
    event_label: "VALIDATED_COMPLETED_VIEWING",
    provider_identity_verified: true,
  };
  const result = await clientFor({
    items: [
      {
        ...review,
        private_author_id: "PRIVATE_CANARY",
        criteria: { ...review.criteria, private_note: "PRIVATE_CANARY" },
      },
    ],
    next_cursor: null,
    reputation: { count: 3, average: 4 },
  }).reputation(id);
  assert.deepEqual(result.items, [review]);
  await assert.rejects(
    clientFor({
      items: [{ ...review, rating: 0 }],
      next_cursor: null,
      reputation: { count: 3, average: 4 },
    }).reputation(id),
    code("unavailable"),
  );
});
