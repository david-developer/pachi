import { Body, ConflictException, Controller, ForbiddenException, Get, Headers, Inject, Param, ParseUUIDPipe, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { IdentityError, ListingModerationStore, StaffAccessError } from '@pachi/database';
import { LocalPrivateMediaStorage } from '@pachi/media';
import { StaffAuthService } from './staff.controller.js';

@Controller('staff/listing-revisions')
export class StaffListingModerationController {
  constructor(
    @Inject('STAFF_AUTH_SERVICE') private readonly auth: StaffAuthService,
    @Inject('LISTING_MODERATION_STORE') private readonly store: ListingModerationStore,
    @Inject('LOCAL_PRIVATE_MEDIA_STORAGE') private readonly storage: LocalPrivateMediaStorage,
  ) {}

  @Get()
  async queue(@Headers('authorization') authorization: string | undefined) {
    try { return { submissions: await this.store.queue(await this.auth.principal(authorization)) }; }
    catch (error) { this.error(error); }
  }

  @Get(':submissionId/media/:mediaId/variants/:width')
  async preview(
    @Headers('authorization') authorization: string | undefined,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Param('width') width: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (!['320', '640'].includes(width)) throw new ConflictException('INVALID_INPUT');
    try {
      const variant = await this.store.preview(await this.auth.principal(authorization), submissionId, mediaId, Number(width), requestId(request), (reference, size) => this.storage.readVariant(reference, size));
      response.status(200).set({ 'content-type': variant.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(variant.bytes);
    } catch (error) { this.error(error); }
  }

  @Post(':listingId/decision')
  async decide(
    @Headers('authorization') authorization: string | undefined,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() body: { submission_id?: unknown; revision_id?: unknown; expected_version?: unknown; command?: unknown; reason_code?: unknown; reason_text?: unknown; provider_message?: unknown; idempotency_key?: unknown },
    @Req() request: Request,
  ) {
    try {
      return await this.store.decide(await this.auth.principal(authorization), listingId, {
        submissionId: typeof body?.submission_id === 'string' ? body.submission_id : '',
        revisionId: typeof body?.revision_id === 'string' ? body.revision_id : '',
        expectedVersion: typeof body?.expected_version === 'number' ? body.expected_version : -1,
        command: body?.command as 'REQUEST_CHANGES' | 'REJECT' | 'APPROVE_AND_PUBLISH',
        reasonCode: typeof body?.reason_code === 'string' ? body.reason_code.trim().toUpperCase() : '',
        reasonText: typeof body?.reason_text === 'string' ? body.reason_text : '',
        ...(typeof body?.provider_message === 'string' ? { providerMessage: body.provider_message } : {}),
        idempotencyKey: typeof body?.idempotency_key === 'string' ? body.idempotency_key : '',
        requestId: requestId(request),
      });
    } catch (error) { this.error(error); }
  }

  private error(error: unknown): never {
    if (error instanceof StaffAccessError || error instanceof IdentityError) {
      if (error.code === 'AUTH_REQUIRED') throw new UnauthorizedException(error.code);
      if (error.code === 'RESOURCE_SCOPE_DENIED' || error.code === 'STEP_UP_REQUIRED') throw new ForbiddenException(error.code);
      throw new ConflictException(error.code);
    }
    throw error;
  }
}

function requestId(request: Request): string {
  const supplied = request.header('x-request-id');
  return supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied) ? supplied : randomUUID();
}
