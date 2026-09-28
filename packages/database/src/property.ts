import type postgres from 'postgres';
import { IdentityError } from './identity.js';

const propertyTypes = ['HOUSE', 'APARTMENT', 'ROOM', 'LAND', 'COMMERCIAL'] as const;
const purposes = ['RENT', 'SALE', 'SHORT_LET'] as const;
const relationshipTypes = ['OWNER', 'AUTHORIZED_AGENT', 'PROPERTY_MANAGER'] as const;
export type PropertyType = typeof propertyTypes[number];
export type ListingPurpose = typeof purposes[number];
export type RelationshipType = typeof relationshipTypes[number];
type OfferingTermsInput = { amountMinor?: number | null | undefined; pricingPeriod?: string | undefined; negotiable?: boolean | undefined; depositAmountMinor?: number | null | undefined; advanceMonths?: number | null | undefined; minimumLeaseMonths?: number | null | undefined; utilitiesIncluded?: boolean | null | undefined; serviceChargeAmountMinor?: number | null | undefined; weeklyAmountMinor?: number | null | undefined; minimumNights?: number | null | undefined; guestLimit?: number | null | undefined; checkInTime?: string | null | undefined; checkOutTime?: string | null | undefined; cleaningFeeMinor?: number | null | undefined; availableFrom?: string | null | undefined };

type ProviderContext = { account_id: string; user_state: string; profile_state: string; verification_status: string };
export type PropertyDraft = { id: string; propertyType: PropertyType; region: 'Southwest' | 'Littoral'; city: string; neighborhood: string; landmark: string | null; bedrooms: number | null; bathrooms: number | null; sizeSqm: string | null; furnishing: string | null; relationshipId: string; relationshipType: RelationshipType; authorizationStatus: 'DECLARED' };
export type ListingDraft = { id: string; propertyId: string; providerAccountId: string; purpose: ListingPurpose; publicationStatus: 'DRAFT' | 'PENDING_REVIEW'; moderationStatus: 'NOT_REVIEWED' | 'IN_REVIEW'; revisionId: string; version: number; title: string | null; description: string | null; offeringId: string; offeringVersionId: string; currency: 'XAF'; amountMinor: number | null; pricingPeriod: 'MONTHLY' | 'TOTAL' | 'NIGHTLY'; negotiable: boolean; depositAmountMinor: number | null; advanceMonths: number | null; minimumLeaseMonths: number | null; utilitiesIncluded: boolean | null; serviceChargeAmountMinor: number | null; weeklyAmountMinor: number | null; minimumNights: number | null; guestLimit: number | null; checkInTime: string | null; checkOutTime: string | null; cleaningFeeMinor: number | null; availableFrom: string | null };

export class PropertyDraftStore {
  public constructor(private readonly client: postgres.Sql) {}

  public async properties(userId: string): Promise<PropertyDraft[]> {
    const provider = await this.requireDraftProvider(userId);
    const rows = await this.client<PropertyRow[]>`SELECT p.id, p.property_type, p.region, p.city, p.neighborhood, p.landmark, p.bedrooms, p.bathrooms, p.size_sqm::text, p.furnishing, r.id AS relationship_id, r.relationship_type, r.authorization_status FROM properties p JOIN provider_property_relationships r ON r.property_id = p.id WHERE r.provider_account_id = ${provider.account_id} ORDER BY p.updated_at DESC`;
    return rows.map(mapProperty);
  }

