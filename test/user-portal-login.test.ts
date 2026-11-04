import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';
import type Provider from 'oidc-provider';
import type { Pool } from 'pg';

import type { AccountService } from '../src/modules/account/domain/accounts.js';
import type { ServiceConfig } from '../src/infrastructure/config/config.schema.js';
import { createUserPortalRouter } from '../src/modules/oidc/infrastructure/user-portal.router.js';

const config = {
  mode: 'development', issuer: 'http://127.0.0.1:3000', port: 3000,
  secrets: { legacyHmacKey: 'moondropapp&&', cookie: 'c'.repeat(43), fingerprint: 'f'.repeat(43), subject: 's'.repeat(43), encryption: 'e'.repeat(43) },
  admin: { username: 'ops', passwordHash: 'hash' }, databases: { oidc: '', accounts: '' },
  redisUrl: 'redis://127.0.0.1:6379/0', redisUsername: null, redisPassword: null,
  trustedProxyCidrs: [], loginRateLimit: { windowSeconds: 900, accountAttempts: 10, ipAttempts: 100 },
  smtp: null, accountPortal: null, profilePictureBaseUrl: null,
} satisfies ServiceConfig;

test('developer sign-in uses the provider authorization endpoint and preserves the console return path', async (context) => {
  let storedState = '';
  const redis = {
    set: async (_key: string, value: string) => { storedState = value; return 'OK'; },
    eval: async () => null,
  };
  const provider = {
    createContext: () => ({}),
    Session: { get: async () => ({ accountId: undefined }) },
  } as unknown as Provider;
  const app = express();
  app.use('/portal', createUserPortalRouter({} as Pool, provider, {} as AccountService, config, redis));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/portal/sign-in?return=%2Fdeveloper%2Foverview`, { redirect: 'manual' });
  const location = response.headers.get('location');
  assert.ok(location);

  assert.equal(response.status, 303);
  assert.equal(new URL(location).pathname, '/auth');
  assert.equal((JSON.parse(storedState) as { returnTo: string }).returnTo, '/developer/overview');
});
