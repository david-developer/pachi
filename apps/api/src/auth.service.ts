import { Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityError, IdentityStore, type AuthenticatedPrincipal } from '@pachi/database';
import { CognitoAccessTokenVerifier, TokenVerificationError } from './token-verifier.js';

@Injectable()
export class AuthService {
  public constructor(private readonly store: IdentityStore, private readonly verifier: CognitoAccessTokenVerifier | null) {}

  public async authenticate(authorization: string | undefined, deviceLabel?: string): Promise<AuthenticatedPrincipal> {
    const token = this.bearerToken(authorization);
    if (!this.verifier) throw new UnauthorizedException('Authentication is not configured');
    try {
      console.error(JSON.stringify({ event: 'api_auth_stage', stage: 'token_verification_start' }));
      const claims = await this.verifier.verify(token);
      console.error(JSON.stringify({ event: 'api_auth_stage', stage: 'token_verification_complete', provider: claims.provider }));
      console.error(JSON.stringify({ event: 'api_auth_stage', stage: 'identity_bootstrap_start' }));
      const principal = await this.store.bootstrap(claims, deviceLabel);
      console.error(JSON.stringify({ event: 'api_auth_stage', stage: 'identity_bootstrap_complete' }));
      return principal;
    } catch (error) {
      console.error(JSON.stringify({ event: 'api_auth_stage', stage: 'authentication_failed', error: error instanceof Error ? error.name : 'unknown', code: error instanceof Error && 'code' in error ? error.code : undefined }));
      if (error instanceof TokenVerificationError || error instanceof IdentityError) throw new UnauthorizedException('Authentication failed');
      throw error;
    }
  }

  private bearerToken(authorization: string | undefined): string {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Authentication required');
    const token = authorization.slice('Bearer '.length).trim();
    if (!token || token.length > 16384) throw new UnauthorizedException('Authentication required');
    return token;
  }
}
