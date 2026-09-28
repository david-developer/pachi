import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import type { ListingPurpose } from './property.js';

export type ListingReadinessCheck = { code: string; field: string; label: string; status: 'READY' | 'BLOCKED'; message: string | null };
export type ListingSubmissionRecord = { id: string; listingId: string; revisionId: string; offeringVersionId: string; submittedAt: string; mediaSnapshot: Array<{ listing_media_id: string; media_asset_id: string; display_order: number; is_cover: boolean }> };
export type ListingReadiness = { listingId: string; publicationStatus: string; moderationStatus: string; revisionId: string; revisionVersion: number; offeringId: string; offeringVersionId: string; canSubmit: boolean; checks: ListingReadinessCheck[]; submission: ListingSubmissionRecord | null };
export type ListingSubmissionResult = { submission: ListingSubmissionRecord; readiness: ListingReadiness; idempotent: boolean };
export type SubmitListingInput = { revisionId: string; offeringVersionId: string; idempotencyKey: string; requestId: string | null };

type ProviderRow = { account_id: string; account_kind: string; account_state: string; profile_state: string; verification_status: string; user_state: string; phone_verified: boolean };
type ListingRow = { id: string; provider_account_id: string; property_id: string; relationship_id: string; purpose: ListingPurpose; publication_status: string; moderation_status: string; revision_id: string; revision_version: number; title: string | null; description: string | null; property_type: string; property_state: string; region: string; city: string; neighborhood: string; bedrooms: number | null; bathrooms: number | null; size_sqm: string | null; furnishing: string | null; relationship_status: string; relationship_current: boolean; offering_id: string; offering_purpose: string; offering_version_id: string; currency: string; amount_minor: number | string | null; pricing_period: string; available_from: string | null };
type MediaRow = { listing_media_id: string; media_asset_id: string; display_order: number; is_cover: boolean; lifecycle: string };
type DbSubmission = { id: string; listing_id: string; listing_revision_id: string; offering_version_id: string; submitted_at: Date | string; media_snapshot: ListingSubmissionRecord['mediaSnapshot'] };

export class ListingSubmissionStore {
  public constructor(private readonly client: postgres.Sql) {}

  public async readiness(userId: string, listingId: string): Promise<ListingReadiness> {
    return this.client.begin(async (tx) => this.evaluate(tx, userId, listingId));
  }

  public async submit(userId: string, listingId: string, input: SubmitListingInput): Promise<ListingSubmissionResult | { readiness: ListingReadiness; submission: null; idempotent: false }> {
    return this.client.begin(async (tx) => {
      const provider = await this.provider(tx, userId, true);
      if (!provider) throw new IdentityError('SUBMISSION_SCOPE_DENIED', 'Listing submission is not available');
      const listing = await this.listing(tx, listingId, provider.account_id, true);
      if (!listing) throw new IdentityError('SUBMISSION_SCOPE_DENIED', 'Listing submission is not available');
      if (listing.revision_id !== input.revisionId || listing.offering_version_id !== input.offeringVersionId) throw new IdentityError('STALE_VERSION', 'Listing or offering changed; refresh readiness and try again');

      const prior = await tx<DbSubmission[]>`SELECT id, listing_id, listing_revision_id, offering_version_id, submitted_at, media_snapshot FROM listing_submissions WHERE listing_id = ${listingId} AND listing_revision_id = ${input.revisionId}`;
      if (prior[0]) {
        if (prior[0].offering_version_id !== input.offeringVersionId) throw new IdentityError('STALE_VERSION', 'Submission snapshot no longer matches this offering');
        return { submission: mapSubmission(prior[0]), readiness: await this.evaluateLoaded(tx, provider, listing, true), idempotent: true };
      }
      const keyUse = await tx<{ listing_id: string; listing_revision_id: string }[]>`SELECT listing_id, listing_revision_id FROM listing_submissions WHERE submitted_by_user_id = ${userId} AND idempotency_key = ${input.idempotencyKey}`;
      if (keyUse[0]) throw new IdentityError('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for another submission');
      if (listing.publication_status !== 'DRAFT') throw new IdentityError('LISTING_STATE_INVALID', 'Only a private draft can be submitted');

      const readiness = await this.evaluateLoaded(tx, provider, listing, true);
      if (!readiness.canSubmit) return { readiness, submission: null, idempotent: false };

      const media = await this.media(tx, listingId, true);
      const mediaSnapshot = JSON.stringify(media.map((item) => ({ listing_media_id: item.listing_media_id, media_asset_id: item.media_asset_id, display_order: item.display_order, is_cover: item.is_cover })));
      const inserted = await tx<DbSubmission[]>`INSERT INTO listing_submissions (listing_id, listing_revision_id, offering_id, offering_version_id, provider_property_relationship_id, submitted_by_user_id, idempotency_key, media_snapshot) SELECT ${listingId}, ${listing.revision_id}, ${listing.offering_id}, ${listing.offering_version_id}, ${listing.relationship_id}, ${userId}, ${input.idempotencyKey}, ${mediaSnapshot}::jsonb WHERE EXISTS (SELECT 1 FROM listings WHERE id = ${listingId} AND current_revision_id = ${input.revisionId} AND publication_status = 'DRAFT') RETURNING id, listing_id, listing_revision_id, offering_version_id, submitted_at, media_snapshot`;
      const submission = inserted[0];
      if (!submission) throw new IdentityError('SUBMISSION_FAILED', 'Listing could not be submitted');
      const transitioned = await tx<{ id: string }[]>`UPDATE listings SET publication_status = 'PENDING_REVIEW', moderation_status = 'IN_REVIEW', updated_at = now() WHERE id = ${listingId} AND provider_account_id = ${provider.account_id} AND publication_status = 'DRAFT' AND current_revision_id = ${input.revisionId} RETURNING id`;
      if (!transitioned[0]) throw new IdentityError('STALE_VERSION', 'Listing changed before submission completed');
      await tx`UPDATE listing_revisions SET submitted_at = now() WHERE id = ${listing.revision_id} AND listing_id = ${listingId}`;
      await tx`INSERT INTO audit_events (actor_user_id, action, target_type, target_id, reason_code, request_id, safe_metadata) VALUES (${userId}, 'LISTING_SUBMITTED_FOR_REVIEW', 'Listing', ${listingId}, 'SUBMISSION_READY', ${input.requestId}, ${JSON.stringify({ submission_id: submission.id, revision_id: listing.revision_id, offering_version_id: listing.offering_version_id, media_snapshot: JSON.parse(mediaSnapshot) })}::jsonb)`;
      const submittedReadiness = await this.evaluate(tx, userId, listingId);
      return { submission: mapSubmission(submission), readiness: submittedReadiness, idempotent: false };
    });
  }

