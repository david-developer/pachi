import { lockListingRegion } from './region-publication.js';
import { snapshotAnalyticsContext } from './analytics-context.js';
import type postgres from 'postgres';
import { IdentityError } from './identity.js';
import { ListingSubmissionStore, type ListingReadiness } from './listing-submission.js';
import { StaffAccessError, validStaffScope, type StaffScope } from './staff-policy.js';
import type { StaffPrincipal } from './staff.js';

type MediaSnapshot = { listing_media_id: string; media_asset_id: string; display_order: number; is_cover: boolean };
type Grant = { role: string; permission_scope: StaffScope };
type StaffSession = { authenticated_at: Date; recently_authenticated: boolean };
type QueueRow = {
  submission_id: string; listing_id: string; revision_id: string; revision_version: number; offering_id: string;
  offering_version_id: string; submitted_at: Date; media_snapshot: MediaSnapshot[]; region: string; city: string;
  neighborhood: string; purpose: string; title: string | null; description: string | null; currency: string;
  amount_minor: number | string | null; pricing_period: string; available_from: string | null;
  owner_user_id: string; market_status: string;
};
type ListingContext = {
  listing_id: string; provider_account_id: string; owner_user_id: string; region: string; purpose: string;
  publication_status: string; moderation_status: string; current_revision_id: string; revision_version: number;
  offering_id: string; current_offering_version_id: string; market_status: string;
};
type SubmissionRow = {
  id: string; listing_id: string; listing_revision_id: string; offering_id: string; offering_version_id: string;
  submitted_by_user_id: string; submitted_at: Date; media_snapshot: MediaSnapshot[];
};
type ActionRow = {
  id: string; listing_id: string; submission_id: string; listing_revision_id: string; offering_version_id: string;
  actor_user_id: string; command: Command; reason_code: string; reason_text: string; provider_message: string | null;
  publication_status: string; moderation_status: string; idempotency_key: string;
};
type Command = 'REQUEST_CHANGES' | 'REJECT' | 'APPROVE_AND_PUBLISH';
export type ListingModerationItem = QueueRow;
export type ListingModerationInput = {
  submissionId: string; revisionId: string; expectedVersion: number; command: Command; reasonCode: string;
  reasonText: string; providerMessage?: string | undefined; idempotencyKey: string; requestId: string;
};
export type ListingModerationResult = {
  action_id: string; listing_id: string; submission_id: string; revision_id: string; command: Command;
  publication_status: string; moderation_status: string; idempotent: boolean;
};
const policyVersion = 'listing-revision-moderation-v1';

export class ListingModerationStore {
  constructor(
    private readonly client: postgres.Sql,
    private readonly submissions: ListingSubmissionStore,
  ) {}

  private async staff(tx: postgres.TransactionSql, principal: StaffPrincipal): Promise<{ grants: Grant[] }> {
    const sessions = await tx<StaffSession[]>`SELECT ss.authenticated_at,
      (ss.authenticated_at <= statement_timestamp() AND ss.authenticated_at >= statement_timestamp() - interval '15 minutes') AS recently_authenticated
      FROM staff_sessions ss JOIN users u ON u.id=ss.user_id
      WHERE ss.user_id=${principal.row.user_id} AND ss.issuer=${principal.row.issuer}
        AND ss.app_client_id=${principal.row.app_client_id} AND ss.origin_jti=${principal.row.origin_jti}
        AND ss.revoked_at IS NULL AND ss.absolute_expires_at>statement_timestamp()
        AND ss.idle_expires_at>statement_timestamp() AND ss.token_expires_at>statement_timestamp()
        AND u.account_state IN ('ACTIVE','PENDING_PHONE') FOR SHARE OF ss,u`;
    const session = sessions[0];
    if (!session) throw new StaffAccessError('AUTH_REQUIRED');
    const grants = await tx<Grant[]>`SELECT role,permission_scope FROM staff_grants
      WHERE user_id=${principal.row.user_id} AND revoked_at IS NULL
        AND active_from<=statement_timestamp() AND expires_at>statement_timestamp() FOR SHARE`;
    const valid = grants.filter((grant) => validStaffScope(grant.role, grant.permission_scope));
    if (!session.recently_authenticated) throw new StaffAccessError('STEP_UP_REQUIRED');
    return { grants: valid };
  }

