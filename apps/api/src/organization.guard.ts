import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { IdentityError, OrganizationAccessStore } from '@pachi/database';
import type { AuthenticatedRequest } from './auth.guard.js';

/** Use after AuthGuard for ordinary organization settings only. Never ownership,
 * invitations, assignment, publication, evidence, or staff permissions. */
@Injectable()
export class OrganizationSettingsGuard implements CanActivate {
  constructor(@Inject('ORGANIZATION_ACCESS_STORE') private readonly store: OrganizationAccessStore) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) throw new UnauthorizedException('Authentication required');
    const id = request.params.organizationId;
    if (typeof id !== 'string') throw new ForbiddenException('RESOURCE_SCOPE_DENIED');
    try { await this.store.requireSettingsAccess(request.principal.userId, id); }
    catch (error) {
      if (error instanceof IdentityError) throw new ForbiddenException('RESOURCE_SCOPE_DENIED');
      throw error;
    }
    return true;
  }
}
