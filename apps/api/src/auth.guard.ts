import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedPrincipal } from '@pachi/database';
import { AuthService } from './auth.service.js';

export type AuthenticatedRequest = Request & { principal?: AuthenticatedPrincipal };

@Injectable()
export class AuthGuard implements CanActivate {
  public constructor(@Inject('AUTH_SERVICE') private readonly auth: AuthService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.principal = await this.auth.authenticate(request.header('authorization'), request.header('user-agent'));
    return true;
  }
}
