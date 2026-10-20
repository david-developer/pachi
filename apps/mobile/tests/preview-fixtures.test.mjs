import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  firstListingId,
  searchFixture,
  startPreview,
  testListings,
} from "../scripts/preview-fixtures.mjs";

test("synthetic search filters and stable pagination demonstrate real public query fields", () => {
  const first = searchFixture(
    new URLSearchParams({
      purpose: "RENT",
      city: "Douala",
      sort: "price_asc",
      limit: "12",
    }),
  );
  assert.deepEqual(
    first.items.map((item) => item.price.amount_minor),
    [200000, 350000],
  );
  assert.equal(first.has_more, false);
  const page = searchFixture(new URLSearchParams());
  assert.equal(page.items.length, 2);
  assert.equal(page.next_cursor, "test-offset-2");
  const second = searchFixture(
    new URLSearchParams({ cursor: page.next_cursor }),
  );
  assert.notEqual(second.items[0].id, page.items[0].id);
  assert.equal(
    searchFixture(new URLSearchParams({ cursor: "not-a-cursor" })),
    null,
  );
  assert.equal(
    searchFixture(new URLSearchParams({ city: "not-a-place" })).items.length,
    0,
  );
  assert.equal(
    searchFixture(
      new URLSearchParams({
        min_bedrooms: "4",
        min_bathrooms: "3",
        property_type: "HOUSE",
        furnishing: "UNFURNISHED",
        max_price: "70000000",
      }),
    ).items[0].purpose,
    "SALE",
  );
  assert.ok(
    testListings.every(
      (item) =>
        item.title.startsWith("TEST ·") &&
        item.description.includes("Synthetic TEST"),
    ),
  );
});

test("loopback synthetic server serves ordinary navigation, public fixtures and denies mutations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pachi-native-preview-"));
  await writeFile(join(directory, "index.html"), "<main>SYNTHETIC TEST</main>");
  const server = await startPreview({ port: 0, fixturePort: 0, directory });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    assert.match(
      await (await fetch(`${base}/listings/${firstListingId}`)).text(),
      /SYNTHETIC TEST/,
    );
    const search = await fetch(`${base}/v1/public/listings`);
    assert.equal(
      search.headers.get("x-pachi-inventory"),
      "synthetic-test-only",
    );
    assert.equal((await search.json()).items.length, 2);
    const detail = await (
      await fetch(`${base}/v1/public/listings/${firstListingId}`)
    ).json();
    const image = await fetch(
      `${base}/v1/public/listings/${firstListingId}/media/${detail.media[0].id}/variants/640`,
    );
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.equal(
      (
        await fetch(`${base}/v1/public/listings`, {
          method: "POST",
          body: "{}",
        })
      ).status,
      405,
    );
    assert.equal((await fetch(`${base}/v1/account/listings`)).status, 404);
    assert.equal((await fetch(`${base}/api/session`)).status, 404);
    assert.equal(
      (await fetch(`http://127.0.0.1:${server.fixturePort}/listings`)).status,
      404,
    );
    server.setScenario("fail-once");
    assert.equal((await fetch(`${base}/v1/public/listings`)).status, 503);
    assert.equal((await fetch(`${base}/v1/public/listings`)).status, 200);
    server.setScenario('page-fail-once');
    assert.equal((await fetch(`${base}/v1/public/listings`)).status, 200);
    assert.equal((await fetch(`${base}/v1/public/listings?cursor=test-offset-2`)).status, 503);
    assert.equal((await fetch(`${base}/v1/public/listings?cursor=test-offset-2`)).status, 200);
    server.setScenario("broken-images");
    assert.equal(
      (
        await fetch(
          `${base}/v1/public/listings/${firstListingId}/media/${detail.media[0].id}/variants/640`,
        )
      ).status,
      404,
    );
    server.setScenario("empty");
    assert.equal(
      (await (await fetch(`${base}/v1/public/listings`)).json()).items.length,
      0,
    );
    assert.throws(() => server.setScenario("unrecognized"));
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
