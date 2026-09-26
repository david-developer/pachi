import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { IdentityError } from './identity.js';

export type MediaLifecycle = 'UPLOAD_AUTHORIZED' | 'UPLOADED_QUARANTINED' | 'PROCESSING' | 'READY' | 'FAILED' | 'REJECTED' | 'DELETION_PENDING' | 'DELETED';
export type ListingMediaItem = { id: string; mediaAssetId: string; displayOrder: number; isCover: boolean; state: MediaLifecycle; mimeType: string | null; bytes: number | null; width: number | null; height: number | null; variants: Array<{ variantWidth: number; width: number; height: number; bytes: number; mime: string }>; failureCode: string | null; retryable: boolean };
export type MediaUploadIntent = { assetId: string; storageReference: string; listingId: string; providerAccountId: string };
export type MediaProcessingJob = { id: string; jobId: string; storageReference: string; originalMime: string; originalBytes: number; originalSha256: string; ownerProviderAccountId: string; attemptCount: number };
export type MediaCleanupJob = { id: string; storageReference: string };
export const MAX_LISTING_MEDIA = 20;
export const MAX_PROVIDER_MEDIA_ASSETS = 1000;
export const MAX_PROVIDER_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_PROVIDER_MEDIA_UPLOADS_IN_FLIGHT = 5;
export const MAX_PROVIDER_MEDIA_UPLOAD_AUTHORIZATIONS_PER_HOUR = 100;
const reservedUploadBytes = 15 * 1024 * 1024;

type ProviderScope = { account_id: string; account_state: string; profile_state: string };

export class ListingMediaStore {
  public constructor(private readonly client: postgres.Sql) {}

  public async createUploadIntent(userId: string, listingId: string): Promise<MediaUploadIntent> {
    const provider = await this.requireProvider(userId);
    return this.client.begin(async (tx) => {
      await tx`SELECT id FROM provider_accounts WHERE id = ${provider.account_id} FOR UPDATE`;
      const listingRows = await tx<{ id: string; provider_account_id: string }[]>`SELECT id, provider_account_id FROM listings WHERE id = ${listingId} AND provider_account_id = ${provider.account_id} AND publication_status = 'DRAFT' FOR UPDATE`;
      const listing = listingRows[0];
      if (!listing) throw new IdentityError('MEDIA_DRAFT_SCOPE_DENIED', 'Listing draft is not available');
      const counts = await tx<{ count: number }[]>`SELECT ((SELECT count(*) FROM listing_media lm JOIN media_assets ma ON ma.id = lm.media_asset_id WHERE lm.listing_id = ${listingId} AND lm.removed_at IS NULL AND ma.lifecycle NOT IN ('DELETED', 'DELETION_PENDING')) + (SELECT count(*) FROM media_upload_intents i JOIN media_assets ma ON ma.id = i.media_asset_id WHERE i.listing_id = ${listingId} AND i.expires_at > now() AND ma.lifecycle = 'UPLOAD_AUTHORIZED'))::int AS count`;
      if ((counts[0]?.count ?? 0) >= MAX_LISTING_MEDIA) throw new IdentityError('MEDIA_COUNT_LIMIT', 'A listing can have at most 20 photos');
      const quotaRows = await tx<{ assets: number; bytes: number; inflight: number; recent: number }[]>`SELECT (SELECT count(*) FROM media_assets WHERE owner_provider_account_id = ${provider.account_id} AND lifecycle NOT IN ('DELETED', 'DELETION_PENDING'))::int AS assets, (SELECT COALESCE(sum(original_bytes), 0) FROM media_assets WHERE owner_provider_account_id = ${provider.account_id} AND lifecycle NOT IN ('DELETED', 'DELETION_PENDING'))::bigint AS bytes, (SELECT count(*) FROM media_upload_intents i JOIN media_assets m ON m.id = i.media_asset_id WHERE m.owner_provider_account_id = ${provider.account_id} AND i.expires_at > now() AND m.lifecycle = 'UPLOAD_AUTHORIZED')::int AS inflight, (SELECT count(*) FROM media_assets WHERE owner_provider_account_id = ${provider.account_id} AND created_at > now() - interval '1 hour')::int AS recent`;
      const quota = quotaRows[0];
      if (quota && (quota.assets >= MAX_PROVIDER_MEDIA_ASSETS || Number(quota.bytes) + quota.inflight * reservedUploadBytes >= MAX_PROVIDER_MEDIA_BYTES)) throw new IdentityError('MEDIA_PROVIDER_QUOTA', 'Provider photo storage quota reached');
      if (quota && quota.inflight >= MAX_PROVIDER_MEDIA_UPLOADS_IN_FLIGHT) throw new IdentityError('MEDIA_UPLOADS_IN_FLIGHT', 'Too many photo uploads are already in progress');
      if (quota && quota.recent >= MAX_PROVIDER_MEDIA_UPLOAD_AUTHORIZATIONS_PER_HOUR) throw new IdentityError('MEDIA_UPLOAD_RATE_LIMIT', 'Photo upload rate limit reached');
      const storageReference = randomUUID();
      const assets = await tx<{ id: string }[]>`INSERT INTO media_assets (owner_provider_account_id, classification, storage_reference, lifecycle, upload_expires_at) VALUES (${provider.account_id}, 'PUBLIC_MARKETPLACE', ${storageReference}, 'UPLOAD_AUTHORIZED', now() + interval '5 minutes') RETURNING id`;
      const asset = assets[0];
      if (!asset) throw new IdentityError('MEDIA_UPLOAD_AUTHORIZATION_FAILED', 'Photo upload could not be authorized');
      await tx`INSERT INTO media_upload_intents (media_asset_id, listing_id, expires_at) VALUES (${asset.id}, ${listingId}, now() + interval '5 minutes')`;
      return { assetId: asset.id, storageReference, listingId, providerAccountId: provider.account_id };
    });
  }

