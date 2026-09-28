import { Body, ConflictException, Controller, Get, Inject, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IdentityError, ProviderStore, type IndividualProviderType } from '@pachi/database';
import type { ProviderOnboardingResponse } from '@pachi/contracts';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthGuard } from './auth.guard.js';

@Controller('account/provider')
@UseGuards(AuthGuard)
export class ProviderController {
  public constructor(@Inject('PROVIDER_STORE') private readonly store: ProviderStore) {}

  @Get()
  public async overview(@Req() request: AuthenticatedRequest): Promise<ProviderOnboardingResponse | { provider: null }> {
    const principal = this.requirePrincipal(request);
    const provider = await this.store.get(principal.userId);
    return provider ? toResponse(provider) : { provider: null };
  }

  @Post('onboard')
  public async onboard(@Req() request: AuthenticatedRequest, @Body() body: { provider_types?: unknown; display_name?: unknown; bio?: unknown; service_area?: unknown }): Promise<ProviderOnboardingResponse> {
    const principal = this.requirePrincipal(request);
    const types = Array.isArray(body.provider_types) ? body.provider_types.filter((value): value is IndividualProviderType => typeof value === 'string') : [];
    try {
      const input = { providerTypes: types, displayName: typeof body.display_name === 'string' ? body.display_name : '' } as { providerTypes: IndividualProviderType[]; displayName: string; bio?: string; serviceArea?: string };
      if (typeof body.bio === 'string') input.bio = body.bio;
      if (typeof body.service_area === 'string') input.serviceArea = body.service_area;
      return toResponse(await this.store.onboard(principal.userId, input));
    } catch (error) {
      if (error instanceof IdentityError) throw new ConflictException(error.message);
      throw error;
    }
  }

  private requirePrincipal(request: AuthenticatedRequest) { if (!request.principal) throw new UnauthorizedException('Authentication required'); return request.principal; }
}

function toResponse(provider: Awaited<ReturnType<ProviderStore['get']>> & object): ProviderOnboardingResponse { return { profile_id: provider.profileId, account_id: provider.accountId, provider_types: provider.providerTypes, state: provider.state, verification_status: provider.verificationStatus, display_name: provider.displayName, bio: provider.bio, service_area: provider.serviceArea }; }
