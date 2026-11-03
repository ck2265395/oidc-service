import { CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { ApplicationError } from '../../common/errors/application.error.js';
import { AdminService } from './admin.service.js';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(@Inject(AdminService) private readonly service: AdminService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!await this.service.auth.authenticated(context.switchToHttp().getRequest<Request>())) throw new ApplicationError(401, 'authentication_required', 'Administrator sign in is required');
    return true;
  }
}
