import { Controller, Get, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthGuard } from './auth.guard.js';
import { IdentityStore } from '@pachi/database';
import type { AccountMeResponse, OperationStatusResponse, SessionListResponse } from '@pachi/contracts';

@Controller('account')
@UseGuards(AuthGuard)
export class AccountController {
  public constructor(private readonly store: IdentityStore) {}

  @Get('me')
  public async me(@Req() request: AuthenticatedRequest): Promise<AccountMeResponse> {
    const principal = this.requirePrincipal(request);
    const user = await this.store.currentUser(principal.userId);
    if (!user) throw new NotFoundException('Account not found');
    return {
      id: user.id,
      account_state: user.accountState,
      participation: user.accountState === 'ACTIVE' && user.phoneVerified ? { allowed: true } : { allowed: false, reason: 'PHONE_REQUIRED' }
    };
  }

  @Get('sessions')
  public async sessions(@Req() request: AuthenticatedRequest): Promise<SessionListResponse> {
    const principal = this.requirePrincipal(request);
    return { sessions: await this.store.listSessions(principal.userId, principal.session.id) };
  }

  @Post('logout')
  public async logout(@Req() request: AuthenticatedRequest): Promise<OperationStatusResponse> {
    const principal = this.requirePrincipal(request);
    await this.store.revokeSession(principal.userId, principal.session.id, 'USER_LOGOUT');
    return { status: 'ok' as const };
  }

  @Post('logout-all')
  public async logoutAll(@Req() request: AuthenticatedRequest): Promise<OperationStatusResponse> {
    const principal = this.requirePrincipal(request);
    await this.store.revokeAllSessions(principal.userId, 'USER_LOGOUT_ALL');
    return { status: 'ok' as const };
  }

  private requirePrincipal(request: AuthenticatedRequest) {
    if (!request.principal) throw new Error('Authenticated principal missing');
    return request.principal;
  }
}
