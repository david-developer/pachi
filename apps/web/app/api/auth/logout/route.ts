import { NextResponse } from 'next/server';
import * as oidc from 'openid-client';
import { revokeSession } from '@/lib/api';
import { webAuthSession, webAuthSessionStore } from '@/lib/server-auth';
import { csrfValid } from '@/lib/csrf';
import { cognitoLogoutUrl, oidcConfigured, oidcConfiguration } from '@/lib/oidc';

export async function POST(request: Request) {
  const { cookie, auth } = await webAuthSession();
  if (!(await csrfValid(request, cookie.csrfToken))) return NextResponse.json({ error: 'csrf_rejected' }, { status: 403 });
  if (auth) {
    try { await revokeSession(auth.accessToken, new URL(request.url).searchParams.get('all') === 'true'); } catch {}
    if (auth.refreshToken && oidcConfigured()) { try { await oidc.tokenRevocation(await oidcConfiguration(), auth.refreshToken); } catch {} }
    await webAuthSessionStore.revoke(auth.id);
  }
  cookie.destroy();
  const logoutUrl = cognitoLogoutUrl();
  if (logoutUrl) return NextResponse.json({ status: 'ok', logout_url: logoutUrl });
  return NextResponse.json({ status: 'ok' });
}
