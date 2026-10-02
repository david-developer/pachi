import { Controller, Get, Headers, Inject, NotFoundException, Param, Post, Req, UseGuards, BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { IdentityError, InteractionStore, type InteractionRead, type InteractionResult } from '@pachi/database';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthGuard } from './auth.guard.js';

@Controller('account')
@UseGuards(AuthGuard)
export class InteractionController {
  public constructor(@Inject('INTERACTION_STORE') private readonly store: InteractionStore) {}

  @Post('listings/:listingId/inquiry')
  public async createInquiry(@Req() request: AuthenticatedRequest, @Param('listingId') listingId: string, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<InteractionResult> {
    if (!idempotencyKey || !isUuid(idempotencyKey)) throw new BadRequestException('A valid idempotency key is required');
    try { return await this.store.createOrReuseInquiry(this.userId(request), listingId, idempotencyKey); }
    catch (error) { throw this.error(error); }
  }

  @Get('interactions/:id')
  public async readInteraction(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<InteractionRead> {
    if (!isUuid(id)) throw new NotFoundException('Interaction is unavailable');
    try { return await this.store.read(this.userId(request), id); }
    catch (error) { throw this.error(error); }
  }

  private userId(request: AuthenticatedRequest): string { if (!request.principal) throw new UnauthorizedException('Authentication required'); return request.principal.userId; }
  private error(error: unknown): Error {
    if (error instanceof IdentityError) {
      if (['PUBLIC_LISTING_NOT_FOUND','RESOURCE_SCOPE_DENIED'].includes(error.code)) return new NotFoundException('Resource is not available');
      if (error.code === 'AUTH_REQUIRED') return new UnauthorizedException('Authentication required');
      if (error.code === 'PHONE_REQUIRED') return new ForbiddenException('Phone verification is required');
      if (error.code === 'CAPABILITY_RESTRICTED') return new ForbiddenException('Contact is not available');
      return new ConflictException(error.code);
    }
    return error as Error;
  }
}
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
