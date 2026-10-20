import type { PublicListing } from "@pachi/contracts";
import { detailCopy } from "./detail-copy";

export type DetailFact = { label: string; value: string | number | null };

/** The marketplace contract expresses XAF in whole currency units; never divide by 100. */
export function detailAmount(
  amount: number,
  formatNumber: (amount: number) => string,
): string {
  return `${formatNumber(amount)} XAF`;
}

/** Show only purpose-compatible public terms, preserving missing values and genuine zeroes. */
export function offeringFacts(
  listing: PublicListing,
  locale: "en" | "fr",
  formatNumber: (amount: number) => string,
): DetailFact[] {
  const copy = detailCopy(locale);
  const months = (value: number | null) =>
    value === null
      ? null
      : `${value.toLocaleString(locale)} ${value === 1 ? copy.month : copy.months}`;
  const nights = (value: number | null) =>
    value === null
      ? null
      : `${value.toLocaleString(locale)} ${value === 1 ? copy.night : copy.nights}`;
  const amount = (value: number | null) =>
    value === null ? null : detailAmount(value, formatNumber);
  if (listing.purpose === "RENT")
    return [
      {
        label: copy.deposit,
        value: amount(listing.terms.deposit_amount_minor),
      },
      { label: copy.advance, value: months(listing.terms.advance_months) },
      { label: copy.lease, value: months(listing.terms.minimum_lease_months) },
      {
        label: copy.utilities,
        value:
          listing.terms.utilities_included === null
            ? null
            : listing.terms.utilities_included
              ? copy.yes
              : copy.no,
      },
      {
        label: copy.service,
        value: amount(listing.terms.service_charge_amount_minor),
      },
    ];
  if (listing.purpose === "SHORT_LET")
    return [
      ...(listing.terms.weekly_amount_minor === null
        ? []
        : [
            {
              label: copy.weekly,
              value: amount(listing.terms.weekly_amount_minor),
            },
          ]),
      { label: copy.stay, value: nights(listing.terms.minimum_nights) },
      { label: copy.guests, value: listing.terms.guest_limit },
      {
        label: copy.checkIn,
        value: listing.terms.check_in_time?.slice(0, 5) ?? null,
      },
      {
        label: copy.checkOut,
        value: listing.terms.check_out_time?.slice(0, 5) ?? null,
      },
      { label: copy.cleaning, value: amount(listing.terms.cleaning_fee_minor) },
    ];
  if (listing.purpose === "SALE")
    return [
      {
        label: copy.negotiable,
        value: listing.price.negotiable ? copy.yes : copy.no,
      },
    ];
  return [];
}
