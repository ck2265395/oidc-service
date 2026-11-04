import { type DynamicModule, Module } from '@nestjs/common';
import type { Pool } from 'pg';
import type { RedisClientType } from 'redis';

import type { AccountService } from '../account/application/account-identity.service.js';
import { OIDC_POOL, OIDC_SIGNING_KEYS, REDIS_COMMAND, REDIS_SUBSCRIBER } from '../../common/tokens/injection-tokens.js';
import { ConfigService } from '../../infrastructure/config/config.service.js';
import type { SigningKeyService } from '../../infrastructure/keys/signing-key.service.js';
import { ApplicationService } from '../application/application/application-management.service.js';
import { ACCOUNT_RESOLVER, ProviderSessionGateway } from '../account/account.module.js';
import { DeveloperService } from '../developer/developer.service.js';
import { OidcAuditService } from './oidc-audit.service.js';
import { OidcProviderService } from './oidc-provider.service.js';

@Module({})
export class OidcModule {
  static registerProduction(accountModule: DynamicModule, applicationModule: DynamicModule, developerModule: DynamicModule): DynamicModule {
    return { module: OidcModule, imports: [accountModule, applicationModule, developerModule], providers: [
      { provide: OidcAuditService, inject: [OIDC_POOL], useFactory: (pool: Pool) => new OidcAuditService(pool) },
      { provide: OidcProviderService, inject: [ConfigService, OIDC_POOL, REDIS_COMMAND, REDIS_SUBSCRIBER, ACCOUNT_RESOLVER, ApplicationService, OIDC_SIGNING_KEYS, ProviderSessionGateway, OidcAuditService, DeveloperService], useFactory: (config: ConfigService, pool: Pool, redis: RedisClientType, subscriber: RedisClientType, accounts: AccountService, applications: ApplicationService, keys: SigningKeyService, gateway: ProviderSessionGateway, audit: OidcAuditService, developer: DeveloperService) => new OidcProviderService(config.get(), pool, redis, subscriber, accounts, applications, keys, gateway, audit, developer) },
    ], exports: [OidcProviderService] };
  }
}