  public async completeUpload(userId: string, assetId: string, input: { mime: string; bytes: number; sha256: string }): Promise<void> {
    const provider = await this.requireProvider(userId);
    await this.client.begin(async (tx) => {
      const intents = await tx<{ listing_id: string }[]>`SELECT i.listing_id FROM media_upload_intents i JOIN media_assets m ON m.id = i.media_asset_id JOIN listings l ON l.id = i.listing_id WHERE i.media_asset_id = ${assetId} AND i.expires_at > now() AND m.owner_provider_account_id = ${provider.account_id} AND m.lifecycle = 'UPLOAD_AUTHORIZED' AND l.provider_account_id = ${provider.account_id} AND l.publication_status = 'DRAFT' FOR UPDATE OF i, m, l`;
      const intent = intents[0];
      if (!intent) throw new IdentityError('MEDIA_UPLOAD_SCOPE_DENIED', 'Photo upload authorization is no longer valid');
      const orderRows = await tx<{ next_order: number }[]>`SELECT COALESCE(max(display_order) + 1, 0)::int AS next_order FROM listing_media WHERE listing_id = ${intent.listing_id} AND removed_at IS NULL`;
      await tx`UPDATE media_assets SET original_mime = ${input.mime}, original_bytes = ${input.bytes}, original_sha256 = ${input.sha256}, lifecycle = 'UPLOADED_QUARANTINED', uploaded_at = now(), updated_at = now() WHERE id = ${assetId}`;
      await tx`INSERT INTO listing_media (listing_id, media_asset_id, display_order, attached_by_user_id) VALUES (${intent.listing_id}, ${assetId}, ${orderRows[0]?.next_order ?? 0}, ${userId})`;
      await tx`INSERT INTO media_processing_jobs (media_asset_id) VALUES (${assetId})`;
      await tx`DELETE FROM media_upload_intents WHERE media_asset_id = ${assetId}`;
    });
  }

  public async cancelUpload(assetId: string, code: 'UNSUPPORTED_IMAGE' | 'INVALID_IMAGE' | 'UPLOAD_FAILED'): Promise<void> {
    await this.client.begin(async (tx) => {
      await tx`UPDATE media_assets SET lifecycle = 'REJECTED', failure_code = ${code}, retryable = false, cleanup_after = now() + interval '7 days', updated_at = now() WHERE id = ${assetId} AND lifecycle = 'UPLOAD_AUTHORIZED'`;
      await tx`DELETE FROM media_upload_intents WHERE media_asset_id = ${assetId}`;
    });
  }

