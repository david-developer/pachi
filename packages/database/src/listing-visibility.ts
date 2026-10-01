import type postgres from 'postgres';
import { readAuthorityRisk } from './authority-risk.js';

type Sql = postgres.Sql | postgres.TransactionSql;
type VisibilityRow = {
  listing_id: string;
  relationship_id: string;
  provider_account_id: string;
  publication_status: string;
  moderation_status: string;
  current_revision_id: string;
  approved_revision_id: string | null;
  approved_submission_id: string | null;
  freshness_current: boolean;
  region: string;
  purpose: string;
  market_status: string;
  property_state: string;
  property_specification_ready: boolean;
  relationship_current: boolean;
  provider_eligible: boolean;
  identity_current: boolean;
  offering_eligible: boolean;
  approved_submission_exact: boolean;
  media_eligible: boolean;
};

export type PublicListingVisibility = {
  visible: boolean;
  reason: string;
};

const blocked = (reason: string): PublicListingVisibility => ({ visible: false, reason });

export async function readPublicListingVisibility(sql: Sql, listingId: string, options: { allowSyntheticVerification?: boolean } = {}): Promise<PublicListingVisibility> {
  const rows = await sql<VisibilityRow[]>`SELECT
    l.id AS listing_id,
    r.id AS relationship_id,
    pa.id AS provider_account_id,
    l.publication_status,
    l.moderation_status,
    l.current_revision_id,
    l.approved_revision_id,
    l.approved_submission_id,
    (l.expires_at IS NOT NULL AND l.expires_at > statement_timestamp()) AS freshness_current,
    p.region,
    l.purpose,
    l.market_status,
    p.record_state AS property_state,
    (p.bedrooms IS NOT NULL OR p.bathrooms IS NOT NULL OR p.size_sqm IS NOT NULL OR p.furnishing IS NOT NULL) AS property_specification_ready,
    (r.authorization_status IN ('DECLARED','VERIFIED') AND (r.valid_from IS NULL OR r.valid_from <= statement_timestamp()) AND (r.valid_until IS NULL OR r.valid_until > statement_timestamp())) AS relationship_current,
    (u.account_state='ACTIVE' AND pp.state='ACTIVE' AND pa.state='ACTIVE' AND EXISTS (
      SELECT 1 FROM phone_contacts pc WHERE pc.user_id=u.id AND pc.verified_at IS NOT NULL AND pc.replaced_at IS NULL
    )) AS provider_eligible,
    EXISTS (
      SELECT 1 FROM verification_claims vc JOIN verification_cases c ON c.id=vc.source_case_id
      WHERE vc.provider_profile_id=pp.id AND vc.status='VERIFIED' AND vc.valid_until>statement_timestamp()
        AND vc.revoked_at IS NULL AND (c.policy_version <> 'provider-identity-synthetic-v1' OR ${options.allowSyntheticVerification === true})
    ) AS identity_current,
    (o.purpose=l.purpose AND ov.currency='XAF' AND ov.amount_minor>0
      AND ov.pricing_period=CASE l.purpose WHEN 'RENT' THEN 'MONTHLY' WHEN 'SALE' THEN 'TOTAL' ELSE 'NIGHTLY' END
      AND ov.available_from IS NOT NULL) AS offering_eligible,
    (l.approved_revision_id=l.current_revision_id AND l.approved_submission_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM listing_submissions s
      WHERE s.id=l.approved_submission_id AND s.listing_id=l.id
        AND s.listing_revision_id=l.current_revision_id AND s.offering_id=o.id
        AND s.offering_version_id=ov.id
    )) AS approved_submission_exact,
    (EXISTS (SELECT 1 FROM listing_media lm JOIN media_assets ma ON ma.id=lm.media_asset_id
      WHERE lm.listing_id=l.id AND lm.removed_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM listing_media lm JOIN media_assets ma ON ma.id=lm.media_asset_id
        WHERE lm.listing_id=l.id AND lm.removed_at IS NULL AND (ma.lifecycle <> 'READY' OR lm.review_status <> 'APPROVED'))
      AND (SELECT count(*) FROM listing_media lm WHERE lm.listing_id=l.id AND lm.removed_at IS NULL AND lm.is_cover)=1) AS media_eligible
    FROM listings l
    JOIN properties p ON p.id=l.property_id
    JOIN provider_property_relationships r ON r.id=l.provider_property_relationship_id
      AND r.property_id=l.property_id AND r.provider_account_id=l.provider_account_id
    JOIN provider_accounts pa ON pa.id=l.provider_account_id
    JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
    JOIN users u ON u.id=pp.user_id
    JOIN listing_revisions lr ON lr.id=l.current_revision_id
    JOIN offerings o ON o.listing_id=l.id
    JOIN offering_versions ov ON ov.id=o.current_version_id
    WHERE l.id=${listingId}`;
  const row = rows[0];
  if (!row) return blocked('LISTING_NOT_FOUND');
  if (row.publication_status !== 'PUBLISHED' || row.moderation_status !== 'APPROVED') return blocked('LISTING_NOT_PUBLISHED');
  if (!row.approved_submission_exact) return blocked('APPROVED_SNAPSHOT_STALE');
  if (!row.freshness_current) return blocked('LISTING_FRESHNESS_EXPIRED');
  if (!['Southwest', 'Littoral'].includes(row.region)) return blocked('REGION_NOT_ENABLED');
  if (row.property_state !== 'ACTIVE' || !row.property_specification_ready) return blocked('PROPERTY_NOT_ELIGIBLE');
  if (!row.provider_eligible) return blocked('PROVIDER_NOT_ELIGIBLE');
  if (!row.identity_current) return blocked('IDENTITY_NOT_CURRENT');
  if (!row.relationship_current) return blocked('RELATIONSHIP_NOT_CURRENT');
  if (!row.offering_eligible) return blocked('OFFERING_NOT_ELIGIBLE');
  if (!row.media_eligible) return blocked('MEDIA_NOT_ELIGIBLE');
  const authority = await readAuthorityRisk(sql, row.relationship_id, row.provider_account_id);
  if (authority.status !== 'CLEAR') return blocked(`AUTHORITY_${authority.status}`);
  if (!discoverable(row.purpose, row.market_status)) return blocked('MARKET_NOT_DISCOVERABLE');
  return { visible: true, reason: 'VISIBLE' };
}

function discoverable(purpose: string, marketStatus: string): boolean {
  if (purpose === 'SHORT_LET') return ['AVAILABLE', 'PARTIALLY_BOOKED'].includes(marketStatus);
  return ['RENT', 'SALE'].includes(purpose) && ['AVAILABLE', 'UNDER_OFFER'].includes(marketStatus);
}
