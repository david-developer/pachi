export type ListingLifecycleState = {
  listing_id: string;
  version: number;
  purpose: "RENT" | "SALE" | "SHORT_LET";
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
  allowed_market_states: string[];
  can_confirm_freshness: boolean;
};
export type ListingMarketCommand = {
  expected_version: number;
  expected_revision_id: string;
  expected_offering_version_id: string;
  market_status:
    | "AVAILABLE"
    | "UNDER_OFFER"
    | "RENTED"
    | "TEMPORARILY_UNAVAILABLE"
    | "SOLD"
    | "PARTIALLY_BOOKED"
    | "UNAVAILABLE";
};
export type ListingFreshnessCommand = {
  expected_version: number;
  expected_revision_id: string;
  expected_offering_version_id: string;
};