  private async evaluate(tx: postgres.TransactionSql, userId: string, listingId: string): Promise<ListingReadiness> {
    const provider = await this.provider(tx, userId, false);
    if (!provider) throw new IdentityError('SUBMISSION_SCOPE_DENIED', 'Listing submission is not available');
    const listing = await this.listing(tx, listingId, provider.account_id, false);
    if (!listing) throw new IdentityError('SUBMISSION_SCOPE_DENIED', 'Listing submission is not available');
    return this.evaluateLoaded(tx, provider, listing, false);
  }

  private async evaluateLoaded(tx: postgres.TransactionSql, provider: ProviderRow, listing: ListingRow, lockMedia: boolean): Promise<ListingReadiness> {
    const media = await this.media(tx, listing.id, lockMedia);
    const submissionRows = await tx<DbSubmission[]>`SELECT id, listing_id, listing_revision_id, offering_version_id, submitted_at, media_snapshot FROM listing_submissions WHERE listing_id = ${listing.id} ORDER BY submitted_at DESC LIMIT 1`;
    const checks: ListingReadinessCheck[] = [];
    const add = (code: string, field: string, label: string, ok: boolean, message: string) => checks.push({ code, field, label, status: ok ? 'READY' : 'BLOCKED', message: ok ? null : message });
    const expectedPeriod = listing.purpose === 'RENT' ? 'MONTHLY' : listing.purpose === 'SALE' ? 'TOTAL' : 'NIGHTLY';

    add('LISTING_TITLE_REQUIRED', 'title', 'Listing title', Boolean(listing.title?.trim()), 'Add a title for this listing.');
    add('LISTING_DESCRIPTION_REQUIRED', 'description', 'Listing description', Boolean(listing.description?.trim()), 'Add a description for this listing.');
    add('PROPERTY_SPECIFICATION_REQUIRED', 'property.specifications', 'Property specifications', listing.bedrooms !== null || listing.bathrooms !== null || listing.size_sqm !== null || listing.furnishing !== null, 'Add a key physical specification, such as bedrooms, bathrooms, size, or furnishing.');
    add('PROPERTY_LOCATION_REQUIRED', 'property.location', 'Structured location', ['Southwest', 'Littoral'].includes(listing.region) && Boolean(listing.city.trim()) && Boolean(listing.neighborhood.trim()), 'Complete the region, city, and neighborhood for this property.');
    add('PROPERTY_RECORD_UNAVAILABLE', 'property', 'Property record', listing.property_state === 'ACTIVE', 'This property is not in an active record state.');
    add('PROPERTY_RELATIONSHIP_NOT_CURRENT', 'property.relationship', 'Provider-property relationship', ['DECLARED', 'VERIFIED'].includes(listing.relationship_status) && listing.relationship_current, 'Re-establish a current relationship to this property before submission.');
    add('PROPERTY_AUTHORITY_REVIEW_UNAVAILABLE', 'property.authority', 'Pending authority evidence', listing.relationship_status !== 'PENDING', 'This workspace cannot distinguish pending authority evidence from an adverse or ambiguous relationship state. Submission remains blocked until the authority case reader exists.');
    add('GEOGRAPHIC_REGION_NOT_ENABLED', 'property.region', 'Publishing region', ['Southwest', 'Littoral'].includes(listing.region), 'This region is not enabled for listing submission.');
    const validOffering = listing.offering_purpose === listing.purpose && listing.currency === 'XAF' && Number(listing.amount_minor) > 0 && listing.pricing_period === expectedPeriod && listing.available_from !== null;
    add('OFFERING_TERMS_INCOMPLETE', 'offering', 'Offering terms', validOffering, 'Add a positive price, the purpose-compatible pricing period, and an availability date.');
    add('MEDIA_REQUIRED', 'media', 'Listing photos', media.length > 0 && media.some((item) => item.lifecycle === 'READY'), 'Add at least one processed photo to this listing.');
    add('MEDIA_PROCESSING_INCOMPLETE', 'media', 'Photo processing', media.length > 0 && media.every((item) => item.lifecycle === 'READY'), 'Wait for every selected photo to finish processing or remove photos that failed.');
    add('MEDIA_COVER_REQUIRED', 'media.cover', 'Cover photo', media.filter((item) => item.lifecycle === 'READY' && item.is_cover).length === 1, 'Choose one processed photo as the cover.');
    add('MEDIA_APPROVAL_UNAVAILABLE', 'media.approval', 'Photo content approval', false, 'Photo content approval is not implemented yet. A processed photo is not an approved photo, so submission remains blocked.');
    add('ACCOUNT_NOT_ELIGIBLE', 'provider.account', 'Account eligibility', provider.user_state === 'ACTIVE' && provider.phone_verified, 'An active, phone-confirmed account is required to submit.');
    add('PROVIDER_NOT_ACTIVE', 'provider.profile', 'Provider profile', provider.profile_state === 'ACTIVE' && provider.account_state === 'ACTIVE', 'An active provider profile and account are required to submit.');
    add('PROVIDER_IDENTITY_VERIFICATION_UNAVAILABLE', 'provider.verification', 'Provider identity verification', false, 'The evidence-backed current PROVIDER_IDENTITY verification required for submission is not available in this workspace. Do not change verification status manually.');
    add('PROPERTY_RISK_HOLD_EVALUATION_UNAVAILABLE', 'property.risk_hold', 'Authority risk-hold evaluation', false, 'Authority risk holds and adverse decisions are not represented in this workspace. Submission remains blocked until the policy reader exists.');

    const submission = submissionRows[0] ? mapSubmission(submissionRows[0]) : null;
    const canSubmit = listing.publication_status === 'DRAFT' && checks.every((check) => check.status === 'READY');
    return { listingId: listing.id, publicationStatus: listing.publication_status, moderationStatus: listing.moderation_status, revisionId: listing.revision_id, revisionVersion: listing.revision_version, offeringId: listing.offering_id, offeringVersionId: listing.offering_version_id, canSubmit, checks, submission };
  }

