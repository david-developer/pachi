import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import { requireStaffPermission, validStaffScope, StaffAccessError, type StaffScope } from './staff-policy.js';
import type { StaffPrincipal } from './staff.js';

export type PhotoReviewStatus = 'NOT_REVIEWED' | 'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED';
export type PhotoReviewItem = {
  id: string; listing_id: string; media_asset_id: string; region: string; listing_title: string | null;
  status: PhotoReviewStatus; version: number; reason_code: string | null; is_cover: boolean; attached_at: string;
};
type Row = {
  id: string; listing_id: string; media_asset_id: string; region: string; listing_title: string | null;
  review_status: PhotoReviewStatus; review_version: number; review_reason_code: string | null;
  is_cover: boolean; attached_at: Date; owner_user_id: string; lifecycle: string;
  storage_reference: string; derivative_manifest: Record<string, { mime: string }>;
  publication_status: string; removed_at: Date | null;
};
type Grant = { role: string; permission_scope: StaffScope };
const policyVersion = 'listing-photo-review-v1';

export class ListingPhotoReviewStore {
  constructor(private readonly client: postgres.Sql, private readonly clock: () => Date = () => new Date()) {}

  private async grants(tx: postgres.TransactionSql, staff: StaffPrincipal): Promise<{ role: string; scope: StaffScope }[]> {
    const rows = await tx<Grant[]>`SELECT role,permission_scope FROM staff_grants WHERE user_id=${staff.row.user_id} AND revoked_at IS NULL AND active_from<=now() AND expires_at>now() FOR SHARE`;
    return rows.filter(g => validStaffScope(g.role, g.permission_scope)).map(g => ({ role: g.role, scope: g.permission_scope }));
  }

  private permitted(grants: { role: string; scope: StaffScope }[], staff: StaffPrincipal, row: Row, sensitive: boolean): void {
    if (row.owner_user_id === staff.row.user_id) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Photo review is outside staff scope');
    const matching = grants.filter(g => g.role === 'LISTING_MODERATOR' && g.scope.permissions.includes('listing:moderate') && g.scope.kind === 'region' && g.scope.id === row.region);
    if (!matching.length) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Photo review is outside staff scope');
    const grant = matching[0]!;
    requireStaffPermission(matching, 'listing:moderate', { kind: grant.scope.kind, id: grant.scope.id }, staff.row.authenticated_at, this.clock(), sensitive);
  }

  private async row(tx: postgres.TransactionSql, id: string, lock: boolean): Promise<Row | null> {
    const rows = lock
      ? await tx<Row[]>`SELECT lm.id,lm.listing_id,lm.media_asset_id,p.region,r.title AS listing_title,lm.review_status,lm.review_version,lm.review_reason_code,lm.is_cover,lm.attached_at,pp.user_id AS owner_user_id,ma.lifecycle,ma.storage_reference,ma.derivative_manifest,l.publication_status,lm.removed_at FROM listing_media lm JOIN listings l ON l.id=lm.listing_id JOIN properties p ON p.id=l.property_id JOIN listing_revisions r ON r.id=l.current_revision_id JOIN media_assets ma ON ma.id=lm.media_asset_id JOIN provider_accounts pa ON pa.id=l.provider_account_id JOIN provider_profiles pp ON pp.id=pa.provider_profile_id WHERE lm.id=${id} FOR UPDATE OF l,lm,ma`
      : await tx<Row[]>`SELECT lm.id,lm.listing_id,lm.media_asset_id,p.region,r.title AS listing_title,lm.review_status,lm.review_version,lm.review_reason_code,lm.is_cover,lm.attached_at,pp.user_id AS owner_user_id,ma.lifecycle,ma.storage_reference,ma.derivative_manifest,l.publication_status,lm.removed_at FROM listing_media lm JOIN listings l ON l.id=lm.listing_id JOIN properties p ON p.id=l.property_id JOIN listing_revisions r ON r.id=l.current_revision_id JOIN media_assets ma ON ma.id=lm.media_asset_id JOIN provider_accounts pa ON pa.id=l.provider_account_id JOIN provider_profiles pp ON pp.id=pa.provider_profile_id WHERE lm.id=${id}`;
    return rows[0] ?? null;
  }

