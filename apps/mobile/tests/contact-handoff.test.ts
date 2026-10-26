import assert from "node:assert/strict";
import { test } from "node:test";
import { webListingUrl } from "../src/contact-handoff";

const id = "00000000-0000-4000-8000-000000000151";
void test("contact handoff uses only the configured web origin and validated listing identity", () => {
  assert.equal(webListingUrl("https://pachi-web.example.test", id), `https://pachi-web.example.test/listings/${id}`);
  assert.equal(webListingUrl("http://localhost:3000/", id), `http://localhost:3000/listings/${id}`);
  assert.equal(webListingUrl("http://127.0.0.1:3000", id), `http://127.0.0.1:3000/listings/${id}`);
  assert.equal(webListingUrl("http://[::1]:3000", id), `http://[::1]:3000/listings/${id}`);
  for (const origin of [undefined, "", "//example.test", "javascript:alert(1)", "file:///tmp/pachi", "http://example.test", "http://localhost.example.test", "https://user:secret@example.test", "https://example.test/path", "https://example.test/?returnTo=https://elsewhere.test", "https://example.test/#contact", " https://example.test", "https://example.test\n", "https://example.test\\@elsewhere.test"]) {
    assert.equal(webListingUrl(origin, id), null, `Reject untrusted origin shape: ${origin}`);
  }
  for (const invalid of ["", "../account", `${id}?token=private`, `${id}/../../account`, "https://elsewhere.test"]) {
    assert.equal(webListingUrl("https://pachi-web.example.test", invalid), null);
  }
});
