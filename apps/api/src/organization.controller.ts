import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, Inject, Injectable, NotFoundException, Param, Post, Query, Req, ServiceUnavailableException, UnauthorizedException, UseGuards, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { IdentityError, OrganizationStore, type OrganizationActor } from '@pachi/database';
import type { OrganizationInvitation, OrganizationInvitationListResponse, OrganizationListResponse, OrganizationMember, OrganizationMemberListResponse, OrganizationSummary } from '@pachi/contracts';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { organizationRequestId } from './logging.js';

/** Run before authentication, including guard failures and malformed body errors. */
@Injectable()
export class OrganizationNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getResponse<{ setHeader: (name: string, value: string) => void }>().setHeader('Cache-Control', 'no-store');
    return true;
  }
}

@Controller('account')
@UseGuards(OrganizationNoStoreGuard, AuthGuard)
export class OrganizationController {
  constructor(@Inject('ORGANIZATION_STORE') private readonly store: OrganizationStore) {}

  @Post('organizations')
  create(@Req() request: AuthenticatedRequest, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationSummary> {
    const body = fields(input, ['legal_name', 'public_name', 'organization_type', 'public_phone_opt_in']);
    if (typeof body.public_phone_opt_in !== 'boolean') throw new BadRequestException('INVALID_INPUT');
    return this.run(() => this.store.create(this.actor(request), { legalName: string(body.legal_name), publicName: string(body.public_name), organizationType: string(body.organization_type), publicPhoneOptIn: body.public_phone_opt_in as boolean, idempotencyKey: commandKey(key), requestId: organizationRequestId(request) }));
  }

  @Get('organizations')
  list(@Req() request: AuthenticatedRequest, @Query('cursor') cursor?: string, @Query('limit') limit?: string): Promise<OrganizationListResponse> {
    return this.run(() => this.store.list(this.actor(request), page(cursor, limit)));
  }

  @Get('organizations/:organizationId')
  get(@Req() request: AuthenticatedRequest, @Param('organizationId') id: string): Promise<OrganizationSummary> {
    return this.run(() => this.store.get(this.actor(request), resourceId(id)));
  }

  @Get('organizations/:organizationId/members')
  members(@Req() request: AuthenticatedRequest, @Param('organizationId') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string): Promise<OrganizationMemberListResponse> {
    return this.run(() => this.store.members(this.actor(request), resourceId(id), page(cursor, limit)));
  }

  @Get('organizations/:organizationId/invitations')
  invitations(@Req() request: AuthenticatedRequest, @Param('organizationId') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string): Promise<OrganizationInvitationListResponse> {
    return this.run(() => this.store.invitations(this.actor(request), { ...page(cursor, limit), organizationId: resourceId(id) }));
  }

  @Get('organization-invitations')
  ownInvitations(@Req() request: AuthenticatedRequest, @Query('cursor') cursor?: string, @Query('limit') limit?: string): Promise<OrganizationInvitationListResponse> {
    return this.run(() => this.store.invitations(this.actor(request), page(cursor, limit)));
  }

  @Post('organizations/:organizationId/invitations')
  invite(@Req() request: AuthenticatedRequest, @Param('organizationId') id: string, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationInvitation> {
    const body = fields(input, ['recipient_phone', 'role', 'expected_version']);
    return this.run(() => this.store.invite(this.actor(request), resourceId(id), { recipientPhone: string(body.recipient_phone), role: string(body.role), expectedVersion: version(body.expected_version), idempotencyKey: commandKey(key), requestId: organizationRequestId(request) }));
  }

  @Post('organization-invitations/:invitationId/accept')
  accept(@Req() request: AuthenticatedRequest, @Param('invitationId') id: string, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationInvitation> {
    return this.respond(request, id, key, input, 'ACCEPT');
  }

  @Post('organization-invitations/:invitationId/decline')
  decline(@Req() request: AuthenticatedRequest, @Param('invitationId') id: string, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationInvitation> {
    return this.respond(request, id, key, input, 'DECLINE');
  }

  @Post('organizations/:organizationId/invitations/:invitationId/revoke')
  revokeInvitation(@Req() request: AuthenticatedRequest, @Param('organizationId') id: string, @Param('invitationId') invitationId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationInvitation> {
    const body = fields(input, ['expected_version']);
    return this.run(() => this.store.revokeInvitation(this.actor(request), resourceId(id), resourceId(invitationId), { expectedVersion: version(body.expected_version), idempotencyKey: commandKey(key), requestId: organizationRequestId(request) }));
  }

  @Post('organizations/:organizationId/members/:membershipId/change-role')
  changeRole(@Req() request: AuthenticatedRequest, @Param('organizationId') id: string, @Param('membershipId') membershipId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationMember> {
    return this.memberCommand(request, id, membershipId, key, input, 'CHANGE_ROLE');
  }

  @Post('organizations/:organizationId/members/:membershipId/suspend')
  suspend(@Req() request: AuthenticatedRequest, @Param('organizationId') id: string, @Param('membershipId') membershipId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationMember> {
    return this.memberCommand(request, id, membershipId, key, input, 'SUSPEND');
  }

  @Post('organizations/:organizationId/members/:membershipId/reactivate')
  reactivate(@Req() request: AuthenticatedRequest, @Param('organizationId') id: string, @Param('membershipId') membershipId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationMember> {
    return this.memberCommand(request, id, membershipId, key, input, 'REACTIVATE');
  }

  @Post('organizations/:organizationId/members/:membershipId/revoke')
  revokeMember(@Req() request: AuthenticatedRequest, @Param('organizationId') id: string, @Param('membershipId') membershipId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationMember> {
    return this.memberCommand(request, id, membershipId, key, input, 'REVOKE');
  }

  private respond(request: AuthenticatedRequest, id: string, key: string | undefined, input: unknown, command: 'ACCEPT' | 'DECLINE'): Promise<OrganizationInvitation> {
    const body = fields(input, ['token', 'expected_version']);
    return this.run(() => this.store.respondInvitation(this.actor(request), resourceId(id), { command, token: string(body.token), expectedVersion: version(body.expected_version), idempotencyKey: commandKey(key), requestId: organizationRequestId(request) }));
  }

  private memberCommand(request: AuthenticatedRequest, id: string, membershipId: string, key: string | undefined, input: unknown, command: 'CHANGE_ROLE' | 'SUSPEND' | 'REACTIVATE' | 'REVOKE'): Promise<OrganizationMember> {
    const body = fields(input, command === 'CHANGE_ROLE' ? ['role', 'expected_version'] : ['expected_version']);
    return this.run(() => this.store.mutateMember(this.actor(request), resourceId(id), resourceId(membershipId), { command, ...(command === 'CHANGE_ROLE' ? { role: string(body.role) } : {}), expectedVersion: version(body.expected_version), idempotencyKey: commandKey(key), requestId: organizationRequestId(request) }));
  }

  private actor(request: AuthenticatedRequest): OrganizationActor {
    if (!request.principal) throw new UnauthorizedException('AUTH_REQUIRED');
    if (Object.keys(request.query).some(key => !['cursor', 'limit'].includes(key))) throw new BadRequestException('INVALID_INPUT');
    return { userId: request.principal.userId, sessionId: request.principal.session.id, securityVersion: request.principal.session.securityVersion };
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof IdentityError) {
        if (['AUTH_REQUIRED', 'SESSION_REVOKED'].includes(error.code)) throw new UnauthorizedException('AUTH_REQUIRED');
        if (error.code === 'RESOURCE_SCOPE_DENIED') throw new NotFoundException('RESOURCE_UNAVAILABLE');
        if (error.code === 'INVALID_INPUT') throw new BadRequestException('INVALID_INPUT');
        if (error.code === 'DELIVERY_UNAVAILABLE') throw new ServiceUnavailableException('DELIVERY_UNAVAILABLE');
        if (['CAPABILITY_RESTRICTED', 'PHONE_REQUIRED', 'PRIVILEGED_GOVERNANCE_UNAVAILABLE'].includes(error.code)) throw new ForbiddenException(error.code);
        throw new ConflictException(error.code);
      }
      throw error;
    }
  }
}

function fields(input: unknown, allowed: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(input, key))) throw new BadRequestException('INVALID_INPUT');
  return input as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('INVALID_INPUT');
  return value;
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new BadRequestException('INVALID_INPUT');
  return value as number;
}
function commandKey(value: string | undefined): string {
  if (!value || !uuid(value)) throw new BadRequestException('INVALID_IDEMPOTENCY_KEY');
  return value;
}
function resourceId(value: string): string {
  if (!uuid(value)) throw new NotFoundException('RESOURCE_UNAVAILABLE');
  return value;
}
function uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function page(cursor: string | undefined, rawLimit: string | undefined): { cursor?: string; limit: number } {
  const limit = rawLimit === undefined ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 1000))) throw new BadRequestException('INVALID_INPUT');
  return { ...(cursor === undefined ? {} : { cursor }), limit };
}
