import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnTo } from "../src/navigation";
void test("detail fallback preserves supported search state without accepting redirects", () => {
  assert.equal(
    safeReturnTo("/listings?city=Buea&purpose=RENT&sort=price_asc"),
    "/listings?purpose=RENT&city=Buea&sort=price_asc",
  );
  assert.equal(safeReturnTo("/"), "/");
  assert.equal(
    safeReturnTo("/listings?city=Douala&cursor=opaque"),
    "/listings?city=Douala",
  );
  for (const input of [
    undefined,
    ["/", "/listings"],
    "//evil.invalid",
    "https://evil.invalid",
    "/account",
    "/listings?max_price=bad",
    "/listings?city=Buea&city=Douala",
    "/listings#secret",
  ])
    assert.equal(safeReturnTo(input), "/listings");
  assert.equal(
    safeReturnTo("/listings?city=Buea&private_address=secret"),
    "/listings?city=Buea",
  );
});
