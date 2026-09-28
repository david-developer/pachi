import {
  Controller,
  Get,
  Headers,
  Inject,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { StaffStore, StaffAccessError } from '@pachi/database';
import type { StaffPrincipal } from '@pachi/database';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
export class StaffAuthService {
  constructor(
    private readonly store: StaffStore,
    private readonly verifier: CognitoAccessTokenVerifier | null,
  ) {}
  async session(authorization: string | undefined) {
    const principal = await this.principal(authorization);
    return this.store.projection(principal);
  }
  async principal(authorization: string | undefined): Promise<StaffPrincipal> {
    if (!this.verifier || !authorization?.startsWith('Bearer ') || authorization.length > 16391)
      throw new UnauthorizedException('AUTH_REQUIRED');
    try {
      const claims = await this.verifier.verify(authorization.slice(7));
      const principal = await this.store.authenticate(claims);
      return principal;
    } catch (error) {
      await this.store.audit('staff-api', null, 'staff:access', 'AUTHORIZATION_REJECTED', 'DENIED');
      if (error instanceof StaffAccessError && error.code === 'RESOURCE_SCOPE_DENIED')
        throw new ForbiddenException('RESOURCE_SCOPE_DENIED');
      throw new UnauthorizedException('AUTH_REQUIRED');
    }
  }
}
@Controller('staff')
export class StaffController {
  constructor(@Inject('STAFF_AUTH_SERVICE') private readonly auth: StaffAuthService) {}
  @Get('session') session(@Headers('authorization') authorization: string | undefined) {
    return this.auth.session(authorization);
  }
}