  public async createProperty(userId: string, input: { propertyType: string; region: string; city: string; neighborhood: string; landmark?: string | undefined; bedrooms?: number | undefined; bathrooms?: number | undefined; sizeSqm?: number | undefined; furnishing?: string | undefined; relationshipType: string }): Promise<PropertyDraft> {
    const provider = await this.requireDraftProvider(userId);
    validateProperty(input);
    return this.client.begin(async (transaction) => {
      const properties = await transaction<{ id: string }[]>`INSERT INTO properties (created_by_user_id, property_type, region, city, neighborhood, landmark, bedrooms, bathrooms, size_sqm, furnishing) VALUES (${userId}, ${input.propertyType}, ${input.region}, ${input.city.trim()}, ${input.neighborhood.trim()}, ${input.landmark?.trim() || null}, ${input.bedrooms ?? null}, ${input.bathrooms ?? null}, ${input.sizeSqm ?? null}, ${input.furnishing || null}) RETURNING id`;
      const property = properties[0]; if (!property) throw new IdentityError('PROPERTY_CREATE_FAILED', 'Property could not be created');
      const relationships = await transaction<{ id: string }[]>`INSERT INTO provider_property_relationships (property_id, provider_account_id, relationship_type) VALUES (${property.id}, ${provider.account_id}, ${input.relationshipType}) RETURNING id`;
      const relationship = relationships[0]; if (!relationship) throw new IdentityError('RELATIONSHIP_CREATE_FAILED', 'Property relationship could not be created');
      const result = await transaction<PropertyRow[]>`SELECT p.id, p.property_type, p.region, p.city, p.neighborhood, p.landmark, p.bedrooms, p.bathrooms, p.size_sqm::text, p.furnishing, r.id AS relationship_id, r.relationship_type, r.authorization_status FROM properties p JOIN provider_property_relationships r ON r.property_id = p.id WHERE p.id = ${property.id}`;
      const row = result[0]; if (!row) throw new IdentityError('PROPERTY_READ_FAILED', 'Property could not be read');
      return mapProperty(row);
    });
  }

  public async drafts(userId: string): Promise<ListingDraft[]> {
    const provider = await this.requireDraftProvider(userId);
    const rows = await this.client<ListingRow[]>`SELECT l.id, l.property_id, l.provider_account_id, l.purpose, l.publication_status, l.moderation_status, r.id AS revision_id, r.version, r.title, r.description, o.id AS offering_id, ov.id AS offering_version_id, ov.currency, ov.amount_minor, ov.pricing_period, ov.negotiable, ov.deposit_amount_minor, ov.advance_months, ov.minimum_lease_months, ov.utilities_included, ov.service_charge_amount_minor, ov.weekly_amount_minor, ov.minimum_nights, ov.guest_limit, ov.check_in_time::text, ov.check_out_time::text, ov.cleaning_fee_minor, ov.available_from::text FROM listings l JOIN listing_revisions r ON r.id = l.current_revision_id JOIN offerings o ON o.listing_id = l.id JOIN offering_versions ov ON ov.id = o.current_version_id WHERE l.provider_account_id = ${provider.account_id} AND l.publication_status IN ('DRAFT', 'PENDING_REVIEW') ORDER BY l.updated_at DESC`;
    return rows.map(mapDraft);
  }

  public async draft(userId: string, listingId: string): Promise<ListingDraft> {
    const provider = await this.requireDraftProvider(userId);
    return this.readDraft(this.client, listingId, provider.account_id);
  }

