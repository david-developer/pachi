import { NextResponse } from 'next/server';
import * as oidc from 'openid-client';
import { StaffAccessError } from '@pachi/database';
import { staffConfig } from '../../../../lib/config';
import {
  configuration,
  verifyAccess,
  attestRequiredTotp,
  freshAuthentication,
} from '../../../../lib/provider';
import { staffCookie, staffStore, revoke } from '../../../../lib/session';
export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const c = staffConfig(),
      url = new URL(request.url);
    if (url.origin + url.pathname !== c.callback)
      return NextResponse.json({ error: 'INVALID_CALLBACK' }, { status: 400 });
    const cookie = await staffCookie();
    try {
      if (!cookie.transaction || !cookie.state || !cookie.nonce || !cookie.verifier)
        throw new Error('TRANSACTION_REQUIRED');
      const started = await staffStore().consumeLogin(cookie.transaction);
      const tokens = await oidc.authorizationCodeGrant(await configuration(), url, {
        pkceCodeVerifier: cookie.verifier,
        expectedState: cookie.state,
        expectedNonce: cookie.nonce,
        idTokenExpected: true,
      });
      const id = tokens.claims(),
        claims = await verifyAccess(tokens.access_token);
      if (!id || id.sub !== claims.subject || id.identities || !tokens.refresh_token)
        throw new Error('LOCAL_IDENTITY_REQUIRED');
      const authenticatedAt = freshAuthentication(id.auth_time, started);
      await attestRequiredTotp(claims.subject);
      const previous = cookie.id;
      const sessionId = await staffStore().register(
        claims,
        authenticatedAt,
        tokens.access_token,
        tokens.refresh_token,
      );
      if (previous) await revoke(previous);
      delete cookie.transaction;
      delete cookie.state;
      delete cookie.nonce;
      delete cookie.verifier;
      cookie.id = sessionId;
      cookie.csrf = crypto.randomUUID();
      await cookie.save();
      console.error(
        JSON.stringify({ event: 'staff_auth', stage: 'login_complete', request_id: requestId }),
      );
      return NextResponse.redirect(new URL('/', c.origin));
    } catch (error) {
      try {
        await staffStore().audit(
          'staff-callback',
          null,
          'staff:login',
          'CALLBACK_OR_MFA_REJECTED',
          'DENIED',
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
        JSON.stringify({ event: 'staff_auth', stage: 'login_rejected', request_id: requestId }),
      );
      return NextResponse.redirect(
        new URL(
          `/?auth_error=${error instanceof StaffAccessError && error.code === 'RESOURCE_SCOPE_DENIED' ? 'access_denied' : 'mfa_or_callback'}`,
          c.origin,
        ),
      );
    }
  } catch {
    return NextResponse.json({ error: 'STAFF_CONFIGURATION' }, { status: 503 });
  }
}
