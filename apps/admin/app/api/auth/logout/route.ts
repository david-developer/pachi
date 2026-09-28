import { NextResponse } from 'next/server';
import { staffCookie, validCsrf, revoke } from '../../../../lib/session';
import { staffConfig } from '../../../../lib/config';
export async function POST(request: Request) {
  const cookie = await staffCookie();
  if (!validCsrf(request, cookie.csrf))
    return NextResponse.json({ error: 'CSRF_REJECTED' }, { status: 403 });
  if (cookie.id) await revoke(cookie.id);
  cookie.destroy();
  const c = staffConfig(),
    url = new URL('/logout', c.domain);
  url.searchParams.set('client_id', c.clientId);
  url.searchParams.set('logout_uri', c.origin);
  return NextResponse.json({ logout_url: url.toString() });
}
