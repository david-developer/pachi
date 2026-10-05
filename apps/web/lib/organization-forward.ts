import { csrfValid } from './csrf';

// Kept separate from cookie access so the security boundary can be tested without
// a running Next server. Callers provide only server-read session credentials.
export async function forwardOrganizationRequest(
  request: Request,
  apiPath: string,
  session: { accessToken?: string | undefined; csrfToken?: string | undefined },
  mutation = false
): Promise<Response> {
  const headers = { 'cache-control': 'private, no-store' };
  if (!session.accessToken)
    return Response.json({ error: 'authentication_required' }, { status: 401, headers });
  if (mutation && !(await csrfValid(request, session.csrfToken)))
    return Response.json({ error: 'csrf_rejected' }, { status: 403, headers });
  let body: string | undefined;
  if (mutation) {
    try { body = JSON.stringify(await request.json()); }
    catch { return Response.json({ error: 'invalid_request' }, { status: 400, headers }); }
  }
  const query = new URLSearchParams();
  if (!mutation) {
    for (const key of ['cursor', 'limit']) {
      const value = new URL(request.url).searchParams.get(key);
      if (value !== null) query.set(key, value);
    }
  }
  try {
    const response = await fetch(
      `${process.env.PACHI_API_URL ?? 'http://localhost:3001'}/v1/account/${apiPath}${query.size ? `?${query}` : ''}`,
      {
        method: mutation ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          'content-type': 'application/json',
          'x-request-id': request.headers.get('x-request-id') ?? crypto.randomUUID(),
          ...(mutation ? { 'idempotency-key': request.headers.get('idempotency-key') ?? '' } : {})
        },
        ...(body === undefined ? {} : { body }),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000)
      }
    );
    // Backend error text is not a browser projection, particularly for token
    // commands. Status is sufficient for safe, actionable client feedback.
    let projection: unknown;
    if (response.ok) projection = await response.json();
    else {
      const failure = await response.json().catch(() => null) as { message?: unknown } | null;
      projection = { error: failure?.message === 'DELIVERY_UNAVAILABLE' ? 'delivery_unavailable' : 'organization_request_failed' };
    }
    return Response.json(projection, {
      status: response.status, headers
    });
  } catch {
    return Response.json({ error: 'organization_unavailable' }, { status: 503, headers });
  }
}
