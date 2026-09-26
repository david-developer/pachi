import { NextResponse } from 'next/server';
import * as oidc from 'openid-client';
import { staffConfig } from '../../../../lib/config';
import { configuration, STAFF_SCOPE } from '../../../../lib/provider';
import { staffCookie, staffStore, validOrigin } from '../../../../lib/session';
export async function POST(request: Request) {
  try {
    const c = staffConfig();
    if (!validOrigin(request))
      return NextResponse.json({ error: 'CSRF_REJECTED' }, { status: 403 });
    const cookie = await staffCookie();
    cookie.transaction = await staffStore().beginLogin();
    cookie.state = oidc.randomState();
    cookie.nonce = oidc.randomNonce();
    cookie.verifier = oidc.randomPKCECodeVerifier();
    await cookie.save();
    const url = oidc.buildAuthorizationUrl(await configuration(), {
      redirect_uri: c.callback,
      response_type: 'code',
      scope: STAFF_SCOPE,
      state: cookie.state,
      nonce: cookie.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(cookie.verifier),
      code_challenge_method: 'S256',
      prompt: 'login',
      identity_provider: 'COGNITO',
    });
    return NextResponse.redirect(url, 303);
  } catch {
    return NextResponse.redirect(new URL('/?auth_error=configuration', request.url), 303);
  }
}
