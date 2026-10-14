import { csrfValid } from './csrf';

const safeCodes = new Set(['REQUEST_EXPIRED', 'APPOINTMENT_PAST', 'STALE_VERSION', 'STALE_SCHEDULE_VERSION',
  'ACTIVE_VIEWING_EXISTS', 'IDEMPOTENCY_KEY_REUSED', 'INVALID_INPUT', 'INVALID_STATE', 'CAPABILITY_RESTRICTED', 'RESOURCE_SCOPE_DENIED', 'STALE_PROPOSAL_VERSION', 'PENDING_PROPOSAL_EXISTS', 'PROPOSAL_EXPIRED', 'STALE_CLAIM_VERSION', 'CLAIM_TOO_EARLY', 'SELF_CONFIRMATION_DENIED', 'ATTENDANCE_PENDING', 'ATTENDANCE_CLAIM_EXISTS']);

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const version = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
function attendanceBodyValid(path: string, value: unknown): boolean {
  if (!object(value)) return false;
  const action = path.split('/').at(-1);
  if (action === 'appeals') {
    return Object.keys(value).every(key => ['original_action_id', 'reason', 'evidence', 'idempotency_key'].includes(key)) &&
      typeof value.original_action_id === 'string' && typeof value.idempotency_key === 'string' && typeof value.reason === 'string' &&
      value.reason.trim().length >= 10 && value.reason.length <= 2000 && Array.isArray(value.evidence) && value.evidence.length <= 5 &&
      value.evidence.every(item => object(item) && Object.keys(item).length === 2 && item.kind === 'MESSAGE' && typeof item.reference === 'string');
  }
  const fields = ['expected_version', 'expected_schedule_version',
    ...(action === 'no-show' ? ['absent_side'] : []),
    ...(['confirm', 'dispute'].includes(action ?? '') ? ['expected_claim_version'] : []),
    ...(action === 'dispute' ? ['reason', 'evidence'] : [])];
  if (Object.keys(value).some(key => !fields.includes(key)) || !version(value.expected_version) || !version(value.expected_schedule_version)) return false;
  if (action === 'no-show' && (typeof value.absent_side !== 'string' || !['SEEKER', 'PROVIDER'].includes(value.absent_side))) return false;
  if (['confirm', 'dispute'].includes(action ?? '') && !version(value.expected_claim_version)) return false;
  if (action === 'dispute') {
    if (typeof value.reason !== 'string' || !['DID_NOT_ATTEND', 'OUTCOME_INCORRECT', 'SAFETY', 'OTHER'].includes(value.reason)) return false;
    if (value.evidence !== undefined && (!Array.isArray(value.evidence) || value.evidence.length > 5 || value.evidence.some(item =>
      !object(item) || Object.keys(item).some(key => !['reference', 'kind'].includes(key)) ||
      typeof item.reference !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.reference) ||
      item.kind !== 'MESSAGE'))) return false;
    if (Array.isArray(value.evidence) && new Set(value.evidence.map(item => (item as { reference: string }).reference.toLowerCase())).size !== value.evidence.length) return false;
  }
  return true;
}

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
    try {
      const value: unknown = await request.json();
      if (path.includes('/attendance/') && !attendanceBodyValid(path, value))
        return Response.json({ error: 'invalid_request' }, { status: 400, headers });
      body = JSON.stringify(value);
    }
    catch { return Response.json({ error: 'invalid_request' }, { status: 400, headers }); }
  }
  const query = new URLSearchParams();
  const queryKeys=path==='viewings'?['interaction_id','cursor','limit']:path==='viewing-notices'?['viewing_id','cursor','limit']:/^viewings\/[^/]+\/(reschedules|attendance)$/.test(path)?['cursor','limit']:[];
  if (!mutation && queryKeys.length) {
    const supplied = new URL(request.url).searchParams;
    if (path.endsWith('/attendance') && ((supplied.has('limit') && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(supplied.get('limit')!)) ||
      ['cursor', 'limit'].some(key => supplied.getAll(key).length > 1)))
      return Response.json({ error: 'invalid_request' }, { status: 400, headers });
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
