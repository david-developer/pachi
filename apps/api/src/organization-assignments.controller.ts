import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, Inject, NotFoundException, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IdentityError, OrganizationAssignmentStore, type OrganizationActor, type OrganizationResource } from '@pachi/database';
import type { OrganizationAssignment, OrganizationAssignmentListResponse } from '@pachi/contracts';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { OrganizationNoStoreGuard } from './organization.controller.js';
import { organizationRequestId } from './logging.js';

@Controller('account/organizations/:organizationId/resources/:resourceType/:resourceId')
@UseGuards(OrganizationNoStoreGuard, AuthGuard)
export class OrganizationAssignmentsController {
  constructor(@Inject('ORGANIZATION_ASSIGNMENT_STORE') private readonly store: OrganizationAssignmentStore) {}
  @Get('assignments')
  list(@Req() request: AuthenticatedRequest, @Param() params: Record<string,string>, @Query() query: Record<string,unknown>): Promise<OrganizationAssignmentListResponse> {
    if (Object.keys(query).some(key => !['membership_id','cursor','limit'].includes(key))) throw new BadRequestException('INVALID_INPUT');
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit<1 || limit>50) throw new BadRequestException('INVALID_INPUT');
    return this.run(() => this.store.list(this.actor(request), resource(params), {
      limit, ...(query.cursor===undefined?{}:{cursor:id(query.cursor)}), ...(query.membership_id===undefined?{}:{membershipId:id(query.membership_id)})
    }));
  }
  @Post('assignments')
  assign(@Req() request: AuthenticatedRequest, @Param() params: Record<string,string>, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationAssignment> {
    const body = fields(input,['membership_id','expected_version']);
    return this.run(() => this.store.assign(this.actor(request),resource(params),id(body.membership_id),{
      idempotencyKey:id(key),requestId:organizationRequestId(request),expectedVersion:version(body.expected_version,0)
    }));
  }
  @Post('assignments/:assignmentId/revoke')
  revoke(@Req() request: AuthenticatedRequest, @Param() params: Record<string,string>, @Headers('idempotency-key') key: string | undefined, @Body() input: unknown): Promise<OrganizationAssignment> {
    const body = fields(input,['expected_version']);
    return this.run(() => this.store.revoke(this.actor(request),resource(params),id(params.assignmentId),{
      idempotencyKey:id(key),requestId:organizationRequestId(request),expectedVersion:version(body.expected_version,1)
    }));
  }
  private actor(request: AuthenticatedRequest): OrganizationActor {
    if (!request.principal) throw new UnauthorizedException('AUTH_REQUIRED');
    if (request.method!=='GET' && Object.keys(request.query).length) throw new BadRequestException('INVALID_INPUT');
    return { userId:request.principal.userId,sessionId:request.principal.session.id,securityVersion:request.principal.session.securityVersion };
  }
  private async run<T>(work:()=>Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof IdentityError) {
        if (error.code==='AUTH_REQUIRED') throw new UnauthorizedException('AUTH_REQUIRED');
        if (error.code==='RESOURCE_SCOPE_DENIED') throw new NotFoundException('RESOURCE_UNAVAILABLE');
        if (error.code==='CAPABILITY_RESTRICTED') throw new ForbiddenException('CAPABILITY_RESTRICTED');
        if (error.code==='INVALID_INPUT') throw new BadRequestException('INVALID_INPUT');
        throw new ConflictException(error.code);
      }
      throw error;
    }
  }
}
function id(value:unknown):string {
  if (typeof value!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('INVALID_INPUT');
  return value;
}
function resource(params:Record<string,string>):OrganizationResource {
  if (!['LISTING','INTERACTION'].includes(params.resourceType ?? '')) throw new BadRequestException('INVALID_INPUT');
  return { organizationId:id(params.organizationId),resourceType:params.resourceType as 'LISTING'|'INTERACTION',resourceId:id(params.resourceId) };
}
function fields(input:unknown,allowed:string[]):Record<string,unknown> {
  if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!allowed.includes(key)) || allowed.some(key=>!Object.hasOwn(input,key))) throw new BadRequestException('INVALID_INPUT');
  return input as Record<string,unknown>;
}
function version(value:unknown,min:number):number {
  if (!Number.isSafeInteger(value) || (value as number)<min) throw new BadRequestException('INVALID_INPUT');
  return value as number;
}
