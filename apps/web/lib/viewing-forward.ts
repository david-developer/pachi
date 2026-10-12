import { csrfValid } from './csrf';

const safeCodes = new Set(['REQUEST_EXPIRED', 'APPOINTMENT_PAST', 'STALE_VERSION', 'STALE_SCHEDULE_VERSION',
  'ACTIVE_VIEWING_EXISTS', 'IDEMPOTENCY_KEY_REUSED', 'INVALID_INPUT', 'INVALID_STATE', 'CAPABILITY_RESTRICTED', 'RESOURCE_SCOPE_DENIED', 'STALE_PROPOSAL_VERSION', 'PENDING_PROPOSAL_EXISTS', 'PROPOSAL_EXPIRED']);

/** Callers select fixed viewing paths; the API resolves all participant authority. */
export async function forwardViewingRequest(
  request: Request,
  path: string,
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
  const queryKeys=path==='viewings'?['interaction_id','cursor','limit']:path==='viewing-notices'?['viewing_id','cursor','limit']:/^viewings\/[^/]+\/reschedules$/.test(path)?['cursor','limit']:[];
  if (!mutation && queryKeys.length) {
    const supplied = new URL(request.url).searchParams;
    for (const key of queryKeys) {
      const value = supplied.get(key);
      if (value !== null) query.set(key, value);
    }
  }
  try {
    const response = await fetch(
      `${process.env.PACHI_API_URL ?? 'http://localhost:3001'}/v1/account/${path}${query.size ? `?${query}` : ''}`,
      {
        method: mutation ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          'content-type': 'application/json',
          'x-request-id': crypto.randomUUID(),
          ...(mutation ? { 'idempotency-key': request.headers.get('idempotency-key') ?? '' } : {})
        },
        ...(body === undefined ? {} : { body }),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000)
      }
    );
    const result = await response.json() as Record<string, unknown>;
    return Response.json(
      response.ok ? result : {
        error: response.status === 409 ? 'request_conflict' :
          response.status === 400 ? 'invalid_request' :
            response.status === 401 ? 'authentication_required' : 'viewing_unavailable',
        ...(typeof result.code === 'string' && safeCodes.has(result.code) ? { code: result.code } : {})
      },
      { status: response.status, headers }
    );
  } catch {
    return Response.json({ error: 'viewing_unavailable' }, { status: 503, headers });
  }
}
