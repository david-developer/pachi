import { NextResponse } from 'next/server';
import { staffAccess, staffCookie, validCsrf } from './session';
import { staffConfig } from './config';

export async function verificationProxy(path: string, request?: Request): Promise<NextResponse> {
  const cookie = await staffCookie();
  if (!cookie.id) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (request?.method === 'POST' && !validCsrf(request, cookie.csrf)) return NextResponse.json({ error: 'CSRF_REJECTED' }, { status: 403 });
  try {
    const token = await staffAccess(cookie.id);
    const response = await fetch(`${staffConfig().api}/v1/staff/verification-cases/${path}`, { method: request?.method ?? 'GET', headers: { authorization: `Bearer ${token}`, ...(request?.method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(request?.method === 'POST' ? { body: await request.text() } : {}), cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    return NextResponse.json(await response.json(), { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }
}
