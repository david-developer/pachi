import { Module } from '@nestjs/common';
import { createRemoteJWKSet } from 'jose';
import { createDatabase, IdentityStore } from '@pachi/database';
import { loadConfig } from './config.js';
import { AccountController } from './account.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';

const config = loadConfig();
const { client } = createDatabase();
const store = new IdentityStore(client);
const verifier = config.COGNITO_ISSUER && config.COGNITO_JWKS_URI && config.COGNITO_CLIENT_IDS.length > 0
  ? new CognitoAccessTokenVerifier({
      issuer: config.COGNITO_ISSUER,
      getKey: createRemoteJWKSet(new URL(config.COGNITO_JWKS_URI)),
      allowedClientIds: new Set(config.COGNITO_CLIENT_IDS),
      requiredScopes: new Set(config.AUTH_REQUIRED_SCOPES),
      provider: 'COGNITO'
    })
  : null;

@Module({ controllers: [AuthController, AccountController], providers: [
  { provide: IdentityStore, useValue: store },
  { provide: CognitoAccessTokenVerifier, useValue: verifier },
  { provide: AuthService, useFactory: () => new AuthService(store, verifier) },
  AuthGuard
], exports: [AuthService] })
export class AuthModule {}
