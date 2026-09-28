import { Body, Controller, ForbiddenException, Get, Headers, Inject, Param, ParseUUIDPipe, Post, Req, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { IdentityError, ProviderVerificationStore, StaffAccessError } from '@pachi/database';
import { StaffAuthService } from './staff.controller.js';

@Controller('staff/verification-cases')
export class StaffVerificationController {
  constructor(@Inject('STAFF_AUTH_SERVICE') private readonly auth: StaffAuthService, @Inject('PROVIDER_VERIFICATION_STORE') private readonly store: ProviderVerificationStore) {}
  private error(error: unknown): never {
    if (error instanceof StaffAccessError || error instanceof IdentityError) {
      if (error.code === 'STEP_UP_REQUIRED') throw new ForbiddenException('STEP_UP_REQUIRED');
      if (error.code === 'RESOURCE_SCOPE_DENIED') throw new ForbiddenException('RESOURCE_SCOPE_DENIED');
      if (error.code === 'CONFIGURATION') throw new ServiceUnavailableException('CONFIGURATION');
      throw new ConflictException(error.code);
    }
    throw error;
  }
  @Get(':id')
  async detail(@Headers('authorization') authorization: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    try { return await this.store.assigned(await this.auth.principal(authorization),id); } catch (error) { this.error(error); }
  }
  @Get(':id/evidence/:kind')
  async evidence(@Headers('authorization') authorization: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Req() request: Request) {
    if (kind !== 'GOVERNMENT_ID' && kind !== 'LIVE_SELFIE') throw new ConflictException('INVALID_INPUT');
    try {
      const value = await this.store.evidence(await this.auth.principal(authorization),id,kind,randomUUID());
      request.res?.setHeader('Cache-Control','no-store');
      return value;
    } catch (error) { this.error(error); }
  }
  @Post(':id/decision')
  async decide(@Headers('authorization') authorization: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Body() body: { expected_version?: unknown; outcome?: unknown; reason_code?: unknown }) {
    try {
      return await this.store.decide(await this.auth.principal(authorization),id,{
        expectedVersion: typeof body.expected_version === 'number' ? body.expected_version : -1,
        outcome: body.outcome as 'VERIFIED' | 'REJECTED' | 'NEEDS_RESUBMISSION',
        reasonCode: typeof body.reason_code === 'string' ? body.reason_code : '',
        requestId: randomUUID(),
      });
    } catch (error) { this.error(error); }
  }
  @Post(':id/assign')
  async assign(@Headers('authorization') authorization: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Body() body: { staff_user_id?: unknown; expected_version?: unknown }) {
    if (typeof body.staff_user_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.staff_user_id) || typeof body.expected_version !== 'number') throw new ConflictException('INVALID_INPUT');
    try { return await this.store.assign(await this.auth.principal(authorization),id,body.staff_user_id,body.expected_version,randomUUID()); } catch (error) { this.error(error); }
  }
}
