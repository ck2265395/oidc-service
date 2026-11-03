import { Inject, Injectable, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

import { REDIS_COMMAND, REDIS_SUBSCRIBER } from '../../common/tokens/injection-tokens.js';
import { ConfigService } from '../config/config.service.js';

interface ManagedRedis { isOpen: boolean; connect(): Promise<unknown>; quit(): Promise<unknown>; }

@Injectable()
export class RedisLifecycle implements OnModuleInit, OnApplicationShutdown {
  private closed = false;
  constructor(
    @Inject(REDIS_COMMAND) private readonly command: ManagedRedis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: ManagedRedis,
  ) {}
  async onModuleInit(): Promise<void> { await Promise.all([this.command.connect(), this.subscriber.connect()]); }
  async onApplicationShutdown(_signal?: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([
      this.command.isOpen ? this.command.quit() : Promise.resolve(),
      this.subscriber.isOpen ? this.subscriber.quit() : Promise.resolve(),
    ]);
  }
}

function client(config: ConfigService): RedisClientType {
  const value = config.get();
  const result = createClient({
    url: value.redisUrl,
    ...(value.redisUsername ? { username: value.redisUsername } : {}),
    ...(value.redisPassword ? { password: value.redisPassword } : {}),
  });
  result.on('error', () => undefined);
  return result;
}

@Module({
  providers: [
    { provide: REDIS_COMMAND, inject: [ConfigService], useFactory: client },
    { provide: REDIS_SUBSCRIBER, inject: [REDIS_COMMAND], useFactory: (command: RedisClientType): RedisClientType => command.duplicate() as RedisClientType },
    RedisLifecycle,
  ],
  exports: [REDIS_COMMAND, REDIS_SUBSCRIBER],
})
export class RedisModule {}
