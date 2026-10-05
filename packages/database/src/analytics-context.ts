import type postgres from 'postgres';
import { z } from 'zod';

export const analyticsSnapshotSchema = z
  .object({
    version: z.literal(1),
    environment: z.enum(['development', 'test', 'staging', 'production']),
    classification: z.enum(['PRODUCTION', 'TEST']),
    region: z.enum(['Southwest', 'Littoral']).nullable(),
    purpose: z.enum(['RENT', 'SALE', 'SHORT_LET']),
    provider_types: z
      .array(
        z.enum([
          'OWNER',
          'INDEPENDENT_AGENT',
          'PROPERTY_MANAGER',
          'ORGANIZATION',
        ]),
      )
      .min(1),
    verification_claim: z.literal('PROVIDER_IDENTITY'),
    verification_status: z.enum(['VERIFIED', 'NOT_VERIFIED']),
  })
  .refine(
    (s) => s.classification !== 'PRODUCTION' || s.environment === 'production',
  );
export type AnalyticsSnapshot = z.infer<typeof analyticsSnapshotSchema>;

// Only called inside the producing business transaction. Never read these mutable
// dimensions during ingestion; legacy sources have explicitly unknown context.
export async function snapshotAnalyticsContext(
  tx: postgres.TransactionSql,
  listingId: string,
  synthetic: boolean,
): Promise<AnalyticsSnapshot> {
  const rows = await tx<
    (Omit<AnalyticsSnapshot, 'version' | 'environment' | 'classification'> & {
      synthetic_claim: boolean;
    })[]
  >`
    SELECT CASE WHEN p.region IN ('Southwest','Littoral') THEN p.region ELSE NULL END AS region,
      l.purpose,pp.provider_types,'PROVIDER_IDENTITY' AS verification_claim,
      CASE WHEN EXISTS (SELECT 1 FROM verification_claims vc JOIN verification_cases c ON c.id=vc.source_case_id
        WHERE vc.provider_profile_id=pp.id AND vc.claim_type='PROVIDER_IDENTITY' AND vc.status='VERIFIED'
          AND vc.valid_from<=statement_timestamp() AND vc.valid_until>statement_timestamp() AND vc.revoked_at IS NULL
          )
        THEN 'VERIFIED' ELSE 'NOT_VERIFIED' END AS verification_status,
      EXISTS (SELECT 1 FROM verification_claims vc JOIN verification_cases c ON c.id=vc.source_case_id WHERE vc.provider_profile_id=pp.id AND vc.status='VERIFIED' AND vc.revoked_at IS NULL AND vc.valid_until>statement_timestamp() AND c.policy_version='provider-identity-synthetic-v1') AS synthetic_claim
    FROM listings l JOIN properties p ON p.id=l.property_id JOIN provider_accounts pa ON pa.id=l.provider_account_id
      JOIN provider_profiles pp ON pp.id=pa.provider_profile_id WHERE l.id=${listingId} FOR SHARE OF l,p,pa,pp`;
  const environment =
    process.env.ANALYTICS_ENVIRONMENT ??
    (process.env.NODE_ENV === 'production'
      ? 'production'
      : process.env.NODE_ENV === 'test'
        ? 'test'
        : 'development');
  return analyticsSnapshotSchema.parse({
    ...rows[0],
    version: 1,
    environment,
    classification:
      environment === 'production' &&
      process.env.NODE_ENV === 'production' &&
      !synthetic &&
      !rows[0]?.synthetic_claim
        ? 'PRODUCTION'
        : 'TEST',
  });
}
