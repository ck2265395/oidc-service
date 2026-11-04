import { type DynamicModule, Module } from '@nestjs/common';
import type { Pool } from 'pg';

import { OIDC_POOL } from '../../common/tokens/injection-tokens.js';
import type { ServiceConfig } from '../../infrastructure/config/config.schema.js';
import type { ApplicationGroupService } from '../application/domain/groups.js';
import { ConfigService } from '../../infrastructure/config/config.service.js';
import type { ApplicationService } from '../application/application/application-management.service.js';
import type { PostgresDeveloperStore } from '../developer/infrastructure/developer.store.js';
import { ApplicationGroupService as Groups } from '../application/domain/groups.js';
import { ApplicationService as Applications } from '../application/application/application-management.service.js';
import { DEVELOPER_STORE } from '../developer-auth/developer-auth.module.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { createAdminLoginRouter } from './admin-login.router.js';
import { ADMIN_PAGE_ROUTER, AdminPageController } from './admin-page.controller.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { PostgresAdminAuth, type AdminAuthPort } from './infrastructure/admin-auth.js';
import { PostgresAdminAudit, type AdminAuditPort } from './infrastructure/admin-audit.repository.js';
import { PostgresAdminRepository } from './infrastructure/admin.repository.js';
import { AdminAuthenticationService } from './application/admin-authentication.service.js';
import { AdminBootstrapService } from './application/admin-bootstrap.service.js';
import { AdminManagementService } from './application/admin-management.service.js';
import { AdminRoleGuard } from './admin-role.guard.js';

export interface AdminModuleOptions { config: ServiceConfig; auth: AdminAuthPort; applications: ApplicationService; groups: ApplicationGroupService; developers: Pick<PostgresDeveloperStore, 'listForAdmin'|'getForAdmin'|'reviewDeveloper'>; audit: AdminAuditPort; management: AdminManagementService; }

@Module({})
export class AdminModule {
  static register(options: AdminModuleOptions): DynamicModule { return { module: AdminModule, controllers: [AdminController], providers: [AdminAuthGuard, AdminRoleGuard, { provide: AdminService, useValue: new AdminService(options.config, options.auth, options.applications, options.groups, options.developers, options.audit, options.management) }] }; }
  static registerProduction(applicationModule: DynamicModule, developerModule: DynamicModule): DynamicModule { return { module: AdminModule, imports: [applicationModule, developerModule], controllers: [AdminController, AdminPageController], providers: [AdminAuthGuard, AdminRoleGuard,
    { provide: PostgresAdminRepository, inject: [OIDC_POOL], useFactory: (pool: Pool) => new PostgresAdminRepository(pool) },
    { provide: AdminAuthenticationService, inject: [PostgresAdminRepository], useFactory: (repository: PostgresAdminRepository) => new AdminAuthenticationService(repository) },
    { provide: AdminBootstrapService, inject: [ConfigService, PostgresAdminRepository], useFactory: (config: ConfigService, repository: PostgresAdminRepository) => new AdminBootstrapService(config.get().mode, repository) },
    { provide: ADMIN_PAGE_ROUTER, inject: [OIDC_POOL, ConfigService, AdminAuthenticationService, PostgresAdminRepository], useFactory: (pool: Pool, config: ConfigService, authentication: AdminAuthenticationService, repository: PostgresAdminRepository) => createAdminLoginRouter(pool, config.get(), authentication, repository) },
    { provide: AdminManagementService, inject: [PostgresAdminRepository], useFactory: (repository: PostgresAdminRepository) => new AdminManagementService(repository) },
    { provide: AdminService, inject: [ConfigService, OIDC_POOL, PostgresAdminRepository, Applications, Groups, DEVELOPER_STORE, AdminManagementService], useFactory: (config: ConfigService, pool: Pool, repository: PostgresAdminRepository, applications: ApplicationService, groups: ApplicationGroupService, developers: PostgresDeveloperStore, management: AdminManagementService) => new AdminService(config.get(), new PostgresAdminAuth(repository, config.get()), applications, groups, developers, new PostgresAdminAudit(pool), management) }] }; }
}
