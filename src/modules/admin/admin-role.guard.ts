import { CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ApplicationError } from '../../common/errors/application.error.js';
import { ADMIN_ROLES } from './admin-role.decorator.js';
import type { AdminPrincipal, AdminRole } from './domain/administrator.js';

export type AdminRequest = Request & { adminPrincipal?: AdminPrincipal };

@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const principal = context.switchToHttp().getRequest<AdminRequest>().adminPrincipal;
    if (!principal || !roles.includes(principal.role)) throw new ApplicationError(403, 'insufficient_role', 'Administrator role does not permit this operation');
    return true;
  }
}
