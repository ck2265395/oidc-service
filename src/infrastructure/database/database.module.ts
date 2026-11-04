import { Global, Inject, Injectable, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';

import { createAccountPool } from '../../modules/account/infrastructure/postgres-account.source.js';
import { ACCOUNT_POOL, OIDC_POOL } from '../../common/tokens/injection-tokens.js';
import { createPlatformPool } from '../../modules/application/infrastructure/application.store.js';
import { ConfigService } from '../config/config.service.js';

interface ManagedPool { query(sql: string): Promise<unknown>; end(): Promise<void>; }

@Injectable()
export class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
  private closed = false;
  constructor(
    @Inject(OIDC_POOL) private readonly oidc: ManagedPool,
    @Inject(ACCOUNT_POOL) private readonly accounts: ManagedPool,
  ) {}
  async onModuleInit(): Promise<void> { await Promise.all([this.oidc.query('SELECT 1'), this.accounts.query('SELECT 1')]); }
  async onApplicationShutdown(_signal?: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([this.oidc.end(), this.accounts.end()]);
  }
}

@Global()
@Module({
  providers: [
    { provide: OIDC_POOL, inject: [ConfigService], useFactory: (config: ConfigService): Pool => createPlatformPool(config.get().databases.oidc) },
    { provide: ACCOUNT_POOL, inject: [ConfigService], useFactory: (config: ConfigService): Pool => createAccountPool(config.get().databases.accounts) },
    DatabaseLifecycle,
  ],
  exports: [OIDC_POOL, ACCOUNT_POOL],
})
export class DatabaseModule {}
