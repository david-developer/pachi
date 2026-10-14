import { NextResponse } from 'next/server';
import { StaffAccessError } from '@pachi/database';
import { staffAccess, staffCookie, validCsrf } from './session';
import { staffConfig } from './config';
import { randomUUID } from 'node:crypto';

const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };

export async function reviewModerationProxy(path: string, request: Request): Promise<Response> {
  const requestId = randomUUID();
  const responseHeaders = { ...headers, 'x-request-id': requestId };
  const errorResponse = (code: string, status: number) => NextResponse.json(
    { statusCode: status, code, message: code, request_id: requestId }, { status, headers: responseHeaders });
  try {
    staffConfig();
  } catch {
    return errorResponse('CONFIGURATION', 503);
  }
  try {
    const cookie = await staffCookie();
    if (!cookie.id) return errorResponse('AUTH_REQUIRED', 401);
    if (request.method === 'POST' && !validCsrf(request, cookie.csrf)) {
      return errorResponse('CSRF_REJECTED', 403);
    }
    const token = await staffAccess(cookie.id);
    const response = await fetch(`${staffConfig().api}/v1/staff/review-cases${path}`, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        'x-request-id': requestId,
        ...(request.method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(request.method === 'POST' ? { body: await request.text() } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json(await response.json(), { status: response.status, headers: responseHeaders });
  } catch (error) {
    if (error instanceof StaffAccessError) return errorResponse(error.code, error.code === 'RESOURCE_SCOPE_DENIED' ? 403 : 401);
    return errorResponse('DELIVERY_UNAVAILABLE', 503);
  }
}
