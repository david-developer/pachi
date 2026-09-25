import { NextResponse } from 'next/server';
import { webAuthSession } from '@/lib/server-auth';

export async function GET() {
  const { cookie, auth } = await webAuthSession();
  if (!cookie.userId || !auth) return NextResponse.json({ authenticated: false });
  if (auth.expiresAt <= new Date()) {
    cookie.destroy();
    return NextResponse.json({ authenticated: false, expired: true });
  }
  if (!cookie.csrfToken) { cookie.csrfToken = crypto.randomUUID(); await cookie.save(); }
  return NextResponse.json({ authenticated: true, userId: cookie.userId, accountState: cookie.accountState, participationAllowed: cookie.participationAllowed, csrfToken: cookie.csrfToken });
}
