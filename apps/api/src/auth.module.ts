import { OrganizationAccessStore } from '@pachi/database';
import { OrganizationSettingsGuard } from './organization.guard.js';
import { StaffStore } from '@pachi/database';
import { StaffController, StaffAuthService } from './staff.controller.js';
import { Module } from '@nestjs/common';
import { createRemoteJWKSet } from 'jose';
import { AuthorityRiskStore, createDatabase, IdentityStore, ListingMediaStore, ListingModerationStore, ListingPhotoReviewStore, ListingSubmissionStore, PhoneVerificationStore, PropertyDraftStore, PublicListingStore } from '@pachi/database';
import { ClamAvScanner, LocalPrivateMediaStorage } from '@pachi/media';
import { loadConfig } from './config.js';
import { AccountController } from './account.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CognitoAccessTokenVerifier } from './token-verifier.js';
import { LocalSmsDevelopmentController, LocalSmsSink, PhoneVerificationController, PhoneVerificationService } from './phone.js';
import { ProviderController } from './provider.controller.js';
import { ProviderStore } from '@pachi/database';
import { PropertyController } from './property.controller.js';
import { ProviderVerificationStore } from '@pachi/database';
import { StaffVerificationController } from './staff-verification.controller.js';
import { StaffListingPhotoController } from './staff-listing-photo.controller.js';
import { StaffListingModerationController } from './staff-listing-moderation.controller.js';
import { PublicListingController } from './public-listing.controller.js';
import { StaffAuthorityRiskController } from './staff-authority-risk.controller.js';

const config = loadConfig();
const { client } = createDatabase();
export const authDatabaseClient = client;
const store = new IdentityStore(client);
const phoneStore = new PhoneVerificationStore(client, config.PHONE_OTP_HMAC_SECRET);
const mediaStore = new ListingMediaStore(client);
const listingSubmissionStore = new ListingSubmissionStore(client, config.NODE_ENV === 'test');
const authorityRiskStore = new AuthorityRiskStore(client);
const providerVerificationStore = new ProviderVerificationStore(client, config.NODE_ENV === 'test' ? 'synthetic-test-only-provider-evidence-secret' : process.env.VERIFICATION_EVIDENCE_SECRET ?? '', config.NODE_ENV === 'test');
const mediaStorage = new LocalPrivateMediaStorage(config.MEDIA_STORAGE_ROOT);
const mediaScanner = new ClamAvScanner(config.CLAMAV_HOST, config.CLAMAV_PORT);
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

const staffVerifier = config.STAFF_COGNITO_ISSUER && config.STAFF_COGNITO_CLIENT_ID ? new CognitoAccessTokenVerifier({issuer:config.STAFF_COGNITO_ISSUER,getKey:createRemoteJWKSet(new URL(`${config.STAFF_COGNITO_ISSUER}/.well-known/jwks.json`)),allowedClientIds:new Set([config.STAFF_COGNITO_CLIENT_ID]),requiredScopes:new Set(['pachi/staff']),provider:'COGNITO',strictStaff:true,...(config.STAFF_API_AUDIENCE ? {audience:config.STAFF_API_AUDIENCE} : {})}) : null;

@Module({ controllers: [StaffController, StaffVerificationController, StaffListingPhotoController, StaffListingModerationController, StaffAuthorityRiskController, PublicListingController, AuthController, AccountController, PhoneVerificationController, LocalSmsDevelopmentController, ProviderController, PropertyController], providers: [
  { provide: 'STAFF_AUTH_SERVICE', useValue: new StaffAuthService(new StaffStore(client), staffVerifier) },
  { provide: 'IDENTITY_STORE', useValue: store },
  { provide: IdentityStore, useExisting: 'IDENTITY_STORE' },
  { provide: 'PROVIDER_STORE', useValue: new ProviderStore(client) },
  { provide: 'PROVIDER_VERIFICATION_STORE', useValue: providerVerificationStore },
  { provide: ProviderStore, useExisting: 'PROVIDER_STORE' },
  { provide: 'PROPERTY_DRAFT_STORE', useValue: new PropertyDraftStore(client) },
  { provide: 'LISTING_MEDIA_STORE', useValue: mediaStore },
  { provide: 'LISTING_PHOTO_REVIEW_STORE', useValue: new ListingPhotoReviewStore(client) },
  { provide: 'LISTING_MODERATION_STORE', useValue: new ListingModerationStore(client, listingSubmissionStore) },
  { provide: 'PUBLIC_LISTING_STORE', useValue: new PublicListingStore(client) },
  { provide: ListingMediaStore, useExisting: 'LISTING_MEDIA_STORE' },
  { provide: 'LISTING_SUBMISSION_STORE', useValue: listingSubmissionStore },
  { provide: 'AUTHORITY_RISK_STORE', useValue: authorityRiskStore },
  { provide: ListingSubmissionStore, useExisting: 'LISTING_SUBMISSION_STORE' },
  { provide: 'LOCAL_PRIVATE_MEDIA_STORAGE', useValue: mediaStorage },
  { provide: LocalPrivateMediaStorage, useExisting: 'LOCAL_PRIVATE_MEDIA_STORAGE' },
  { provide: 'MEDIA_SCANNER', useValue: mediaScanner },
  { provide: ClamAvScanner, useExisting: 'MEDIA_SCANNER' },
  { provide: PropertyDraftStore, useExisting: 'PROPERTY_DRAFT_STORE' },
  { provide: PhoneVerificationStore, useValue: phoneStore },
  { provide: 'SMS_PROVIDER', useValue: smsProvider },
  { provide: LocalSmsSink, useValue: smsProvider },
  { provide: CognitoAccessTokenVerifier, useValue: verifier },
  { provide: 'AUTH_SERVICE', useFactory: () => new AuthService(store, verifier) },
  { provide: AuthService, useExisting: 'AUTH_SERVICE' },
  AuthGuard,
  OrganizationSettingsGuard,
  { provide: 'ORGANIZATION_ACCESS_STORE', useValue: new OrganizationAccessStore(client) },
  { provide: 'PHONE_VERIFICATION_SERVICE', useFactory: () => new PhoneVerificationService(phoneStore, smsProvider) },
  { provide: PhoneVerificationService, useExisting: 'PHONE_VERIFICATION_SERVICE' }
], exports: [AuthService, 'AUTH_SERVICE', 'ORGANIZATION_ACCESS_STORE', AuthGuard, OrganizationSettingsGuard] })
export class AuthModule {}
