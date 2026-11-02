import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';
import type Provider from 'oidc-provider';
import type { Pool } from 'pg';

import type { AccountService } from '../src/accounts.js';
import type { ServiceConfig } from '../src/config.js';
import { createSessionApiRouter } from '../src/session-api.js';

const config = {
  mode: 'development', issuer: 'http://127.0.0.1:3000', port: 3000,
  secrets: { legacyHmacKey: 'legacy-key&&', cookie: 'c'.repeat(43), fingerprint: 'f'.repeat(43), subject: 's'.repeat(43), encryption: 'e'.repeat(43) },
  admin: { username: 'ops', passwordHash: 'hash' }, databases: { oidc: '', accounts: '' },
  redisUrl: 'redis://127.0.0.1:6379/0', redisUsername: null, redisPassword: null,
  trustedProxyCidrs: [], loginRateLimit: { windowSeconds: 900, accountAttempts: 10, ipAttempts: 100 },
  smtp: null, accountPortal: null, profilePictureBaseUrl: null,
} satisfies ServiceConfig;

async function startSessionApi(accountId: string | undefined, adminAuthenticated: boolean) {
  const provider = {
    createContext: () => ({}),
    Session: { get: async () => ({ accountId }) },
  } as unknown as Provider;
  const accounts = {
    resolve: async () => accountId ? { uuid: 'user-1', profile: { nickname: 'Moon', email: 'moon@example.test', picture: null } } : null,
  } as unknown as AccountService;
  const pool = {
    query: async () => ({ rowCount: adminAuthenticated ? 1 : 0, rows: adminAuthenticated ? [{}] : [] }),
  } as unknown as Pool;
  const app = express();
  app.use('/api/v1/session', createSessionApiRouter(provider, accounts, pool, config));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}/api/v1/session` };
}

test('returns an anonymous bootstrap with a CSRF token', async (context) => {
  const fixture = await startSessionApi(undefined, false);
  context.after(() => new Promise<void>((resolve) => fixture.server.close(() => resolve())));

  const response = await fetch(fixture.url);
  const body = await response.json() as { data: { account: unknown; admin: { authenticated: boolean }; csrfToken: string } };

  assert.equal(response.status, 200);
  assert.equal(body.data.account, null);
  assert.equal(body.data.admin.authenticated, false);
  assert.match(body.data.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(response.headers.get('set-cookie') ?? '', /dt-console-csrf=/);
});

test('returns account and admin roles without exposing session identifiers', async (context) => {
  const accountId = 'user-1.' + 'a'.repeat(43);
  const fixture = await startSessionApi(accountId, true);
  context.after(() => new Promise<void>((resolve) => fixture.server.close(() => resolve())));

  const response = await fetch(fixture.url, { headers: { cookie: 'dt-admin=admin-session-token' } });
  const body = await response.json() as { data: Record<string, unknown> };
  const serialized = JSON.stringify(body);

  assert.deepEqual(body.data.account, { uuid: 'user-1', nickname: 'Moon', email: 'm***@example.test', picture: null });
  assert.deepEqual(body.data.admin, { authenticated: true, username: 'ops' });
  assert.doesNotMatch(serialized, /accountId|admin-session-token|fingerprint/i);
});
