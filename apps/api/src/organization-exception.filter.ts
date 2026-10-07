import { Catch, HttpException, type ArgumentsHost, type HttpServer } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';
import { isOrganizationRequestPath, isContactSafetyPath } from './logging.js';

const safeCategories = new Set(['INVALID_INPUT', 'INVALID_IDEMPOTENCY_KEY', 'AUTH_REQUIRED', 'RESOURCE_UNAVAILABLE', 'CAPABILITY_RESTRICTED', 'PHONE_REQUIRED', 'PRIVILEGED_GOVERNANCE_UNAVAILABLE', 'DELIVERY_UNAVAILABLE', 'STALE_VERSION', 'IDEMPOTENCY_KEY_REUSED', 'INVITATION_UNAVAILABLE', 'STEP_UP_REQUIRED', 'FINAL_OWNER_PROTECTED', 'INVALID_STATE']);
const defaults: Record<number, string> = { 400: 'INVALID_INPUT', 401: 'AUTH_REQUIRED', 403: 'CAPABILITY_RESTRICTED', 404: 'RESOURCE_UNAVAILABLE', 409: 'REQUEST_CONFLICT', 503: 'DELIVERY_UNAVAILABLE' };

/** Includes parser failures before controller guards; other API behavior is unchanged. */
@Catch()
export class OrganizationExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly adapter: HttpServer) { super(adapter); }
  override catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    if (!isOrganizationRequestPath(request.path) && !isContactSafetyPath(request.path)) { super.catch(exception, host); return; }
    const response = http.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const data = exception instanceof HttpException ? exception.getResponse() : null;
    const message = data && typeof data === 'object' && 'message' in data ? data.message : null;
    const category = typeof message === 'string' && safeCategories.has(message) ? message : defaults[status] ?? 'INTERNAL_ERROR';
    response.setHeader('Cache-Control', /ownership-transfers|privileged-(?:role|revoke)/.test(request.path) ? 'private, no-store' : 'no-store');
    // Do not delegate unknown organization errors: BaseExceptionFilter logs raw exceptions.
    if (!this.adapter.isHeadersSent(response)) this.adapter.reply(response, { statusCode: status, message: category }, status);
    else this.adapter.end(response);
  }
}
