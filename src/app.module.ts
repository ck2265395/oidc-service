import { type DynamicModule, Module } from '@nestjs/common';

import { ConfigModule } from './infrastructure/config/config.module.js';
import { ConfigService } from './infrastructure/config/config.service.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { EmailModule } from './infrastructure/email/email.module.js';
import { SigningKeyModule } from './infrastructure/keys/signing-key.service.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { WebModule } from './infrastructure/web/web.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({})
export class AppModule {
  static register(config: ConfigService, infrastructure = false): DynamicModule {
    return { module: AppModule, imports: [ConfigModule.register(config), ...(infrastructure ? [DatabaseModule, RedisModule, EmailModule, SigningKeyModule] : []), HealthModule, WebModule] };
  }
}