  private permitted(grants: Grant[], principal: StaffPrincipal, region: string, ownerUserId: string): void {
    if (principal.row.user_id === ownerUserId) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Listing review is outside staff scope');
    if (!grants.some((grant) => grant.role === 'LISTING_MODERATOR'
      && grant.permission_scope.kind === 'region'
      && grant.permission_scope.id === region
      && grant.permission_scope.permissions.includes('listing:moderate'))) {
      throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Listing review is outside staff scope');
    }
  }

  public async queue(principal: StaffPrincipal): Promise<ListingModerationItem[]> {
    return this.client.begin(async (tx): Promise<ListingModerationItem[]> => {
      const { grants } = await this.staff(tx, principal);
      const regions = grants.filter((grant) => grant.role === 'LISTING_MODERATOR'
        && grant.permission_scope.kind === 'region'
        && grant.permission_scope.permissions.includes('listing:moderate'))
        .map((grant) => grant.permission_scope.id);
      if (!regions.length) return [];
      const rows = await tx<QueueRow[]>`SELECT s.id AS submission_id,s.listing_id,s.listing_revision_id AS revision_id,
        r.version AS revision_version,s.offering_id,s.offering_version_id,s.submitted_at,s.media_snapshot,
        p.region,p.city,p.neighborhood,l.purpose,r.title,r.description,ov.currency,ov.amount_minor,
        ov.pricing_period,ov.available_from::text,l.market_status,pp.user_id AS owner_user_id
        FROM listing_submissions s JOIN listings l ON l.id=s.listing_id
        JOIN listing_revisions r ON r.id=s.listing_revision_id AND r.listing_id=s.listing_id
        JOIN offerings o ON o.id=s.offering_id AND o.listing_id=s.listing_id
        JOIN offering_versions ov ON ov.id=s.offering_version_id AND ov.offering_id=o.id
        JOIN properties p ON p.id=l.property_id
        JOIN provider_accounts pa ON pa.id=l.provider_account_id
        JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
        WHERE l.publication_status='PENDING_REVIEW' AND l.moderation_status='IN_REVIEW'
          AND p.region=ANY(${regions}) AND pp.user_id<>${principal.row.user_id}
        ORDER BY s.submitted_at,s.id LIMIT 100`;
      return rows;
    });
  }

