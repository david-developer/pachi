import { NextResponse } from 'next/server';
import * as oidc from 'openid-client';
import { webSession } from '@/lib/session';
import { oidcConfigured, oidcConfiguration, redirectUri, safeReturnTo, WEB_AUTH_SCOPE } from '@/lib/oidc';

export async function GET(request: Request) {
  if (!oidcConfigured()) return NextResponse.redirect(new URL('/?auth_error=configuration', request.url));
  const session = await webSession();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  session.oidcState = state;
  session.oidcNonce = nonce;
  session.pkceVerifier = codeVerifier;
  session.returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
  await session.save();
  const configuration = await oidcConfiguration();
  const authorizationUrl = oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: redirectUri(), response_type: 'code', scope: WEB_AUTH_SCOPE, state, nonce,
    code_challenge: codeChallenge, code_challenge_method: 'S256'
  });
  return NextResponse.redirect(authorizationUrl);
}
