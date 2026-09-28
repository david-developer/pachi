import { Body, ConflictException, Controller, Get, Inject, Post, Req, UnauthorizedException, UseGuards, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { IdentityError, ProviderStore, ProviderVerificationStore, type IndividualProviderType } from '@pachi/database';
import { randomUUID } from 'node:crypto';
import type { ProviderOnboardingResponse } from '@pachi/contracts';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthGuard } from './auth.guard.js';

@Controller('account/provider')
@UseGuards(AuthGuard)
export class ProviderController {
  public constructor(@Inject('PROVIDER_STORE') private readonly store: ProviderStore, @Inject('PROVIDER_VERIFICATION_STORE') private readonly verification: ProviderVerificationStore) {}

  @Get()
  public async overview(@Req() request: AuthenticatedRequest): Promise<ProviderOnboardingResponse | { provider: null }> {
    const principal = this.requirePrincipal(request);
    const provider = await this.store.get(principal.userId);
    return provider ? toResponse(provider) : { provider: null };
  }

  @Post('onboard')
  public async onboard(@Req() request: AuthenticatedRequest, @Body() body: { provider_types?: unknown; display_name?: unknown; bio?: unknown; service_area?: unknown }): Promise<ProviderOnboardingResponse> {
    const principal = this.requirePrincipal(request);
    const types = Array.isArray(body.provider_types) ? body.provider_types as unknown[] : [];
    try {
      if (types.some((value) => typeof value !== 'string') || (body.bio !== undefined && typeof body.bio !== 'string') || (body.service_area !== undefined && typeof body.service_area !== 'string')) throw new IdentityError('PROVIDER_PROFILE_INVALID', 'Provider profile fields are invalid');
      const input = { providerTypes: types as IndividualProviderType[], displayName: typeof body.display_name === 'string' ? body.display_name : '' } as { providerTypes: IndividualProviderType[]; displayName: string; bio?: string; serviceArea?: string };
      if (typeof body.bio === 'string') input.bio = body.bio;
      if (typeof body.service_area === 'string') input.serviceArea = body.service_area;
      return toResponse(await this.store.onboard(principal.userId, input));
    } catch (error) {
      if (error instanceof IdentityError) throw new ConflictException(error.message);
      throw error;
    }
  }

  @Get('verification')
  public async verificationStatus(@Req() request: AuthenticatedRequest) {
    return { case: await this.verification.own(this.requirePrincipal(request).userId), synthetic_intake_available: this.syntheticIntakeEnabled() };
  }

  @Post('verification')
  public async submitVerification(@Req() request: AuthenticatedRequest, @Body() body: { capacity?: unknown; government_id?: unknown; live_selfie?: unknown; idempotency_key?: unknown }) {
    try {
      return await this.verification.submit(this.requirePrincipal(request).userId, {
        capacity: typeof body.capacity === 'string' ? body.capacity : '',
        governmentId: typeof body.government_id === 'string' ? body.government_id : '',
        liveSelfie: typeof body.live_selfie === 'string' ? body.live_selfie : '',
        idempotencyKey: typeof body.idempotency_key === 'string' ? body.idempotency_key : '',
        requestId: randomUUID(),
        syntheticEnabled: this.syntheticIntakeEnabled(),
      });
    } catch (error) {
      if (error instanceof IdentityError) {
        if (error.code === 'EVIDENCE_POLICY_UNAVAILABLE') throw new ServiceUnavailableException(error.code);
        if (error.code === 'RESOURCE_SCOPE_DENIED') throw new ForbiddenException(error.code);
        throw new ConflictException(error.code);
      }
      throw error;
    }
  }

  private requirePrincipal(request: AuthenticatedRequest) { if (!request.principal) throw new UnauthorizedException('Authentication required'); return request.principal; }
  private syntheticIntakeEnabled() { return process.env.NODE_ENV === 'test' || (process.env.NODE_ENV !== 'production' && process.env.PACHI_SYNTHETIC_VERIFICATION_EVIDENCE === 'enabled' && (process.env.VERIFICATION_EVIDENCE_SECRET?.length ?? 0) >= 32); }
}

function toResponse(provider: Awaited<ReturnType<ProviderStore['get']>> & object): ProviderOnboardingResponse { return { profile_id: provider.profileId, account_id: provider.accountId, provider_types: provider.providerTypes, state: provider.state, verification_status: provider.verificationStatus, display_name: provider.displayName, bio: provider.bio, service_area: provider.serviceArea }; }
