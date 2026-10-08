import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
const id = "a58c9d04-1bd3-4138-aecf-c77143197355";
const initial = {
  listing_id: id,
  version: 3,
  purpose: "RENT",
  market_status: "AVAILABLE",
  publication_status: "PUBLISHED",
  moderation_status: "APPROVED",
  revision_id: "38fa8db7-3b38-4a3d-b4ed-ffea26a90a75",
  offering_version_id: "1cfc77e1-497b-4c88-a152-310acb693e14",
  last_confirmed_at: "2026-10-01T00:00:00Z",
  expires_at: "2026-10-31T00:00:00Z",
  region_enabled: true,
  visible: true,
  eligibility_reason: "VISIBLE",
  allowed_market_states: [
    "AVAILABLE",
    "UNDER_OFFER",
    "RENTED",
    "TEMPORARILY_UNAVAILABLE",
  ],
  can_confirm_freshness: true,
};
async function workspace(page: Page, state = initial) {
  const requests: {
    key: string | null;
    csrf: string | null;
    body: Record<string, unknown>;
  }[] = [];
  let disconnect = false,
    denied = false;
  await page.route("**/api/**", async (route) => {
    if (route.request().url().endsWith("/api/session"))
      return route.fulfill({
        json: { authenticated: true, csrfToken: "synthetic-csrf" },
      });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requests.push({
        key: route.request().headers()["idempotency-key"] ?? null,
        csrf: route.request().headers()["x-csrf-token"] ?? null,
        body,
      });
      if (disconnect) {
        disconnect = false;
        return route.abort("failed");
      }
      return route.fulfill({
        status: 201,
        json: {
          ...state,
          version: state.version + 1,
          market_status: body.market_status ?? state.market_status,
        },
      });
    }
    return route.fulfill(
      denied
        ? { status: 404, json: { error: "unavailable" } }
        : { json: state },
    );
  });
  await page.goto("/provider/listings");
  await page.getByLabel("Listing reference").fill(id);
  await page.getByRole("button", { name: "Refresh listing state" }).click();
  return {
    requests,
    disconnect: () => {
      disconnect = true;
    },
    deny: () => {
      denied = true;
    },
  };
}
test("G3-E provider market control sends current snapshot, CSRF and UUID key then shows committed status", async ({
  page,
}) => {
  const f = await workspace(page);
  await page.getByLabel("Market availability").selectOption("RENTED");
  await page.getByRole("button", { name: "Save market availability" }).click();
  await expect(page.getByText("Market: RENTED", { exact: true })).toBeVisible();
  expect(f.requests[0]!.body).toEqual({
    expected_version: 3,
    expected_revision_id: initial.revision_id,
    expected_offering_version_id: initial.offering_version_id,
    market_status: "RENTED",
  });
  expect(f.requests[0]!.csrf).toBe("synthetic-csrf");
  expect(f.requests[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
});
test("G3-E expired listing offers explicit renewal and region-disabled state removes freshness control", async ({
  page,
}) => {
  await workspace(page, {
    ...initial,
    publication_status: "EXPIRED",
    visible: false,
  });
  await expect(
    page.getByRole("button", { name: "Request renewal" }),
  ).toBeVisible();
  await expect(
    page.getByText("This listing is currently unavailable publicly."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Request renewal" }).click();
  await expect(page.getByText("Listing state saved.")).toBeVisible();
});
test("G3-E unavailable region and organization verification expose no renewal shortcut", async ({
  page,
}) => {
  await workspace(page, {
    ...initial,
    region_enabled: false,
    visible: false,
    can_confirm_freshness: false,
  });
  await expect(
    page.getByText("Publishing is disabled in this region.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm freshness" }),
  ).toHaveCount(0);
});
test("G3-E ambiguous transport retry preserves the same UUID, body and selected market state", async ({
  page,
}) => {
  const f = await workspace(page);
  f.disconnect();
  await page.getByLabel("Market availability").selectOption("UNDER_OFFER");
  await page.getByRole("button", { name: "Save market availability" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Market availability")).toHaveValue(
    "UNDER_OFFER",
  );
  await page.getByRole("button", { name: "Retry unconfirmed request" }).click();
  await expect(page.getByText("Listing state saved.")).toBeVisible();
  expect(f.requests[1]).toEqual(f.requests[0]);
});
test("G3-E loss of current access removes controls and never retains the old private projection", async ({
  page,
}) => {
  const f = await workspace(page);
  await expect(page.getByLabel("Market availability")).toBeVisible();
  f.deny();
  await page.getByRole("button", { name: "Refresh listing state" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Market availability")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm freshness" }),
  ).toHaveCount(0);
});

test('G3-E actual BFF lifecycle routes deny anonymous reads and writes with private no-store',async({request})=>{
  for(const response of [await request.get(`/api/account/listings/${id}/lifecycle`),await request.post(`/api/account/listings/${id}/lifecycle/freshness`,{data:{expected_version:3},headers:{'idempotency-key':randomUUID()}})]){
    expect(response.status()).toBe(401);expect(response.headers()['cache-control']).toBe('private, no-store');
  }
});
