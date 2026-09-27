import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import * as oidc from "openid-client";
import { StaffAccessError } from "@pachi/database";
import { staffConfig } from "../../../../lib/config";
import {
  configuration,
  verifyAccess,
  attestRequiredTotp,
  freshAuthentication,
  AuthenticationFreshnessError,
} from "../../../../lib/provider";
import { staffCookie, staffStore, revoke } from "../../../../lib/session";
export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  let failureStage = "configuration";
  let verifiedIdentityFingerprint: string | undefined;
  try {
    const c = staffConfig(),
      url = new URL(request.url);
    if (url.origin + url.pathname !== c.callback)
      return NextResponse.json({ error: "INVALID_CALLBACK" }, { status: 400 });
    failureStage = "cookie";
    const cookie = await staffCookie();
    try {
      failureStage = "login_transaction";
      if (
        !cookie.transaction ||
        !cookie.state ||
        !cookie.nonce ||
        !cookie.verifier
      )
        throw new Error("TRANSACTION_REQUIRED");
      const started = await staffStore().consumeLogin(cookie.transaction);
      failureStage = "oidc_discovery";
      const provider = await configuration();
      failureStage = "token_exchange_and_id_validation";
      const tokens = await oidc.authorizationCodeGrant(provider, url, {
        pkceCodeVerifier: cookie.verifier,
        expectedState: cookie.state,
        expectedNonce: cookie.nonce,
        idTokenExpected: true,
      });
      failureStage = "access_token_validation";
      const id = tokens.claims(),
        claims = await verifyAccess(tokens.access_token);
      failureStage = "local_identity_validation";
      if (
        !id ||
        id.sub !== claims.subject ||
        id.identities ||
        !tokens.refresh_token
      )
        throw new Error("LOCAL_IDENTITY_REQUIRED");
      verifiedIdentityFingerprint = createHash("sha256")
        .update(JSON.stringify([claims.issuer, claims.subject])).digest("hex");
      failureStage = "authentication_freshness";
      const authenticatedAt = freshAuthentication(id.auth_time, started);
      await attestRequiredTotp(claims.subject, (stage) => {
        failureStage = stage;
      });
      failureStage = "staff_session_registration";
      const previous = cookie.id;
      const sessionId = await staffStore().register(
        claims,
        authenticatedAt,
        tokens.access_token,
        tokens.refresh_token,
      );
      failureStage = "previous_session_revocation";
      if (previous) await revoke(previous);
      failureStage = "session_cookie_save";
      delete cookie.transaction;
      delete cookie.state;
      delete cookie.nonce;
      delete cookie.verifier;
      cookie.id = sessionId;
      cookie.csrf = crypto.randomUUID();
      await cookie.save();
      console.error(
        JSON.stringify({
          event: "staff_auth",
          stage: "login_complete",
          request_id: requestId,
        }),
      );
      return NextResponse.redirect(new URL("/", c.origin));
    } catch (error) {
      try {
        await staffStore().audit(
          "staff-callback",
          null,
          "staff:login",
          "CALLBACK_OR_MFA_REJECTED",
          "DENIED",
        );
      } catch {
        /* The redacted diagnostic below still records failure if the store is unavailable. */
      }
      delete cookie.transaction;
      delete cookie.state;
      delete cookie.nonce;
      delete cookie.verifier;
      await cookie.save();
      console.error(
        JSON.stringify({
          event: "staff_auth",
          stage: "login_rejected",
          failure_stage: failureStage,
          observed_at: new Date().toISOString(),
          verified_identity_sha256: verifiedIdentityFingerprint,
          ...(error instanceof AuthenticationFreshnessError ? {
            reason: error.reason,
            auth_age_seconds: error.ageSeconds,
            auth_transaction_delta_seconds: error.transactionDeltaSeconds,
          } : {}),
          request_id: requestId,
          category:
            error instanceof StaffAccessError
              ? error.code === "RESOURCE_SCOPE_DENIED"
                ? "grant_denied"
                : "staff_session_rejected"
              : "stage_failed",
        }),
      );
      return NextResponse.redirect(
        new URL(
          `/?auth_error=${error instanceof StaffAccessError && error.code === "RESOURCE_SCOPE_DENIED" ? "access_denied" : "mfa_or_callback"}`,
          c.origin,
        ),
      );
    }
  } catch {
    return NextResponse.json({ error: "STAFF_CONFIGURATION" }, { status: 503 });
  }
}
