import { type DynamicModule, Module } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { RedisClientType } from 'redis';

import { MAILER, REDIS_COMMAND } from '../../common/tokens/injection-tokens.js';
import type { VerificationMailer } from '../../infrastructure/email/email.module.js';
import type { ServiceConfig } from '../../infrastructure/config/config.schema.js';
import type { DeveloperSessionService } from './application/developer-session.service.js';
import type { PostgresDeveloperStore } from './infrastructure/developer.store.js';
import { ConfigService } from '../../infrastructure/config/config.service.js';
import { AccountApplicationService } from '../account/application/account.service.js';
import { ProviderSessionGateway } from '../account/account.module.js';
import { DEVELOPER_SESSIONS, DEVELOPER_STORE, DeveloperAuthModule } from '../developer-auth/developer-auth.module.js';
import { NestDeveloperAuthService } from '../developer-auth/developer-auth.service.js';
import { DeveloperController } from './developer.controller.js';
import { DeveloperEmailVerification } from './application/email-verification.service.js';
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
    return { module: DeveloperModule, controllers: [DeveloperController], providers: [{ provide: DeveloperService, useValue: new DeveloperService(options.config, options.sessions, options.store, options.moondrop, options.credentials) }], exports: [DeveloperService] };
  }

  static registerProduction(accountModule: DynamicModule): DynamicModule {
    return {
      module: DeveloperModule,
      imports: [accountModule, DeveloperAuthModule.registerProduction()],
      controllers: [DeveloperController],
      providers: [{ provide: DeveloperService, inject: [ConfigService, DEVELOPER_SESSIONS, DEVELOPER_STORE, AccountApplicationService, ProviderSessionGateway, NestDeveloperAuthService, REDIS_COMMAND, MAILER], useFactory: (config: ConfigService, sessions: DeveloperSessionService, store: PostgresDeveloperStore, accounts: AccountApplicationService, providerSessions: ProviderSessionGateway, auth: NestDeveloperAuthService, redis: RedisClientType, mailer: VerificationMailer | null) => { const service = new DeveloperService(config.get(), sessions, store, { subject: async (request, response) => (await accounts.identity(await providerSessions.accountId(request as Request, response as Response), 'developer-portal'))?.uuid ?? null }, { login: (email, password) => auth.login(email, password) }); service.attachEmailVerification(mailer ? new DeveloperEmailVerification(redis, store, config.get().issuer, mailer.send) : null); return service; } }],
      exports: [DeveloperService, DeveloperAuthModule],
    };
  }
}
