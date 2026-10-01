import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import { readPublicListingVisibility } from './listing-visibility.js';

type Sql = postgres.Sql | postgres.TransactionSql;
type Candidate = { id: string; updated_at: Date; amount_minor: number | string | null };
type PublicRow = {
  id: string; purpose: string; title: string; description: string; revision_version: number;
  currency: string; amount_minor: number | string; pricing_period: string; negotiable: boolean;
  deposit_amount_minor: number | string | null; advance_months: number | null; minimum_lease_months: number | null;
  utilities_included: boolean | null; service_charge_amount_minor: number | string | null;
  weekly_amount_minor: number | string | null; minimum_nights: number | null; guest_limit: number | null;
  check_in_time: string | null; check_out_time: string | null; cleaning_fee_minor: number | string | null;
  available_from: string | null; property_type: string; region: string; city: string; neighborhood: string;
  bedrooms: number | null; bathrooms: number | null; size_sqm: string | null; furnishing: string | null;
  public_location_mode: string; market_status: string; expires_at: Date;
};
type MediaRow = { id: string; is_cover: boolean; derivative_manifest: Record<string, { width: number; height: number; bytes: number; mime: string }> };
export type PublicListingFilters = {
  purpose?: 'RENT' | 'SALE' | 'SHORT_LET'; region?: 'Southwest' | 'Littoral'; city?: string; neighborhood?: string;
  propertyType?: string; minPrice?: number; maxPrice?: number; minBedrooms?: number; minBathrooms?: number;
  furnishing?: 'FURNISHED' | 'UNFURNISHED' | 'PARTLY_FURNISHED'; availableFrom?: string;
  sort?: 'newest' | 'price_asc' | 'price_desc'; limit?: number; cursor?: string;
};
export type PublicListingMedia = { id: string; is_cover: boolean; widths: number[] };
export type PublicListing = {
  id: string; purpose: string; title: string; description: string; revision_version: number;
  price: { amount_minor: number; currency: 'XAF'; pricing_period: string; negotiable: boolean };
  terms: { deposit_amount_minor: number | null; advance_months: number | null; minimum_lease_months: number | null; utilities_included: boolean | null; service_charge_amount_minor: number | null; weekly_amount_minor: number | null; minimum_nights: number | null; guest_limit: number | null; check_in_time: string | null; check_out_time: string | null; cleaning_fee_minor: number | null };
  property: { property_type: string; bedrooms: number | null; bathrooms: number | null; size_sqm: string | null; furnishing: string | null };
  location: { region: string; city: string; neighborhood?: string };
  market_status: string; available_from: string | null; expires_at: string; media: PublicListingMedia[];
};
export type PublicListingSearch = { items: PublicListing[]; filters: PublicListingFilters; next_cursor: string | null; has_more: boolean };
export type PublicMediaSource = { storageReference: string; mime: string };
const maxLimit = 20;

export class PublicListingStore {
  public constructor(private readonly client: postgres.Sql, private readonly allowSyntheticVerification = false) {}

  public async search(input: PublicListingFilters): Promise<PublicListingSearch> {
    const filters = normalize(input);
    const cursor = decodeCursor(filters);
    const candidates = await this.candidates(filters, cursor);
    const items: PublicListing[] = [];
    for (const candidate of candidates) {
      const visibility = await readPublicListingVisibility(this.client, candidate.id, { allowSyntheticVerification: this.allowSyntheticVerification });
      if (!visibility.visible) continue;
      items.push(await this.detail(candidate.id));
      if (items.length === filters.limit) break;
    }
    const hasMore = candidates.length === 100 || items.length === filters.limit && candidates.length > items.length;
    const last = items[items.length - 1];
    const lastCandidate = last ? candidates.find((candidate) => candidate.id === last.id) : undefined;
    return { items, filters, next_cursor: hasMore && last && lastCandidate ? encodeCursor(filters, last, lastCandidate) : null, has_more: hasMore };
  }