  public async media(userId: string, listingId: string): Promise<ListingMediaItem[]> {
    const provider = await this.requireProvider(userId);
    await this.requireDraftScope(this.client, listingId, provider.account_id);
    const rows = await this.client<MediaRow[]>`SELECT lm.id, lm.media_asset_id, lm.display_order, lm.is_cover, ma.lifecycle, ma.original_mime, ma.original_bytes, ma.width, ma.height, ma.derivative_manifest, ma.failure_code, ma.retryable FROM listing_media lm JOIN media_assets ma ON ma.id = lm.media_asset_id WHERE lm.listing_id = ${listingId} AND lm.removed_at IS NULL ORDER BY lm.display_order`;
    return rows.map(mapMedia);
  }

  public async variant(userId: string, listingId: string, mediaAssetId: string, width: number): Promise<{ storageReference: string; mime: string }> {
    const provider = await this.requireProvider(userId);
    await this.requireDraftScope(this.client, listingId, provider.account_id);
    if (![320, 640, 1280, 1920].includes(width)) throw new IdentityError('MEDIA_VARIANT_INVALID', 'Photo size is not available');
    const rows = await this.client<{ storage_reference: string; lifecycle: MediaLifecycle; derivative_manifest: Record<string, { mime: string }> }[]>`SELECT ma.storage_reference, ma.lifecycle, ma.derivative_manifest FROM listing_media lm JOIN media_assets ma ON ma.id = lm.media_asset_id WHERE lm.listing_id = ${listingId} AND lm.media_asset_id = ${mediaAssetId} AND lm.removed_at IS NULL AND ma.owner_provider_account_id = ${provider.account_id}`;
    const media = rows[0];
    const variant = media?.derivative_manifest[String(width)];
    if (!media || media.lifecycle !== 'READY' || !variant) throw new IdentityError('MEDIA_NOT_READY', 'Photo is not ready');
    return { storageReference: media.storage_reference, mime: variant.mime };
  }

  public async reorder(userId: string, listingId: string, mediaAssetIds: string[], coverMediaAssetId: string): Promise<ListingMediaItem[]> {
    const provider = await this.requireProvider(userId);
    await this.client.begin(async (tx) => {
      await this.requireDraftScope(tx, listingId, provider.account_id, true);
      if (new Set(mediaAssetIds).size !== mediaAssetIds.length || mediaAssetIds.length > 20) throw new IdentityError('MEDIA_ORDER_INVALID', 'Photo order is invalid');
      const rows = await tx<{ media_asset_id: string; lifecycle: MediaLifecycle }[]>`SELECT lm.media_asset_id, ma.lifecycle FROM listing_media lm JOIN media_assets ma ON ma.id = lm.media_asset_id WHERE lm.listing_id = ${listingId} AND lm.removed_at IS NULL ORDER BY lm.display_order FOR UPDATE OF lm`;
      const actual = rows.map((row) => row.media_asset_id).sort();
      if (actual.length !== mediaAssetIds.length || actual.some((id, index) => id !== [...mediaAssetIds].sort()[index])) throw new IdentityError('MEDIA_ORDER_INVALID', 'Photo order must include this listing’s current photos');
      if (!rows.some((row) => row.media_asset_id === coverMediaAssetId && row.lifecycle === 'READY')) throw new IdentityError('MEDIA_COVER_INVALID', 'Cover photo must be processed and ready');
      await tx`UPDATE listing_media SET display_order = display_order + 1000, is_cover = false WHERE listing_id = ${listingId} AND removed_at IS NULL`;
      for (const [displayOrder, id] of mediaAssetIds.entries()) await tx`UPDATE listing_media SET display_order = ${displayOrder}, is_cover = ${id === coverMediaAssetId} WHERE listing_id = ${listingId} AND media_asset_id = ${id} AND removed_at IS NULL`;
    });
    return this.media(userId, listingId);
  }

