import { type DynamicModule, Module, type Type } from '@nestjs/common';

import { ConfigModule } from './infrastructure/config/config.module.js';
import { ConfigService } from './infrastructure/config/config.service.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { EmailModule } from './infrastructure/email/email.module.js';
import { SigningKeyModule } from './infrastructure/keys/signing-key.service.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { WebModule } from './infrastructure/web/web.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AccountModule } from './modules/account/account.module.js';
import { DeveloperModule } from './modules/developer/developer.module.js';
import { ApplicationModule } from './modules/application/application.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { OidcModule } from './modules/oidc/oidc.module.js';

@Module({})
export class AppModule {
  static register(config: ConfigService, infrastructure = false): DynamicModule {
    const productionModules: Array<DynamicModule | Type<unknown>> = [];
    if (infrastructure) {
      const account = AccountModule.register();
      const developer = DeveloperModule.registerProduction(account);
      const application = ApplicationModule.registerProduction(developer);
      productionModules.push(
        DatabaseModule,
        RedisModule,
        EmailModule,
        SigningKeyModule,
        account,
        developer,
        application,
        AdminModule.registerProduction(application, developer),
        OidcModule.registerProduction(account, application, developer),
      );
    }
    return { module: AppModule, imports: [ConfigModule.register(config), ...productionModules, HealthModule, WebModule] };
  }
}