  public async createDraft(userId: string, input: { propertyId: string; purpose: string; title?: string | undefined; description?: string | undefined } & OfferingTermsInput): Promise<ListingDraft> {
    const provider = await this.requireDraftProvider(userId);
    if (!purposes.includes(input.purpose as ListingPurpose)) throw new IdentityError('DRAFT_PURPOSE_INVALID', 'Listing purpose is invalid');
    const pricingPeriod = input.pricingPeriod ?? (input.purpose === 'RENT' ? 'MONTHLY' : input.purpose === 'SALE' ? 'TOTAL' : 'NIGHTLY');
    validateOfferingTerms(input.purpose as ListingPurpose, { ...input, pricingPeriod });
    return this.client.begin(async (transaction) => {
      const relationship = await transaction<{ id: string }[]>`SELECT id FROM provider_property_relationships WHERE property_id = ${input.propertyId} AND provider_account_id = ${provider.account_id} AND authorization_status IN ('DECLARED', 'PENDING', 'VERIFIED') FOR UPDATE`;
      const relation = relationship[0]; if (!relation) throw new IdentityError('PROPERTY_SCOPE_DENIED', 'Property is not owned by this provider');
      const listingRows = await transaction<{ id: string }[]>`INSERT INTO listings (property_id, provider_account_id, provider_property_relationship_id, purpose, created_by_user_id) VALUES (${input.propertyId}, ${provider.account_id}, ${relation.id}, ${input.purpose}, ${userId}) RETURNING id`;
      const listing = listingRows[0]; if (!listing) throw new IdentityError('DRAFT_CREATE_FAILED', 'Listing draft could not be created');
      const revisions = await transaction<{ id: string }[]>`INSERT INTO listing_revisions (listing_id, version, title, description, created_by_user_id) VALUES (${listing.id}, 1, ${input.title?.trim() || null}, ${input.description?.trim() || null}, ${userId}) RETURNING id`;
      const revision = revisions[0]; if (!revision) throw new IdentityError('REVISION_CREATE_FAILED', 'Listing draft revision could not be created');
      await transaction`UPDATE listings SET current_revision_id = ${revision.id} WHERE id = ${listing.id}`;
      const offerings = await transaction<{ id: string }[]>`INSERT INTO offerings (listing_id, purpose) VALUES (${listing.id}, ${input.purpose}) RETURNING id`;
      const offering = offerings[0]; if (!offering) throw new IdentityError('OFFERING_CREATE_FAILED', 'Draft offering could not be created');
      const versions = await transaction<{ id: string }[]>`INSERT INTO offering_versions (offering_id, version, amount_minor, pricing_period, negotiable, deposit_amount_minor, advance_months, minimum_lease_months, utilities_included, service_charge_amount_minor, weekly_amount_minor, minimum_nights, guest_limit, check_in_time, check_out_time, cleaning_fee_minor, available_from, created_by_user_id) VALUES (${offering.id}, 1, ${input.amountMinor ?? null}, ${pricingPeriod}, ${input.negotiable ?? false}, ${input.depositAmountMinor ?? null}, ${input.advanceMonths ?? null}, ${input.minimumLeaseMonths ?? null}, ${input.utilitiesIncluded ?? null}, ${input.serviceChargeAmountMinor ?? null}, ${input.weeklyAmountMinor ?? null}, ${input.minimumNights ?? null}, ${input.guestLimit ?? null}, ${input.checkInTime ?? null}, ${input.checkOutTime ?? null}, ${input.cleaningFeeMinor ?? null}, ${input.availableFrom ?? null}, ${userId}) RETURNING id`;
      const version = versions[0]; if (!version) throw new IdentityError('OFFERING_VERSION_FAILED', 'Draft offering terms could not be created');
      await transaction`UPDATE offerings SET current_version_id = ${version.id} WHERE id = ${offering.id}`;
      return this.readDraft(transaction, listing.id, provider.account_id);
    });
  }

