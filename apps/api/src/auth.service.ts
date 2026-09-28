import { UnauthorizedException } from '@nestjs/common';
import { IdentityError, IdentityStore, type AuthenticatedPrincipal } from '@pachi/database';
import { CognitoAccessTokenVerifier, TokenVerificationError } from './token-verifier.js';

export class AuthService {
  public constructor(private readonly store: IdentityStore, private readonly verifier: CognitoAccessTokenVerifier | null) {}

  public async authenticate(authorization: string | undefined, deviceLabel?: string): Promise<AuthenticatedPrincipal> {
    const token = this.bearerToken(authorization);
    if (!this.verifier) throw new UnauthorizedException('Authentication is not configured');
    try {
      const claims = await this.verifier.verify(token);
      return await this.store.bootstrap(claims, deviceLabel);
    } catch (error) {
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
