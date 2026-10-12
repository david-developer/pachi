import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException,
  Get, Headers, Inject, NotFoundException, Param, Post, Query, Req,
  UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { IdentityError, ViewingAppointmentStore } from '@pachi/database';
import type {
  ViewingAcceptRequest, ViewingConfirmRequest, ViewingCreateRequest, ViewingReasonRequest, ViewingRescheduleRequest, ViewingRescheduleActionRequest, ViewingRescheduleCommandResponse, ViewingRescheduleListResponse,
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
  constructor(@Inject('VIEWING_STORE') private readonly store: ViewingAppointmentStore) {}

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
      if (['CAPABILITY_RESTRICTED', 'PHONE_REQUIRED'].includes(error.code)) throw new ForbiddenException(error.code);
      throw new ConflictException(['STALE_VERSION', 'STALE_SCHEDULE_VERSION', 'IDEMPOTENCY_KEY_REUSED', 'INVALID_STATE', 'REQUEST_EXPIRED', 'APPOINTMENT_PAST', 'ACTIVE_VIEWING_EXISTS','STALE_PROPOSAL_VERSION','PENDING_PROPOSAL_EXISTS','PROPOSAL_EXPIRED'].includes(error.code) ? error.code : 'REQUEST_CONFLICT');
    }
  }
}
