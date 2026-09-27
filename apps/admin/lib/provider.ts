import * as oidc from "openid-client";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  DescribeUserPoolClientCommand,
  GetUserPoolMfaConfigCommand,
  DescribeUserPoolDomainCommand,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { VerifiedTokenClaims } from "@pachi/database";
import { staffConfig } from "./config";
export const STAFF_SCOPE = "openid email pachi/staff";
export async function configuration() {
  const c = staffConfig();
  const config = await oidc.discovery(
    new URL(c.issuer),
    c.clientId,
    c.clientSecret,
  );
  config.timeout = 10;
  oidc.enableNonRepudiationChecks(config);
  return config;
}
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function verifyAccess(
  token: string,
): Promise<VerifiedTokenClaims> {
  const c = staffConfig();
  let key = keys.get(c.issuer);
  if (!key) {
    key = createRemoteJWKSet(new URL(`${c.issuer}/.well-known/jwks.json`));
    keys.set(c.issuer, key);
  }
  const { payload: p } = await jwtVerify(token, key, {
    issuer: c.issuer,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub"],
  });
  if (
    p.token_use !== "access" ||
    p.client_id !== c.clientId ||
    typeof p.origin_jti !== "string" ||
    !p.origin_jti ||
    typeof p.jti !== "string" ||
    !p.jti ||
    (p.aud !== undefined && p.aud !== c.api) ||
    typeof p.scope !== "string" ||
    !p.scope.split(" ").includes("pachi/staff")
  )
    throw new Error("STAFF_TOKEN");
  return {
    issuer: c.issuer,
    subject: p.sub!,
    clientId: c.clientId,
    originJti: p.origin_jti,
    jti: p.jti,
    expiresAt: new Date(p.exp! * 1000),
    issuedAt: new Date(p.iat! * 1000),
    scopes: p.scope.split(" "),
    provider: "COGNITO",
  };
}
export function awsClient() {
  return new CognitoIdentityProviderClient({
    region: staffConfig().region,
    maxAttempts: 2,
  });
}
export async function verifiedLocalUser(subject: string) {
  const c = staffConfig();
  return awsClient().send(
    new AdminGetUserCommand({ UserPoolId: c.poolId, Username: subject }),
    {
      abortSignal: AbortSignal.timeout(10_000),
    },
  );
}
export class AuthenticationFreshnessError extends Error {
  constructor(
    public readonly reason: "AUTH_TIME_INVALID" | "AUTH_TIME_BEFORE_TRANSACTION" | "AUTH_TIME_IN_FUTURE" | "AUTH_TIME_TOO_OLD",
    public readonly ageSeconds?: number,
    public readonly transactionDeltaSeconds?: number,
  ) { super("MFA_UNPROVEN"); }
}
export function freshAuthentication(
  authTime: unknown,
  started: Date,
  now = new Date(),
): Date {
  if (typeof authTime !== "number" || !Number.isSafeInteger(authTime))
    throw new AuthenticationFreshnessError("AUTH_TIME_INVALID");
  const age = Math.floor(+now / 1000) - authTime;
  const delta = authTime - Math.floor(+started / 1000);
  if (delta < 0) throw new AuthenticationFreshnessError("AUTH_TIME_BEFORE_TRANSACTION", age, delta);
  if (authTime > Math.floor(+now / 1000)) throw new AuthenticationFreshnessError("AUTH_TIME_IN_FUTURE", age, delta);
  if (+now - authTime * 1000 > 600_000) throw new AuthenticationFreshnessError("AUTH_TIME_TOO_OLD", age, delta);
  return new Date(authTime * 1000);
}
// Trust comes from inspected REQUIRED/TOTP-only pool policy + a fresh verified
// local OIDC authentication, never from an invented amr claim or browser flag.
export async function attestRequiredTotp(
  subject: string,
  onStage: (
    stage:
      | "aws_credential_resolution"
      | "aws_policy_reads"
      | "mfa_policy_validation",
  ) => void = () => {},
): Promise<void> {
  const c = staffConfig(),
    aws = awsClient(),
    options = { abortSignal: AbortSignal.timeout(10_000) };
  onStage("aws_credential_resolution");
  await aws.config.credentials();
  onStage("aws_policy_reads");
  const [pool, mfa, client, domain, user] = await Promise.all([
    aws.send(new DescribeUserPoolCommand({ UserPoolId: c.poolId }), options),
    aws.send(
      new GetUserPoolMfaConfigCommand({ UserPoolId: c.poolId }),
      options,
    ),
    aws.send(
      new DescribeUserPoolClientCommand({
        UserPoolId: c.poolId,
        ClientId: c.clientId,
      }),
      options,
    ),
    aws.send(
      new DescribeUserPoolDomainCommand({
        Domain: new URL(c.domain).hostname.endsWith(".amazoncognito.com")
          ? new URL(c.domain).hostname.split(".")[0]!
          : new URL(c.domain).hostname,
      }),
      options,
    ),
    verifiedLocalUser(subject),
  ]);
  onStage("mfa_policy_validation");
  assertProviderPolicy(
    {
      pool: pool.UserPool,
      mfa,
      client: client.UserPoolClient,
      domain: domain.DomainDescription,
      user,
    },
    c,
    subject,
  );
}
type OptionalUndefined<T> =
  T extends Array<infer U>
    ? OptionalUndefined<U>[]
    : T extends object
      ? { [K in keyof T]: OptionalUndefined<T[K]> | undefined }
      : T;
