import { Body, ConflictException, Controller, ForbiddenException, Get, Headers, Inject, Param, ParseUUIDPipe, Post, Req, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { AuthorityRiskStore, IdentityError, StaffAccessError, type AuthorityRiskCaseInput, type AuthorityRiskDecisionInput, type AuthorityRiskInternalSource } from '@pachi/database';
import { StaffAuthService } from './staff.controller.js';

@Controller('staff/authority-risk-cases')
export class StaffAuthorityRiskController {
  constructor(@Inject('STAFF_AUTH_SERVICE') private readonly auth: StaffAuthService, @Inject('AUTHORITY_RISK_STORE') private readonly store: AuthorityRiskStore) {}
  private error(error: unknown): never {
    if (error instanceof StaffAccessError || error instanceof IdentityError) {
      if (error.code === 'AUTH_REQUIRED') throw new UnauthorizedException(error.code);
      if (error.code === 'RESOURCE_SCOPE_DENIED' || error.code === 'STEP_UP_REQUIRED') throw new ForbiddenException(error.code);
      throw new ConflictException(error.code);
    }
    throw error;
  }
  @Post()
  async open(@Headers('authorization') authorization: string | undefined, @Body() body: Partial<AuthorityRiskCaseInput>, @Req() request: Request) {
    try {
      return await this.store.openCase(await this.auth.principal(authorization), {
        id: body?.id ?? '', propertyId: body?.propertyId ?? '', relationshipId: body?.relationshipId ?? null,
        principalId: body?.principalId ?? null, subjectScope: body?.subjectScope as AuthorityRiskCaseInput['subjectScope'],
        triggerKind: body?.triggerKind as AuthorityRiskCaseInput['triggerKind'], allegationKind: body?.allegationKind as AuthorityRiskCaseInput['allegationKind'],
        provenance: body?.provenance as AuthorityRiskCaseInput['provenance'], reasonCode: body?.reasonCode ?? '',
        evidenceRefType: body?.evidenceRefType ?? null, evidenceRefId: body?.evidenceRefId ?? null,
        requestId: requestId(request),
      });
    } catch (error) { this.error(error); }
  }
  @Get(':id')
  async detail(@Headers('authorization') authorization: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    try { return await this.store.case(await this.auth.principal(authorization), id); }
    catch (error) { this.error(error); }
  }
  @Get(':id/internal-source')
  async internalSource(@Headers('authorization') authorization: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Req() request: Request): Promise<AuthorityRiskInternalSource> {
    try { return await this.store.internalSource(await this.auth.principal(authorization), id, requestId(request)); }
    catch (error) { this.error(error); }
  }
  @Post(':id/claim-legacy')
  async claimLegacy(@Headers('authorization') authorization: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Body() body: { expected_version?: unknown }, @Req() request: Request) {
    try { return await this.store.claimLegacyCase(await this.auth.principal(authorization), id, typeof body?.expected_version === 'number' ? body.expected_version : -1, requestId(request)); }
    catch (error) { this.error(error); }
  }
  @Post(':id/decision')
  async decide(@Headers('authorization') authorization: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Body() body: { expected_version?: unknown; outcome?: unknown; reason_code?: unknown; evidence_ref_type?: unknown; evidence_ref_id?: unknown }, @Req() request: Request) {
    try {
      const input: AuthorityRiskDecisionInput = {
        expectedVersion: typeof body?.expected_version === 'number' ? body.expected_version : -1,
        outcome: body?.outcome as AuthorityRiskDecisionInput['outcome'], reasonCode: typeof body?.reason_code === 'string' ? body.reason_code : '',
        evidenceRefType: body?.evidence_ref_type as AuthorityRiskDecisionInput['evidenceRefType'], evidenceRefId: typeof body?.evidence_ref_id === 'string' ? body.evidence_ref_id : '',
        requestId: requestId(request),
      };
      return await this.store.decide(await this.auth.principal(authorization), id, input);
    } catch (error) { this.error(error); }
  }
}
function requestId(request: Request): string {
  const supplied = request.header('x-request-id');
  return supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied) ? supplied : randomUUID();
}
