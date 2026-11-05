import { CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../../common/errors/application.error.js';
import { AdminService } from './admin.service.js';
import type { AdminRequest } from './admin-role.guard.js';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(@Inject(AdminService) private readonly service: AdminService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const principal = await this.service.auth.authenticated(request);
    if (!principal) throw new ApplicationError(401, 'authentication_required', 'Administrator sign in is required');
    request.adminPrincipal = principal;
    const path = request.originalUrl.split('?')[0] ?? '';
    if (principal.mustChangePassword && !path.endsWith('/password') && !path.endsWith('/logout')) throw new ApplicationError(403, 'password_change_required', 'Administrator password must be changed before continuing');
    return true;
  }
}
