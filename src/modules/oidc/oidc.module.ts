import { type DynamicModule, Module } from '@nestjs/common';
import type { Pool } from 'pg';
import type { RedisClientType } from 'redis';

import type { AccountService } from '../../accounts.js';
import { OIDC_POOL, OIDC_SIGNING_KEYS, REDIS_COMMAND, REDIS_SUBSCRIBER } from '../../common/tokens/injection-tokens.js';
import { ConfigService } from '../../infrastructure/config/config.service.js';
import type { SigningKeyService } from '../../infrastructure/keys/signing-key.service.js';
import { ApplicationService } from '../../platform.js';
import { ACCOUNT_RESOLVER, ProviderSessionGateway } from '../account/account.module.js';
import { InteractionController } from './interaction.controller.js';
import { OidcAuditService } from './oidc-audit.service.js';
import { OidcProviderService } from './oidc-provider.service.js';
import { PortalController } from './portal.controller.js';

@Module({})
export class OidcModule {
  static registerProduction(): DynamicModule {
    return { module: OidcModule, controllers: [InteractionController, PortalController], providers: [
      { provide: OidcAuditService, inject: [OIDC_POOL], useFactory: (pool: Pool) => new OidcAuditService(pool) },
      { provide: OidcProviderService, inject: [ConfigService, OIDC_POOL, REDIS_COMMAND, REDIS_SUBSCRIBER, ACCOUNT_RESOLVER, ApplicationService, OIDC_SIGNING_KEYS, ProviderSessionGateway, OidcAuditService], useFactory: (config: ConfigService, pool: Pool, redis: RedisClientType, subscriber: RedisClientType, accounts: AccountService, applications: ApplicationService, keys: SigningKeyService, gateway: ProviderSessionGateway, audit: OidcAuditService) => new OidcProviderService(config.get(), pool, redis, subscriber, accounts, applications, keys, gateway, audit) },
    ], exports: [OidcProviderService] };
  }
}
