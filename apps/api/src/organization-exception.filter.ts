import { Catch, HttpException, type ArgumentsHost, type HttpServer } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';
import { isOrganizationRequestPath, isContactSafetyPath, isListingLifecyclePath, isViewingPath, isReviewPath, organizationRequestId } from './logging.js';

const safeCategories = new Set(['INVALID_INPUT', 'INVALID_IDEMPOTENCY_KEY', 'AUTH_REQUIRED', 'RESOURCE_UNAVAILABLE', 'CAPABILITY_RESTRICTED', 'PHONE_REQUIRED', 'PRIVILEGED_GOVERNANCE_UNAVAILABLE', 'DELIVERY_UNAVAILABLE', 'STALE_VERSION', 'IDEMPOTENCY_KEY_REUSED', 'INVITATION_UNAVAILABLE', 'STEP_UP_REQUIRED', 'FINAL_OWNER_PROTECTED', 'INVALID_STATE', 'PUBLICATION_REQUIREMENTS_BLOCKED']);
const viewingCategories = new Set(['STALE_SCHEDULE_VERSION', 'REQUEST_EXPIRED', 'APPOINTMENT_PAST', 'ACTIVE_VIEWING_EXISTS', 'STALE_PROPOSAL_VERSION', 'PENDING_PROPOSAL_EXISTS', 'PROPOSAL_EXPIRED', 'CLAIM_TOO_EARLY', 'SELF_CONFIRMATION_DENIED', 'STALE_CLAIM_VERSION', 'ATTENDANCE_CLAIM_EXISTS', 'ATTENDANCE_PENDING']);
const reviewCategories = new Set(['ELIGIBILITY_EXPIRED', 'REVIEW_UNAVAILABLE']);
const defaults: Record<number, string> = { 400: 'INVALID_INPUT', 401: 'AUTH_REQUIRED', 403: 'CAPABILITY_RESTRICTED', 404: 'RESOURCE_UNAVAILABLE', 409: 'REQUEST_CONFLICT', 503: 'DELIVERY_UNAVAILABLE' };

/** Includes parser failures before controller guards; other API behavior is unchanged. */
@Catch()
export class OrganizationExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly adapter: HttpServer) { super(adapter); }
  override catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    if (!isOrganizationRequestPath(request.path) && !isContactSafetyPath(request.path) && !isListingLifecyclePath(request.path) && !isViewingPath(request.path) && !isReviewPath(request.path)) { super.catch(exception, host); return; }
    const response = http.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const data = exception instanceof HttpException ? exception.getResponse() : null;
    const message = data && typeof data === 'object' && 'message' in data ? data.message : null;
    const category = typeof message === 'string' && (safeCategories.has(message) || (isViewingPath(request.path) && viewingCategories.has(message)) || (isReviewPath(request.path) && reviewCategories.has(message))) ? message : defaults[status] ?? 'INTERNAL_ERROR';
    response.setHeader('Cache-Control', (isViewingPath(request.path) || isReviewPath(request.path) || isListingLifecyclePath(request.path) || /ownership-transfers|privileged-(?:role|revoke)/.test(request.path)) ? 'private, no-store' : 'no-store');
    // Do not delegate unknown organization errors: BaseExceptionFilter logs raw exceptions.
    const payload = isViewingPath(request.path) || isReviewPath(request.path)
      ? { statusCode: status, code: category, message: category, request_id: organizationRequestId(request) }
      : { statusCode: status, message: category };
    if (!this.adapter.isHeadersSent(response)) this.adapter.reply(response, payload, status);
    else this.adapter.end(response);
  }
}
