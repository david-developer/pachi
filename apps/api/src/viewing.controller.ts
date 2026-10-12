import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException,
  Get, Headers, Inject, NotFoundException, Param, Post, Query, Req,
  UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { IdentityError, ViewingAttendanceStore } from '@pachi/database';
import type {
  ViewingAcceptRequest, ViewingConfirmRequest, ViewingCreateRequest, ViewingReasonRequest, ViewingRescheduleRequest, ViewingRescheduleActionRequest, ViewingRescheduleCommandResponse, ViewingRescheduleListResponse,
  ViewingAttendanceCompletionRequest, ViewingAttendanceNoShowRequest, ViewingAttendanceConfirmRequest,
  ViewingAttendanceDisputeRequest, ViewingAttendanceResponse, ViewingAttendanceCommandResponse, ViewingAttendanceCaseResponse,
} from '@pachi/contracts';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { OrganizationOwnerNoStoreGuard } from './organization-owner.controller.js';
import { organizationRequestId } from './logging.js';

const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function resource(value: string): string {
  if (!uuid(value)) throw new NotFoundException('RESOURCE_UNAVAILABLE');
  return value;
}
function fields(input: unknown, names: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('INVALID_INPUT');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !names.includes(key)) || names.some((key) => !(key in body)))
    throw new BadRequestException('INVALID_INPUT');
  return body;
}
function versions(body: Record<string, unknown>): void {
  if (![body.expected_version, body.expected_schedule_version].every((value) => Number.isSafeInteger(value) && Number(value) >= 1))
    throw new BadRequestException('INVALID_INPUT');
}

@Controller('account')
@UseGuards(OrganizationOwnerNoStoreGuard, AuthGuard)
export class ViewingController {
  constructor(@Inject('VIEWING_STORE') private readonly store: ViewingAttendanceStore) {}

  @Post('interactions/:interactionId/viewings')
  create(@Req() request: AuthenticatedRequest, @Param('interactionId') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() input: unknown) {
    const body = fields(input, ['proposed_start', 'proposed_end', 'display_timezone']);
    if (![body.proposed_start, body.proposed_end, body.display_timezone].every((value) => typeof value === 'string'))
      throw new BadRequestException('INVALID_INPUT');
    return this.run(() => this.store.create(this.actor(request), resource(id), body as ViewingCreateRequest, this.options(request, key)));
  }