type Snapshots = OptionalUndefined<{
  pool?: {
    MfaConfiguration?: string;
    DeviceConfiguration?: unknown;
    AdminCreateUserConfig?: { AllowAdminCreateUserOnly?: boolean };
    Policies?: {
      PasswordPolicy?: { MinimumLength?: number };
      SignInPolicy?: { AllowedFirstAuthFactors?: string[] };
    };
  };
  mfa: {
    MfaConfiguration?: string;
    SoftwareTokenMfaConfiguration?: { Enabled?: boolean };
    SmsMfaConfiguration?: unknown;
    EmailMfaConfiguration?: unknown;
  };
  client?: {
    ClientId?: string;
    ClientSecret?: string;
    SupportedIdentityProviders?: string[];
    AllowedOAuthFlows?: string[];
    AllowedOAuthFlowsUserPoolClient?: boolean;
    AllowedOAuthScopes?: string[];
    CallbackURLs?: string[];
    LogoutURLs?: string[];
    EnableTokenRevocation?: boolean;
    RefreshTokenRotation?: {
      Feature?: string;
      RetryGracePeriodSeconds?: number;
    };
    ExplicitAuthFlows?: string[];
    AccessTokenValidity?: number;
    TokenValidityUnits?: { AccessToken?: string };
  };
  domain?: { UserPoolId?: string; ManagedLoginVersion?: number };
  user: {
    Enabled?: boolean;
    UserStatus?: string;
    UserAttributes?: { Name?: string; Value?: string }[];
    UserMFASettingList?: string[];
  };
}>;
export function assertProviderPolicy(
  s: Snapshots,
  c: {
    poolId: string;
    clientId: string;
    clientSecret: string;
    callback: string;
    origin: string;
  },
  subject: string,
) {
  const p = s.pool,
    m = s.mfa,
    a = s.client,
    u = s.user;
  if (!m || !u) throw new Error("MFA_UNPROVEN");
  if (
    !p ||
    !a ||
    p.MfaConfiguration !== "ON" ||
    m.MfaConfiguration !== "ON" ||
    !m.SoftwareTokenMfaConfiguration?.Enabled ||
    m.SmsMfaConfiguration ||
    m.EmailMfaConfiguration ||
    p.DeviceConfiguration ||
    !p.AdminCreateUserConfig?.AllowAdminCreateUserOnly ||
    (p.Policies?.PasswordPolicy?.MinimumLength ?? 0) < 12 ||
    p.Policies?.SignInPolicy?.AllowedFirstAuthFactors?.join(",") !==
      "PASSWORD" ||
    s.domain?.UserPoolId !== c.poolId ||
    s.domain.ManagedLoginVersion !== 2 ||
    a.ClientId !== c.clientId ||
    a.ClientSecret !== c.clientSecret ||
    a.SupportedIdentityProviders?.join(",") !== "COGNITO" ||
    a.AllowedOAuthFlows?.join(",") !== "code" ||
    !a.AllowedOAuthFlowsUserPoolClient ||
    !a.AllowedOAuthScopes?.includes("pachi/staff") ||
    a.CallbackURLs?.join(",") !== c.callback ||
    a.LogoutURLs?.join(",") !== c.origin ||
    !a.EnableTokenRevocation ||
    a.RefreshTokenRotation?.Feature !== "ENABLED" ||
    a.RefreshTokenRotation.RetryGracePeriodSeconds !== 10 ||
    a.ExplicitAuthFlows?.join(",") !== "ALLOW_USER_SRP_AUTH" ||
    a.AccessTokenValidity !== 5 ||
    a.TokenValidityUnits?.AccessToken !== "minutes" ||
    !u.Enabled ||
    u.UserStatus !== "CONFIRMED" ||
    u.UserAttributes?.find((v) => v.Name === "sub")?.Value !== subject ||
    u.UserAttributes?.some((v) => v.Name === "identities") ||
    u.UserMFASettingList?.join(",") !== "SOFTWARE_TOKEN_MFA"
  )
    throw new Error("MFA_UNPROVEN");
}