  public async remove(userId: string, listingId: string, mediaAssetId: string): Promise<ListingMediaItem[]> {
    const provider = await this.requireProvider(userId);
    await this.client.begin(async (tx) => {
      await this.requireDraftScope(tx, listingId, provider.account_id, true);
      const selected = await tx<{ is_cover: boolean }[]>`SELECT is_cover FROM listing_media lm JOIN media_assets ma ON ma.id = lm.media_asset_id WHERE lm.listing_id = ${listingId} AND lm.media_asset_id = ${mediaAssetId} AND lm.removed_at IS NULL AND ma.owner_provider_account_id = ${provider.account_id} FOR UPDATE OF lm, ma`;
      if (!selected[0]) throw new IdentityError('MEDIA_SCOPE_DENIED', 'Photo is not available');
      await tx`UPDATE listing_media SET removed_at = now(), is_cover = false WHERE listing_id = ${listingId} AND media_asset_id = ${mediaAssetId} AND removed_at IS NULL`;
      await tx`UPDATE media_assets SET lifecycle = 'DELETION_PENDING', cleanup_after = now(), updated_at = now() WHERE id = ${mediaAssetId}`;
      await tx`UPDATE listing_media SET display_order = display_order + 1000, is_cover = false WHERE listing_id = ${listingId} AND removed_at IS NULL`;
      const remaining = await tx<{ media_asset_id: string; lifecycle: MediaLifecycle }[]>`SELECT lm.media_asset_id, ma.lifecycle FROM listing_media lm JOIN media_assets ma ON ma.id = lm.media_asset_id WHERE lm.listing_id = ${listingId} AND lm.removed_at IS NULL ORDER BY lm.display_order`;
      for (const [displayOrder, row] of remaining.entries()) await tx`UPDATE listing_media SET display_order = ${displayOrder}, is_cover = ${displayOrder === 0 && row.lifecycle === 'READY'} WHERE listing_id = ${listingId} AND media_asset_id = ${row.media_asset_id} AND removed_at IS NULL`;
    });
    return this.media(userId, listingId);
  }

  public async retry(userId: string, listingId: string, mediaAssetId: string): Promise<void> {
    const provider = await this.requireProvider(userId);
    await this.client.begin(async (tx) => {
      await this.requireDraftScope(tx, listingId, provider.account_id, true);
      const eligible = await tx<{ id: string }[]>`SELECT ma.id FROM media_assets ma JOIN listing_media lm ON lm.media_asset_id = ma.id JOIN media_processing_jobs j ON j.media_asset_id = ma.id WHERE lm.listing_id = ${listingId} AND lm.media_asset_id = ${mediaAssetId} AND lm.removed_at IS NULL AND ma.owner_provider_account_id = ${provider.account_id} AND ma.lifecycle = 'FAILED' AND ma.retryable = true AND ma.cleanup_after > now() AND j.attempt_count < 5 AND j.state = 'PENDING' FOR UPDATE OF ma, lm, j`;
      if (!eligible[0]) throw new IdentityError('MEDIA_RETRY_DENIED', 'Photo cannot be retried');
      await tx`UPDATE media_assets SET lifecycle = 'UPLOADED_QUARANTINED', retryable = false, failure_code = NULL, updated_at = now() WHERE id = ${mediaAssetId}`;
      await tx`UPDATE media_processing_jobs SET next_attempt_at = now(), lease_expires_at = NULL, last_failure_code = NULL, updated_at = now() WHERE media_asset_id = ${mediaAssetId}`;
    });
  }

  public async claimProcessing(): Promise<MediaProcessingJob | null> {
    return this.client.begin(async (tx) => {
      const rows = await tx<{ id: string; job_id: string; storage_reference: string; original_mime: string; original_bytes: number; original_sha256: string; owner_provider_account_id: string; attempt_count: number }[]>`SELECT ma.id, j.id AS job_id, ma.storage_reference, ma.original_mime, ma.original_bytes, ma.original_sha256, ma.owner_provider_account_id, j.attempt_count FROM media_processing_jobs j JOIN media_assets ma ON ma.id = j.media_asset_id WHERE j.attempt_count < 5 AND ((j.state = 'PENDING' AND j.next_attempt_at <= now()) OR (j.state = 'PROCESSING' AND j.lease_expires_at <= now())) AND ma.lifecycle IN ('UPLOADED_QUARANTINED', 'PROCESSING', 'FAILED') ORDER BY j.next_attempt_at, j.created_at FOR UPDATE OF j, ma SKIP LOCKED LIMIT 1`;
      const item = rows[0];
      if (!item) return null;
      const jobs = await tx<{ attempt_count: number }[]>`UPDATE media_processing_jobs SET state = 'PROCESSING', attempt_count = attempt_count + 1, lease_expires_at = now() + interval '2 minutes', updated_at = now() WHERE id = ${item.job_id} RETURNING attempt_count`;
      await tx`UPDATE media_assets SET lifecycle = 'PROCESSING', attempt_count = ${jobs[0]?.attempt_count ?? item.attempt_count + 1}, updated_at = now() WHERE id = ${item.id}`;
      return { id: item.id, jobId: item.job_id, storageReference: item.storage_reference, originalMime: item.original_mime, originalBytes: item.original_bytes, originalSha256: item.original_sha256, ownerProviderAccountId: item.owner_provider_account_id, attemptCount: jobs[0]?.attempt_count ?? item.attempt_count + 1 };
    });
  }

