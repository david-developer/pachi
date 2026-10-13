import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers,
  Inject, NotFoundException, Param, Post, Query, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { IdentityError, ReviewStore } from '@pachi/database';
import type {
  ReviewCommandResponse, ReviewEditRequest, ReviewEligibilityResponse, ReviewOwn,
  ReviewPublishedListResponse, ReviewReportRequest, ReviewReportResponse, ReviewSubmitRequest,
} from '@pachi/contracts';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { OrganizationOwnerNoStoreGuard } from './organization-owner.controller.js';
import { organizationRequestId } from './logging.js';

const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function resource(value: string): string {
  if (!uuid(value)) throw new NotFoundException('RESOURCE_UNAVAILABLE');
  return value;
}
function fields(input: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('INVALID_INPUT');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !required.includes(key) && !optional.includes(key)) || required.some((key) => !(key in body)))
    throw new BadRequestException('INVALID_INPUT');
  return body;
}
function version(input: unknown): number {
  if (!Number.isSafeInteger(input) || Number(input) < 1) throw new BadRequestException('INVALID_INPUT');
  return input as number;
}
function content(input: unknown): ReviewSubmitRequest {
  const body = fields(input, ['expected_version', 'rating'], ['text', 'criteria']);
  version(body.expected_version);
  if (!Number.isInteger(body.rating) || Number(body.rating) < 1 || Number(body.rating) > 5 ||
    (body.text !== undefined && (typeof body.text !== 'string' || Array.from(body.text).length > 2000)))
    throw new BadRequestException('INVALID_INPUT');
  if (body.criteria !== undefined) {
    const criterion = fields(body.criteria, [], ['listing_accuracy', 'communication', 'reliability', 'transparency',
      'overall_experience', 'appointment_attendance', 'respectful_conduct', 'overall_interaction']);
    if (Object.values(criterion).some((score) => !Number.isInteger(score) || Number(score) < 1 || Number(score) > 5))
      throw new BadRequestException('INVALID_INPUT');
  }
  return body as ReviewSubmitRequest;
}
function pagination(query: Record<string, unknown>, seeker = false) {
  if (Object.keys(query).some((key) => !['cursor', 'limit', ...(seeker ? ['interaction_id'] : [])].includes(key)) ||
    (query.cursor !== undefined && !uuid(query.cursor)) ||
    (query.interaction_id !== undefined && !uuid(query.interaction_id)) ||
    (query.limit !== undefined && (typeof query.limit !== 'string' || !/^([1-9]|[1-4][0-9]|50)$/.test(query.limit))))
    throw new BadRequestException('INVALID_INPUT');
  return { ...(query.cursor === undefined ? {} : { cursor: query.cursor as string }),
    ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
    ...(query.interaction_id === undefined ? {} : { interaction_id: query.interaction_id as string }) };
}
async function run<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    if (error.code === 'AUTH_REQUIRED') throw new UnauthorizedException('AUTH_REQUIRED');
    if (['RESOURCE_SCOPE_DENIED', 'PUBLIC_LISTING_NOT_FOUND'].includes(error.code)) throw new NotFoundException('RESOURCE_UNAVAILABLE');
    if (error.code === 'INVALID_INPUT') throw new BadRequestException('INVALID_INPUT');
    if (['CAPABILITY_RESTRICTED', 'PHONE_REQUIRED'].includes(error.code)) throw new ForbiddenException(error.code);
    if (error.code === 'REVIEW_WINDOW_CLOSED') throw new ConflictException('ELIGIBILITY_EXPIRED');
    if (['REVIEW_ELIGIBILITY_UNAVAILABLE', 'REVIEW_LOCKED'].includes(error.code)) throw new ConflictException('REVIEW_UNAVAILABLE');
    throw new ConflictException(['STALE_VERSION', 'IDEMPOTENCY_KEY_REUSED', 'INVALID_STATE', 'ELIGIBILITY_EXPIRED',
      'REVIEW_UNAVAILABLE'].includes(error.code) ? error.code : 'REQUEST_CONFLICT');
  }
}

@Controller('account')
@UseGuards(OrganizationOwnerNoStoreGuard, AuthGuard)
export class ReviewController {
  constructor(@Inject('REVIEW_STORE') private readonly store: ReviewStore) {}

  @Get('viewings/:id/reviews')
  eligibility(@Req() request: AuthenticatedRequest, @Param('id') id: string,
    @Query() query: Record<string, unknown>): Promise<ReviewEligibilityResponse> {
    fields(query, []);
    return run(() => this.store.eligibility(this.actor(request), resource(id)));
  }

