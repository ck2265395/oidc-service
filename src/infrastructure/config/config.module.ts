import { type DynamicModule, Module } from '@nestjs/common';

import { ConfigService } from './config.service.js';

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