  public async preview(
    principal: StaffPrincipal,
    submissionId: string,
    listingMediaId: string,
    width: number,
    requestId: string,
    read: (storageReference: string, width: number) => Promise<Buffer>,
  ): Promise<{ bytes: Buffer; mime: string }> {
    if (![320, 640].includes(width)) throw new IdentityError('INVALID_INPUT', 'Preview size is invalid');
    try {
      return await this.client.begin(async (tx) => {
        const { grants } = await this.staff(tx, principal);
        const rows = await tx<(ListingContext & { media_snapshot: MediaSnapshot[]; submitted_at: Date; media_asset_id: string; lifecycle: string; review_status: string; removed_at: Date | null; storage_reference: string; derivative_manifest: Record<string, { mime: string }> } )[]>`
          SELECT l.id AS listing_id,l.provider_account_id,pp.user_id AS owner_user_id,p.region,l.purpose,
            l.publication_status,l.moderation_status,l.current_revision_id,r.version AS revision_version,
            o.id AS offering_id,o.current_version_id AS current_offering_version_id,l.market_status,
            s.media_snapshot,s.submitted_at,lm.media_asset_id,ma.lifecycle,lm.review_status,lm.removed_at,
            ma.storage_reference,ma.derivative_manifest
          FROM listing_submissions s JOIN listings l ON l.id=s.listing_id
          JOIN listing_revisions r ON r.id=l.current_revision_id AND r.listing_id=l.id
          JOIN offerings o ON o.listing_id=l.id JOIN properties p ON p.id=l.property_id
          JOIN provider_accounts pa ON pa.id=l.provider_account_id JOIN provider_profiles pp ON pp.id=pa.provider_profile_id
          JOIN listing_media lm ON lm.id=${listingMediaId} AND lm.listing_id=l.id
          JOIN media_assets ma ON ma.id=lm.media_asset_id
          WHERE s.id=${submissionId} AND s.listing_id=l.id FOR UPDATE OF l,lm,ma`;
        const row = rows[0];
        if (!row) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Listing preview is unavailable');
        this.permitted(grants, principal, row.region, row.owner_user_id);
        const snapshot = row.media_snapshot.find((item) => item.listing_media_id === listingMediaId);
        if (row.publication_status !== 'PENDING_REVIEW' || row.moderation_status !== 'IN_REVIEW'
          || !snapshot || snapshot.media_asset_id !== row.media_asset_id || row.removed_at
          || row.lifecycle !== 'READY' || row.review_status !== 'APPROVED') {
          throw new IdentityError('INVALID_STATE', 'Submitted photo is no longer reviewable');
        }
        const variant = row.derivative_manifest[String(width)];
        if (!variant) throw new IdentityError('INVALID_STATE', 'Submitted preview is unavailable');
        const bytes = await read(row.storage_reference, width);
        await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata)
          VALUES (${principal.row.user_id},'LISTING_REVISION_MEDIA_PREVIEW_ACCESSED','ListingMedia',${listingMediaId},'SCOPED_REVIEW',${requestId},
            ${JSON.stringify({listing_id:row.listing_id,submission_id:submissionId,media_asset_id:row.media_asset_id,width,policy_version:policyVersion})}::jsonb)`;
        return { bytes, mime: variant.mime };
      });
    } catch (error) {
      const reason = error instanceof IdentityError || error instanceof StaffAccessError ? error.code : 'STORAGE_READ_FAILED';
      await this.client`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id)
        VALUES (${principal.row.user_id},'LISTING_REVISION_MEDIA_PREVIEW_DENIED','ListingMedia',${listingMediaId},${reason},${requestId})`;
      throw error;
    }
  }

  public async decide(principal: StaffPrincipal, listingId: string, input: ListingModerationInput): Promise<ListingModerationResult> {
    this.validate(input);
    try {
      return await this.client.begin(async (tx) => {
        await lockListingRegion(tx, listingId);
        const { grants } = await this.staff(tx, principal);
        const priorRows = await tx<ActionRow[]>`SELECT * FROM listing_revision_moderation_actions WHERE idempotency_key=${input.idempotencyKey}`;
        if (priorRows[0]) {
          const prior = priorRows[0];
          const context = await this.context(tx, prior.listing_id, false);
          if (!context) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Listing review is unavailable');
          this.permitted(grants, principal, context.region, context.owner_user_id);
          this.samePayload(prior, principal, listingId, input);
          return result(prior, true);
        }
        const submittedRows = await tx<SubmissionRow[]>`SELECT id,listing_id,listing_revision_id,offering_id,offering_version_id,
          submitted_by_user_id,submitted_at,media_snapshot FROM listing_submissions WHERE id=${input.submissionId} AND listing_id=${listingId}`;
        const submitted = submittedRows[0];
        if (!submitted) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Listing submission is unavailable');
        const readiness = await this.submissions.readinessInTransaction(tx, submitted.submitted_by_user_id, listingId, true);
        const context = await this.context(tx, listingId, true);
        if (!context) throw new IdentityError('RESOURCE_SCOPE_DENIED', 'Listing review is unavailable');
        this.permitted(grants, principal, context.region, context.owner_user_id);
        if (context.publication_status !== 'PENDING_REVIEW' || context.moderation_status !== 'IN_REVIEW'
          || context.current_revision_id !== submitted.listing_revision_id
          || context.revision_version !== input.expectedVersion
          || submitted.listing_revision_id !== input.revisionId
          || submitted.offering_id !== context.offering_id
          || submitted.offering_version_id !== context.current_offering_version_id
          || readiness.revisionId !== submitted.listing_revision_id
          || readiness.offeringVersionId !== submitted.offering_version_id
          || readiness.submission?.id !== submitted.id
          || !sameSnapshot(submitted.media_snapshot, readiness.submission.mediaSnapshot)) {
          throw new IdentityError('STALE_VERSION', 'The submitted listing revision changed; refresh the review queue');
        }
        const mediaRows = await tx<MediaSnapshot[]>`SELECT id AS listing_media_id,media_asset_id,display_order,is_cover
          FROM listing_media WHERE listing_id=${listingId} AND removed_at IS NULL ORDER BY display_order,id FOR UPDATE`;
        if (!sameSnapshot(submitted.media_snapshot, mediaRows)) throw new IdentityError('STALE_VERSION', 'Submitted photos changed; refresh the review queue');
        if (input.command === 'APPROVE_AND_PUBLISH') {
          if (!readiness.checks.every((check) => check.status === 'READY')) throw new IdentityError('PUBLICATION_REQUIREMENTS_BLOCKED', 'Current publication requirements are not satisfied');
          if (!marketDiscoverable(context.purpose, context.market_status)) throw new IdentityError('LISTING_MARKET_STATUS_INVALID', 'Listing is not in a discoverable market state');
        }
        const after = input.command === 'REQUEST_CHANGES'
          ? { publication: 'DRAFT', moderation: 'CHANGES_REQUIRED' }
          : input.command === 'REJECT'
            ? { publication: 'REJECTED', moderation: 'REJECTED' }
            : { publication: 'PUBLISHED', moderation: 'APPROVED' };
        const actionRows = await tx<ActionRow[]>`INSERT INTO listing_revision_moderation_actions
          (listing_id,submission_id,listing_revision_id,offering_version_id,actor_user_id,command,reason_code,reason_text,provider_message,
           prior_publication_status,publication_status,prior_moderation_status,moderation_status,media_snapshot,idempotency_key,request_id,policy_version)
          VALUES (${listingId},${submitted.id},${submitted.listing_revision_id},${submitted.offering_version_id},${principal.row.user_id},
            ${input.command},${input.reasonCode},${input.reasonText.trim()},${input.providerMessage?.trim() ?? null},
            ${context.publication_status},${after.publication},${context.moderation_status},${after.moderation},
            ${JSON.stringify(submitted.media_snapshot)}::jsonb,${input.idempotencyKey},${input.requestId},${policyVersion}) RETURNING *`;
        const action = actionRows[0];
        if (!action) throw new IdentityError('LISTING_MODERATION_FAILED', 'Decision could not be recorded');
        if (input.command === 'REQUEST_CHANGES') {
          const changed = await tx`UPDATE listings SET publication_status='DRAFT',moderation_status='CHANGES_REQUIRED',moderation_feedback=${input.providerMessage!.trim()},updated_at=statement_timestamp()
            WHERE id=${listingId} AND publication_status='PENDING_REVIEW' AND moderation_status='IN_REVIEW' AND current_revision_id=${submitted.listing_revision_id}`;
          if (changed.count !== 1) throw new IdentityError('STALE_VERSION', 'Listing changed before correction completed');
        } else if (input.command === 'REJECT') {
          const changed = await tx`UPDATE listings SET publication_status='REJECTED',moderation_status='REJECTED',moderation_feedback=${input.providerMessage?.trim() ?? input.reasonText.trim()},updated_at=statement_timestamp()
            WHERE id=${listingId} AND publication_status='PENDING_REVIEW' AND current_revision_id=${submitted.listing_revision_id}`;
          if (changed.count !== 1) throw new IdentityError('STALE_VERSION', 'Listing changed before rejection completed');
        } else {
          const changed = await tx`UPDATE listings SET publication_status='PUBLISHED',moderation_status='APPROVED',
            approved_revision_id=${submitted.listing_revision_id},approved_submission_id=${submitted.id},approved_by_user_id=${principal.row.user_id},
            approved_at=statement_timestamp(),last_confirmed_at=statement_timestamp(),
            expires_at=statement_timestamp()+CASE purpose WHEN 'RENT' THEN interval '30 days' WHEN 'SALE' THEN interval '60 days' ELSE interval '14 days' END,
            moderation_feedback=NULL,updated_at=statement_timestamp()
            WHERE id=${listingId} AND publication_status='PENDING_REVIEW' AND moderation_status='IN_REVIEW'
              AND current_revision_id=${submitted.listing_revision_id}`;
          if (changed.count !== 1) throw new IdentityError('STALE_VERSION', 'Listing changed before publication completed');
        }
        const eventType = input.command === 'REQUEST_CHANGES' ? 'LISTING_CHANGES_REQUESTED'
          : input.command === 'REJECT' ? 'LISTING_REJECTED' : 'LISTING_PUBLISHED';
        await tx`INSERT INTO listing_revision_moderation_outbox(action_id,event_type,safe_payload)
          VALUES (${action.id},${eventType},${JSON.stringify({listing_id:listingId,submission_id:submitted.id,revision_id:submitted.listing_revision_id,command:input.command,...(eventType === 'LISTING_PUBLISHED' ? {analytics:await snapshotAnalyticsContext(tx,listingId,false)} : {})})}::jsonb)`;
        await tx`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id,safe_metadata)
          VALUES (${principal.row.user_id},${`LISTING_${input.command}`},'Listing',${listingId},${input.reasonCode},${input.requestId},
            ${JSON.stringify({submission_id:submitted.id,revision_id:submitted.listing_revision_id,offering_version_id:submitted.offering_version_id,
              before:{publication_status:context.publication_status,moderation_status:context.moderation_status},after,policy_version:policyVersion})}::jsonb)`;
        return result(action, false);
      });
    } catch (error) {
      if (error instanceof IdentityError || error instanceof StaffAccessError) {
        await this.client`INSERT INTO audit_events(actor_user_id,action,target_type,target_id,reason_code,request_id)
          VALUES (${principal.row.user_id},'LISTING_REVISION_MODERATION_DENIED','Listing',${listingId},${error.code},${input.requestId})`;
      }
      throw error;
    }
  }

  private async context(tx: postgres.TransactionSql, listingId: string, lock: boolean): Promise<ListingContext | null> {
    const query = lock
      ? await tx<ListingContext[]>`SELECT l.id AS listing_id,l.provider_account_id,pp.user_id AS owner_user_id,p.region,l.purpose,
          l.publication_status,l.moderation_status,l.current_revision_id,r.version AS revision_version,
          o.id AS offering_id,o.current_version_id AS current_offering_version_id,l.market_status
          FROM listings l JOIN properties p ON p.id=l.property_id JOIN listing_revisions r ON r.id=l.current_revision_id
          JOIN offerings o ON o.listing_id=l.id JOIN provider_accounts pa ON pa.id=l.provider_account_id
          JOIN provider_profiles pp ON pp.id=pa.provider_profile_id WHERE l.id=${listingId} FOR UPDATE OF l,r,p,o`
      : await tx<ListingContext[]>`SELECT l.id AS listing_id,l.provider_account_id,pp.user_id AS owner_user_id,p.region,l.purpose,
          l.publication_status,l.moderation_status,l.current_revision_id,r.version AS revision_version,
          o.id AS offering_id,o.current_version_id AS current_offering_version_id,l.market_status
          FROM listings l JOIN properties p ON p.id=l.property_id JOIN listing_revisions r ON r.id=l.current_revision_id
          JOIN offerings o ON o.listing_id=l.id JOIN provider_accounts pa ON pa.id=l.provider_account_id
          JOIN provider_profiles pp ON pp.id=pa.provider_profile_id WHERE l.id=${listingId}`;
    return query[0] ?? null;
  }

  private validate(input: ListingModerationInput): void {
    if (!input || !['REQUEST_CHANGES','REJECT','APPROVE_AND_PUBLISH'].includes(input.command)
      || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.submissionId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.revisionId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)
      || !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.reasonCode)
      || typeof input.reasonText !== 'string' || input.reasonText.trim().length < 1 || input.reasonText.trim().length > 2000
      || (input.command === 'REQUEST_CHANGES' && (typeof input.providerMessage !== 'string' || input.providerMessage.trim().length < 10 || input.providerMessage.trim().length > 1000))
      || (input.providerMessage !== undefined && (typeof input.providerMessage !== 'string' || input.providerMessage.trim().length < 10 || input.providerMessage.trim().length > 1000))) {
      throw new IdentityError('INVALID_INPUT', 'Listing moderation decision is invalid');
    }
  }

  private samePayload(prior: ActionRow, principal: StaffPrincipal, listingId: string, input: ListingModerationInput): void {
    if (prior.actor_user_id !== principal.row.user_id || prior.listing_id !== listingId || prior.submission_id !== input.submissionId
      || prior.listing_revision_id !== input.revisionId || prior.command !== input.command || prior.reason_code !== input.reasonCode
      || prior.reason_text !== input.reasonText.trim() || prior.provider_message !== (input.providerMessage?.trim() ?? null)) {
      throw new IdentityError('IDEMPOTENCY_KEY_REUSED', 'Decision key was used for another listing decision');
    }
  }
}

function sameSnapshot(left: MediaSnapshot[], right: MediaSnapshot[]): boolean {
  const sort = (items: MediaSnapshot[]) => [...items].sort((a,b) => a.display_order-b.display_order || a.listing_media_id.localeCompare(b.listing_media_id));
  const key = (item: MediaSnapshot) => `${item.listing_media_id}|${item.media_asset_id}|${item.display_order}|${item.is_cover}`;
  return JSON.stringify(sort(left).map(key)) === JSON.stringify(sort(right).map(key));
}
function marketDiscoverable(purpose: string, status: string): boolean {
  if (purpose === 'SHORT_LET') return ['AVAILABLE','PARTIALLY_BOOKED'].includes(status);
  return ['RENT','SALE'].includes(purpose) && ['AVAILABLE','UNDER_OFFER'].includes(status);
}
function result(row: ActionRow, idempotent: boolean): ListingModerationResult {
  return { action_id:row.id,listing_id:row.listing_id,submission_id:row.submission_id,revision_id:row.listing_revision_id,
    command:row.command,publication_status:row.publication_status,moderation_status:row.moderation_status,idempotent };
}
