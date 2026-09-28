import { NextResponse } from 'next/server';
import { confirmPhone } from '@/lib/api';
import { csrfValid } from '@/lib/csrf';
import { webAuthSession } from '@/lib/server-auth';

export async function POST(request: Request) {
  const { cookie, auth } = await webAuthSession();
  if (!(await csrfValid(request, cookie.csrfToken))) return NextResponse.json({ error: 'csrf_rejected' }, { status: 403 });
  if (!auth) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json() as { phone?: unknown; challenge_id?: unknown; code?: unknown };
  if (typeof body.phone !== 'string' || typeof body.challenge_id !== 'string' || typeof body.code !== 'string') return NextResponse.json({ error: 'verification_fields_required' }, { status: 400 });
  try {
    const result = await confirmPhone(auth.accessToken, body.phone, body.challenge_id, body.code);
    if (result.activated) { cookie.accountState = 'ACTIVE'; cookie.participationAllowed = true; }
    await cookie.save();
    return NextResponse.json(result);
  } catch { return NextResponse.json({ error: 'phone_confirmation_failed' }, { status: 400 }); }
}
