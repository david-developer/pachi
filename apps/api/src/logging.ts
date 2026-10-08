import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const sensitiveKey = /(authorization|cookie|password|secret|token|api[_-]?key|database[_-]?url|evidence|message)/i;
const requestIdPattern = /^[A-Za-z0-9._:-]{1,100}$/;
const organizationRequestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOrganizationRequestPath(path: string): boolean {
  return /^\/(?:v1\/)?account\/(?:organizations|organization-invitations)(?:\/|$)/i.test(path);
}

export function isContactSafetyPath(path: string): boolean {
  return /^\/(?:v1\/)?account\/(?:blocks(?:\/|$)|(?:interactions|listings)\/[^/]+\/(?:block|block-provider|contact-safety)(?:\/|$))/i.test(path);
}

export function isListingLifecyclePath(path: string): boolean {
  return /^\/(?:v1\/)?account\/listings\/[^/]+\/lifecycle(?:\/|$)/i.test(path);
}

/** Reuse the server-established correlation identity; never arbitrary header text. */
export function organizationRequestId(request: Request): string {
  const current = request.res?.locals.requestId as unknown;
  const id = typeof current === 'string' && organizationRequestIdPattern.test(current) ? current : randomUUID();
  if (request.res) { request.res.locals.requestId = id; request.res.setHeader('x-request-id', id); }
  return id;
}

export function requestIdMiddleware(request: Request, response: Response, next: NextFunction): void {
  const incoming = request.header('x-request-id');
  const organizationRequest = isOrganizationRequestPath(request.path) || isContactSafetyPath(request.path) || isListingLifecyclePath(request.path);
  const requestId = incoming && (organizationRequest ? organizationRequestIdPattern : requestIdPattern).test(incoming) ? incoming : randomUUID();
  if (organizationRequest) response.setHeader('Cache-Control', isListingLifecyclePath(request.path) ? 'private, no-store' : 'no-store');
  response.setHeader('x-request-id', requestId);
  response.locals.requestId = requestId;
  const startedAt = Date.now();
  response.on('finish', () => {
    const path = organizationRequest ? (typeof request.route?.path === 'string' ? request.route.path : (isListingLifecyclePath(request.path) ? '/v1/account/listings/*/lifecycle/*' : isContactSafetyPath(request.path) ? '/v1/account/contact-safety/*' : '/v1/account/organizations/*')) : request.path;
    console.log(JSON.stringify({ event: 'http_request', request_id: requestId, method: request.method, path, status: response.statusCode, duration_ms: Date.now() - startedAt }));
  });
  next();
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sensitiveKey.test(key) ? '[REDACTED]' : redact(entry)]));
  }
  return value;
}