  public async detail(listingId: string): Promise<PublicListing> {
    const visibility = await readPublicListingVisibility(this.client, listingId, { allowSyntheticVerification: this.allowSyntheticVerification });
    if (!visibility.visible) throw new IdentityError('PUBLIC_LISTING_NOT_FOUND', 'Listing is not available');
    const rows = await this.client<PublicRow[]>`SELECT l.id,l.purpose,r.title,r.description,r.version AS revision_version,ov.currency,ov.amount_minor,ov.pricing_period,ov.negotiable,ov.deposit_amount_minor,ov.advance_months,ov.minimum_lease_months,ov.utilities_included,ov.service_charge_amount_minor,ov.weekly_amount_minor,ov.minimum_nights,ov.guest_limit,ov.check_in_time::text,ov.check_out_time::text,ov.cleaning_fee_minor, p.region,p.city,p.neighborhood,p.property_type,p.bedrooms,p.bathrooms,p.size_sqm::text,p.furnishing,l.public_location_mode,l.market_status,ov.available_from::text,l.expires_at FROM listings l JOIN listing_revisions r ON r.id=l.current_revision_id JOIN offerings o ON o.listing_id=l.id JOIN offering_versions ov ON ov.id=o.current_version_id JOIN properties p ON p.id=l.property_id WHERE l.id=${listingId}`;
    const row = rows[0];
    if (!row) throw new IdentityError('PUBLIC_LISTING_NOT_FOUND', 'Listing is not available');
    const media = await this.client<MediaRow[]>`SELECT lm.id,lm.is_cover,ma.derivative_manifest FROM listing_media lm JOIN media_assets ma ON ma.id=lm.media_asset_id WHERE lm.listing_id=${listingId} AND lm.removed_at IS NULL AND ma.lifecycle='READY' AND lm.review_status='APPROVED' ORDER BY lm.display_order,lm.id`;
    return {
      id: row.id, purpose: row.purpose, title: row.title, description: row.description, revision_version: row.revision_version,
      price: { amount_minor: Number(row.amount_minor), currency: 'XAF', pricing_period: row.pricing_period, negotiable: row.negotiable },
      terms: { deposit_amount_minor: numberOrNull(row.deposit_amount_minor), advance_months: row.advance_months, minimum_lease_months: row.minimum_lease_months, utilities_included: row.utilities_included, service_charge_amount_minor: numberOrNull(row.service_charge_amount_minor), weekly_amount_minor: numberOrNull(row.weekly_amount_minor), minimum_nights: row.minimum_nights, guest_limit: row.guest_limit, check_in_time: row.check_in_time, check_out_time: row.check_out_time, cleaning_fee_minor: numberOrNull(row.cleaning_fee_minor) },
      property: { property_type: row.property_type, bedrooms: row.bedrooms, bathrooms: row.bathrooms, size_sqm: row.size_sqm, furnishing: row.furnishing },
      location: row.public_location_mode === 'HIDDEN' ? { region: row.region, city: row.city } : { region: row.region, city: row.city, neighborhood: row.neighborhood },
      market_status: row.market_status, available_from: row.available_from, expires_at: new Date(row.expires_at).toISOString(),
      media: media.map((item) => ({ id: item.id, is_cover: item.is_cover, widths: Object.keys(item.derivative_manifest).map(Number).filter((width) => [320, 640, 1280, 1920].includes(width)).sort((a,b) => a-b) }))
    };
  }

  public async media(listingId: string, mediaId: string, width: number): Promise<PublicMediaSource> {
    if (![320, 640, 1280, 1920].includes(width)) throw new IdentityError('PUBLIC_LISTING_NOT_FOUND', 'Listing media is not available');
    const visibility = await readPublicListingVisibility(this.client, listingId, { allowSyntheticVerification: this.allowSyntheticVerification });
    if (!visibility.visible) throw new IdentityError('PUBLIC_LISTING_NOT_FOUND', 'Listing media is not available');
    const rows = await this.client<(MediaRow & { storage_reference: string })[]>`SELECT lm.id, lm.is_cover,ma.derivative_manifest,ma.storage_reference FROM listing_media lm JOIN media_assets ma ON ma.id=lm.media_asset_id WHERE lm.id=${mediaId} AND lm.listing_id=${listingId} AND lm.removed_at IS NULL AND ma.lifecycle='READY' AND lm.review_status='APPROVED'`;
    const row = rows[0];
    const variant = row?.derivative_manifest[String(width)];
    if (!row || !variant) throw new IdentityError('PUBLIC_LISTING_NOT_FOUND', 'Listing media is not available');
    return { storageReference: row.storage_reference, mime: variant.mime };
  }

