import { type DynamicModule, Module } from '@nestjs/common';
import type { Pool } from 'pg';

import { OIDC_POOL } from '../../common/tokens/injection-tokens.js';
import type { ServiceConfig } from '../../config.js';
import { ApplicationGroupService } from '../../groups.js';
import { ConfigService } from '../../infrastructure/config/config.service.js';
import { ApplicationService } from '../../platform.js';
import { PostgresApplicationRepository } from '../../store.js';
import { DeveloperService } from '../developer/developer.service.js';
import { ApplicationController } from './application.controller.js';
import { ApplicationApiService, type DeveloperAccessPort } from './application.service.js';

export interface ApplicationModuleOptions { config: ServiceConfig; developer: DeveloperAccessPort; applications: ApplicationService; groups: ApplicationGroupService; }

@Module({})
export class ApplicationModule {
  static register(options: ApplicationModuleOptions): DynamicModule { return { module: ApplicationModule, global: true, controllers: [ApplicationController], providers: [{ provide: ApplicationApiService, useValue: new ApplicationApiService(options.config, options.developer, options.applications, options.groups) }], exports: [ApplicationApiService] }; }
  static registerProduction(): DynamicModule {
    return { module: ApplicationModule, global: true, controllers: [ApplicationController], providers: [
      { provide: PostgresApplicationRepository, inject: [OIDC_POOL, ConfigService], useFactory: (pool: Pool, config: ConfigService) => new PostgresApplicationRepository(pool, config.get().mode === 'production' ? 'production' : 'development') },
      { provide: ApplicationService, inject: [PostgresApplicationRepository, ConfigService], useFactory: (repository: PostgresApplicationRepository, config: ConfigService) => new ApplicationService(repository, config.get().mode === 'production' ? 'production' : 'development', undefined, undefined, config.get().secrets.encryption) },
      { provide: ApplicationGroupService, inject: [PostgresApplicationRepository], useFactory: (repository: PostgresApplicationRepository) => new ApplicationGroupService(repository) },
      { provide: ApplicationApiService, inject: [ConfigService, DeveloperService, ApplicationService, ApplicationGroupService], useFactory: (config: ConfigService, developer: DeveloperService, applications: ApplicationService, groups: ApplicationGroupService) => new ApplicationApiService(config.get(), developer, applications, groups) },
    ], exports: [ApplicationApiService, ApplicationService, ApplicationGroupService, PostgresApplicationRepository] };
  }
}
