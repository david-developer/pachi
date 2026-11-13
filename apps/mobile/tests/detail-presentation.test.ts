import assert from "node:assert/strict";
import test from "node:test";
import type { PublicListing } from "@pachi/contracts";
import { detailAmount, offeringFacts } from "../src/detail-presentation";

const listing: PublicListing = {
  id: "00000000-0000-4000-8000-000000000151",
  purpose: "RENT",
  title: "TEST property",
  description: "Synthetic TEST fixture.",
  price: {
    amount_minor: 200000,
    currency: "XAF",
    pricing_period: "MONTHLY",
    negotiable: false,
  },
  terms: {
    deposit_amount_minor: 200000,
    advance_months: 1,
    minimum_lease_months: null,
    utilities_included: false,
    service_charge_amount_minor: 0,
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
    size_sqm: "95",
    furnishing: "FURNISHED",
  },
  location: { region: "Littoral", city: "Douala" },
  market_status: "AVAILABLE",
  available_from: null,
  expires_at: "2026-11-01T00:00:00Z",
  media: [],
};

void test("detail prices retain whole XAF values and an explicit currency in both locales", () => {
  assert.equal(
    detailAmount(200000, (amount) => amount.toLocaleString("en-CM")),
    "200,000 XAF",
  );
  assert.match(
    detailAmount(200000, (amount) => amount.toLocaleString("fr-CM")),
    /^200\s000 XAF$/u,
  );
  assert.equal(detailAmount(0, String), "0 XAF");
});

void test("rental presentation distinguishes zero, missing values and excluded short-stay terms", () => {
  const facts = offeringFacts(
    {
      ...listing,
      terms: { ...listing.terms, guest_limit: 4, cleaning_fee_minor: 5000 },
    },
    "en",
    String,
  );
  assert.deepEqual(facts, [
    { label: "Deposit", value: "200000 XAF" },
    { label: "Advance rent", value: "1 month" },
    { label: "Minimum lease", value: null },
    { label: "Utilities included", value: "No" },
    { label: "Service charge", value: "0 XAF" },
  ]);
});

void test("short-let terms use translated nights, limits and times without inventing a weekly rate", () => {
  const facts = offeringFacts(
    {
      ...listing,
      purpose: "SHORT_LET",
      terms: {
        ...listing.terms,
        minimum_nights: 2,
        guest_limit: 4,
        check_in_time: "14:30:00",
        check_out_time: "10:00:00",
        cleaning_fee_minor: 0,
      },
    },
    "fr",
    String,
  );
  assert.deepEqual(facts, [
    { label: "Séjour minimum", value: "2 nuits" },
    { label: "Nombre maximal de voyageurs", value: 4 },
    { label: "Heure d’arrivée", value: "14:30" },
    { label: "Heure de départ", value: "10:00" },
    { label: "Frais de ménage", value: "0 XAF" },
  ]);
});

void test("sale terms never borrow rental commitments and localize negotiability", () => {
  assert.deepEqual(
    offeringFacts({ ...listing, purpose: "SALE" }, "en", String),
    [{ label: "Price negotiable", value: "No" }],
  );
  assert.deepEqual(
    offeringFacts(
      {
        ...listing,
        purpose: "SALE",
        price: { ...listing.price, negotiable: true },
      },
      "fr",
      String,
    ),
    [{ label: "Prix négociable", value: "Oui" }],
  );
});
