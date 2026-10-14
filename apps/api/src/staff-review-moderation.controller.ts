import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers,
  Inject, NotFoundException, Param, Post, Query, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { IdentityError, ReviewModerationStore, StaffAccessError } from '@pachi/database';
import type {
  ReviewModerationAssignRequest, ReviewModerationCaseState, ReviewModerationCommandResponse,
  ReviewModerationDecisionRequest, ReviewModerationDetailResponse, ReviewModerationQueueResponse,
  ReviewModerationSeverity,
} from '@pachi/contracts';
import type { Request } from 'express';
import { StaffAuthService } from './staff.controller.js';
import { OrganizationOwnerNoStoreGuard } from './organization-owner.controller.js';
import { organizationRequestId } from './logging.js';

const states = ['OPEN', 'TRIAGED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'RESOLVED', 'CLOSED'];
const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const commands = ['BEGIN_INVESTIGATION', 'HOLD', 'HIDE', 'REMOVE', 'RESTORE', 'RESOLVE', 'CLOSE'];
const reasons = ['REVIEW_POLICY_VIOLATION', 'PRIVACY_PROTECTION', 'THREAT_PROTECTION', 'INVESTIGATION',
  'NO_VIOLATION', 'ELIGIBILITY_RESTORED', 'CASE_COMPLETED'];
const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function fields(input: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('INVALID_INPUT');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !required.includes(key) && !optional.includes(key)) || required.some(key => !(key in body)))
    throw new BadRequestException('INVALID_INPUT');
  return body;
}
function purpose(value: unknown): 'REVIEW_MODERATION' {
  if (value !== 'REVIEW_MODERATION') throw new BadRequestException('INVALID_INPUT');
  return value;
}
function resource(value: string): string {
  if (!uuid(value)) throw new NotFoundException('RESOURCE_UNAVAILABLE');
  return value;
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new BadRequestException('INVALID_INPUT');
  return value as number;
}
function key(value: unknown): string {
  if (!uuid(value)) throw new BadRequestException('INVALID_IDEMPOTENCY_KEY');
  return value;
}
async function run<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (!(error instanceof IdentityError) && !(error instanceof StaffAccessError)) throw error;
    if (error.code === 'AUTH_REQUIRED') throw new UnauthorizedException('AUTH_REQUIRED');
    if (error.code === 'RESOURCE_SCOPE_DENIED') throw new ForbiddenException('RESOURCE_SCOPE_DENIED');
    if (error.code === 'STEP_UP_REQUIRED') throw new ForbiddenException('STEP_UP_REQUIRED');
    if (error.code === 'INVALID_INPUT') throw new BadRequestException('INVALID_INPUT');
    throw new ConflictException(['STALE_VERSION', 'IDEMPOTENCY_KEY_REUSED', 'INVALID_STATE', 'REVIEW_UNAVAILABLE'].includes(error.code)
      ? error.code : 'REQUEST_CONFLICT');
  }
}

@Controller('staff/review-cases')
@UseGuards(OrganizationOwnerNoStoreGuard)
export class StaffReviewModerationController {
  constructor(@Inject('STAFF_AUTH_SERVICE') private readonly auth: StaffAuthService,
    @Inject('REVIEW_MODERATION_STORE') private readonly store: ReviewModerationStore) {}

  @Get()
  queue(@Headers('authorization') authorization: string | undefined, @Query() input: Record<string, unknown>,
    @Req() request: Request): Promise<ReviewModerationQueueResponse> {
    const query = fields(input, ['purpose'], ['status', 'severity', 'assigned', 'limit']);
    purpose(query.purpose);
    if ((query.status !== undefined && (typeof query.status !== 'string' || !states.includes(query.status))) ||
      (query.severity !== undefined && (typeof query.severity !== 'string' || !severities.includes(query.severity))) ||
      (query.assigned !== undefined && !['me', 'unassigned', 'all'].includes(query.assigned as string)) ||
      (query.limit !== undefined && (typeof query.limit !== 'string' || !/^([1-9]|[1-4][0-9]|50)$/.test(query.limit))))
      throw new BadRequestException('INVALID_INPUT');
    return run(async () => this.store.queue(await this.auth.principal(authorization), {
      ...(query.status === undefined ? {} : { status: query.status as ReviewModerationCaseState }),
      ...(query.severity === undefined ? {} : { severity: query.severity as ReviewModerationSeverity }),
      ...(query.assigned === undefined ? {} : { assigned: query.assigned as 'me' | 'unassigned' | 'all' }),
      ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
    }, organizationRequestId(request)));
  }

  @Get(':id')
  detail(@Headers('authorization') authorization: string | undefined, @Param('id') id: string,
    @Query() input: Record<string, unknown>, @Req() request: Request): Promise<ReviewModerationDetailResponse> {
    const query = fields(input, ['purpose']);
    const selectedPurpose = purpose(query.purpose);
    return run(async () => this.store.get(await this.auth.principal(authorization), resource(id), selectedPurpose, organizationRequestId(request)));
  }

  @Post(':id/assign')
  assign(@Headers('authorization') authorization: string | undefined, @Param('id') id: string,
    @Body() input: unknown, @Req() request: Request): Promise<ReviewModerationCommandResponse> {
    const body = fields(input, ['purpose', 'expected_version', 'assigned_staff_user_id', 'idempotency_key']);
    purpose(body.purpose); version(body.expected_version); key(body.idempotency_key);
    if (!uuid(body.assigned_staff_user_id)) throw new BadRequestException('INVALID_INPUT');
    return run(async () => this.store.assign(await this.auth.principal(authorization), resource(id),
      body as ReviewModerationAssignRequest, organizationRequestId(request)));
  }

  @Post(':id/decisions')
  decide(@Headers('authorization') authorization: string | undefined, @Param('id') id: string,
    @Body() input: unknown, @Req() request: Request): Promise<ReviewModerationCommandResponse> {
    const body = fields(input, ['purpose', 'expected_version', 'expected_review_version', 'command', 'reason_code', 'reason_text', 'idempotency_key'], ['reverses_action_id']);
    purpose(body.purpose); version(body.expected_version); version(body.expected_review_version); key(body.idempotency_key);
    if (typeof body.command !== 'string' || !commands.includes(body.command) || typeof body.reason_code !== 'string' || !reasons.includes(body.reason_code) ||
      typeof body.reason_text !== 'string' || Array.from(body.reason_text.trim()).length < 10 || Array.from(body.reason_text).length > 2000 ||
      (body.reverses_action_id !== undefined && !uuid(body.reverses_action_id))) throw new BadRequestException('INVALID_INPUT');
    return run(async () => this.store.decide(await this.auth.principal(authorization), resource(id),
      body as ReviewModerationDecisionRequest, organizationRequestId(request)));
  }
}