  @Get('viewings')
  list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).some((key) => !['interaction_id', 'cursor', 'limit'].includes(key)) ||
      (query.interaction_id !== undefined && !uuid(query.interaction_id)) ||
      (query.cursor !== undefined && !uuid(query.cursor)) ||
      (query.limit !== undefined && (typeof query.limit !== 'string' || !/^([1-9]|[1-4][0-9]|50)$/.test(query.limit))))
      throw new BadRequestException('INVALID_INPUT');
    return this.run(() => this.store.list(this.actor(request), {
      ...(query.interaction_id === undefined ? {} : { interaction_id: query.interaction_id as string }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor as string }),
      ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
    }));
  }

  @Get('viewings/:id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.run(() => this.store.get(this.actor(request), resource(id)));
  }

  @Post('viewings/:id/accept')
  accept(@Req() request: AuthenticatedRequest, @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() input: unknown) {
    const body = fields(input, ['expected_version', 'expected_schedule_version', 'scheduled_start', 'scheduled_end', 'private_instructions']);
    versions(body);
    if (![body.scheduled_start, body.scheduled_end, body.private_instructions].every((value) => typeof value === 'string'))
      throw new BadRequestException('INVALID_INPUT');
    return this.run(() => this.store.accept(this.actor(request), resource(id), body as ViewingAcceptRequest, this.options(request, key)));
  }

  @Post('viewings/:id/decline')
  decline(@Req() request: AuthenticatedRequest, @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() input: unknown) {
    const body = this.reason(input);
    return this.run(() => this.store.decline(this.actor(request), resource(id), body, this.options(request, key)));
  }

  @Post('viewings/:id/confirm')
  confirm(@Req() request: AuthenticatedRequest, @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() input: unknown) {
    const body = fields(input, ['expected_version', 'expected_schedule_version']);
    versions(body);
    return this.run(() => this.store.confirm(this.actor(request), resource(id), body as ViewingConfirmRequest, this.options(request, key)));
  }

  @Post('viewings/:id/cancel')
  cancel(@Req() request: AuthenticatedRequest, @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() input: unknown) {
    const body = this.reason(input);
    return this.run(() => this.store.cancel(this.actor(request), resource(id), body, this.options(request, key)));
  }

  @Post('viewings/:id/reschedules')
  proposeReschedule(@Req() request:AuthenticatedRequest,@Param('id') id:string,@Headers('idempotency-key') key:string|undefined,@Body() input:unknown):Promise<ViewingRescheduleCommandResponse> {
    const body=fields(input,['expected_version','expected_schedule_version','proposed_start','proposed_end']);versions(body);
    if(typeof body.proposed_start!=='string'||typeof body.proposed_end!=='string')throw new BadRequestException('INVALID_INPUT');
    return this.run(()=>this.store.proposeReschedule(this.actor(request),resource(id),body as ViewingRescheduleRequest,this.options(request,key)));
  }
  @Get('viewings/:id/reschedules')
  reschedules(@Req() request:AuthenticatedRequest,@Param('id') id:string,@Query() query:Record<string,unknown>):Promise<ViewingRescheduleListResponse> {
    const pagination=this.pagination(query,['cursor','limit']);
    return this.run(()=>this.store.listReschedules(this.actor(request),resource(id),pagination));
  }
  @Post('viewings/:id/reschedules/:proposalId/accept')
  acceptReschedule(@Req() request:AuthenticatedRequest,@Param('id') id:string,@Param('proposalId') proposalId:string,@Headers('idempotency-key') key:string|undefined,@Body() input:unknown):Promise<ViewingRescheduleCommandResponse> {
    return this.rescheduleResponse(request,id,proposalId,'accept',input,key);
  }
  @Post('viewings/:id/reschedules/:proposalId/reject')
  rejectReschedule(@Req() request:AuthenticatedRequest,@Param('id') id:string,@Param('proposalId') proposalId:string,@Headers('idempotency-key') key:string|undefined,@Body() input:unknown):Promise<ViewingRescheduleCommandResponse> {
    return this.rescheduleResponse(request,id,proposalId,'reject',input,key);
  }
  @Post('viewings/:id/reschedules/:proposalId/withdraw')
  withdrawReschedule(@Req() request:AuthenticatedRequest,@Param('id') id:string,@Param('proposalId') proposalId:string,@Headers('idempotency-key') key:string|undefined,@Body() input:unknown):Promise<ViewingRescheduleCommandResponse> {
    return this.rescheduleResponse(request,id,proposalId,'withdraw',input,key);
  }
  @Get('viewings/:id/reminders')
  reminders(@Req() request:AuthenticatedRequest,@Param('id') id:string) {
    return this.run(()=>this.store.reminderStatus(this.actor(request),resource(id)));
  }
  @Get('viewing-notices')
  notices(@Req() request:AuthenticatedRequest,@Query() query:Record<string,unknown>) {
    const pagination=this.pagination(query,['viewing_id','cursor','limit']);
    if(query.viewing_id!==undefined&&!uuid(query.viewing_id))throw new BadRequestException('INVALID_INPUT');
    return this.run(()=>this.store.listNotices(this.actor(request),{...pagination,...(query.viewing_id===undefined?{}:{viewing_id:query.viewing_id as string})}));
  }
  @Post('viewing-notices/:id/read')
  noticeRead(@Req() request:AuthenticatedRequest,@Param('id') id:string,@Body() input:unknown) {
    fields(input,[]);return this.run(()=>this.store.readNotice(this.actor(request),resource(id)));
  }

  @Get('viewings/:id/attendance')
  attendance(@Req() request: AuthenticatedRequest, @Param('id') id: string,
    @Query() query: Record<string, unknown>): Promise<ViewingAttendanceResponse> {
    return this.run(() => this.store.attendance(this.actor(request), resource(id), this.pagination(query, ['cursor', 'limit'])));
  }

  @Post('viewings/:id/attendance/completion')
  claimCompletion(@Req() request: AuthenticatedRequest, @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<ViewingAttendanceCommandResponse> {
    const body = fields(input, ['expected_version', 'expected_schedule_version']);
    versions(body);
    return this.run(() => this.store.claimAttendance(this.actor(request), resource(id),
      { ...body as ViewingAttendanceCompletionRequest, claim_type: 'COMPLETION' }, this.options(request, key)));
  }

  @Post('viewings/:id/attendance/no-show')
  claimNoShow(@Req() request: AuthenticatedRequest, @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<ViewingAttendanceCommandResponse> {
    const body = fields(input, ['expected_version', 'expected_schedule_version', 'absent_side']);
    versions(body);
    if (typeof body.absent_side !== 'string' || !['SEEKER', 'PROVIDER'].includes(body.absent_side)) throw new BadRequestException('INVALID_INPUT');
    return this.run(() => this.store.claimAttendance(this.actor(request), resource(id),
      { ...body as ViewingAttendanceNoShowRequest, claim_type: 'NO_SHOW' }, this.options(request, key)));
  }

  @Post('viewings/:id/attendance/claims/:claimId/confirm')
  confirmAttendance(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Param('claimId') claimId: string,
    @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<ViewingAttendanceCommandResponse> {
    const body = fields(input, ['expected_version', 'expected_schedule_version', 'expected_claim_version']);
    this.claimVersions(body);
    return this.run(() => this.store.respondAttendance(this.actor(request), resource(id), resource(claimId),
      'confirm', body as ViewingAttendanceConfirmRequest, this.options(request, key)));
  }

  @Post('viewings/:id/attendance/claims/:claimId/dispute')
  disputeAttendance(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Param('claimId') claimId: string,
    @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<ViewingAttendanceCommandResponse> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('INVALID_INPUT');
    const names = ['expected_version', 'expected_schedule_version', 'expected_claim_version', 'reason'];
    if ('evidence' in input) names.push('evidence');
    const body = fields(input, names);
    this.claimVersions(body);
    if (typeof body.reason !== 'string' || !['DID_NOT_ATTEND', 'OUTCOME_INCORRECT', 'SAFETY', 'OTHER'].includes(body.reason))
      throw new BadRequestException('INVALID_INPUT');
    if (body.evidence !== undefined) {
      if (!Array.isArray(body.evidence) || body.evidence.length > 5) throw new BadRequestException('INVALID_INPUT');
      const references = new Set<string>();
      for (const item of body.evidence) {
        const evidence = fields(item, ['reference', 'kind']);
        if (!uuid(evidence.reference) || evidence.kind !== 'MESSAGE' || references.has(evidence.reference))
          throw new BadRequestException('INVALID_INPUT');
        references.add(evidence.reference);
      }
    }
    return this.run(() => this.store.respondAttendance(this.actor(request), resource(id), resource(claimId),
      'dispute', body as ViewingAttendanceDisputeRequest, this.options(request, key)));
  }

  @Get('viewings/:id/attendance/case')
  attendanceCase(@Req() request: AuthenticatedRequest, @Param('id') id: string,
    @Query() query: Record<string, unknown>): Promise<ViewingAttendanceCaseResponse> {
    this.pagination(query, []);
    return this.run(async () => {
      const attendance = await this.store.attendance(this.actor(request), resource(id));
      return { viewing_id: attendance.viewing_id, schedule_version: attendance.schedule_version, case: attendance.case };
    });
  }

  private claimVersions(body: Record<string, unknown>): void {
    versions(body);
    if (!Number.isSafeInteger(body.expected_claim_version) || Number(body.expected_claim_version) < 1)
      throw new BadRequestException('INVALID_INPUT');
  }
  private pagination(query:Record<string,unknown>,allowed:string[]) {
    if(Object.keys(query).some(k=>!allowed.includes(k))||(query.cursor!==undefined&&!uuid(query.cursor))||
      (query.limit!==undefined&&(typeof query.limit!=='string'||!/^([1-9]|[1-4][0-9]|50)$/.test(query.limit))))throw new BadRequestException('INVALID_INPUT');
    return {...(query.cursor===undefined?{}:{cursor:query.cursor as string}),...(query.limit===undefined?{}:{limit:Number(query.limit)})};
  }
  private rescheduleResponse(request:AuthenticatedRequest,id:string,proposalId:string,action:'accept'|'reject'|'withdraw',input:unknown,key:string|undefined):Promise<ViewingRescheduleCommandResponse> {
    const body=fields(input,['expected_version','expected_schedule_version','expected_proposal_version']);versions(body);
    if(!Number.isSafeInteger(body.expected_proposal_version)||Number(body.expected_proposal_version)<1)throw new BadRequestException('INVALID_INPUT');
    return this.run(()=>this.store.respondReschedule(this.actor(request),resource(id),resource(proposalId),action,body as ViewingRescheduleActionRequest,this.options(request,key)));
  }

  private reason(input: unknown): ViewingReasonRequest {
    const body = fields(input, ['expected_version', 'expected_schedule_version', 'reason']);
    versions(body);
    if (typeof body.reason !== 'string') throw new BadRequestException('INVALID_INPUT');
    return body as ViewingReasonRequest;
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
  private async run<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (!(error instanceof IdentityError)) throw error;
      if (error.code === 'AUTH_REQUIRED') throw new UnauthorizedException('AUTH_REQUIRED');
      if (['RESOURCE_SCOPE_DENIED', 'PUBLIC_LISTING_NOT_FOUND'].includes(error.code)) throw new NotFoundException('RESOURCE_UNAVAILABLE');
      if (error.code === 'INVALID_INPUT') throw new BadRequestException('INVALID_INPUT');
      if (['CAPABILITY_RESTRICTED', 'PHONE_REQUIRED', 'SELF_CONFIRMATION_DENIED'].includes(error.code)) throw new ForbiddenException(error.code);
      throw new ConflictException(['STALE_VERSION', 'STALE_SCHEDULE_VERSION', 'IDEMPOTENCY_KEY_REUSED', 'INVALID_STATE', 'REQUEST_EXPIRED', 'APPOINTMENT_PAST', 'ACTIVE_VIEWING_EXISTS','STALE_PROPOSAL_VERSION','PENDING_PROPOSAL_EXISTS','PROPOSAL_EXPIRED', 'CLAIM_TOO_EARLY', 'STALE_CLAIM_VERSION', 'ATTENDANCE_CLAIM_EXISTS', 'ATTENDANCE_PENDING'].includes(error.code) ? error.code : 'REQUEST_CONFLICT');
    }
  }
}
