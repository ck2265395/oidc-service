import { type DynamicModule, Module } from '@nestjs/common';

import { ConfigModule } from './infrastructure/config/config.module.js';
import { ConfigService } from './infrastructure/config/config.service.js';

@Module({})
export class AppModule {
  static register(config: ConfigService): DynamicModule {
    return { module: AppModule, imports: [ConfigModule.register(config)] };
  }
}
