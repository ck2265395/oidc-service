import { type DynamicModule, Module } from '@nestjs/common';
import type { Pool } from 'pg';

import { OIDC_POOL } from '../../common/tokens/injection-tokens.js';
import type { ServiceConfig } from '../../config.js';
import type { ApplicationGroupService } from '../../groups.js';
import { ConfigService } from '../../infrastructure/config/config.service.js';
import type { ApplicationService } from '../../platform.js';
import type { PostgresDeveloperStore } from '../../developer-store.js';
import { createAdminRouter } from '../../admin.js';
import { ApplicationGroupService as Groups } from '../../groups.js';
import { ApplicationService as Applications } from '../../platform.js';
import { DEVELOPER_STORE } from '../developer-auth/developer-auth.module.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { ADMIN_PAGE_ROUTER, AdminPageController } from './admin-page.controller.js';
import { AdminController } from './admin.controller.js';
import { AdminService, type AdminAuditPort, type AdminAuthPort, PostgresAdminAudit, PostgresAdminAuth } from './admin.service.js';

export interface AdminModuleOptions { config: ServiceConfig; auth: AdminAuthPort; applications: ApplicationService; groups: ApplicationGroupService; developers: Pick<PostgresDeveloperStore, 'listForAdmin'|'getForAdmin'|'reviewDeveloper'>; audit: AdminAuditPort; }

@Module({})
export class AdminModule {
  static register(options: AdminModuleOptions): DynamicModule { return { module: AdminModule, controllers: [AdminController], providers: [AdminAuthGuard, { provide: AdminService, useValue: new AdminService(options.config, options.auth, options.applications, options.groups, options.developers, options.audit) }] }; }
  static registerProduction(): DynamicModule { return { module: AdminModule, controllers: [AdminController, AdminPageController], providers: [AdminAuthGuard,
    { provide: ADMIN_PAGE_ROUTER, inject: [OIDC_POOL, ConfigService, Applications, Groups], useFactory: (pool: Pool, config: ConfigService, applications: ApplicationService, groups: ApplicationGroupService) => createAdminRouter(pool, config.get(), applications, groups) },
    { provide: AdminService, inject: [ConfigService, OIDC_POOL, Applications, Groups, DEVELOPER_STORE], useFactory: (config: ConfigService, pool: Pool, applications: ApplicationService, groups: ApplicationGroupService, developers: PostgresDeveloperStore) => new AdminService(config.get(), new PostgresAdminAuth(pool, config.get()), applications, groups, developers, new PostgresAdminAudit(pool, config.get())) }] }; }
}
