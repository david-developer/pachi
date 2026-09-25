import { NextResponse } from 'next/server';
import { revokeSession } from '@/lib/api';
import { webAuthSession, webAuthSessionStore } from '@/lib/server-auth';
import { sameOrigin } from '@/lib/csrf';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'csrf_rejected' }, { status: 403 });
  const { cookie, auth } = await webAuthSession();
  if (auth) {
    try { await revokeSession(auth.accessToken, new URL(request.url).searchParams.get('all') === 'true'); } catch {}
    await webAuthSessionStore.revoke(auth.id);
  }
  cookie.destroy();
  const logoutUrl = process.env.COGNITO_LOGOUT_URI;
  if (logoutUrl && process.env.COGNITO_CLIENT_ID) {
    const destination = new URL(logoutUrl);
    destination.searchParams.set('client_id', process.env.COGNITO_CLIENT_ID);
    destination.searchParams.set('logout_uri', new URL('/', request.url).toString());
    return NextResponse.redirect(destination);
  }
  return NextResponse.json({ status: 'ok' });
}
