import { type DynamicModule, Module } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';

import { AccountService } from './application/account-identity.service.js';
import { PostgresAccountSource } from './infrastructure/postgres-account.source.js';
import { ACCOUNT_POOL, OIDC_POOL } from '../../common/tokens/injection-tokens.js';
import type { ServiceConfig } from '../../infrastructure/config/config.schema.js';
import { ConfigService } from '../../infrastructure/config/config.service.js';
import { AccountApplicationService, type AccountRepositoryPort, type AccountResolutionPort, type ProviderGrantPort } from './application/account.service.js';
import { AccountController } from './controllers/account.controller.js';
import { MeController } from './controllers/me.controller.js';
import { SessionController } from './controllers/session.controller.js';
import { AccountRepository } from './infrastructure/account.repository.js';
import { PostgresAdminAuth, type AdminAuthPort } from '../admin/infrastructure/admin-auth.js';
import { PostgresAdminRepository } from '../admin/infrastructure/admin.repository.js';
import { ADMIN_SESSION_AUTH, PROVIDER_SESSIONS } from './account.tokens.js';

export interface AccountModuleOptions {
  config: ServiceConfig;
  repository: AccountRepositoryPort;
  sessions: ProviderSessionPort;
  resolver: AccountResolutionPort;
  adminAuth?: Pick<AdminAuthPort, 'authenticated'>;
}

export interface ProviderSessionPort extends ProviderGrantPort {
  accountId(request: Request, response: Response): Promise<string | null>;
}

export class ProviderSessionGateway implements ProviderSessionPort {
  private delegate: ProviderSessionPort | null = null;
  attach(delegate: ProviderSessionPort): void {
    if (this.delegate) throw new Error('Provider session gateway is already attached');
    this.delegate = delegate;
  }
  accountId(request: Request, response: Response): Promise<string | null> { return this.delegate?.accountId(request, response) ?? Promise.resolve(null); }
  revokeGrant(id: string, accountId: string): Promise<{ clientId: string | null } | null> { return this.delegate?.revokeGrant(id, accountId) ?? Promise.resolve(null); }
}

export const ACCOUNT_RESOLVER = Symbol('ACCOUNT_RESOLVER');
const REPOSITORY = Symbol('ACCOUNT_REPOSITORY');
const SETTINGS = Symbol('ACCOUNT_SETTINGS');

@Module({})
export class AccountModule {
  static register(options?: AccountModuleOptions): DynamicModule {
    const providers = options ? [
      { provide: SETTINGS, useValue: options.config }, { provide: ACCOUNT_RESOLVER, useValue: options.resolver },
      { provide: REPOSITORY, useValue: options.repository }, { provide: PROVIDER_SESSIONS, useValue: options.sessions },
      { provide: ADMIN_SESSION_AUTH, useValue: options.adminAuth ?? { authenticated: async () => false } },
    ] : [
      { provide: SETTINGS, inject: [ConfigService], useFactory: (config: ConfigService) => config.get() },
      { provide: ACCOUNT_RESOLVER, inject: [ACCOUNT_POOL, ConfigService], useFactory: (pool: Pool, config: ConfigService) => new AccountService(new PostgresAccountSource(pool), { legacyHmacKey: config.get().secrets.legacyHmacKey, fingerprintKey: config.get().secrets.fingerprint, subjectKey: config.get().secrets.subject }) },
      { provide: REPOSITORY, inject: [OIDC_POOL], useFactory: (pool: Pool) => new AccountRepository(pool) },
      { provide: ADMIN_SESSION_AUTH, inject: [OIDC_POOL, ConfigService], useFactory: (pool: Pool, config: ConfigService) => new PostgresAdminAuth(new PostgresAdminRepository(pool), config.get()) },
      ProviderSessionGateway, { provide: PROVIDER_SESSIONS, useExisting: ProviderSessionGateway },
    ];
    return {
      module: AccountModule, controllers: [AccountController, MeController, SessionController],
      providers: [...providers, { provide: AccountApplicationService, inject: [ACCOUNT_RESOLVER, REPOSITORY, PROVIDER_SESSIONS, SETTINGS], useFactory: (resolver: AccountResolutionPort, repository: AccountRepositoryPort, sessions: ProviderSessionPort, config: ServiceConfig) => new AccountApplicationService(resolver, repository, sessions, config) }],
      exports: [AccountApplicationService, ACCOUNT_RESOLVER, ...(options ? [] : [ProviderSessionGateway])],
    };
  }
}
