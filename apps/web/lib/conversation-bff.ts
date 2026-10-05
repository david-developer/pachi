import { NextResponse } from 'next/server';
import { csrfValid } from './csrf';
import { webAuthSession } from './server-auth';

export async function conversationProxy(
  request: Request,
  resource: string,
  mutation = false
): Promise<Response> {
  const { cookie, auth } = await webAuthSession();
  if (!auth)
    return NextResponse.json(
      { error: 'authentication_required' },
      { status: 401 }
    );
  if (mutation && !(await csrfValid(request, cookie.csrfToken)))
    return NextResponse.json({ error: 'csrf_rejected' }, { status: 403 });
  let body: string | undefined;
  if (mutation) {
    try {
      body = JSON.stringify(await request.json());
    } catch {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
  }
  const query = new URL(request.url).searchParams;
  const safeQuery = new URLSearchParams();
  for (const key of ['cursor', 'limit']) {
    const value = query.get(key);
    if (value !== null) safeQuery.set(key, value);
  }
  try {
    const response = await fetch(
      `${process.env.PACHI_API_URL ?? 'http://localhost:3001'}/v1/account/conversations${resource}${mutation ? '' : `?${safeQuery}`}`,
      {
        method: mutation ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          'content-type': 'application/json',
          'x-request-id':
            request.headers.get('x-request-id') ?? crypto.randomUUID()
        },
        ...(body === undefined ? {} : { body }),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000)
      }
    );
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { 'cache-control': 'private, no-store' }
    });
  } catch {
    return NextResponse.json(
      { error: 'communication_unavailable' },
      { status: 503 }
    );
  }
}
