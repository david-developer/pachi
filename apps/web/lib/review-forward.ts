import { csrfValid } from './csrf';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const criteria = new Set(['listing_accuracy', 'communication', 'reliability', 'transparency', 'overall_experience', 'appointment_attendance', 'respectful_conduct', 'overall_interaction']);
const reportReasons = new Set(['HARASSMENT', 'DISCRIMINATION', 'THREATS', 'PRIVACY_EXPOSURE', 'EXTORTION', 'IMPERSONATION', 'IRRELEVANT_CONTENT', 'OTHER']);
const safeCodes = new Set(['STALE_VERSION', 'IDEMPOTENCY_KEY_REUSED', 'INVALID_STATE', 'INVALID_INPUT', 'ELIGIBILITY_EXPIRED', 'CAPABILITY_RESTRICTED', 'PHONE_REQUIRED', 'REVIEW_UNAVAILABLE', 'REQUEST_CONFLICT']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const rating = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
const version = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const textValid = (value: unknown) => value === undefined || (typeof value === 'string' && Array.from(value).length <= 2000);

function bodyValid(path: string, value: unknown): boolean {
  if (!object(value)) return false;
  const command = path.split('/').at(-1);
  if (command === 'report') return Object.keys(value).every(key => ['reason', 'details'].includes(key)) &&
    typeof value.reason === 'string' && reportReasons.has(value.reason) && textValid(value.details);
  if (command === 'withdraw') return Object.keys(value).every(key => key === 'expected_version') && version(value.expected_version);
  return Object.keys(value).every(key => ['expected_version', 'rating', 'text', 'criteria'].includes(key)) &&
    version(value.expected_version) && rating(value.rating) && textValid(value.text) &&
    (value.criteria === undefined || (object(value.criteria) && Object.entries(value.criteria).every(([key, score]) => criteria.has(key) && rating(score))));
}

/** Fixed routes preserve server-resolved principals; private content never enters errors. */
export async function forwardReviewRequest(request: Request, path: string, session: { accessToken?: string | undefined; csrfToken?: string | undefined }, mutation = false): Promise<Response> {
  const headers = { 'cache-control': 'private, no-store' };
  const publicRead = !mutation && /^(providers\/[^/]+\/reviews|public\/listings\/[^/]+\/reviews)$/.test(path);
  if (!publicRead && !session.accessToken) return Response.json({ error: 'authentication_required' }, { status: 401, headers });
  if (mutation && !(await csrfValid(request, session.csrfToken))) return Response.json({ error: 'csrf_rejected' }, { status: 403, headers });
  const allowed = mutation ? /^account\/(review-eligibilities\/[^/]+\/submit|reviews\/[^/]+\/(edit|withdraw|report))$/ :
    /^(account\/(viewings\/[^/]+\/reviews|reviews\/[^/]+|(seekers|providers)\/[^/]+\/reviews)|providers\/[^/]+\/reviews|public\/listings\/[^/]+\/reviews)$/;
  if (!allowed.test(path)) return Response.json({ error: 'not_found' }, { status: 404, headers });
  let body: string | undefined;
  if (mutation) {
    if (!uuid.test(request.headers.get('idempotency-key') ?? '')) return Response.json({ error: 'invalid_request' }, { status: 400, headers });
    try { const value: unknown = await request.json(); if (!bodyValid(path, value)) return Response.json({ error: 'invalid_request' }, { status: 400, headers }); body = JSON.stringify(value); }
    catch { return Response.json({ error: 'invalid_request' }, { status: 400, headers }); }
  }
  const query = new URLSearchParams(), supplied = new URL(request.url).searchParams;
  const queryKeys = /^account\/(seekers|providers)\//.test(path) ? ['interaction_id', 'cursor', 'limit'] : publicRead ? ['cursor', 'limit'] : [];
  if (!mutation) {
    if (queryKeys.some(key => supplied.getAll(key).length > 1) || (supplied.has('limit') && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(supplied.get('limit')!)) ||
      (queryKeys.includes('interaction_id') && supplied.has('interaction_id') && !uuid.test(supplied.get('interaction_id')!)))
      return Response.json({ error: 'invalid_request' }, { status: 400, headers });
    for (const key of queryKeys) { const value = supplied.get(key); if (value !== null) query.set(key, value); }
  }
  try {
    const response = await fetch(`${process.env.PACHI_API_URL ?? 'http://localhost:3001'}/v1/${path}${query.size ? `?${query}` : ''}`, {
      method: mutation ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-request-id': crypto.randomUUID(),
        ...(!publicRead ? { authorization: `Bearer ${session.accessToken}` } : {}),
        ...(mutation ? { 'idempotency-key': request.headers.get('idempotency-key')! } : {}) },
      ...(body === undefined ? {} : { body }), cache: 'no-store', signal: AbortSignal.timeout(10_000)
    });
    const result = await response.json() as Record<string, unknown>;
    return Response.json(response.ok ? result : {
      error: response.status === 401 ? 'authentication_required' : response.status === 400 ? 'invalid_request' : response.status === 409 ? 'request_conflict' : 'review_unavailable',
      ...(typeof result.code === 'string' && safeCodes.has(result.code) ? { code: result.code } : {})
    }, { status: response.status, headers });
  } catch { return Response.json({ error: 'review_unavailable' }, { status: 503, headers }); }
}