  private async candidates(filters: PublicListingFilters, cursor: Cursor | null): Promise<Candidate[]> {
    const order = filters.sort === 'price_asc' ? 'ov.amount_minor ASC,l.id ASC' : filters.sort === 'price_desc' ? 'ov.amount_minor DESC,l.id DESC' : 'l.updated_at DESC,l.id DESC';
    const cursorClause = !cursor ? this.client`` : filters.sort === 'newest'
      ? this.client`AND (l.updated_at < ${cursor.value}::timestamptz OR (l.updated_at = ${cursor.value}::timestamptz AND l.id < ${cursor.id}))`
      : filters.sort === 'price_asc'
        ? this.client`AND (ov.amount_minor > ${cursor.value} OR (ov.amount_minor = ${cursor.value} AND l.id > ${cursor.id}))`
        : this.client`AND (ov.amount_minor < ${cursor.value} OR (ov.amount_minor = ${cursor.value} AND l.id < ${cursor.id}))`;
    const rows = await this.client<Candidate[]>`SELECT l.id,l.updated_at,ov.amount_minor FROM listings l JOIN listing_revisions r ON r.id=l.current_revision_id JOIN offerings o ON o.listing_id=l.id JOIN offering_versions ov ON ov.id=o.current_version_id JOIN properties p ON p.id=l.property_id WHERE l.publication_status='PUBLISHED' AND l.moderation_status='APPROVED' ${filters.purpose ? this.client`AND l.purpose=${filters.purpose}` : this.client``} ${filters.region ? this.client`AND p.region=${filters.region}` : this.client``} ${filters.city ? this.client`AND lower(p.city)=lower(${filters.city})` : this.client``} ${filters.neighborhood ? this.client`AND lower(p.neighborhood)=lower(${filters.neighborhood})` : this.client``} ${filters.propertyType ? this.client`AND p.property_type=${filters.propertyType}` : this.client``} ${filters.minPrice !== undefined ? this.client`AND ov.amount_minor>=${filters.minPrice}` : this.client``} ${filters.maxPrice !== undefined ? this.client`AND ov.amount_minor<=${filters.maxPrice}` : this.client``} ${filters.minBedrooms !== undefined ? this.client`AND p.bedrooms>=${filters.minBedrooms}` : this.client``} ${filters.minBathrooms !== undefined ? this.client`AND p.bathrooms>=${filters.minBathrooms}` : this.client``} ${filters.furnishing ? this.client`AND p.furnishing=${filters.furnishing}` : this.client``} ${filters.availableFrom ? this.client`AND ov.available_from>=${filters.availableFrom}` : this.client``} ${cursorClause} ORDER BY ${this.client.unsafe(order)} LIMIT 100`;
    return rows;
  }
}

type Cursor = { sort: string; value: string; id: string; signature: string };
function normalize(input: PublicListingFilters): PublicListingFilters {
  const limit = input.limit ?? 12;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) throw new IdentityError('PUBLIC_FILTER_INVALID', 'Listing filters are invalid');
  if (input.minPrice !== undefined && (!Number.isSafeInteger(input.minPrice) || input.minPrice < 0) || input.maxPrice !== undefined && (!Number.isSafeInteger(input.maxPrice) || input.maxPrice < 0) || input.minPrice !== undefined && input.maxPrice !== undefined && input.minPrice > input.maxPrice) throw new IdentityError('PUBLIC_FILTER_INVALID', 'Listing price filters are invalid');
  for (const value of [input.minBedrooms,input.minBathrooms]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new IdentityError('PUBLIC_FILTER_INVALID', 'Listing specification filters are invalid');
  if (input.purpose && !['RENT','SALE','SHORT_LET'].includes(input.purpose) || input.region && !['Southwest','Littoral'].includes(input.region) || input.furnishing && !['FURNISHED','UNFURNISHED','PARTLY_FURNISHED'].includes(input.furnishing)) throw new IdentityError('PUBLIC_FILTER_INVALID', 'Listing filters are invalid');
  if (input.availableFrom !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.availableFrom)) throw new IdentityError('PUBLIC_FILTER_INVALID', 'Availability filter is invalid');
  return { ...input, limit, sort: input.sort ?? 'newest' };
}
function signature(filters: PublicListingFilters): string { return JSON.stringify({ ...filters, cursor: undefined }); }
function encodeCursor(filters: PublicListingFilters, listing: PublicListing, candidate: Candidate): string { const value = filters.sort === 'newest' ? new Date(candidate.updated_at).toISOString() : String(listing.price.amount_minor); return Buffer.from(JSON.stringify({ sort: filters.sort, value, id: listing.id, signature: signature(filters) })).toString('base64url'); }
function decodeCursor(filters: PublicListingFilters): Cursor | null { if (!filters.cursor) return null; try { const value = JSON.parse(Buffer.from(filters.cursor,'base64url').toString('utf8')) as Cursor; if (value.signature !== signature(filters) || value.sort !== filters.sort) throw new Error(); return value; } catch { throw new IdentityError('PUBLIC_CURSOR_INVALID', 'Listing pagination cursor is invalid'); } }
function numberOrNull(value: number | string | null): number | null { return value === null ? null : Number(value); }
