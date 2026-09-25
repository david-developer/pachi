import { NextResponse } from 'next/server';
import { requestPhone } from '@/lib/api';
import { csrfValid } from '@/lib/csrf';
import { webAuthSession } from '@/lib/server-auth';

export async function POST(request: Request) {
  const { cookie, auth } = await webAuthSession();
  if (!(await csrfValid(request, cookie.csrfToken))) return NextResponse.json({ error: 'csrf_rejected' }, { status: 403 });
  if (!auth) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json() as { phone?: unknown };
  if (typeof body.phone !== 'string') return NextResponse.json({ error: 'phone_required' }, { status: 400 });
  try { return NextResponse.json(await requestPhone(auth.accessToken, body.phone)); }
  catch { return NextResponse.json({ error: 'phone_request_failed' }, { status: 400 }); }
}
