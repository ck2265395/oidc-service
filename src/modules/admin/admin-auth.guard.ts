import { CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { AdminService } from './admin.service.js';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(@Inject(AdminService) private readonly service: AdminService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!await this.service.auth.authenticated(context.switchToHttp().getRequest<Request>())) throw new UnauthorizedException();
    return true;
  }
}
