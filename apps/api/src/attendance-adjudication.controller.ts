import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, Param, Post, Query, Req, Headers, UnauthorizedException, UseGuards, Injectable } from '@nestjs/common';
import { AttendanceAdjudicationStore, IdentityError, StaffAccessError } from '@pachi/database';
import type { AttendanceAssignmentRequest, AttendanceDecisionRequest, AttendanceAppealDecisionRequest, AttendanceAppealRequest, AttendanceInvestigationRequest } from '@pachi/contracts';
import type { Request } from 'express';
import { StaffAuthService } from './staff.controller.js';
import { OrganizationOwnerNoStoreGuard } from './organization-owner.controller.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { organizationRequestId } from './logging.js';

async function run<T>(work:()=>Promise<T>):Promise<T>{
  try{return await work();}catch(e){
    if(!(e instanceof IdentityError)&&!(e instanceof StaffAccessError))throw e;
    if(e.code==='AUTH_REQUIRED')throw new UnauthorizedException(e.code);
    if(['RESOURCE_SCOPE_DENIED','STEP_UP_REQUIRED'].includes(e.code))throw new ForbiddenException(e.code);
    if(e.code==='INVALID_INPUT')throw new BadRequestException(e.code);
    throw new ConflictException(['STALE_VERSION','IDEMPOTENCY_KEY_REUSED','INVALID_STATE'].includes(e.code)?e.code:'REQUEST_CONFLICT');
  }
}
function purpose(query:Record<string,unknown>){if(Object.keys(query).some(k=>k!=='purpose')||query.purpose!=='ATTENDANCE_ADJUDICATION')throw new BadRequestException('INVALID_INPUT');return 'ATTENDANCE_ADJUDICATION';}
@Controller('staff/attendance-cases')
@UseGuards(OrganizationOwnerNoStoreGuard)
export class StaffAttendanceAdjudicationController {
  constructor(@Inject('STAFF_AUTH_SERVICE') private readonly auth:StaffAuthService,@Inject('ATTENDANCE_ADJUDICATION_STORE') private readonly store:AttendanceAdjudicationStore){}
  @Get()
  queue(@Headers('authorization') token:string|undefined,@Query() query:Record<string,unknown>,@Req() request:Request){purpose(query);return run(async()=>this.store.queue(await this.auth.principal(token),organizationRequestId(request)));}
  @Get(':id')
  get(@Headers('authorization') token:string|undefined,@Param('id') id:string,@Query() query:Record<string,unknown>,@Req() request:Request){const selected=purpose(query);return run(async()=>this.store.get(await this.auth.principal(token),id,selected,organizationRequestId(request)));}
  @Post(':id/assign')
  assign(@Headers('authorization') token:string|undefined,@Param('id') id:string,@Body() input:unknown,@Req() request:Request){return run(async()=>this.store.assign(await this.auth.principal(token),id,input as AttendanceAssignmentRequest,organizationRequestId(request)));}
  @Post(':id/investigation')
  investigate(@Headers('authorization') token:string|undefined,@Param('id') id:string,@Body() input:unknown,@Req() request:Request){return run(async()=>this.store.beginInvestigation(await this.auth.principal(token),id,input as AttendanceInvestigationRequest,organizationRequestId(request)));}
  @Post(':id/decisions')
  decide(@Headers('authorization') token:string|undefined,@Param('id') id:string,@Body() input:unknown,@Req() request:Request){return run(async()=>this.store.decide(await this.auth.principal(token),id,input as AttendanceDecisionRequest,organizationRequestId(request)));}
  @Post(':id/appeal-decisions')
  appealDecision(@Headers('authorization') token:string|undefined,@Param('id') id:string,@Body() input:unknown,@Req() request:Request){return run(async()=>this.store.resolveAppeal(await this.auth.principal(token),id,input as AttendanceAppealDecisionRequest,organizationRequestId(request)));}
}
/** Dedicated safe appeal path; ordinary authentication still denies suspension. */
@Injectable()
export class AttendanceAppealAuthGuard implements CanActivate {
  constructor(@Inject('AUTH_SERVICE') private readonly auth:AuthService){}
  async canActivate(context:ExecutionContext){const req=context.switchToHttp().getRequest<AuthenticatedRequest>();req.principal=await this.auth.authenticate(req.header('authorization'),req.header('user-agent'),'ATTENDANCE_APPEAL');return true;}
}
@Controller('account/viewings')
@UseGuards(OrganizationOwnerNoStoreGuard,AttendanceAppealAuthGuard)
export class AttendanceAppealController {
  constructor(@Inject('ATTENDANCE_ADJUDICATION_STORE') private readonly store:AttendanceAdjudicationStore){}
  private actor(req:AuthenticatedRequest){const p=req.principal;if(!p)throw new UnauthorizedException('AUTH_REQUIRED');return {userId:p.userId,sessionId:p.session.id,securityVersion:p.session.securityVersion};}
  @Get(':id/attendance/resolution')
  resolution(@Req() req:AuthenticatedRequest,@Param('id') id:string,@Query() query:Record<string,unknown>){if(Object.keys(query).length)throw new BadRequestException('INVALID_INPUT');return run(()=>this.store.participantResolution(this.actor(req),id));}
  @Post(':id/attendance/appeals')
  appeal(@Req() req:AuthenticatedRequest,@Param('id') id:string,@Body() input:unknown){return run(()=>this.store.submitAppeal(this.actor(req),id,input as AttendanceAppealRequest));}
}
