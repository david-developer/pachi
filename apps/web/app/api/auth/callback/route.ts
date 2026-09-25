import { NextResponse } from 'next/server';
import * as oidc from 'openid-client';
import { bootstrap } from '@/lib/api';
import { oidcConfiguration, redirectUri } from '@/lib/oidc';
import { webSession } from '@/lib/session';
import { webAuthSessionStore } from '@/lib/server-auth';

export async function GET(request: Request) {
  const session = await webSession();
  const url = new URL(request.url);
  if (url.origin !== new URL(redirectUri()).origin || url.pathname !== new URL(redirectUri()).pathname) return NextResponse.json({ error: 'invalid_callback_destination' }, { status: 400 });
  if (!session.oidcState || !session.oidcNonce || !session.pkceVerifier) return NextResponse.redirect(new URL('/?auth_error=missing_transaction', request.url));
  if (url.searchParams.get('error')) return NextResponse.redirect(new URL('/?auth_error=provider', request.url));
  try {
    const configuration = await oidcConfiguration();
    const tokens = await oidc.authorizationCodeGrant(configuration, url, {
      pkceCodeVerifier: session.pkceVerifier,
      expectedState: session.oidcState,
      expectedNonce: session.oidcNonce
    });
    if (!tokens.access_token) throw new Error('missing_access_token');
    const account = await bootstrap(tokens.access_token);
    session.id = await webAuthSessionStore.create(account.user_id, tokens.access_token, tokens.refresh_token, new Date(Date.now() + (tokens.expires_in ?? 300) * 1000));
    session.userId = account.user_id;
    session.accountState = account.account_state;
    session.participationAllowed = account.participation.allowed;
    session.csrfToken = crypto.randomUUID();
    const returnTo = session.returnTo ?? '/';
    delete session.oidcState; delete session.oidcNonce; delete session.pkceVerifier; delete session.returnTo;
    await session.save();
    return NextResponse.redirect(new URL(returnTo, request.url));
  } catch {
    session.destroy();
    return NextResponse.redirect(new URL('/?auth_error=callback', request.url));
  }
}