  async queue(staff: StaffPrincipal): Promise<PhotoReviewItem[]> {
    return this.client.begin(async tx => {
      const grants = await this.grants(tx, staff);
      const scopes = grants.filter(g => g.role === 'LISTING_MODERATOR' && g.scope.kind === 'region' && g.scope.permissions.includes('listing:moderate'));
      if (!scopes.length) return [];
      const regions = scopes.map(g => g.scope.id);
      const rows = await tx<Row[]>`SELECT lm.id,lm.listing_id,lm.media_asset_id,p.region,r.title AS listing_title,lm.review_status,lm.review_version,lm.review_reason_code,lm.is_cover,lm.attached_at,pp.user_id AS owner_user_id,ma.lifecycle,ma.storage_reference,ma.derivative_manifest,l.publication_status,lm.removed_at FROM listing_media lm JOIN listings l ON l.id=lm.listing_id JOIN properties p ON p.id=l.property_id JOIN listing_revisions r ON r.id=l.current_revision_id JOIN media_assets ma ON ma.id=lm.media_asset_id JOIN provider_accounts pa ON pa.id=l.provider_account_id JOIN provider_profiles pp ON pp.id=pa.provider_profile_id WHERE lm.removed_at IS NULL AND lm.review_status='NOT_REVIEWED' AND ma.lifecycle='READY' AND l.publication_status='DRAFT' AND pp.user_id<>${staff.row.user_id} AND p.region=ANY(${regions}) ORDER BY lm.attached_at,lm.id LIMIT 100`;
      return rows.map(item);
    });
  }

