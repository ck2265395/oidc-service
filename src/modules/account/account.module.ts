import { type DynamicModule, Module } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';

import { AccountService, PostgresAccountSource } from '../../accounts.js';
import { ACCOUNT_POOL, OIDC_POOL } from '../../common/tokens/injection-tokens.js';
import type { ServiceConfig } from '../../config.js';
import { ConfigService } from '../../infrastructure/config/config.service.js';
import { AccountApplicationService, type AccountRepositoryPort, type AccountResolutionPort, type ProviderSessionPort } from './application/account.service.js';
import { AccountController } from './controllers/account.controller.js';
import { MeController } from './controllers/me.controller.js';
import { SessionController } from './controllers/session.controller.js';
import { AccountRepository } from './infrastructure/account.repository.js';

export interface AccountModuleOptions {
  config: ServiceConfig;
  repository: AccountRepositoryPort;
  sessions: ProviderSessionPort;
  resolver: AccountResolutionPort;
}

export class ProviderSessionGateway implements ProviderSessionPort {
  private delegate: ProviderSessionPort | null = null;
  attach(delegate: ProviderSessionPort): void { this.delegate = delegate; }
  accountId(request: Request, response: Response): Promise<string | null> { return this.delegate?.accountId(request, response) ?? Promise.resolve(null); }
  revokeGrant(id: string, accountId: string): Promise<{ clientId: string | null } | null> { return this.delegate?.revokeGrant(id, accountId) ?? Promise.resolve(null); }
}

const RESOLVER = Symbol('ACCOUNT_RESOLVER');
const REPOSITORY = Symbol('ACCOUNT_REPOSITORY');
const SESSIONS = Symbol('PROVIDER_SESSION_PORT');
const SETTINGS = Symbol('ACCOUNT_SETTINGS');

@Module({})
export class AccountModule {
  static register(options?: AccountModuleOptions): DynamicModule {
    const providers = options ? [
      { provide: SETTINGS, useValue: options.config }, { provide: RESOLVER, useValue: options.resolver },
      { provide: REPOSITORY, useValue: options.repository }, { provide: SESSIONS, useValue: options.sessions },
    ] : [
      { provide: SETTINGS, inject: [ConfigService], useFactory: (config: ConfigService) => config.get() },
      { provide: RESOLVER, inject: [ACCOUNT_POOL, ConfigService], useFactory: (pool: Pool, config: ConfigService) => new AccountService(new PostgresAccountSource(pool), { legacyHmacKey: config.get().secrets.legacyHmacKey, fingerprintKey: config.get().secrets.fingerprint, subjectKey: config.get().secrets.subject }) },
      { provide: REPOSITORY, inject: [OIDC_POOL, ConfigService], useFactory: (pool: Pool, config: ConfigService) => new AccountRepository(pool, config.get()) },
      ProviderSessionGateway, { provide: SESSIONS, useExisting: ProviderSessionGateway },
    ];
    return {
      module: AccountModule, controllers: [AccountController, MeController, SessionController],
      providers: [...providers, { provide: AccountApplicationService, inject: [RESOLVER, REPOSITORY, SESSIONS, SETTINGS], useFactory: (resolver: AccountResolutionPort, repository: AccountRepositoryPort, sessions: ProviderSessionPort, config: ServiceConfig) => new AccountApplicationService(resolver, repository, sessions, config) }],
      exports: [AccountApplicationService, ...(options ? [] : [ProviderSessionGateway])],
    };
  }
}
