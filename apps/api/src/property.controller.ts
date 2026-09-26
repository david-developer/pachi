import { Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, PayloadTooLargeException, Post, Put, Req, Res, UnauthorizedException, UseGuards, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { IdentityError, ListingMediaStore, ListingSubmissionStore, PropertyDraftStore, type ListingDraft, type ListingMediaItem, type ListingReadiness, type ListingSubmissionRecord, type PropertyDraft } from '@pachi/database';
import { LocalPrivateMediaStorage, MAX_ORIGINAL_BYTES, sniffListingImage } from '@pachi/media';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthGuard } from './auth.guard.js';
import type { ListingDraftCreateRequest, ListingDraftResponse, ListingDraftUpdateRequest, ListingMediaFailureCode, ListingMediaOrderRequest, ListingMediaResponse, ListingMediaUploadResponse, ListingReadinessResponse, ListingSubmissionCommandResponse, ListingSubmissionRequest, PropertyCreateRequest, PropertyDraftResponse } from '@pachi/contracts';

@Controller('account')
@UseGuards(AuthGuard)
export class PropertyController {
  public constructor(
    @Inject('PROPERTY_DRAFT_STORE') private readonly store: PropertyDraftStore,
    @Inject('LISTING_MEDIA_STORE') private readonly mediaStore: ListingMediaStore,
    @Inject('LISTING_SUBMISSION_STORE') private readonly submissionStore: ListingSubmissionStore,
    @Inject('LOCAL_PRIVATE_MEDIA_STORAGE') private readonly mediaStorage: LocalPrivateMediaStorage
  ) {}