  public async updateDraft(userId: string, listingId: string, input: { title?: string | null | undefined; description?: string | null | undefined } & OfferingTermsInput): Promise<ListingDraft> {
    const provider = await this.requireDraftProvider(userId);
    return this.client.begin(async (transaction) => {
      const listingRows = await transaction<{ id: string; purpose: ListingPurpose; revision_id: string; revision_version: number; offering_id: string; offering_version_id: string; offering_version: number }[]>`SELECT l.id, l.purpose, l.current_revision_id AS revision_id, r.version AS revision_version, o.id AS offering_id, o.current_version_id AS offering_version_id, ov.version AS offering_version FROM listings l JOIN listing_revisions r ON r.id = l.current_revision_id JOIN offerings o ON o.listing_id = l.id JOIN offering_versions ov ON ov.id = o.current_version_id WHERE l.id = ${listingId} AND l.provider_account_id = ${provider.account_id} AND l.publication_status = 'DRAFT' FOR UPDATE`;
      const listing = listingRows[0]; if (!listing) throw new IdentityError('DRAFT_SCOPE_DENIED', 'Listing draft is not available');
      validateOfferingTerms(listing.purpose, input);
      const revisionRows = await transaction<{ id: string }[]>`INSERT INTO listing_revisions (listing_id, version, title, description, created_by_user_id) SELECT ${listingId}, ${listing.revision_version + 1}, CASE WHEN ${input.title !== undefined} THEN NULLIF(${input.title?.trim() ?? null}, '') ELSE title END, CASE WHEN ${input.description !== undefined} THEN NULLIF(${input.description?.trim() ?? null}, '') ELSE description END, ${userId} FROM listing_revisions WHERE id = ${listing.revision_id} RETURNING id`;
      const revision = revisionRows[0]; if (!revision) throw new IdentityError('REVISION_CREATE_FAILED', 'Draft revision could not be created');
      await transaction`UPDATE listings SET current_revision_id = ${revision.id}, updated_at = now() WHERE id = ${listingId}`;
      const versionRows = await transaction<{ id: string }[]>`INSERT INTO offering_versions (offering_id, version, amount_minor, pricing_period, negotiable, deposit_amount_minor, advance_months, minimum_lease_months, utilities_included, service_charge_amount_minor, weekly_amount_minor, minimum_nights, guest_limit, check_in_time, check_out_time, cleaning_fee_minor, available_from, created_by_user_id) SELECT ${listing.offering_id}, ${listing.offering_version + 1}, CASE WHEN ${input.amountMinor !== undefined} THEN ${input.amountMinor ?? null} ELSE amount_minor END, COALESCE(${input.pricingPeriod ?? null}, pricing_period), COALESCE(${input.negotiable ?? null}, negotiable), CASE WHEN ${input.depositAmountMinor !== undefined} THEN ${input.depositAmountMinor ?? null} ELSE deposit_amount_minor END, CASE WHEN ${input.advanceMonths !== undefined} THEN ${input.advanceMonths ?? null} ELSE advance_months END, CASE WHEN ${input.minimumLeaseMonths !== undefined} THEN ${input.minimumLeaseMonths ?? null} ELSE minimum_lease_months END, CASE WHEN ${input.utilitiesIncluded !== undefined} THEN ${input.utilitiesIncluded ?? null} ELSE utilities_included END, CASE WHEN ${input.serviceChargeAmountMinor !== undefined} THEN ${input.serviceChargeAmountMinor ?? null} ELSE service_charge_amount_minor END, CASE WHEN ${input.weeklyAmountMinor !== undefined} THEN ${input.weeklyAmountMinor ?? null} ELSE weekly_amount_minor END, CASE WHEN ${input.minimumNights !== undefined} THEN ${input.minimumNights ?? null} ELSE minimum_nights END, CASE WHEN ${input.guestLimit !== undefined} THEN ${input.guestLimit ?? null} ELSE guest_limit END, CASE WHEN ${input.checkInTime !== undefined} THEN ${input.checkInTime ?? null} ELSE check_in_time END, CASE WHEN ${input.checkOutTime !== undefined} THEN ${input.checkOutTime ?? null} ELSE check_out_time END, CASE WHEN ${input.cleaningFeeMinor !== undefined} THEN ${input.cleaningFeeMinor ?? null} ELSE cleaning_fee_minor END, CASE WHEN ${input.availableFrom !== undefined} THEN ${input.availableFrom ?? null} ELSE available_from END, ${userId} FROM offering_versions WHERE id = ${listing.offering_version_id} RETURNING id`;
      const version = versionRows[0]; if (!version) throw new IdentityError('OFFERING_VERSION_FAILED', 'Draft offering version could not be created');
      await transaction`UPDATE offerings SET current_version_id = ${version.id} WHERE id = ${listing.offering_id}`;
      return this.readDraft(transaction, listingId, provider.account_id);
    });
  }

