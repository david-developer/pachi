import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { IdentityProvider, VerifiedTokenClaims } from '@pachi/database';

export type TokenVerifierOptions = {
  issuer: string;
  getKey: JWTVerifyGetKey;
  allowedClientIds: ReadonlySet<string>;
  requiredScopes: ReadonlySet<string>;
  provider: IdentityProvider;
};

export class TokenVerificationError extends Error {
  public constructor(public readonly code: string, message: string) { super(message); }
}

export class CognitoAccessTokenVerifier {
  public constructor(private readonly options: TokenVerifierOptions) {}

  public async verify(token: string): Promise<VerifiedTokenClaims> {
    let payload;
    try {
      const result = await jwtVerify(token, this.options.getKey, {
        issuer: this.options.issuer,
        algorithms: ['RS256']
      });
      payload = result.payload;
    } catch {
      throw new TokenVerificationError('INVALID_TOKEN', 'The access token is invalid');
    }

    if (payload.token_use !== 'access') throw new TokenVerificationError('INVALID_TOKEN_TYPE', 'Only access tokens are accepted');
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new TokenVerificationError('INVALID_SUBJECT', 'The token subject is invalid');
    if (typeof payload.client_id !== 'string' || !this.options.allowedClientIds.has(payload.client_id)) throw new TokenVerificationError('INVALID_CLIENT', 'The token client is not allowed');
    if (typeof payload.origin_jti !== 'string' || typeof payload.jti !== 'string') throw new TokenVerificationError('INVALID_SESSION_CLAIMS', 'The token session claims are invalid');

    const scopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : [];
    for (const requiredScope of this.options.requiredScopes) {
      if (!scopes.includes(requiredScope)) throw new TokenVerificationError('MISSING_SCOPE', 'The token lacks a required scope');
    }

    return {
      issuer: this.options.issuer,
      subject: payload.sub,
      clientId: payload.client_id,
      originJti: payload.origin_jti,
      jti: payload.jti,
      expiresAt: new Date((payload.exp ?? 0) * 1000),
      issuedAt: new Date((payload.iat ?? Math.floor(Date.now() / 1000)) * 1000),
      scopes,
      provider: this.options.provider
    };
  }
}
