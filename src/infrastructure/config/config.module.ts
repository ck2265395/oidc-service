import { type DynamicModule, Global, Module } from '@nestjs/common';

import { ConfigService } from './config.service.js';

@Global()
@Module({})
export class ConfigModule {
  static register(config: ConfigService): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: ConfigService, useValue: config }],
      exports: [ConfigService],
    };
  }
}
