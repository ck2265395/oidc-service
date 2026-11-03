import type { AddressInfo } from 'node:net';

import { type INestApplication, type LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';

import { AppModule } from '../app.module.js';
import { ConfigService } from '../infrastructure/config/config.service.js';

export interface BootstrapOptions {
  configPath?: string;
  port?: number;
  logger?: false | LoggerService | Array<'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal'>;
}

export interface NestApplicationHandle {
  app: INestApplication;
  port: number;
  close(): Promise<void>;
}

export async function bootstrapNest(options: BootstrapOptions = {}): Promise<NestApplicationHandle> {
  const config = await ConfigService.fromFile(options.configPath);
  const app = await NestFactory.create(
    AppModule.register(config),
    new ExpressAdapter(),
    { bodyParser: false, bufferLogs: true, logger: options.logger ?? ['log', 'error', 'warn'] },
  );
  app.enableShutdownHooks();
  await app.listen(options.port ?? config.get().port, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo | null;
  if (!address) {
    await app.close();
    throw new Error('Nest application did not bind a TCP port');
  }
  let closed = false;
  return {
    app,
    port: address.port,
    close: async () => {
      if (closed) return;
      closed = true;
      await app.close();
    },
  };
}