  public async markReady(job: MediaProcessingJob, output: { width: number; height: number; originalSha256: string; variants: Record<string, { width: number; height: number; bytes: number; mime: string }> }, processorVersion: string): Promise<boolean> {
    return this.client.begin(async (tx) => {
      const manifest = JSON.stringify(output.variants);
      const completed = await tx<{ id: string }[]>`UPDATE media_assets SET lifecycle = 'READY', original_sha256 = ${output.originalSha256}, width = ${output.width}, height = ${output.height}, derivative_manifest = ${manifest}::jsonb, processor_version = ${processorVersion}, retryable = false, failure_code = NULL, ready_at = now(), cleanup_after = NULL, updated_at = now() WHERE id = ${job.id} AND lifecycle = 'PROCESSING' RETURNING id`;
      await tx`UPDATE media_processing_jobs SET state = 'COMPLETED', lease_expires_at = NULL, last_failure_code = NULL, updated_at = now() WHERE id = ${job.jobId}`;
      if (!completed[0]) return false;
      const listings = await tx<{ listing_id: string }[]>`SELECT listing_id FROM listing_media WHERE media_asset_id = ${job.id} AND removed_at IS NULL`;
      const listing = listings[0];
      if (listing) {
        const covers = await tx<{ id: string }[]>`SELECT id FROM listing_media WHERE listing_id = ${listing.listing_id} AND removed_at IS NULL AND is_cover = true`;
        if (!covers[0]) await tx`UPDATE listing_media SET is_cover = true WHERE media_asset_id = ${job.id} AND removed_at IS NULL`;
      }
      return true;
    });
  }

  public async markFailure(job: MediaProcessingJob, code: string, retryable: boolean): Promise<void> {
    const canRetry = retryable && job.attemptCount < 5;
    await this.client.begin(async (tx) => {
      await tx`UPDATE media_assets SET lifecycle = ${retryable ? 'FAILED' : 'REJECTED'}, failure_code = ${code}, retryable = ${canRetry}, cleanup_after = CASE WHEN ${canRetry} THEN now() + interval '24 hours' ELSE now() + interval '7 days' END, updated_at = now() WHERE id = ${job.id} AND lifecycle = 'PROCESSING'`;
      await tx`UPDATE media_processing_jobs SET state = ${canRetry ? 'PENDING' : 'FAILED'}, next_attempt_at = now() + make_interval(secs => LEAST(300, 5 * power(2, ${Math.max(0, job.attemptCount - 1)}))::int), lease_expires_at = NULL, last_failure_code = ${code}, updated_at = now() WHERE id = ${job.jobId}`;
    });
  }

  public async claimCleanup(): Promise<MediaCleanupJob | null> {
    return this.client.begin(async (tx) => {
      const rows = await tx<{ id: string; storage_reference: string }[]>`SELECT id, storage_reference FROM media_assets WHERE (lifecycle = 'DELETION_PENDING' OR (lifecycle = 'UPLOAD_AUTHORIZED' AND upload_expires_at <= now()) OR (lifecycle IN ('REJECTED', 'FAILED') AND cleanup_after <= now())) ORDER BY COALESCE(cleanup_after, upload_expires_at) FOR UPDATE SKIP LOCKED LIMIT 1`;
      const row = rows[0];
      if (!row) return null;
      await tx`UPDATE media_assets SET lifecycle = 'DELETION_PENDING', retryable = false, updated_at = now() WHERE id = ${row.id}`;
      await tx`DELETE FROM media_upload_intents WHERE media_asset_id = ${row.id}`;
      return { id: row.id, storageReference: row.storage_reference };
    });
  }

