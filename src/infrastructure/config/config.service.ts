import { readFile } from 'node:fs/promises';

import { Injectable } from '@nestjs/common';

import { loadConfig, type ServiceConfig } from './config.schema.js';

function freeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return Object.freeze(value);
}

@Injectable()
export class ConfigService {
  private constructor(private readonly config: ServiceConfig) {}

  static async fromFile(path: string | undefined = process.env.OIDC_CONFIG_FILE): Promise<ConfigService> {
    if (!path) throw new Error('OIDC_CONFIG_FILE must point to a protected JSON configuration file');
    const input = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return new ConfigService(freeze(loadConfig(input)));
  }

  get(): ServiceConfig { return this.config; }
}
