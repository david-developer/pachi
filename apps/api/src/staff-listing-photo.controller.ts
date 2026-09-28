import { Body, ConflictException, Controller, ForbiddenException, Get, Headers, Inject, Param, ParseUUIDPipe, Post, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { IdentityError, ListingPhotoReviewStore, StaffAccessError } from '@pachi/database';
import { LocalPrivateMediaStorage } from '@pachi/media';
import { StaffAuthService } from './staff.controller.js';

@Controller('staff/listing-photos')
export class StaffListingPhotoController {
  constructor(
    @Inject('STAFF_AUTH_SERVICE') private readonly auth: StaffAuthService,
    @Inject('LISTING_PHOTO_REVIEW_STORE') private readonly store: ListingPhotoReviewStore,
    @Inject('LOCAL_PRIVATE_MEDIA_STORAGE') private readonly storage: LocalPrivateMediaStorage,
  ) {}

  private assertMediaAdapterAvailable(): void {
    if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Photo storage is not configured for this environment');
  }

  @Get()
  async queue(@Headers('authorization') authorization: string | undefined) {
    this.assertMediaAdapterAvailable();
    try { return { photos: await this.store.queue(await this.auth.principal(authorization)) }; }
    catch (error) { this.error(error); }
  }

  @Get(':id/variants/:width')
  async preview(@Headers('authorization') authorization: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Param('width') width: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    this.assertMediaAdapterAvailable();
    if (!['320','640'].includes(width)) throw new ConflictException('INVALID_INPUT');
    try {
      const variant = await this.store.preview(await this.auth.principal(authorization), id, Number(width), requestId(request), (storageReference, size) => this.storage.readVariant(storageReference, size));
      response.status(200).set({ 'content-type': variant.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(variant.bytes);
    } catch (error) { this.error(error); }
  }

  @Post(':id/decision')
  async decide(@Headers('authorization') authorization: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Body() body: { media_asset_id?: unknown; expected_version?: unknown; outcome?: unknown; reason_code?: unknown; idempotency_key?: unknown }, @Req() request: Request) {
    this.assertMediaAdapterAvailable();
    if (typeof body?.media_asset_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.media_asset_id)) throw new ConflictException('INVALID_INPUT');
    try {
      return await this.store.decide(await this.auth.principal(authorization), id, {
        mediaAssetId: body.media_asset_id,
        expectedVersion: typeof body.expected_version === 'number' ? body.expected_version : -1,
        outcome: body.outcome as 'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED',
        reasonCode: typeof body.reason_code === 'string' ? body.reason_code : '',
        requestId: requestId(request),
        idempotencyKey: typeof body.idempotency_key === 'string' ? body.idempotency_key : '',
      });
    } catch (error) { this.error(error); }
  }

  private error(error: unknown): never {
    if (error instanceof StaffAccessError || error instanceof IdentityError) {
      if (error.code === 'RESOURCE_SCOPE_DENIED') throw new ForbiddenException('RESOURCE_SCOPE_DENIED');
      if (error.code === 'STEP_UP_REQUIRED') throw new ForbiddenException('STEP_UP_REQUIRED');
      throw new ConflictException(error.code);
    }
    throw error;
  }
}
function requestId(request: Request): string {
  const supplied = request.header('x-request-id');
  return supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied) ? supplied : randomUUID();
}