  private async requireDraftProvider(userId: string): Promise<ProviderContext> {
    const provider = await this.provider(userId);
    if (!provider || provider.user_state !== 'ACTIVE' || !['DRAFT', 'ACTIVE'].includes(provider.profile_state)) throw new IdentityError('PROVIDER_ELIGIBILITY_REQUIRED', 'Active phone-confirmed provider profile required');
    return provider;
  }

  private async provider(userId: string): Promise<ProviderContext | null> {
    const rows = await this.client<ProviderContext[]>`SELECT a.id AS account_id, u.account_state AS user_state, p.state AS profile_state, p.verification_status AS verification_status FROM provider_accounts a JOIN provider_profiles p ON p.id = a.provider_profile_id JOIN users u ON u.id = p.user_id WHERE p.user_id = ${userId}`;
    return rows[0] ?? null;
  }

  private async readDraft(transaction: postgres.Sql, listingId: string, providerAccountId: string): Promise<ListingDraft> {
    const rows = await transaction<ListingRow[]>`SELECT l.id, l.property_id, l.provider_account_id, l.purpose, l.publication_status, l.moderation_status, r.id AS revision_id, r.version, r.title, r.description, o.id AS offering_id, ov.id AS offering_version_id, ov.currency, ov.amount_minor, ov.pricing_period, ov.negotiable, ov.deposit_amount_minor, ov.advance_months, ov.minimum_lease_months, ov.utilities_included, ov.service_charge_amount_minor, ov.weekly_amount_minor, ov.minimum_nights, ov.guest_limit, ov.check_in_time::text, ov.check_out_time::text, ov.cleaning_fee_minor, ov.available_from::text FROM listings l JOIN listing_revisions r ON r.id = l.current_revision_id JOIN offerings o ON o.listing_id = l.id JOIN offering_versions ov ON ov.id = o.current_version_id WHERE l.id = ${listingId} AND l.provider_account_id = ${providerAccountId}`;
    const row = rows[0]; if (!row) throw new IdentityError('DRAFT_READ_FAILED', 'Listing draft could not be read');
    return mapDraft(row);
  }
}

type PropertyRow = { id: string; property_type: PropertyType; region: 'Southwest' | 'Littoral'; city: string; neighborhood: string; landmark: string | null; bedrooms: number | null; bathrooms: number | null; size_sqm: string | null; furnishing: string | null; relationship_id: string; relationship_type: RelationshipType; authorization_status: 'DECLARED' };
type ListingRow = { id: string; property_id: string; provider_account_id: string; purpose: ListingPurpose; publication_status: 'DRAFT' | 'PENDING_REVIEW'; moderation_status: 'NOT_REVIEWED' | 'IN_REVIEW'; revision_id: string; version: number; title: string | null; description: string | null; offering_id: string; offering_version_id: string; currency: 'XAF'; amount_minor: number | string | null; pricing_period: 'MONTHLY' | 'TOTAL' | 'NIGHTLY'; negotiable: boolean; deposit_amount_minor: number | string | null; advance_months: number | null; minimum_lease_months: number | null; utilities_included: boolean | null; service_charge_amount_minor: number | string | null; weekly_amount_minor: number | string | null; minimum_nights: number | null; guest_limit: number | null; check_in_time: string | null; check_out_time: string | null; cleaning_fee_minor: number | string | null; available_from: string | null };
function mapProperty(row: PropertyRow): PropertyDraft { return { id: row.id, propertyType: row.property_type, region: row.region, city: row.city, neighborhood: row.neighborhood, landmark: row.landmark, bedrooms: row.bedrooms, bathrooms: row.bathrooms, sizeSqm: row.size_sqm, furnishing: row.furnishing, relationshipId: row.relationship_id, relationshipType: row.relationship_type, authorizationStatus: 'DECLARED' }; }
function mapDraft(row: ListingRow): ListingDraft { return { id: row.id, propertyId: row.property_id, providerAccountId: row.provider_account_id, purpose: row.purpose, publicationStatus: row.publication_status, moderationStatus: row.moderation_status, revisionId: row.revision_id, version: row.version, title: row.title, description: row.description, offeringId: row.offering_id, offeringVersionId: row.offering_version_id, currency: 'XAF', amountMinor: row.amount_minor === null ? null : Number(row.amount_minor), pricingPeriod: row.pricing_period, negotiable: row.negotiable, depositAmountMinor: row.deposit_amount_minor === null ? null : Number(row.deposit_amount_minor), advanceMonths: row.advance_months, minimumLeaseMonths: row.minimum_lease_months, utilitiesIncluded: row.utilities_included, serviceChargeAmountMinor: row.service_charge_amount_minor === null ? null : Number(row.service_charge_amount_minor), weeklyAmountMinor: row.weekly_amount_minor === null ? null : Number(row.weekly_amount_minor), minimumNights: row.minimum_nights, guestLimit: row.guest_limit, checkInTime: row.check_in_time, checkOutTime: row.check_out_time, cleaningFeeMinor: row.cleaning_fee_minor === null ? null : Number(row.cleaning_fee_minor), availableFrom: row.available_from }; }

