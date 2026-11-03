import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import express, { type Express, type Router } from 'express';
import type Provider from 'oidc-provider';

import { createApplication } from '../../src/app.js';
import { loadConfig, type ServiceConfig } from '../../src/config.js';

const secret = (): string => randomBytes(32).toString('base64url');

export function testServiceConfig(): ServiceConfig {
  return loadConfig({
    mode: 'test',
    issuer: 'https://identity.example.test',
    port: 3000,
    secrets: {
      legacyHmacKey: secret(),
      cookie: secret(),
      fingerprint: secret(),
      subject: secret(),
      encryption: secret(),
    },
    admin: { username: 'ops', passwordHash: 'scrypt$16384$8$1$salt$hash' },
    databases: {
      oidc: 'postgres://oidc:secret@localhost:5432/oidc_test',
      accounts: 'postgres://reader:secret@localhost:5432/accounts_test',
    },
    redisUrl: 'redis://localhost:6379/0',
  });
}

function marker(owner: string, path = '/probe'): Router {
  const router = express.Router();
  router.get(path, (_request, response) => response.json({ owner }));
  return router;
}

export interface TestServiceOptions {
  app?: Express;
  config?: ServiceConfig;
  provider?: Provider;
  developerAuth?: Router;
  readiness?: () => Promise<void>;
  port?: number;
}

export interface TestService {
  baseUrl: string;
  close(): Promise<void>;
}

export async function createTestService(options: TestServiceOptions = {}): Promise<TestService> {
  const config = options.config ?? testServiceConfig();
  const app = options.app ?? createApplication(
    config,
    options.provider,
    marker('interaction'),
    marker('developer-api'),
    marker('admin', '/login'),
    marker('portal'),
    options.readiness ?? (async () => undefined),
    undefined,
    marker('user-api'),
    marker('session-api'),
    marker('account-api'),
    marker('admin-api'),
    options.developerAuth ?? marker('developer-auth-api'),
  );
  const server: Server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test service did not bind a TCP port');
  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
