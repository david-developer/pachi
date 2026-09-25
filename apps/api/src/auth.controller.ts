import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { IdentityStore } from '@pachi/database';
import type { AuthBootstrapResponse } from '@pachi/contracts';

@Controller('auth')
export class AuthController {
  public constructor(@Inject('AUTH_SERVICE') private readonly auth: AuthService, private readonly store: IdentityStore) {}

  @Post('bootstrap')
  public async bootstrap(@Headers('authorization') authorization: string | undefined, @Body() body: { device_label?: unknown }): Promise<AuthBootstrapResponse> {
    const deviceLabel = typeof body?.device_label === 'string' ? body.device_label.slice(0, 120) : undefined;
    const principal = await this.auth.authenticate(authorization, deviceLabel);
    const user = await this.store.currentUser(principal.userId);
    const participates = user?.accountState === 'ACTIVE' && user.phoneVerified;
    return {
      user_id: principal.userId,
      session_id: principal.session.id,
      account_state: principal.session.accountState,
      participation: participates ? { allowed: true } : { allowed: false, reason: 'PHONE_REQUIRED' }
    };
  }
}
