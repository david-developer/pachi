import { Module } from '@nestjs/common';
import { createRemoteJWKSet } from 'jose';
import { createDatabase, IdentityStore, PhoneVerificationStore } from '@pachi/database';
import { loadConfig } from './config.js';
import { AccountController } from './account.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { LocalSmsDevelopmentController, LocalSmsSink, PhoneVerificationController, PhoneVerificationService } from './phone.js';
import { ProviderController } from './provider.controller.js';
import { ProviderStore } from '@pachi/database';

const config = loadConfig();
const { client } = createDatabase();
export const authDatabaseClient = client;
const store = new IdentityStore(client);
const phoneStore = new PhoneVerificationStore(client, config.PHONE_OTP_HMAC_SECRET);
const smsProvider = new LocalSmsSink(config.NODE_ENV);
const verifier = config.COGNITO_ISSUER && config.COGNITO_JWKS_URI && config.COGNITO_CLIENT_IDS.length > 0
  ? new CognitoAccessTokenVerifier({
      issuer: config.COGNITO_ISSUER,
      getKey: createRemoteJWKSet(new URL(config.COGNITO_JWKS_URI)),
      allowedClientIds: new Set(config.COGNITO_CLIENT_IDS),
      requiredScopes: new Set(config.AUTH_REQUIRED_SCOPES),
      provider: 'COGNITO'
    })
  : null;

@Module({ controllers: [AuthController, AccountController, PhoneVerificationController, LocalSmsDevelopmentController, ProviderController], providers: [
  { provide: 'IDENTITY_STORE', useValue: store },
  { provide: IdentityStore, useExisting: 'IDENTITY_STORE' },
  { provide: 'PROVIDER_STORE', useValue: new ProviderStore(client) },
  { provide: ProviderStore, useExisting: 'PROVIDER_STORE' },
  { provide: PhoneVerificationStore, useValue: phoneStore },
  { provide: 'SMS_PROVIDER', useValue: smsProvider },
  { provide: LocalSmsSink, useValue: smsProvider },
  { provide: CognitoAccessTokenVerifier, useValue: verifier },
  { provide: 'AUTH_SERVICE', useFactory: () => new AuthService(store, verifier) },
  { provide: AuthService, useExisting: 'AUTH_SERVICE' },
  AuthGuard,
  { provide: 'PHONE_VERIFICATION_SERVICE', useFactory: () => new PhoneVerificationService(phoneStore, smsProvider) },
  { provide: PhoneVerificationService, useExisting: 'PHONE_VERIFICATION_SERVICE' }
], exports: [AuthService] })
export class AuthModule {}
