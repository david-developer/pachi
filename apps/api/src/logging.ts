import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const sensitiveKey = /(authorization|cookie|password|secret|token|api[_-]?key|database[_-]?url|evidence|message)/i;
const requestIdPattern = /^[A-Za-z0-9._:-]{1,100}$/;

export function requestIdMiddleware(request: Request, response: Response, next: NextFunction): void {
  const incoming = request.header('x-request-id');
  const requestId = incoming && requestIdPattern.test(incoming) ? incoming : randomUUID();
  response.setHeader('x-request-id', requestId);
  response.locals.requestId = requestId;
  const startedAt = Date.now();
  response.on('finish', () => {
    console.log(JSON.stringify({ event: 'http_request', request_id: requestId, method: request.method, path: request.path, status: response.statusCode, duration_ms: Date.now() - startedAt }));
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
