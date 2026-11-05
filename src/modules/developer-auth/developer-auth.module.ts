import { type DynamicModule, Module } from '@nestjs/common';
import type { Pool } from 'pg';
import type { RedisClientType } from 'redis';

import { MAILER, OIDC_POOL, REDIS_COMMAND } from '../../common/tokens/injection-tokens.js';
import type { ServiceConfig } from '../../infrastructure/config/config.schema.js';
import { DeveloperAuthService } from './application/credential.service.js';
import { DeveloperEmailCode } from './domain/email-code.js';
import { hashDeveloperPassword } from '../developer/domain/developer-identity.js';
import { DeveloperSessionService } from '../developer/application/developer-session.service.js';
import { PostgresDeveloperStore } from '../developer/infrastructure/developer.store.js';
import { ConfigService } from '../../infrastructure/config/config.service.js';
import type { VerificationMailer } from '../../infrastructure/email/email.module.js';
import { DeveloperAuthController } from './developer-auth.controller.js';
import { type DeveloperIdentityMethods, NestDeveloperAuthService } from './developer-auth.service.js';

export interface DeveloperAuthModuleOptions {
  config: ServiceConfig;
  auth: Pick<DeveloperAuthService, 'register' | 'loginWithPassword'>;
  codes: Pick<DeveloperEmailCode, 'issue'>;
  sessions: Pick<DeveloperSessionService, 'create' | 'resolve' | 'revoke'>;
  identities: DeveloperIdentityMethods;
}

export const DEVELOPER_STORE = Symbol('DEVELOPER_STORE');
export const DEVELOPER_SESSIONS = Symbol('DEVELOPER_SESSIONS');

@Module({})
export class DeveloperAuthModule {
  static register(options: DeveloperAuthModuleOptions): DynamicModule {
    return { module: DeveloperAuthModule, controllers: [DeveloperAuthController], providers: [{ provide: NestDeveloperAuthService, useValue: new NestDeveloperAuthService(options.config.issuer, options.auth, options.codes, options.sessions, options.identities) }], exports: [NestDeveloperAuthService] };
  }

  static registerProduction(): DynamicModule {
    const AUTH = Symbol('DEVELOPER_AUTH'); const CODES = Symbol('DEVELOPER_CODES');
    return {
      module: DeveloperAuthModule,
      controllers: [DeveloperAuthController],
      providers: [
        { provide: DEVELOPER_STORE, inject: [OIDC_POOL], useFactory: (pool: Pool) => new PostgresDeveloperStore(pool) },
        { provide: DEVELOPER_SESSIONS, inject: [DEVELOPER_STORE], useFactory: (store: PostgresDeveloperStore) => new DeveloperSessionService(store) },
        { provide: CODES, inject: [REDIS_COMMAND, ConfigService, MAILER], useFactory: (redis: RedisClientType, config: ConfigService, mailer: VerificationMailer | null) => new DeveloperEmailCode(redis, config.get().secrets.fingerprint, async (email, code) => {
          if (!mailer) throw new Error('Developer email delivery is not configured');
          await mailer.sendCode(email, code);
        }) },
        { provide: AUTH, inject: [DEVELOPER_STORE, CODES], useFactory: async (store: PostgresDeveloperStore, codes: DeveloperEmailCode) => new DeveloperAuthService(store, codes, await hashDeveloperPassword('MOONDROP Dummy Developer 42!')) },
        { provide: NestDeveloperAuthService, inject: [ConfigService, AUTH, CODES, DEVELOPER_SESSIONS, DEVELOPER_STORE], useFactory: (config: ConfigService, auth: DeveloperAuthService, codes: DeveloperEmailCode, sessions: DeveloperSessionService, store: PostgresDeveloperStore) => new NestDeveloperAuthService(config.get().issuer, auth, codes, sessions, store) },
      ],
      exports: [NestDeveloperAuthService, DEVELOPER_STORE, DEVELOPER_SESSIONS],
    };
  }
}