  private async provider(tx: postgres.TransactionSql, userId: string, lock: boolean): Promise<ProviderRow | null> {
    const rows = lock
      ? await tx<ProviderRow[]>`SELECT a.id AS account_id, a.kind AS account_kind, a.state AS account_state, p.state AS profile_state, p.verification_status, u.account_state AS user_state, EXISTS (SELECT 1 FROM phone_contacts pc WHERE pc.user_id = u.id AND pc.verified_at IS NOT NULL AND pc.replaced_at IS NULL) AS phone_verified FROM users u JOIN provider_profiles p ON p.user_id = u.id JOIN provider_accounts a ON a.provider_profile_id = p.id WHERE u.id = ${userId} FOR UPDATE OF u, p, a`
      : await tx<ProviderRow[]>`SELECT a.id AS account_id, a.kind AS account_kind, a.state AS account_state, p.state AS profile_state, p.verification_status, u.account_state AS user_state, EXISTS (SELECT 1 FROM phone_contacts pc WHERE pc.user_id = u.id AND pc.verified_at IS NOT NULL AND pc.replaced_at IS NULL) AS phone_verified FROM users u JOIN provider_profiles p ON p.user_id = u.id JOIN provider_accounts a ON a.provider_profile_id = p.id WHERE u.id = ${userId}`;
    return rows[0] ?? null;
  }

