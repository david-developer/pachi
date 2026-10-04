import { NextResponse } from 'next/server';
import { csrfValid } from '@/lib/csrf';
import { webAuthSession } from '@/lib/server-auth';
const apiBase = process.env.PACHI_API_URL ?? 'http://localhost:3001';

export async function POST(request: Request, context: { params: Promise<{ listingId: string }> }): Promise<Response> {
  const { listingId } = await context.params;
  const { cookie, auth } = await webAuthSession();
  if (!auth) return NextResponse.json({ error: 'authentication_required' }, { status: 401 });
  if (!(await csrfValid(request, cookie.csrfToken))) return NextResponse.json({ error: 'csrf_rejected' }, { status: 403 });
  const idempotencyKey = request.headers.get('idempotency-key');
  const response = await fetch(`${apiBase}/v1/account/listings/${encodeURIComponent(listingId)}/inquiry`, { method:'POST', headers:{ authorization:`Bearer ${auth.accessToken}`, 'idempotency-key':idempotencyKey ?? '', 'x-request-id':request.headers.get('x-request-id') ?? crypto.randomUUID() }, cache:'no-store' });
  return NextResponse.json(await response.json(), { status: response.status });
}
