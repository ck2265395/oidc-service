import { SetMetadata } from '@nestjs/common';

import type { AdminRole } from './domain/administrator.js';

export const ADMIN_ROLES = 'admin_roles';
export const AdminRoles = (...roles: AdminRole[]): MethodDecorator & ClassDecorator => SetMetadata(ADMIN_ROLES, roles);