  @Post('review-eligibilities/:id/submit')
  submit(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() input: unknown,
    @Headers('idempotency-key') key: string | undefined): Promise<ReviewCommandResponse> {
    const body = content(input);
    return run(() => this.store.submit(this.actor(request), resource(id), body, this.options(request, key)));
  }

  @Get('reviews/:id')
  own(@Req() request: AuthenticatedRequest, @Param('id') id: string,
    @Query() query: Record<string, unknown>): Promise<ReviewOwn> {
    fields(query, []);
    return run(() => this.store.own(this.actor(request), resource(id)));
  }

  @Post('reviews/:id/edit')
  edit(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() input: unknown,
    @Headers('idempotency-key') key: string | undefined): Promise<ReviewCommandResponse> {
    const body: ReviewEditRequest = content(input);
    return run(() => this.store.edit(this.actor(request), resource(id), body, this.options(request, key)));
  }

  @Post('reviews/:id/withdraw')
  withdraw(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() input: unknown,
    @Headers('idempotency-key') key: string | undefined): Promise<ReviewCommandResponse> {
    const body = fields(input, ['expected_version']);
    return run(() => this.store.withdraw(this.actor(request), resource(id),
      { expected_version: version(body.expected_version) }, this.options(request, key)));
  }

  @Post('reviews/:id/report')
  report(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() input: unknown,
    @Headers('idempotency-key') key: string | undefined): Promise<ReviewReportResponse> {
    const body = fields(input, ['reason'], ['details']);
    if (typeof body.reason !== 'string' || !['HARASSMENT', 'DISCRIMINATION', 'THREATS', 'PRIVACY_EXPOSURE',
      'EXTORTION', 'IMPERSONATION', 'IRRELEVANT_CONTENT', 'OTHER'].includes(body.reason) ||
      (body.details !== undefined && (typeof body.details !== 'string' || Array.from(body.details).length > 2000)))
      throw new BadRequestException('INVALID_INPUT');
    return run(() => this.store.report(this.actor(request), resource(id), body as ReviewReportRequest, this.options(request, key)));
  }

  @Get('seekers/:id/reviews')
  seeker(@Req() request: AuthenticatedRequest, @Param('id') id: string,
    @Query() query: Record<string, unknown>): Promise<ReviewPublishedListResponse> {
    const options = pagination(query, true);
    return run(() => this.store.publishedSeeker(this.actor(request), resource(id), options));
  }

  @Get('providers/:id/reviews')
  provider(@Req() request: AuthenticatedRequest, @Param('id') id: string,
    @Query() query: Record<string, unknown>): Promise<ReviewPublishedListResponse> {
    const options = pagination(query, true);
    if (!options.interaction_id) throw new NotFoundException('RESOURCE_UNAVAILABLE');
    return run(() => this.store.publishedProviderForActor(this.actor(request), resource(id),
      { ...options, interaction_id: options.interaction_id! }));
  }

  private actor(request: AuthenticatedRequest) {
    const principal = request.principal;
    if (!principal) throw new UnauthorizedException('AUTH_REQUIRED');
    return { userId: principal.userId, sessionId: principal.session.id, securityVersion: principal.session.securityVersion };
  }
  private options(request: AuthenticatedRequest, key: string | undefined) {
    if (!uuid(key)) throw new BadRequestException('INVALID_IDEMPOTENCY_KEY');
    return { idempotencyKey: key, requestId: organizationRequestId(request) };
  }
}

@Controller('providers')
@UseGuards(OrganizationOwnerNoStoreGuard)
export class PublicProviderReviewController {
  constructor(@Inject('REVIEW_STORE') private readonly store: ReviewStore) {}
  @Get(':id/reviews')
  published(@Param('id') id: string, @Query() query: Record<string, unknown>): Promise<ReviewPublishedListResponse> {
    const options = pagination(query);
    return run(() => this.store.publishedProvider(resource(id), options));
  }
}

@Controller('public/listings')
@UseGuards(OrganizationOwnerNoStoreGuard)
export class PublicListingReviewController {
  constructor(@Inject('REVIEW_STORE') private readonly store: ReviewStore) {}
  @Get(':id/reviews')
  published(@Param('id') id: string, @Query() query: Record<string, unknown>): Promise<ReviewPublishedListResponse> {
    const options = pagination(query);
    return run(() => this.store.publishedListing(resource(id), options));
  }
}
