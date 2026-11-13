import type { PublicListing } from "@pachi/contracts";
import type { Locale } from "./locale";
const map = (
  value: string,
  locale: Locale,
  labels: Record<string, [string, string]>,
) => labels[value]?.[locale === "fr" ? 1 : 0] ?? value;
export function purposeLabel(value: string, locale: Locale) {
  return map(value, locale, {
    RENT: ["For rent", "À louer"],
    SALE: ["For sale", "À vendre"],
    SHORT_LET: ["Short stay", "Court séjour"],
  });
}
export function propertyLabel(value: string, locale: Locale) {
  return map(value, locale, {
    HOUSE: ["House", "Maison"],
    APARTMENT: ["Apartment", "Appartement"],
    ROOM: ["Room", "Chambre"],
    LAND: ["Land", "Terrain"],
    COMMERCIAL: ["Commercial", "Local commercial"],
  });
}
export function furnishingLabel(value: string, locale: Locale) {
  return map(value, locale, {
    FURNISHED: ["Furnished", "Meublé"],
    UNFURNISHED: ["Unfurnished", "Non meublé"],
    PARTLY_FURNISHED: ["Partly furnished", "Partiellement meublé"],
  });
}
export function marketLabel(value: string, locale: Locale) {
  return map(value, locale, {
    AVAILABLE: ["Available", "Disponible"],
    UNDER_OFFER: ["Under offer", "Offre en cours"],
    UNDER_NEGOTIATION: ["Under negotiation", "En négociation"],
    PARTIALLY_BOOKED: ["Partially booked", "Partiellement réservé"],
    RENTED: ["Rented", "Loué"],
    SOLD: ["Sold", "Vendu"],
    FULLY_BOOKED: ["Fully booked", "Complet"],
    UNAVAILABLE: ["Unavailable", "Indisponible"],
    WITHDRAWN: ["Withdrawn", "Retiré"],
  });
}
export function pricePeriod(price: PublicListing["price"], locale: Locale) {
  return map(price.pricing_period, locale, {
    MONTHLY: ["per month", "par mois"],
    NIGHTLY: ["per night", "par nuit"],
    TOTAL: ["total price", "prix total"],
  });
}
export function locationLabel(listing: PublicListing) {
  return [listing.location.neighborhood, listing.location.city]
    .filter(Boolean)
    .join(", ");
}