  private async listing(tx: postgres.TransactionSql, listingId: string, providerAccountId: string, lock: boolean): Promise<ListingRow | null> {
    const rows = lock
      ? await tx<ListingRow[]>`SELECT l.id, l.provider_account_id, l.property_id, l.provider_property_relationship_id AS relationship_id, l.purpose, l.publication_status, l.moderation_status, revision.id AS revision_id, revision.version AS revision_version, revision.title, revision.description, property.property_type, property.record_state AS property_state, property.region, property.city, property.neighborhood, property.bedrooms, property.bathrooms, property.size_sqm::text, property.furnishing, relation.authorization_status AS relationship_status, (relation.authorization_status IN ('DECLARED', 'PENDING', 'VERIFIED') AND (relation.valid_from IS NULL OR relation.valid_from <= now()) AND (relation.valid_until IS NULL OR relation.valid_until > now())) AS relationship_current, offering.id AS offering_id, offering.purpose AS offering_purpose, offering_version.id AS offering_version_id, offering_version.currency, offering_version.amount_minor, offering_version.pricing_period, offering_version.available_from::text FROM listings l JOIN listing_revisions revision ON revision.id = l.current_revision_id AND revision.listing_id = l.id JOIN properties property ON property.id = l.property_id JOIN provider_property_relationships relation ON relation.id = l.provider_property_relationship_id AND relation.property_id = l.property_id AND relation.provider_account_id = l.provider_account_id JOIN offerings offering ON offering.listing_id = l.id JOIN offering_versions offering_version ON offering_version.id = offering.current_version_id AND offering_version.offering_id = offering.id WHERE l.id = ${listingId} AND l.provider_account_id = ${providerAccountId} FOR UPDATE OF l, revision, property, relation, offering, offering_version`
      : await tx<ListingRow[]>`SELECT l.id, l.provider_account_id, l.property_id, l.provider_property_relationship_id AS relationship_id, l.purpose, l.publication_status, l.moderation_status, revision.id AS revision_id, revision.version AS revision_version, revision.title, revision.description, property.property_type, property.record_state AS property_state, property.region, property.city, property.neighborhood, property.bedrooms, property.bathrooms, property.size_sqm::text, property.furnishing, relation.authorization_status AS relationship_status, (relation.authorization_status IN ('DECLARED', 'PENDING', 'VERIFIED') AND (relation.valid_from IS NULL OR relation.valid_from <= now()) AND (relation.valid_until IS NULL OR relation.valid_until > now())) AS relationship_current, offering.id AS offering_id, offering.purpose AS offering_purpose, offering_version.id AS offering_version_id, offering_version.currency, offering_version.amount_minor, offering_version.pricing_period, offering_version.available_from::text FROM listings l JOIN listing_revisions revision ON revision.id = l.current_revision_id AND revision.listing_id = l.id JOIN properties property ON property.id = l.property_id JOIN provider_property_relationships relation ON relation.id = l.provider_property_relationship_id AND relation.property_id = l.property_id AND relation.provider_account_id = l.provider_account_id JOIN offerings offering ON offering.listing_id = l.id JOIN offering_versions offering_version ON offering_version.id = offering.current_version_id AND offering_version.offering_id = offering.id WHERE l.id = ${listingId} AND l.provider_account_id = ${providerAccountId}`;
    return rows[0] ?? null;
  }

  private async media(tx: postgres.TransactionSql, listingId: string, lock: boolean): Promise<MediaRow[]> {
    return lock
      ? tx<MediaRow[]>`SELECT lm.id AS listing_media_id, lm.media_asset_id, lm.display_order, lm.is_cover, ma.lifecycle FROM listing_media lm JOIN media_assets ma ON ma.id = lm.media_asset_id WHERE lm.listing_id = ${listingId} AND lm.removed_at IS NULL ORDER BY lm.display_order FOR UPDATE OF lm, ma`
      : tx<MediaRow[]>`SELECT lm.id AS listing_media_id, lm.media_asset_id, lm.display_order, lm.is_cover, ma.lifecycle FROM listing_media lm JOIN media_assets ma ON ma.id = lm.media_asset_id WHERE lm.listing_id = ${listingId} AND lm.removed_at IS NULL ORDER BY lm.display_order`;
  }
}

function mapSubmission(row: DbSubmission): ListingSubmissionRecord {
  return { id: row.id, listingId: row.listing_id, revisionId: row.listing_revision_id, offeringVersionId: row.offering_version_id, submittedAt: new Date(row.submitted_at).toISOString(), mediaSnapshot: row.media_snapshot };
}