function validateProperty(input: { propertyType: string; region: string; city: string; neighborhood: string; bedrooms?: number | undefined; bathrooms?: number | undefined; sizeSqm?: number | undefined; furnishing?: string | undefined; relationshipType: string }): void {
  if (!propertyTypes.includes(input.propertyType as PropertyType) || !['Southwest', 'Littoral'].includes(input.region) || !input.city.trim() || !input.neighborhood.trim() || !relationshipTypes.includes(input.relationshipType as RelationshipType)) throw new IdentityError('PROPERTY_INPUT_INVALID', 'Property details are invalid');
  for (const value of [input.bedrooms, input.bathrooms]) if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new IdentityError('PROPERTY_INPUT_INVALID', 'Property details are invalid');
  if (input.sizeSqm !== undefined && (!Number.isFinite(input.sizeSqm) || input.sizeSqm <= 0)) throw new IdentityError('PROPERTY_INPUT_INVALID', 'Property details are invalid');
}

function validateOfferingTerms(purpose: ListingPurpose, input: OfferingTermsInput): void {
  const expectedPeriod = purpose === 'RENT' ? 'MONTHLY' : purpose === 'SALE' ? 'TOTAL' : 'NIGHTLY';
  const nonnegative = [input.amountMinor, input.depositAmountMinor, input.advanceMonths, input.serviceChargeAmountMinor, input.weeklyAmountMinor, input.cleaningFeeMinor];
  const rentOnly = [input.depositAmountMinor, input.advanceMonths, input.minimumLeaseMonths, input.utilitiesIncluded, input.serviceChargeAmountMinor];
  const shortLetOnly = [input.weeklyAmountMinor, input.minimumNights, input.guestLimit, input.checkInTime, input.checkOutTime, input.cleaningFeeMinor];
  const invalidTime = [input.checkInTime, input.checkOutTime].some((value) => value != null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
  if ((input.pricingPeriod !== undefined && input.pricingPeriod !== expectedPeriod) || nonnegative.some((value) => value !== undefined && value !== null && (!Number.isInteger(value) || value < 0)) || (input.minimumLeaseMonths != null && (!Number.isInteger(input.minimumLeaseMonths) || input.minimumLeaseMonths <= 0)) || (input.minimumNights != null && (!Number.isInteger(input.minimumNights) || input.minimumNights <= 0)) || (input.guestLimit != null && (!Number.isInteger(input.guestLimit) || input.guestLimit <= 0)) || (purpose !== 'RENT' && rentOnly.some((value) => value !== undefined && value !== null)) || (purpose !== 'SHORT_LET' && shortLetOnly.some((value) => value !== undefined && value !== null)) || invalidTime) throw new IdentityError('OFFERING_TERMS_INVALID', 'Offering terms are not valid for this listing purpose');
}
