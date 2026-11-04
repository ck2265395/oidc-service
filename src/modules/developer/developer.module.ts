import { type DynamicModule, Module } from '@nestjs/common';

import type { ServiceConfig } from '../../infrastructure/config/config.schema.js';
import type { DeveloperSessionService } from './application/developer-session.service.js';
import type { PostgresDeveloperStore } from './infrastructure/developer.store.js';
import { ConfigService } from '../../infrastructure/config/config.service.js';
import { AccountApplicationService } from '../account/application/account.service.js';
import { DEVELOPER_SESSIONS, DEVELOPER_STORE, DeveloperAuthModule } from '../developer-auth/developer-auth.module.js';
import { NestDeveloperAuthService } from '../developer-auth/developer-auth.service.js';
import { DeveloperController } from './developer.controller.js';
import { DeveloperService, type DeveloperCredentialPort, type DeveloperStorePort, type MoondropSubjectPort } from './developer.service.js';

export interface DeveloperModuleOptions {
  config: ServiceConfig;
  sessions: Pick<DeveloperSessionService, 'resolve' | 'create'>;
  store: DeveloperStorePort;
  moondrop: MoondropSubjectPort;
  credentials: DeveloperCredentialPort;
}

@Module({})
export class DeveloperModule {
  static register(options: DeveloperModuleOptions): DynamicModule {
    return { module: DeveloperModule, global: true, controllers: [DeveloperController], providers: [{ provide: DeveloperService, useValue: new DeveloperService(options.config, options.sessions, options.store, options.moondrop, options.credentials) }], exports: [DeveloperService] };
  }

  static registerProduction(): DynamicModule {
    return {
      module: DeveloperModule,
      global: true,
      imports: [DeveloperAuthModule.registerProduction()],
      controllers: [DeveloperController],
      providers: [{ provide: DeveloperService, inject: [ConfigService, DEVELOPER_SESSIONS, DEVELOPER_STORE, AccountApplicationService, NestDeveloperAuthService], useFactory: (config: ConfigService, sessions: DeveloperSessionService, store: PostgresDeveloperStore, accounts: AccountApplicationService, auth: NestDeveloperAuthService) => new DeveloperService(config.get(), sessions, store, { subject: async (request, response) => (await accounts.identity(request, response, 'developer-portal'))?.uuid ?? null }, { login: (email, password) => auth.login(email, password) }) }],
      exports: [DeveloperService, DeveloperAuthModule],
    };
  }
}