  public async markDeleted(id: string): Promise<void> {
    await this.client.begin(async (tx) => {
      const associations = await tx<{ listing_id: string }[]>`SELECT listing_id FROM listing_media WHERE media_asset_id = ${id} AND removed_at IS NULL FOR UPDATE`;
      await tx`UPDATE media_assets SET lifecycle = 'DELETED', derivative_manifest = '{}'::jsonb, updated_at = now() WHERE id = ${id} AND lifecycle = 'DELETION_PENDING'`;
      await tx`UPDATE media_processing_jobs SET state = 'FAILED', lease_expires_at = NULL, last_failure_code = 'ASSET_REMOVED', updated_at = now() WHERE media_asset_id = ${id}`;
      for (const association of associations) {
        await tx`UPDATE listing_media SET removed_at = now(), is_cover = false WHERE media_asset_id = ${id} AND listing_id = ${association.listing_id} AND removed_at IS NULL`;
        await tx`UPDATE listing_media SET display_order = display_order + 1000, is_cover = false WHERE listing_id = ${association.listing_id} AND removed_at IS NULL`;
        const remaining = await tx<{ media_asset_id: string; lifecycle: MediaLifecycle }[]>`SELECT lm.media_asset_id, ma.lifecycle FROM listing_media lm JOIN media_assets ma ON ma.id = lm.media_asset_id WHERE lm.listing_id = ${association.listing_id} AND lm.removed_at IS NULL ORDER BY lm.display_order`;
        for (const [displayOrder, row] of remaining.entries()) await tx`UPDATE listing_media SET display_order = ${displayOrder}, is_cover = ${displayOrder === 0 && row.lifecycle === 'READY'} WHERE listing_id = ${association.listing_id} AND media_asset_id = ${row.media_asset_id} AND removed_at IS NULL`;
      }
    });
  }

  private async requireProvider(userId: string): Promise<ProviderScope> {
    const rows = await this.client<ProviderScope[]>`SELECT a.id AS account_id, u.account_state, p.state AS profile_state FROM provider_accounts a JOIN provider_profiles p ON p.id = a.provider_profile_id JOIN users u ON u.id = p.user_id WHERE p.user_id = ${userId}`;
    const provider = rows[0];
    if (!provider || provider.account_state !== 'ACTIVE' || !['DRAFT', 'ACTIVE'].includes(provider.profile_state)) throw new IdentityError('PROVIDER_ELIGIBILITY_REQUIRED', 'Active phone-confirmed provider profile required');
    return provider;
  }

  private async requireDraftScope(tx: postgres.Sql, listingId: string, providerAccountId: string, lock = false): Promise<void> {
    const rows = lock
      ? await tx<{ id: string }[]>`SELECT id FROM listings WHERE id = ${listingId} AND provider_account_id = ${providerAccountId} AND publication_status = 'DRAFT' FOR UPDATE`
      : await tx<{ id: string }[]>`SELECT id FROM listings WHERE id = ${listingId} AND provider_account_id = ${providerAccountId} AND publication_status = 'DRAFT'`;
    if (!rows[0]) throw new IdentityError('MEDIA_DRAFT_SCOPE_DENIED', 'Listing draft is not available');
  }
}

type MediaRow = { id: string; media_asset_id: string; display_order: number; is_cover: boolean; lifecycle: MediaLifecycle; original_mime: string | null; original_bytes: number | string | null; width: number | null; height: number | null; derivative_manifest: Record<string, { width: number; height: number; bytes: number; mime: string }>; failure_code: string | null; retryable: boolean };
function mapMedia(row: MediaRow): ListingMediaItem { return { id: row.id, mediaAssetId: row.media_asset_id, displayOrder: row.display_order, isCover: row.is_cover, state: row.lifecycle, mimeType: row.original_mime, bytes: row.original_bytes === null ? null : Number(row.original_bytes), width: row.width, height: row.height, variants: Object.entries(row.derivative_manifest).map(([variantWidth, info]) => ({ ...info, variantWidth: Number(variantWidth) })), failureCode: row.failure_code, retryable: row.retryable }; }
