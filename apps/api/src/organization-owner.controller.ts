import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, Inject, Injectable, NotFoundException, Param, Post, Query, Req, UnauthorizedException, UseGuards, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { IdentityError, OrganizationOwnerStore, type OrganizationActor, type OrganizationRole, type OrdinaryOrganizationRole } from '@pachi/database';
import type { OrganizationMember, OrganizationOwnershipTransfer, OrganizationOwnershipTransferListResponse } from '@pachi/contracts';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { organizationRequestId } from './logging.js';

@Injectable()
export class OrganizationOwnerNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>().setHeader('Cache-Control', 'private, no-store'); return true;
  }
}
const versions = ['expected_organization_version','expected_actor_membership_version'];
const transferVersions = [...versions,'expected_transfer_version','expected_source_membership_version','expected_recipient_membership_version'];
@Controller('account/organizations/:organizationId')
@UseGuards(OrganizationOwnerNoStoreGuard, AuthGuard)
export class OrganizationOwnerController {
  constructor(@Inject('ORGANIZATION_OWNER_STORE') private readonly store: OrganizationOwnerStore) {}
  @Post('members/:membershipId/privileged-role')
  role(@Req() request: AuthenticatedRequest, @Param() params: Record<string, string>, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationMember> {
    const body = fields(input, [...versions,'expected_membership_version','role']);
    if (typeof body.role !== 'string' || !['OWNER','ADMIN','LISTING_MANAGER','AGENT','ANALYST'].includes(body.role)) throw new BadRequestException('INVALID_INPUT');
    return this.run(() => this.store.mutateMember(this.actor(request), id(params.organizationId), id(params.membershipId), {
      ...command(request, key, body), expectedMembershipVersion: version(body.expected_membership_version), command: 'ROLE', role: body.role as OrganizationRole
    }));
  }
  @Post('members/:membershipId/privileged-revoke')
  revoke(@Req() request: AuthenticatedRequest, @Param() params: Record<string, string>, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationMember> {
    const body = fields(input, [...versions,'expected_membership_version']);
    return this.run(() => this.store.mutateMember(this.actor(request), id(params.organizationId), id(params.membershipId), {
      ...command(request, key, body), expectedMembershipVersion: version(body.expected_membership_version), command: 'REVOKE'
    }));
  }
  @Get('ownership-transfers')
  list(@Req() request: AuthenticatedRequest, @Param('organizationId') organizationId: string, @Query() query: Record<string, unknown>): Promise<OrganizationOwnershipTransferListResponse> {
    if (Object.keys(query).some(key => !['cursor','limit'].includes(key))) throw new BadRequestException('INVALID_INPUT');
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new BadRequestException('INVALID_INPUT');
    return this.run(() => this.store.list(this.actor(request), id(organizationId), { limit, ...(query.cursor === undefined ? {} : { cursor: id(query.cursor) }) }));
  }
  @Post('ownership-transfers')
  initiate(@Req() request: AuthenticatedRequest, @Param('organizationId') organizationId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationOwnershipTransfer> {
    const body = fields(input, [...versions,'recipient_membership_id','expected_recipient_membership_version','source_role_after']);
    if (typeof body.source_role_after !== 'string' || !['LISTING_MANAGER','AGENT','ANALYST'].includes(body.source_role_after)) throw new BadRequestException('INVALID_INPUT');
    return this.run(() => this.store.initiate(this.actor(request), id(organizationId), id(body.recipient_membership_id), {
      ...command(request, key, body), expectedRecipientMembershipVersion: version(body.expected_recipient_membership_version), sourceRoleAfter: body.source_role_after as OrdinaryOrganizationRole
    }));
  }
  @Post('ownership-transfers/:transferId/accept')
  accept(@Req() request: AuthenticatedRequest, @Param() params: Record<string, string>, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationOwnershipTransfer> { return this.transfer(request, params, key, input, 'ACCEPT'); }
  @Post('ownership-transfers/:transferId/complete')
  complete(@Req() request: AuthenticatedRequest, @Param() params: Record<string, string>, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationOwnershipTransfer> { return this.transfer(request, params, key, input, 'COMPLETE'); }
  @Post('ownership-transfers/:transferId/cancel')
  cancel(@Req() request: AuthenticatedRequest, @Param() params: Record<string, string>, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationOwnershipTransfer> { return this.transfer(request, params, key, input, 'CANCEL'); }
  private transfer(request: AuthenticatedRequest, params: Record<string, string>, key: string | undefined, input: unknown, action: 'ACCEPT' | 'COMPLETE' | 'CANCEL'): Promise<OrganizationOwnershipTransfer> {
    const body = fields(input, transferVersions);
    return this.run(() => this.store.transferCommand(this.actor(request), id(params.organizationId), id(params.transferId), {
      ...command(request, key, body), command: action, expectedTransferVersion: version(body.expected_transfer_version),
      expectedSourceMembershipVersion: version(body.expected_source_membership_version), expectedRecipientMembershipVersion: version(body.expected_recipient_membership_version)
    }));
  }
  private actor(request: AuthenticatedRequest): OrganizationActor {
    if (!request.principal) throw new UnauthorizedException('AUTH_REQUIRED');
    if (request.method !== 'GET' && Object.keys(request.query).length) throw new BadRequestException('INVALID_INPUT');
    return { userId: request.principal.userId, sessionId: request.principal.session.id, securityVersion: request.principal.session.securityVersion };
  }
  private async run<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof IdentityError) {
        if (['AUTH_REQUIRED','SESSION_REVOKED'].includes(error.code)) throw new UnauthorizedException('AUTH_REQUIRED');
        if (error.code === 'RESOURCE_SCOPE_DENIED') throw new NotFoundException('RESOURCE_UNAVAILABLE');
        if (error.code === 'INVALID_INPUT') throw new BadRequestException('INVALID_INPUT');
        if (['STEP_UP_REQUIRED','CAPABILITY_RESTRICTED'].includes(error.code)) throw new ForbiddenException(error.code);
        throw new ConflictException(error.code);
      }
      throw error;
    }
  }
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('INVALID_INPUT'); return value;
}
function version(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 1) throw new BadRequestException('INVALID_INPUT'); return value as number; }
function fields(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input,key))) throw new BadRequestException('INVALID_INPUT'); return input as Record<string, unknown>;
}
function command(request: AuthenticatedRequest, key: string | undefined, body: Record<string, unknown>) {
  return { idempotencyKey: id(key), requestId: organizationRequestId(request), expectedOrganizationVersion: version(body.expected_organization_version), expectedActorMembershipVersion: version(body.expected_actor_membership_version) };
}
