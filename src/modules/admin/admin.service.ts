import { Injectable } from '@nestjs/common';

import type { ServiceConfig } from '../../infrastructure/config/config.schema.js';
import type { ApplicationGroupService } from '../application/domain/groups.js';
import type { ApplicationService } from '../application/application/application-management.service.js';
import type { PostgresDeveloperStore } from '../developer/infrastructure/developer.store.js';
import type { AdminAuthPort } from './infrastructure/admin-auth.js';
import type { AdminAuditPort } from './infrastructure/admin-audit.repository.js';
import type { AdminManagementService } from './application/admin-management.service.js';

export type { AdminAuthPort } from './infrastructure/admin-auth.js';
export type { AdminAuditPort } from './infrastructure/admin-audit.repository.js';

@Injectable()
export class AdminService {
  constructor(readonly config: ServiceConfig, readonly auth: AdminAuthPort, readonly applications: ApplicationService, readonly groups: ApplicationGroupService, readonly developers: Pick<PostgresDeveloperStore, 'listForAdmin' | 'getForAdmin' | 'reviewDeveloper'>, readonly audit: AdminAuditPort, readonly management: AdminManagementService) {}
}