  async preview(staff: StaffPrincipal, id: string, width: number, requestId: string, read: (storageReference: string, width: number) => Promise<Buffer>): Promise<{ bytes: Buffer; mime: string }> {
    if (![320, 640].includes(width)) throw new IdentityError('INVALID_INPUT', 'Preview size is invalid');
    return this.client.begin(async tx => {
      const row = await this.row(tx, id, true);
      if (!row) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Photo is unavailable');
      this.permitted(await this.grants(tx, staff), staff, row, true);
      const variant = row.derivative_manifest[String(width)];
      if (row.removed_at || row.publication_status !== 'DRAFT' || row.lifecycle !== 'READY' || row.review_status !== 'NOT_REVIEWED' || !variant) throw new IdentityError('INVALID_STATE', 'Photo is no longer pending');
      const bytes = await read(row.storage_reference, width);
      await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata) VALUES (${staff.row.user_id},'LISTING_PHOTO_PREVIEW_ACCESSED','ListingMedia',${id},'SCOPED_REVIEW',${requestId},${JSON.stringify({listing_id:row.listing_id,media_asset_id:row.media_asset_id,width,policy_version:policyVersion})}::jsonb)`;
      return { bytes, mime: variant.mime };
    }).catch(async error => {
      const reason = error instanceof IdentityError || error instanceof StaffAccessError ? error.code : 'STORAGE_READ_FAILED';
      await this.client`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id) VALUES (${staff.row.user_id},'LISTING_PHOTO_PREVIEW_DENIED','ListingMedia',${id},${reason},${requestId})`;
      throw error;
    });
  }

  async decide(staff: StaffPrincipal, id: string, input: { mediaAssetId: string; expectedVersion: number; outcome: 'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED'; reasonCode: string; requestId: string; idempotencyKey: string }): Promise<PhotoReviewItem> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
      !['APPROVED','CHANGES_REQUIRED','REJECTED'].includes(input.outcome) ||
      !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.reasonCode) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) throw new IdentityError('INVALID_INPUT', 'Invalid photo decision');
    try {
      return await this.client.begin(async tx => {
        const row = await this.row(tx, id, true);
        if (!row) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Photo is unavailable');
        this.permitted(await this.grants(tx, staff), staff, row, true);
        const prior = await tx<{listing_media_id:string;media_asset_id:string;actor_user_id:string;prior_version:number;outcome:PhotoReviewStatus;reason_code:string}[]>`SELECT listing_media_id,media_asset_id,actor_user_id,prior_version,outcome,reason_code FROM listing_photo_review_actions WHERE idempotency_key=${input.idempotencyKey}`;
        if (prior[0]) {
          if (prior[0].listing_media_id !== id || prior[0].media_asset_id !== input.mediaAssetId || prior[0].actor_user_id !== staff.row.user_id || prior[0].prior_version !== input.expectedVersion || prior[0].outcome !== input.outcome || prior[0].reason_code !== input.reasonCode) throw new IdentityError('IDEMPOTENCY_KEY_REUSED', 'Decision key was used for another photo decision');
          return { ...item(row), status: prior[0].outcome, version: input.expectedVersion + 1, reason_code: input.reasonCode };
        }
        if (row.media_asset_id !== input.mediaAssetId || row.review_version !== input.expectedVersion) throw new IdentityError('STALE_VERSION', 'Photo changed');
        if (row.removed_at || row.publication_status !== 'DRAFT' || row.lifecycle !== 'READY' || row.review_status !== 'NOT_REVIEWED') throw new IdentityError('INVALID_STATE', 'Photo is no longer pending');
        const preview = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM audit_events WHERE actor_user_id=${staff.row.user_id} AND action='LISTING_PHOTO_PREVIEW_ACCESSED' AND target_id=${id} AND created_at>=${row.attached_at}`;
        if (!preview[0]?.count) throw new IdentityError('EVIDENCE_REVIEW_REQUIRED', 'Preview this photo before deciding');
        const updated = await tx<Row[]>`UPDATE listing_media SET review_status=${input.outcome},review_reason_code=${input.reasonCode},review_version=review_version+1,reviewed_at=now() WHERE id=${id} AND media_asset_id=${input.mediaAssetId} AND removed_at IS NULL AND review_status='NOT_REVIEWED' AND review_version=${input.expectedVersion} RETURNING *`;
        if (!updated[0]) throw new IdentityError('STALE_VERSION', 'Photo changed');
        const actions = await tx<{id:string}[]>`INSERT INTO listing_photo_review_actions(listing_media_id,listing_id,media_asset_id,actor_user_id,prior_status,outcome,reason_code,prior_version,policy_version,request_id,idempotency_key) VALUES (${id},${row.listing_id},${row.media_asset_id},${staff.row.user_id},${row.review_status},${input.outcome},${input.reasonCode},${input.expectedVersion},${policyVersion},${input.requestId},${input.idempotencyKey}) RETURNING id`;
        await tx`INSERT INTO listing_photo_review_outbox(review_action_id,event_type,safe_payload) VALUES (${actions[0]!.id},'LISTING_PHOTO_REVIEW_DECIDED',${JSON.stringify({listing_id:row.listing_id,listing_media_id:id,media_asset_id:row.media_asset_id,outcome:input.outcome,version:input.expectedVersion+1})}::jsonb)`;
        await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata) VALUES (${staff.row.user_id},'LISTING_PHOTO_REVIEW_DECIDED','ListingMedia',${id},${input.reasonCode},${input.requestId},${JSON.stringify({listing_id:row.listing_id,media_asset_id:row.media_asset_id,before:row.review_status,after:input.outcome,prior_version:input.expectedVersion,policy_version:policyVersion})}::jsonb)`;
        return { ...item(row), status: input.outcome, version: input.expectedVersion + 1, reason_code: input.reasonCode };
      });
    } catch (error) {
      if (error instanceof IdentityError || error instanceof StaffAccessError) await this.client`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id) VALUES (${staff.row.user_id},'LISTING_PHOTO_REVIEW_DENIED','ListingMedia',${id},${error.code},${input.requestId})`;
      throw error;
    }
  }
}
function item(row: Row): PhotoReviewItem {
  return { id:row.id, listing_id:row.listing_id, media_asset_id:row.media_asset_id, region:row.region, listing_title:row.listing_title, status:row.review_status, version:row.review_version, reason_code:row.review_reason_code, is_cover:row.is_cover, attached_at:new Date(row.attached_at).toISOString() };
}