  private assertMediaAdapterAvailable(): void { if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Photo storage is not configured for this environment'); }

  @Get('properties')
  public async properties(@Req() request: AuthenticatedRequest): Promise<{ properties: PropertyDraftResponse[] }> {
    try { return { properties: (await this.store.properties(this.userId(request))).map(propertyResponse) }; }
    catch (error) { throw this.error(error); }
  }

  @Post('properties')
  public async createProperty(@Req() request: AuthenticatedRequest, @Body() body: PropertyCreateRequest): Promise<PropertyDraftResponse> {
    try { return propertyResponse(await this.store.createProperty(this.userId(request), propertyInput(body))); }
    catch (error) { throw this.error(error); }
  }

  @Get('listing-drafts')
  public async drafts(@Req() request: AuthenticatedRequest): Promise<{ drafts: ListingDraftResponse[] }> {
    try { return { drafts: (await this.store.drafts(this.userId(request))).map(draftResponse) }; }
    catch (error) { throw this.error(error); }
  }

  @Get('listing-drafts/:id')
  public async draft(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<ListingDraftResponse> {
    try { return draftResponse(await this.store.draft(this.userId(request), id)); }
    catch (error) { throw this.error(error); }
  }

  @Get('listing-drafts/:id/readiness')
  public async listingReadiness(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<ListingReadinessResponse> {
    try { return readinessResponse(await this.submissionStore.readiness(this.userId(request), id)); }
    catch (error) { throw this.error(error); }
  }

  @Post('listing-drafts/:id/submissions')
  public async submitListing(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: ListingSubmissionRequest, @Res() response: Response): Promise<void> {
    const idempotencyKey = request.header('idempotency-key')?.trim();
    if (!isUuid(body?.revision_id) || !isUuid(body?.offering_version_id) || !idempotencyKey || idempotencyKey.length > 128) throw new BadRequestException('Expected revision, offering version, and an idempotency key are required');
    try {
      const result = await this.submissionStore.submit(this.userId(request), id, { revisionId: body.revision_id, offeringVersionId: body.offering_version_id, idempotencyKey, requestId: request.header('x-request-id')?.slice(0, 128) ?? null });
      const command: ListingSubmissionCommandResponse = { submitted: Boolean(result.submission), idempotent: result.idempotent, submission: result.submission ? submissionResponse(result.submission) : null, readiness: readinessResponse(result.readiness) };
      response.status(!result.submission ? 422 : result.idempotent ? 200 : 201).json(command);
    } catch (error) { throw this.error(error); }
  }

  @Post('listing-drafts')
  public async createDraft(@Req() request: AuthenticatedRequest, @Body() body: ListingDraftCreateRequest): Promise<ListingDraftResponse> {
    try { return draftResponse(await this.store.createDraft(this.userId(request), draftInput(body))); }
    catch (error) { throw this.error(error); }
  }

  @Patch('listing-drafts/:id')
  public async updateDraft(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: ListingDraftUpdateRequest): Promise<ListingDraftResponse> {
    try { return draftResponse(await this.store.updateDraft(this.userId(request), id, updateInput(body))); }
    catch (error) { throw this.error(error); }
  }

  @Get('listing-drafts/:id/media')
  public async listingMedia(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<{ media: ListingMediaResponse[] }> {
    this.assertMediaAdapterAvailable();
    try { return { media: (await this.mediaStore.media(this.userId(request), id)).map(mediaResponse) }; }
    catch (error) { throw this.error(error); }
  }

  @Post('listing-drafts/:id/media')
  @HttpCode(202)
  public async uploadListingMedia(@Req() request: AuthenticatedRequest, @Param('id') listingId: string): Promise<ListingMediaUploadResponse> {
    this.assertMediaAdapterAvailable();
    const userId = this.userId(request);
    let intent: Awaited<ReturnType<ListingMediaStore['createUploadIntent']>>;
    try { intent = await this.mediaStore.createUploadIntent(userId, listingId); }
    catch (error) { throw this.error(error); }
    let stored = false;
    try {
      const declaredLength = Number(request.header('content-length') ?? 0);
      if (declaredLength > MAX_ORIGINAL_BYTES) throw new PayloadTooLargeException('Photo exceeds the 15 MiB limit');
      const bytes = await readUploadBody(request);
      if (bytes.byteLength > MAX_ORIGINAL_BYTES) throw new PayloadTooLargeException('Photo exceeds the 15 MiB limit');
      const detected = sniffListingImage(bytes);
      if (!detected) throw new BadRequestException('Choose a valid JPEG, PNG, or WebP photo');
      if (request.header('content-type')?.split(';')[0]?.trim().toLowerCase() !== detected.mime) throw new BadRequestException('Photo content does not match its declared file type');
      await this.mediaStorage.putQuarantine(intent.storageReference, bytes);
      stored = true;
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await this.mediaStore.completeUpload(userId, intent.assetId, { mime: detected.mime, bytes: bytes.byteLength, sha256 });
      return { media_asset_id: intent.assetId, status: 'UPLOADED_QUARANTINED' };
    } catch (error) {
      if (stored) await this.mediaStorage.removeAsset(intent.storageReference).catch(() => undefined);
      await this.mediaStore.cancelUpload(intent.assetId, error instanceof BadRequestException || error instanceof PayloadTooLargeException ? 'INVALID_IMAGE' : 'UPLOAD_FAILED');
      if (error instanceof BadRequestException || error instanceof PayloadTooLargeException || error instanceof IdentityError) throw this.error(error);
      throw new ServiceUnavailableException('Photo upload could not be stored. Try again.');
    }
  }

  @Put('listing-drafts/:id/media/order')
  public async reorderListingMedia(@Req() request: AuthenticatedRequest, @Param('id') listingId: string, @Body() body: ListingMediaOrderRequest): Promise<{ media: ListingMediaResponse[] }> {
    this.assertMediaAdapterAvailable();
    try { return { media: (await this.mediaStore.reorder(this.userId(request), listingId, body.media_asset_ids, body.cover_media_asset_id)).map(mediaResponse) }; }
    catch (error) { throw this.error(error); }
  }

  @Delete('listing-drafts/:id/media/:mediaAssetId')
  public async removeListingMedia(@Req() request: AuthenticatedRequest, @Param('id') listingId: string, @Param('mediaAssetId') mediaAssetId: string): Promise<{ media: ListingMediaResponse[] }> {
    this.assertMediaAdapterAvailable();
    try { return { media: (await this.mediaStore.remove(this.userId(request), listingId, mediaAssetId)).map(mediaResponse) }; }
    catch (error) { throw this.error(error); }
  }

  @Post('listing-drafts/:id/media/:mediaAssetId/retry')
  public async retryListingMedia(@Req() request: AuthenticatedRequest, @Param('id') listingId: string, @Param('mediaAssetId') mediaAssetId: string): Promise<{ status: 'UPLOADED_QUARANTINED' }> {
    this.assertMediaAdapterAvailable();
    try { await this.mediaStore.retry(this.userId(request), listingId, mediaAssetId); return { status: 'UPLOADED_QUARANTINED' }; }
    catch (error) { throw this.error(error); }
  }

  @Get('listing-drafts/:id/media/:mediaAssetId/variants/:width')
  public async readListingMediaVariant(@Req() request: AuthenticatedRequest, @Param('id') listingId: string, @Param('mediaAssetId') mediaAssetId: string, @Param('width') width: string, @Res() response: Response): Promise<void> {
    this.assertMediaAdapterAvailable();
    try {
      const variant = await this.mediaStore.variant(this.userId(request), listingId, mediaAssetId, Number(width));
      const bytes = await this.mediaStorage.readVariant(variant.storageReference, Number(width));
      response.status(200).set({ 'content-type': variant.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(bytes);
    } catch (error) { throw this.error(error); }
  }

  private userId(request: AuthenticatedRequest): string { if (!request.principal) throw new UnauthorizedException('Authentication required'); return request.principal.userId; }
  private error(error: unknown): Error { return error instanceof IdentityError ? ['DRAFT_READ_FAILED', 'MEDIA_DRAFT_SCOPE_DENIED', 'MEDIA_SCOPE_DENIED', 'MEDIA_UPLOAD_SCOPE_DENIED', 'SUBMISSION_SCOPE_DENIED'].includes(error.code) ? new NotFoundException('Private resource is not available') : new ConflictException(error.message) : error as Error; }
}

async function readUploadBody(request: AuthenticatedRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_ORIGINAL_BYTES) throw new PayloadTooLargeException('Photo exceeds the 15 MiB limit');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

function propertyInput(body: PropertyCreateRequest) { return { propertyType: body.property_type, region: body.region, city: body.city, neighborhood: body.neighborhood, landmark: body.landmark, bedrooms: body.bedrooms, bathrooms: body.bathrooms, sizeSqm: body.size_sqm, furnishing: body.furnishing, relationshipType: body.relationship_type }; }
function draftInput(body: ListingDraftCreateRequest) { return { propertyId: body.property_id, purpose: body.purpose, title: body.title, description: body.description, amountMinor: body.amount_minor, pricingPeriod: body.pricing_period, negotiable: body.negotiable, depositAmountMinor: body.deposit_amount_minor, advanceMonths: body.advance_months, minimumLeaseMonths: body.minimum_lease_months, utilitiesIncluded: body.utilities_included, serviceChargeAmountMinor: body.service_charge_amount_minor, weeklyAmountMinor: body.weekly_amount_minor, minimumNights: body.minimum_nights, guestLimit: body.guest_limit, checkInTime: body.check_in_time, checkOutTime: body.check_out_time, cleaningFeeMinor: body.cleaning_fee_minor, availableFrom: body.available_from }; }
function updateInput(body: ListingDraftUpdateRequest) { return { title: body.title, description: body.description, amountMinor: body.amount_minor, pricingPeriod: body.pricing_period, negotiable: body.negotiable, depositAmountMinor: body.deposit_amount_minor, advanceMonths: body.advance_months, minimumLeaseMonths: body.minimum_lease_months, utilitiesIncluded: body.utilities_included, serviceChargeAmountMinor: body.service_charge_amount_minor, weeklyAmountMinor: body.weekly_amount_minor, minimumNights: body.minimum_nights, guestLimit: body.guest_limit, checkInTime: body.check_in_time, checkOutTime: body.check_out_time, cleaningFeeMinor: body.cleaning_fee_minor, availableFrom: body.available_from }; }
function propertyResponse(property: PropertyDraft): PropertyDraftResponse { return { id: property.id, property_type: property.propertyType, region: property.region, city: property.city, neighborhood: property.neighborhood, landmark: property.landmark, bedrooms: property.bedrooms, bathrooms: property.bathrooms, size_sqm: property.sizeSqm, furnishing: property.furnishing, relationship_id: property.relationshipId, relationship_type: property.relationshipType, authorization_status: property.authorizationStatus }; }
function draftResponse(draft: ListingDraft): ListingDraftResponse { return { id: draft.id, property_id: draft.propertyId, provider_account_id: draft.providerAccountId, purpose: draft.purpose, publication_status: draft.publicationStatus, moderation_status: draft.moderationStatus, revision_id: draft.revisionId, version: draft.version, title: draft.title, description: draft.description, offering_id: draft.offeringId, offering_version_id: draft.offeringVersionId, currency: 'XAF', amount_minor: draft.amountMinor, pricing_period: draft.pricingPeriod, negotiable: draft.negotiable, deposit_amount_minor: draft.depositAmountMinor, advance_months: draft.advanceMonths, minimum_lease_months: draft.minimumLeaseMonths, utilities_included: draft.utilitiesIncluded, service_charge_amount_minor: draft.serviceChargeAmountMinor, weekly_amount_minor: draft.weeklyAmountMinor, minimum_nights: draft.minimumNights, guest_limit: draft.guestLimit, check_in_time: draft.checkInTime, check_out_time: draft.checkOutTime, cleaning_fee_minor: draft.cleaningFeeMinor, available_from: draft.availableFrom }; }
function mediaResponse(media: ListingMediaItem): ListingMediaResponse { return { id: media.id, media_asset_id: media.mediaAssetId, display_order: media.displayOrder, is_cover: media.isCover, status: media.state, mime_type: media.mimeType as ListingMediaResponse['mime_type'], size_bytes: media.bytes, width: media.width, height: media.height, variants: media.variants.map((variant) => ({ variant_width: variant.variantWidth as 320 | 640 | 1280 | 1920, width: variant.width, height: variant.height, bytes: variant.bytes, mime: 'image/webp' })), failure_code: media.failureCode as ListingMediaFailureCode | null, retryable: media.retryable }; }
function readinessResponse(readiness: ListingReadiness): ListingReadinessResponse { return { listing_id: readiness.listingId, publication_status: readiness.publicationStatus as ListingReadinessResponse['publication_status'], moderation_status: readiness.moderationStatus as ListingReadinessResponse['moderation_status'], revision_id: readiness.revisionId, revision_version: readiness.revisionVersion, offering_id: readiness.offeringId, offering_version_id: readiness.offeringVersionId, can_submit: readiness.canSubmit, checks: readiness.checks as ListingReadinessResponse['checks'], submission: readiness.submission ? submissionResponse(readiness.submission) : null }; }
function submissionResponse(submission: ListingSubmissionRecord): NonNullable<ListingSubmissionCommandResponse['submission']> { return { id: submission.id, listing_id: submission.listingId, revision_id: submission.revisionId, offering_version_id: submission.offeringVersionId, submitted_at: submission.submittedAt, media_snapshot: submission.mediaSnapshot }; }
function isUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
